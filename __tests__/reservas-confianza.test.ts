/**
 * Confianza en las reservas: «No vino» y el bloqueo por faltas, el bloqueo a
 * mano, el modo «por confirmar», el recordatorio, los turnos sin hora que
 * ocupan bahía, y la opción de que la tiquetera sume sellos.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

const BASE = '/api/publico/lavaderos/el-brillante/reservas';
const TEL = ['+573157776601', '+573157776602', '+573157776603', '+573157776604'];
const PLACAS = ['CNF001', 'CNF002', 'CNF003', 'CNF004', 'CNF005', 'CNF006'];
let admin: string;
let completo: { id: string };
let tenantId: string;
const auth = () => ({ Authorization: `Bearer ${admin}` });
interface Dia { fecha: string; horas: string[] }

async function limpiar(): Promise<void> {
  await db.queryAdmin(`DELETE FROM payments WHERE appointment_id IN (SELECT a.id FROM appointments a JOIN vehicles v ON v.id = a.vehicle_id WHERE v.plate = ANY($1))`, [PLACAS]);
  await db.queryAdmin(`DELETE FROM tiqueteras WHERE customer_id IN (SELECT id FROM customers WHERE phone = ANY($1))`, [TEL]);
  await db.queryAdmin(`DELETE FROM appointments WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate = ANY($1))`, [PLACAS]);
  await db.queryAdmin(`DELETE FROM vehicles WHERE plate = ANY($1)`, [PLACAS]);
  await db.queryAdmin(`DELETE FROM customers WHERE phone = ANY($1)`, [TEL]);
  await db.queryAdmin(`DELETE FROM paquetes_lavado WHERE nombre = 'Prueba CNF'`);
  await db.queryAdmin(`UPDATE tenants SET reservas_por_confirmar = false, fidelidad_tiquetera_suma_sellos = false, fidelidad_sellos_meta = 6 WHERE slug = 'el-brillante'`);
}

const ultimoDia = async (): Promise<Dia> => {
  const dias: Dia[] = (await request(app).get(`${BASE}/horarios`).query({ servicio: completo.id })).body.dias;
  return dias[dias.length - 1];
};
const reservar = (extra: Record<string, unknown>) =>
  request(app).post(BASE).send({ autorizaDatos: true, servicioId: completo.id, tipoVehiculo: 'sedan', nombre: 'Confianza', telefono: TEL[0], placa: PLACAS[0], ...extra });
const estado = (id: string, status: string) => request(app).patch(`/api/appointments/${id}/status`).set(auth()).send({ status });

/** Un turno de hoy del cliente `i`, sin hora, creado desde el panel. */
async function turnoHoy(i: number): Promise<{ id: string; customer_id: string }> {
  const t = await request(app).post('/api/appointments/quick').set(auth()).send({
    autorizaDatos: true, customerPhone: TEL[i], customerFirstName: 'Confianza', plate: PLACAS[i], vehicleType: 'sedan', serviceId: completo.id,
  });
  expect(t.status).toBe(201);
  return t.body;
}

