/**
 * Servicios adicionales («encera tú mismo»): se suman a un lavado, alargan lo
 * que el turno ocupa la bahía y suman su precio. Ver
 * src/modules/appointments/adicionales.ts.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

const BASE = '/api/publico/lavaderos/el-brillante/reservas';
const TEL = ['+573159990001', '+573159990002', '+573159990003', '+573159990004', '+573159990005'];
const PLACAS = ['ADC001', 'ADC002', 'ADC003', 'ADC004', 'ADC005'];

let token: string;
let encerado: { id: string; minutos: number; precios: Record<string, number | null> };
let completo: { id: string; minutos: number; precios: Record<string, number | null> };
let basico: { id: string };
const auth = () => ({ Authorization: `Bearer ${token}` });

interface Dia { fecha: string; horas: string[] }

async function limpiar(): Promise<void> {
  await db.queryAdmin(
    `DELETE FROM appointment_status_log WHERE appointment_id IN
       (SELECT a.id FROM appointments a JOIN vehicles v ON v.id = a.vehicle_id WHERE v.plate = ANY($1))`,
    [PLACAS],
  );
  await db.queryAdmin(
    `DELETE FROM appointments WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate = ANY($1))`,
    [PLACAS],
  );
  await db.queryAdmin(`DELETE FROM vehicles WHERE plate = ANY($1)`, [PLACAS]);
  await db.queryAdmin(`DELETE FROM customers WHERE phone = ANY($1)`, [TEL]);
}

const ultimoDia = async (servicio: string, adicionales: string[] = []): Promise<Dia> => {
  const q: Record<string, string> = { servicio };
  if (adicionales.length) q.adicionales = adicionales.join(',');
  const dias: Dia[] = (await request(app).get(`${BASE}/horarios`).query(q)).body.dias;
  return dias[dias.length - 1];
};

const reserva = (extra: Record<string, unknown>) => ({
  autorizaDatos: true,
  servicioId: completo.id,
  tipoVehiculo: 'sedan',
  nombre: 'Adicional',
  telefono: TEL[0],
  placa: PLACAS[0],
  ...extra,
});

beforeAll(async () => {
  const login = await request(app).post('/api/auth/login').send({ email: 'admin@elbrillante.co', password: 'admin123' });
  token = login.body.accessToken;
  const datos = (await request(app).get(BASE)).body;
  encerado = datos.adicionales.find((s: { nombre: string }) => s.nombre === 'Encera tú mismo');
  completo = datos.servicios.find((s: { nombre: string }) => s.nombre === 'Lavado Completo');
  basico = datos.servicios.find((s: { nombre: string }) => s.nombre === 'Lavado Básico');
  await limpiar();
});

afterAll(async () => {
  await limpiar();
  await db.pool.end();
});

describe('la página de reservas', () => {
  beforeEach(limpiar);

  it('ofrece el adicional aparte, nunca como lavado', async () => {
    const datos = (await request(app).get(BASE)).body;
    expect(encerado).toBeDefined();
    expect(encerado.precios.sedan).toBe(20000);
    expect(datos.servicios.map((s: { nombre: string }) => s.nombre)).not.toContain('Encera tú mismo');
  });

  it('un adicional no se puede reservar solo', async () => {
    const dia = await ultimoDia(completo.id);
    const res = await request(app).post(BASE).send(reserva({ servicioId: encerado.id, fecha: dia.fecha, hora: dia.horas[0] }));
    expect(res.status).toBe(404);
  });

  it('con el adicional, el turno dura más: la última hora posible es más temprano', async () => {
    const sin = await ultimoDia(completo.id);
    const con = await ultimoDia(completo.id, [encerado.id]);
    const ultima = (d: Dia) => d.horas[d.horas.length - 1];
    // 60 min de lavado vs 90 con el encerado: la última hora retrocede 30 min.
    const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
    expect(aMin(ultima(sin)) - aMin(ultima(con))).toBe(encerado.minutos);
  });

  it('reservar con el adicional suma su precio y lo guarda en el turno', async () => {
    const dia = await ultimoDia(completo.id, [encerado.id]);
    const res = await request(app).post(BASE).send(reserva({ adicionales: [encerado.id], fecha: dia.fecha, hora: dia.horas[0] }));
    expect(res.status).toBe(201);
    expect(res.body.precio).toBe(60000); // 40.000 del lavado + 20.000 del encerado
    expect(res.body.adicionales).toEqual(['Encera tú mismo']);

    const { rows } = await db.queryAdmin<{ price: number; extras: string }>(
      `SELECT a.price, (SELECT COUNT(*) FROM appointment_extras e WHERE e.appointment_id = a.id) AS extras
         FROM appointments a JOIN vehicles v ON v.id = a.vehicle_id WHERE v.plate = $1`,
      [PLACAS[0]],
    );
    expect(rows[0]).toMatchObject({ price: 6000000, extras: '1' });
  });

  it('el tiempo del adicional ocupa la bahía: llena con lavado + encerado, la hora siguiente tampoco queda', async () => {
    const dia = await ultimoDia(completo.id, [encerado.id]);
    const hora = dia.horas[0];
    const { rows } = await db.queryAdmin<{ bays_count: number }>(`SELECT bays_count FROM tenants WHERE slug = 'el-brillante'`);
    for (let i = 0; i < rows[0].bays_count; i++) {
      const r = await request(app).post(BASE).send(reserva({ telefono: TEL[i], placa: PLACAS[i], adicionales: [encerado.id], fecha: dia.fecha, hora }));
      expect(r.status).toBe(201);
    }
    // Lavado de 60 + encerado de 30: una hora después siguen ocupadas.
    const [h, m] = hora.split(':').map(Number);
    const unaHoraDespues = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const despues = (await request(app).get(`${BASE}/horarios`).query({ servicio: basico.id })).body.dias
      .find((d: Dia) => d.fecha === dia.fecha);
    expect(despues?.horas ?? []).not.toContain(unaHoraDespues);
  });

  it('un id que no es adicional se rechaza', async () => {
    const dia = await ultimoDia(completo.id);
    const res = await request(app).post(BASE).send(reserva({ adicionales: [basico.id], fecha: dia.fecha, hora: dia.horas[0] }));
    expect(res.status).toBe(400);
  });
});

describe('el panel', () => {
  beforeEach(limpiar);

  const rapido = (extra: Record<string, unknown>) =>
    request(app).post('/api/appointments/quick').set(auth()).send({
      autorizaDatos: true, customerPhone: TEL[0], customerFirstName: 'Panel', plate: PLACAS[0],
      vehicleType: 'sedan', serviceId: completo.id, ...extra,
    });

  it('el turno rápido suma el adicional y lo devuelve en el turno', async () => {
    const res = await rapido({ adicionales: [encerado.id] });
    expect(res.status).toBe(201);
    expect(res.body.price).toBe(6000000);
    expect(res.body.adicionales).toEqual([expect.objectContaining({ nombre: 'Encera tú mismo', precio: 2000000, minutos: 30 })]);
    expect(res.body.minutos_adicionales).toBe(30);
  });

  it('terminado el lavado empieza el adicional, una sola vez y sólo si está en lavado', async () => {
    const turno = (await rapido({ adicionales: [encerado.id] })).body;
    const empezar = () => request(app).patch(`/api/appointments/${turno.id}/adicional`).set(auth());

    expect((await empezar()).status).toBe(409); // todavía esperando
    await request(app).patch(`/api/appointments/${turno.id}/status`).set(auth()).send({ status: 'in_progress' });
    const ok = await empezar();
    expect(ok.status).toBe(200);
    expect(ok.body.adicional_iniciado_at).not.toBeNull();
    expect((await empezar()).status).toBe(409); // ya empezó

    // Y se marca listo como cualquier turno.
    const listo = await request(app).patch(`/api/appointments/${turno.id}/status`).set(auth()).send({ status: 'done' });
    expect(listo.status).toBe(200);
  });

  it('un turno sin adicionales no tiene fase de adicional', async () => {
    const turno = (await rapido({})).body;
    await request(app).patch(`/api/appointments/${turno.id}/status`).set(auth()).send({ status: 'in_progress' });
    expect((await request(app).patch(`/api/appointments/${turno.id}/adicional`).set(auth())).status).toBe(409);
  });

  it('se puede crear un servicio adicional desde Configuración', async () => {
    const res = await request(app).post('/api/services').set(auth()).send({
      name: 'Prueba adicional', priceSedan: 1000000, estimatedMinutes: 20, esAdicional: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.es_adicional).toBe(true);
    await db.queryAdmin('DELETE FROM services WHERE id = $1', [res.body.id]);
  });
});
