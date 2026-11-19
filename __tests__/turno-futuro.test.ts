/**
 * Un turno de otro día no se puede iniciar: es una reserva y el carro todavía
 * no está. Si el cliente llega antes, se pasa a hoy («Atender hoy» en el panel)
 * y ahí sí se inicia.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import { getDateInTimezone, sumarDias } from '../src/shared/utils/dateUtils';

const TEL = '+573157775501';
const PLACA = 'FUT001';
let admin: string;
let hoy: string;
let turnoId: string;
const auth = () => ({ Authorization: `Bearer ${admin}` });

async function limpiar(): Promise<void> {
  await db.queryAdmin(`DELETE FROM appointments WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate = $1)`, [PLACA]);
  await db.queryAdmin(`DELETE FROM vehicles WHERE plate = $1`, [PLACA]);
  await db.queryAdmin(`DELETE FROM customers WHERE phone = $1`, [TEL]);
}

beforeAll(async () => {
  admin = (await request(app).post('/api/auth/login').send({ email: 'admin@elbrillante.co', password: 'admin123' })).body.accessToken;
  await limpiar();
  const t = await request(app).post('/api/appointments/quick').set(auth()).send({
    autorizaDatos: true, customerPhone: TEL, customerFirstName: 'Futuro', plate: PLACA, vehicleType: 'sedan',
    serviceId: (await request(app).get('/api/services').set(auth())).body[0].id,
  });
  turnoId = t.body.id;
  const { rows } = await db.queryAdmin<{ timezone: string }>(`SELECT timezone FROM tenants WHERE slug = 'el-brillante'`);
  hoy = getDateInTimezone(rows[0].timezone);
  // Como una reserva web para mañana.
  await db.queryAdmin(`UPDATE appointments SET scheduled_date = $2 WHERE id = $1`, [turnoId, sumarDias(hoy, 1)]);
});

afterAll(async () => {
  await limpiar();
  await db.pool.end();
});

const iniciar = () => request(app).patch(`/api/appointments/${turnoId}/status`).set(auth()).send({ status: 'in_progress' });

it('un turno de mañana no se puede iniciar, y el mensaje dice qué hacer', async () => {
  const res = await iniciar();
  expect(res.status).toBe(409);
  expect(res.body.details?.codigo).toBe('TURNO_FUTURO');
  expect(res.body.error).toMatch(/Atender hoy/);
  const { rows } = await db.queryAdmin<{ status: string }>('SELECT status FROM appointments WHERE id = $1', [turnoId]);
  expect(rows[0].status).toBe('pending');
});

it('pasado a hoy, se inicia', async () => {
  expect((await request(app).patch(`/api/appointments/${turnoId}`).set(auth()).send({ scheduledDate: hoy })).status).toBe(200);
  expect((await iniciar()).status).toBe(200);
});
