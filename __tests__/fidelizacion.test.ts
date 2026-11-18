/**
 * Fidelización: la tarjeta de sellos (el premio al cobrar) y los clientes que
 * no han vuelto. Ver src/modules/fidelizacion/fidelizacion.ts.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

const TEL = ['+573157772301', '+573157772302', '+573157772303'];
const PLACAS = ['FID001', 'FID002', 'FID003'];
let admin: string;
let completo: string;
let encerado: string;
let metaOriginal: number;
let diasOriginal: number;
const auth = () => ({ Authorization: `Bearer ${admin}` });

async function limpiar(): Promise<void> {
  await db.queryAdmin(
    `DELETE FROM payments WHERE appointment_id IN (SELECT a.id FROM appointments a JOIN vehicles v ON v.id = a.vehicle_id WHERE v.plate = ANY($1))`,
    [PLACAS],
  );
  await db.queryAdmin(`DELETE FROM appointments WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate = ANY($1))`, [PLACAS]);
  await db.queryAdmin(`DELETE FROM vehicles WHERE plate = ANY($1)`, [PLACAS]);
  await db.queryAdmin(`DELETE FROM customers WHERE phone = ANY($1)`, [TEL]);
}

/** Un turno del cliente `i`, llevado hasta «listo». */
async function turnoListo(i: number, adicionales: string[] = []): Promise<{ id: string; price: number; customer_id: string }> {
  const t = await request(app).post('/api/appointments/quick').set(auth()).send({
    autorizaDatos: true, customerPhone: TEL[i], customerFirstName: `Fiel${i}`, plate: PLACAS[i], vehicleType: 'sedan',
    serviceId: completo, adicionales,
  });
  expect(t.status).toBe(201);
  for (const status of ['in_progress', 'done']) {
    await request(app).patch(`/api/appointments/${t.body.id}/status`).set(auth()).send({ status });
  }
  return t.body;
}

const pagar = (appointmentId: string, extra: Record<string, unknown> = {}) =>
  request(app).post('/api/payments').set(auth()).send({ appointmentId, amount: 4000000, paymentMethod: 'cash', ...extra });
const sellos = async (appointmentId: string) =>
  (await request(app).get(`/api/appointments/${appointmentId}/fidelidad`).set(auth())).body;

beforeAll(async () => {
  admin = (await request(app).post('/api/auth/login').send({ email: 'admin@elbrillante.co', password: 'admin123' })).body.accessToken;
  const servicios = (await request(app).get('/api/services').set(auth())).body as Array<{ id: string; name: string }>;
  completo = servicios.find((s) => s.name === 'Lavado Completo')!.id;
  encerado = servicios.find((s) => s.name === 'Encera tú mismo')!.id;
  const { rows } = await db.queryAdmin<{ meta: number; dias: number }>(
    `SELECT fidelidad_sellos_meta AS meta, fidelidad_dias_regreso AS dias FROM tenants WHERE slug = 'el-brillante'`,
  );
  metaOriginal = rows[0].meta;
  diasOriginal = rows[0].dias;
  await limpiar();
  // El 3.er lavado gratis, para no tener que hacer cinco.
  const r = await request(app).patch('/api/tenants/me').set(auth()).send({ fidelidad_sellos_meta: 3, fidelidad_dias_regreso: 30 });
  expect(r.status).toBe(200);
});

afterAll(async () => {
  await db.queryAdmin(
    `UPDATE tenants SET fidelidad_sellos_meta = $1, fidelidad_dias_regreso = $2 WHERE slug = 'el-brillante'`,
    [metaOriginal, diasOriginal],
  );
  await limpiar();
  await db.pool.end();
});

