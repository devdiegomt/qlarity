/**
 * Tiquetera: paquetes, venta, uso al cobrar, saldo, vencimiento, y que la
 * plata entre a los reportes el día de la venta. Ver
 * src/modules/fidelizacion/tiquetera.ts.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

const TEL = '+573157773401';
const PLACA = 'TIQ001';
let admin: string;
let operario: string;
let completo: string;
let basico: string;
let encerado: string;
let customerId: string;
const auth = (t = admin) => ({ Authorization: `Bearer ${t}` });
const login = async (email: string) =>
  (await request(app).post('/api/auth/login').send({ email, password: 'admin123' })).body.accessToken as string;

async function limpiar(): Promise<void> {
  await db.queryAdmin(`DELETE FROM payments WHERE appointment_id IN (SELECT a.id FROM appointments a JOIN vehicles v ON v.id = a.vehicle_id WHERE v.plate = $1)`, [PLACA]);
  await db.queryAdmin(`DELETE FROM tiqueteras WHERE customer_id IN (SELECT id FROM customers WHERE phone = $1)`, [TEL]);
  await db.queryAdmin(`DELETE FROM appointments WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate = $1)`, [PLACA]);
  await db.queryAdmin(`DELETE FROM vehicles WHERE plate = $1`, [PLACA]);
  await db.queryAdmin(`DELETE FROM customers WHERE phone = $1`, [TEL]);
  await db.queryAdmin(`DELETE FROM paquetes_lavado WHERE nombre LIKE 'Prueba TIQ%'`);
}

async function turnoListo(serviceId = completo, adicionales: string[] = []): Promise<{ id: string; customer_id: string; price: number }> {
  const t = await request(app).post('/api/appointments/quick').set(auth()).send({
    autorizaDatos: true, customerPhone: TEL, customerFirstName: 'Tiquetera', plate: PLACA, vehicleType: 'sedan', serviceId, adicionales,
  });
  expect(t.status).toBe(201);
  for (const status of ['in_progress', 'done']) await request(app).patch(`/api/appointments/${t.body.id}/status`).set(auth()).send({ status });
  customerId = t.body.customer_id;
  return t.body;
}

const paquete = (extra: Record<string, unknown> = {}) =>
  request(app).post('/api/paquetes').set(auth()).send({ nombre: 'Prueba TIQ 5 completos', serviceId: completo, cantidad: 5, precio: 18000000, vigenciaDias: 90, ...extra });
const vender = (paqueteId: string) =>
  request(app).post(`/api/customers/${customerId}/tiqueteras`).set(auth()).send({ paqueteId, metodoPago: 'nequi' });
const pagarCon = (appointmentId: string, tiqueteraId: string) =>
  request(app).post('/api/payments').set(auth()).send({ appointmentId, amount: 0, paymentMethod: 'cash', tiqueteraId });

beforeAll(async () => {
  admin = await login('admin@elbrillante.co');
  operario = await login('maria@elbrillante.co');
  const servicios = (await request(app).get('/api/services').set(auth())).body as Array<{ id: string; name: string }>;
  completo = servicios.find((s) => s.name === 'Lavado Completo')!.id;
  basico = servicios.find((s) => s.name === 'Lavado Básico')!.id;
  encerado = servicios.find((s) => s.name === 'Encera tú mismo')!.id;
  await limpiar();
});
beforeEach(limpiar);
afterAll(async () => {
  await limpiar();
  await db.pool.end();
});

it('los paquetes los crea un admin, y sólo de un lavado (no de un adicional)', async () => {
  expect((await request(app).post('/api/paquetes').set(auth(operario)).send({ nombre: 'Prueba TIQ x', serviceId: completo, cantidad: 5, precio: 100 })).status).toBe(403);
  expect((await paquete({ serviceId: encerado })).status).toBe(400);
  const ok = await paquete();
  expect(ok.status).toBe(201);
  expect(ok.body).toMatchObject({ nombre: 'Prueba TIQ 5 completos', cantidad: 5, servicio: 'Lavado Completo' });
});

it('se vende, se usa al cobrar (el lavado sale en $0) y descuenta del saldo', async () => {
  const t1 = await turnoListo();
  const tiq = (await vender((await paquete()).body.id)).body;
  expect(tiq).toMatchObject({ cantidad: 5, usados: 0, quedan: 5, precio: 18000000 });
  expect(tiq.vence_el).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const aplicables = (await request(app).get(`/api/appointments/${t1.id}/tiqueteras`).set(auth())).body;
  expect(aplicables.map((x: { id: string }) => x.id)).toEqual([tiq.id]);

  const pago = await pagarCon(t1.id, tiq.id);
  expect(pago.status).toBe(201);
  expect(pago.body).toMatchObject({ origen: 'tiquetera', amount: 0, tiquetera_id: tiq.id });

  const lista = (await request(app).get(`/api/customers/${customerId}/tiqueteras`).set(auth())).body;
  expect(lista[0]).toMatchObject({ usados: 1, quedan: 4, vencida: false, agotada: false });
});

it('con adicionales, se cobran los adicionales', async () => {
  const t = await turnoListo(completo, [encerado]);
  const tiq = (await vender((await paquete()).body.id)).body;
  const pago = await pagarCon(t.id, tiq.id);
  expect(pago.body.amount).toBe(2000000);
});

it('no sirve para otro servicio, vencida, ni sin saldo', async () => {
  const otro = await turnoListo(basico);
  const tiq = (await vender((await paquete({ cantidad: 2 })).body.id)).body;
  expect((await request(app).get(`/api/appointments/${otro.id}/tiqueteras`).set(auth())).body).toEqual([]);
  expect((await pagarCon(otro.id, tiq.id)).status).toBe(409);

  for (let i = 0; i < 2; i++) expect((await pagarCon((await turnoListo()).id, tiq.id)).status).toBe(201);
  expect((await pagarCon((await turnoListo()).id, tiq.id)).status).toBe(409); // agotada

  const otra = (await vender((await paquete()).body.id)).body;
  // «Ayer» del lavadero (Bogotá), no de la base: de noche, en UTC ya es mañana.
  await db.queryAdmin(
    `UPDATE tiqueteras t SET vence_el = (NOW() AT TIME ZONE tn.timezone)::date - 1 FROM tenants tn WHERE tn.id = t.tenant_id AND t.id = $1`,
    [otra.id],
  );
  expect((await pagarCon((await turnoListo()).id, otra.id)).status).toBe(409); // vencida
});

it('el último lavado no se puede gastar dos veces a la vez', async () => {
  const primero = await turnoListo(); // crea al cliente antes de venderle
  const tiq = (await vender((await paquete({ cantidad: 2 })).body.id)).body;
  expect((await pagarCon(primero.id, tiq.id)).status).toBe(201);
  const [a, b] = [await turnoListo(), await turnoListo()];
  const r = await Promise.all([pagarCon(a.id, tiq.id), pagarCon(b.id, tiq.id)]);
  expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
  const { rows } = await db.queryAdmin<{ usados: number }>('SELECT usados FROM tiqueteras WHERE id = $1', [tiq.id]);
  expect(rows[0].usados).toBe(2);
});

it('premio y tiquetera a la vez no; y lo pagado con tiquetera no suma sellos', async () => {
  const t = await turnoListo();
  const tiq = (await vender((await paquete()).body.id)).body;
  const ambos = await request(app).post('/api/payments').set(auth()).send({ appointmentId: t.id, amount: 0, paymentMethod: 'cash', tiqueteraId: tiq.id, premio: true });
  expect(ambos.status).toBe(400);
  await pagarCon(t.id, tiq.id);
  const s = (await request(app).get(`/api/customers/${customerId}/fidelidad`).set(auth())).body;
  expect(s.sellos).toBe(0);
});

it('la venta entra a los ingresos el día que se vende', async () => {
  const antesHoy = (await request(app).get('/api/tenants/me/stats').set(auth())).body.revenue.total;
  const antesRep = (await request(app).get('/api/reports/dashboard?period=today').set(auth())).body.summary.total_revenue;
  await turnoListo();
  await vender((await paquete()).body.id);
  expect((await request(app).get('/api/tenants/me/stats').set(auth())).body.revenue.total).toBe(antesHoy + 18000000);
  const rep = (await request(app).get('/api/reports/dashboard?period=today').set(auth())).body.summary;
  expect(rep.total_revenue).toBe(antesRep + 18000000);
  const metodos = (await request(app).get('/api/reports/revenue?period=today').set(auth())).body.byMethod;
  expect(metodos.find((m: { method: string }) => m.method === 'nequi').total).toBeGreaterThanOrEqual(18000000);
});
