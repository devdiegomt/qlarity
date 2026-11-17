/**
 * `GET /api/appointments/proximas`: los turnos pendientes de los próximos días.
 *
 * El tablero muestra sólo hoy, y una reserva web para mañana no aparecía en
 * ninguna parte del panel salvo buscando la fecha a mano en la agenda.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import { getDateInTimezone, sumarDias } from '../src/shared/utils/dateUtils';

const TEL = ['+573157770101', '+573157770102', '+573157770103'];
const PLACAS = ['PRX001', 'PRX002', 'PRX003'];
let token: string;
let tenantId: string;
let serviceId: string;

async function limpiar(): Promise<void> {
  await db.queryAdmin(
    `DELETE FROM appointments WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate = ANY($1))`,
    [PLACAS],
  );
  await db.queryAdmin(`DELETE FROM vehicles WHERE plate = ANY($1)`, [PLACAS]);
  await db.queryAdmin(`DELETE FROM customers WHERE phone = ANY($1)`, [TEL]);
}

/** Un turno directo en la base, para controlar fecha, estado y origen. */
async function turno(i: number, fecha: string, status: string, source: string): Promise<void> {
  const { rows: c } = await db.queryAdmin<{ id: string }>(
    `INSERT INTO customers (tenant_id, first_name, phone) VALUES ($1, 'Próxima', $2) RETURNING id`,
    [tenantId, TEL[i]],
  );
  const { rows: v } = await db.queryAdmin<{ id: string }>(
    `INSERT INTO vehicles (tenant_id, customer_id, plate) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, c[0].id, PLACAS[i]],
  );
  await db.queryAdmin(
    `INSERT INTO appointments (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time, price, status, source)
     VALUES ($1, $2, $3, $4, $5, '10:00', 100, $6, $7)`,
    [tenantId, c[0].id, v[0].id, serviceId, fecha, status, source],
  );
}

beforeAll(async () => {
  const login = await request(app).post('/api/auth/login').send({ email: 'admin@elbrillante.co', password: 'admin123' });
  token = login.body.accessToken;
  const { rows } = await db.queryAdmin<{ id: string; timezone: string }>(`SELECT id, timezone FROM tenants WHERE slug = 'el-brillante'`);
  tenantId = rows[0].id;
  const svc = await db.queryAdmin<{ id: string }>(`SELECT id FROM services WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  serviceId = svc.rows[0].id;
  await limpiar();

  const hoy = getDateInTimezone(rows[0].timezone);
  await turno(0, sumarDias(hoy, 1), 'pending', 'web');   // mañana, web → sale
  await turno(1, hoy, 'pending', 'web');                  // hoy → ya está en el tablero
  await turno(2, sumarDias(hoy, 2), 'cancelled', 'web');  // cancelada → no sale
});

afterAll(async () => {
  await limpiar();
  await db.pool.end();
});

it('lista las pendientes de los próximos días, con su origen; no las de hoy ni las canceladas', async () => {
  const res = await request(app).get('/api/appointments/proximas').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const placas = (res.body as Array<{ plate: string; source: string }>).map((t) => t.plate);
  expect(placas).toContain('PRX001');
  expect(placas).not.toContain('PRX002');
  expect(placas).not.toContain('PRX003');
  expect(res.body.find((t: { plate: string }) => t.plate === 'PRX001').source).toBe('web');
});

it('sin sesión no responde', async () => {
  expect((await request(app).get('/api/appointments/proximas')).status).toBe(401);
});