describe('tarjeta de sellos', () => {
  it('cada lavado pagado suma; al completar la meta el siguiente es gratis, y vuelve a empezar', async () => {
    const t1 = await turnoListo(0);
    expect(await sellos(t1.id)).toMatchObject({ meta: 3, sellos: 0, faltan: 2, premioDisponible: false });
    expect((await pagar(t1.id)).status).toBe(201);

    const t2 = await turnoListo(0);
    expect((await sellos(t2.id)).sellos).toBe(1);
    // Sin el premio, pedirlo no sirve.
    expect((await pagar(t2.id, { premio: true })).status).toBe(409);
    expect((await pagar(t2.id)).status).toBe(201);

    const t3 = await turnoListo(0);
    expect(await sellos(t3.id)).toMatchObject({ sellos: 2, faltan: 0, premioDisponible: true });
    const premio = await pagar(t3.id, { premio: true, amount: 999 });
    expect(premio.status).toBe(201);
    // El monto lo calcula el backend: gratis, aunque el panel mande otra cosa.
    expect(premio.body).toMatchObject({ origen: 'premio', amount: 0, descuento: t3.price });

    const t4 = await turnoListo(0);
    expect(await sellos(t4.id)).toMatchObject({ sellos: 0, premioDisponible: false });
  });

  it('con premio, los adicionales se cobran', async () => {
    for (let i = 0; i < 2; i++) expect((await pagar((await turnoListo(1)).id)).status).toBe(201);
    const t = await turnoListo(1, [encerado]);
    const premio = await pagar(t.id, { premio: true });
    expect(premio.status).toBe(201);
    expect(premio.body.amount).toBe(2000000); // el encerado
    expect(premio.body.descuento).toBe(t.price - 2000000);
  });

  it('un pago normal en 0 sigue sin poderse', async () => {
    const t = await turnoListo(2);
    expect((await pagar(t.id, { amount: 0 })).status).toBe(400);
  });

  it('la meta se configura entre 2 y 50, o 0 para apagarla', async () => {
    expect((await request(app).patch('/api/tenants/me').set(auth()).send({ fidelidad_sellos_meta: 1 })).status).toBe(400);
    await request(app).patch('/api/tenants/me').set(auth()).send({ fidelidad_sellos_meta: 0 });
    const t = await turnoListo(2);
    expect(await sellos(t.id)).toMatchObject({ meta: 0, premioDisponible: false });
    await request(app).patch('/api/tenants/me').set(auth()).send({ fidelidad_sellos_meta: 3 });
  });
});

describe('clientes que no han vuelto', () => {
  const lista = async () => (await request(app).get('/api/customers/sin-volver').set(auth())).body;

  it('aparece quien lleva más de N días sin venir; al invitarlo deja de aparecer', async () => {
    await limpiar();
    const t = await turnoListo(0);
    await pagar(t.id);
    await request(app).patch(`/api/appointments/${t.id}/status`).set(auth()).send({ status: 'delivered' });
    expect((await lista()).clientes.map((c: { telefono: string }) => c.telefono)).not.toContain(TEL[0]);

    await db.queryAdmin(`UPDATE appointments SET scheduled_date = CURRENT_DATE - 40 WHERE id = $1`, [t.id]);
    const conEl = (await lista()).clientes.find((c: { telefono: string }) => c.telefono === TEL[0]);
    expect(conEl).toMatchObject({ nombre: 'Fiel0', placa: PLACAS[0], visitas: 1 });
    expect(conEl.diasSinVenir).toBeGreaterThanOrEqual(40);

    const inv = await request(app).post(`/api/customers/${t.customer_id}/invitado`).set(auth());
    expect(inv.status).toBe(200);
    expect(inv.body).toMatchObject({ telefono: TEL[0], slug: 'el-brillante' });
    expect((await lista()).clientes.map((c: { telefono: string }) => c.telefono)).not.toContain(TEL[0]);
  });

  it('quien ya tiene un turno pendiente no aparece', async () => {
    await limpiar();
    const t = await turnoListo(1);
    await pagar(t.id);
    await request(app).patch(`/api/appointments/${t.id}/status`).set(auth()).send({ status: 'delivered' });
    await db.queryAdmin(`UPDATE appointments SET scheduled_date = CURRENT_DATE - 40 WHERE id = $1`, [t.id]);
    await request(app).post('/api/appointments/quick').set(auth()).send({
      customerPhone: TEL[1], customerFirstName: 'Fiel1', plate: PLACAS[1], vehicleType: 'sedan', serviceId: completo,
    });
    expect((await lista()).clientes.map((c: { telefono: string }) => c.telefono)).not.toContain(TEL[1]);
  });
});