beforeAll(async () => {
  admin = (await request(app).post('/api/auth/login').send({ email: 'admin@elbrillante.co', password: 'admin123' })).body.accessToken;
  completo = (await request(app).get(BASE)).body.servicios.find((s: { nombre: string }) => s.nombre === 'Lavado Completo');
  tenantId = (await db.queryAdmin<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'el-brillante'`)).rows[0].id;
});
beforeEach(limpiar);
afterAll(async () => {
  await limpiar();
  await db.pool.end();
});

describe('«No vino»', () => {
  it('se marca en un turno de hoy, se puede deshacer, y no en uno futuro', async () => {
    const t = await turnoHoy(0);
    expect((await estado(t.id, 'no_show')).status).toBe(200);
    expect((await estado(t.id, 'pending')).status).toBe(200); // llegó tarde después de todo

    const dia = await ultimoDia();
    const futura = await reservar({ fecha: dia.fecha, hora: dia.horas[0], telefono: TEL[1], placa: PLACAS[1] });
    const { rows } = await db.queryAdmin<{ id: string }>(
      `SELECT a.id FROM appointments a JOIN vehicles v ON v.id = a.vehicle_id WHERE v.plate = $1`, [PLACAS[1]],
    );
    expect(futura.status).toBe(201);
    const r = await estado(rows[0].id, 'no_show');
    expect(r.status).toBe(409);
    expect(r.body.details?.codigo).toBe('TURNO_FUTURO');
  });

  it('libera el cupo: con las bahías llenas, un «No vino» vuelve a abrir la hora', async () => {
    const dia = await ultimoDia();
    const hora = dia.horas[dia.horas.length - 1];
    const { rows: b } = await db.queryAdmin<{ bays_count: number }>(`SELECT bays_count FROM tenants WHERE id = $1`, [tenantId]);
    for (let i = 0; i < b[0].bays_count; i++) {
      expect((await reservar({ fecha: dia.fecha, hora, telefono: TEL[i], placa: PLACAS[i] })).status).toBe(201);
    }
    const horas = async () => ((await request(app).get(`${BASE}/horarios`).query({ servicio: completo.id })).body.dias as Dia[]).find((d) => d.fecha === dia.fecha)?.horas ?? [];
    expect(await horas()).not.toContain(hora);
    // (Se marca directo en la base: el turno es de otro día y desde el panel no se puede.)
    await db.queryAdmin(`UPDATE appointments SET status = 'no_show' WHERE vehicle_id = (SELECT id FROM vehicles WHERE plate = $1)`, [PLACAS[0]]);
    expect(await horas()).toContain(hora);
  });

  it('con 2 faltas en 90 días, ese número no puede reservar por la web', async () => {
    for (let i = 0; i < 2; i++) {
      const t = await turnoHoy(0);
      expect((await estado(t.id, 'no_show')).status).toBe(200);
    }
    const s = (await request(app).get(`/api/customers/${(await turnoHoy(0)).customer_id}/fidelidad`).set(auth())).body;
    expect(s.faltas).toBe(2);
    const dia = await ultimoDia();
    const r = await reservar({ fecha: dia.fecha, hora: dia.horas[0] });
    expect(r.status).toBe(409);
    expect(r.body.details?.codigo).toBe('BLOQUEADO');
    expect(JSON.stringify(r.body)).not.toMatch(/falt/i); // no dice por qué
  });
});

it('el lavadero puede bloquear un número a mano', async () => {
  const t = await turnoHoy(2);
  expect((await request(app).patch(`/api/customers/${t.customer_id}`).set(auth()).send({ bloqueadoWeb: true })).status).toBe(200);
  const dia = await ultimoDia();
  expect((await reservar({ fecha: dia.fecha, hora: dia.horas[0], telefono: TEL[2], placa: PLACAS[2] })).body.details?.codigo).toBe('BLOQUEADO');
});

it('modo «por confirmar»: la reserva entra pendiente de confirmar, y el lavadero la confirma', async () => {
  await request(app).patch('/api/tenants/me').set(auth()).send({ reservas_por_confirmar: true });
  expect((await request(app).get(BASE)).body.porConfirmar).toBe(true);
  const dia = await ultimoDia();
  const r = await reservar({ fecha: dia.fecha, hora: dia.horas[0] });
  expect(r.status).toBe(201);
  expect(r.body.porConfirmar).toBe(true);
  const { rows } = await db.queryAdmin<{ id: string; por_confirmar: boolean }>(
    `SELECT a.id, a.por_confirmar FROM appointments a JOIN vehicles v ON v.id = a.vehicle_id WHERE v.plate = $1`, [PLACAS[0]],
  );
  expect(rows[0].por_confirmar).toBe(true);
  expect((await request(app).post(`/api/appointments/${rows[0].id}/confirmar`).set(auth())).status).toBe(204);
  expect((await request(app).post(`/api/appointments/${rows[0].id}/recordado`).set(auth())).status).toBe(204);
  const { rows: d } = await db.queryAdmin<{ por_confirmar: boolean; recordado_at: Date | null }>('SELECT por_confirmar, recordado_at FROM appointments WHERE id = $1', [rows[0].id]);
  expect(d[0]).toMatchObject({ por_confirmar: false });
  expect(d[0].recordado_at).not.toBeNull();
});

it('un carro que llegó sin hora ocupa su bahía: la web no vende ese cupo', async () => {
  const dia = await ultimoDia();
  const hora = dia.horas[2];
  const { rows: b } = await db.queryAdmin<{ bays_count: number }>(`SELECT bays_count FROM tenants WHERE id = $1`, [tenantId]);
  for (let i = 0; i < b[0].bays_count; i++) {
    const t = await turnoHoy(i);
    // Como si se hubiera registrado ese día a esa hora, sin hora agendada.
    await db.queryAdmin(
      `UPDATE appointments a SET scheduled_date = $2, scheduled_time = NULL,
              created_at = ($2::date + $3::time) AT TIME ZONE tn.timezone
         FROM tenants tn WHERE tn.id = a.tenant_id AND a.id = $1`,
      [t.id, dia.fecha, hora],
    );
  }
  const despues = ((await request(app).get(`${BASE}/horarios`).query({ servicio: completo.id })).body.dias as Dia[]).find((d) => d.fecha === dia.fecha);
  expect(despues?.horas ?? []).not.toContain(hora);
});

it('si el lavadero lo elige, lo pagado con tiquetera suma sellos', async () => {
  await request(app).patch('/api/tenants/me').set(auth()).send({ fidelidad_tiquetera_suma_sellos: true });
  const t = await turnoHoy(3);
  for (const s of ['in_progress', 'done']) await estado(t.id, s);
  const paq = await request(app).post('/api/paquetes').set(auth()).send({ nombre: 'Prueba CNF', serviceId: completo.id, cantidad: 5, precio: 100000 });
  const tiq = await request(app).post(`/api/customers/${t.customer_id}/tiqueteras`).set(auth()).send({ paqueteId: paq.body.id, metodoPago: 'cash' });
  expect((await request(app).post('/api/payments').set(auth()).send({ appointmentId: t.id, amount: 0, paymentMethod: 'cash', tiqueteraId: tiq.body.id })).status).toBe(201);
  expect((await request(app).get(`/api/customers/${t.customer_id}/fidelidad`).set(auth())).body.sellos).toBe(1);
});
