/**
 * «Primeros pasos»: qué se detecta solo, qué se marca al guardar, y que se
 * puede cerrar. Ver src/modules/primeros-pasos/primeros-pasos.ts.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

let admin: string;
let original: unknown;
const auth = () => ({ Authorization: `Bearer ${admin}` });
const estado = async () => (await request(app).get('/api/tenants/me/primeros-pasos').set(auth())).body;
const paso = (e: { pasos: Array<{ clave: string; hecho: boolean }> }, clave: string) => e.pasos.find((p) => p.clave === clave)!.hecho;

beforeAll(async () => {
  admin = (await request(app).post('/api/auth/login').send({ email: 'admin@elbrillante.co', password: 'admin123' })).body.accessToken;
  const { rows } = await db.queryAdmin<{ p: unknown }>(`SELECT primeros_pasos AS p FROM tenants WHERE slug = 'el-brillante'`);
  original = rows[0].p;
  await db.queryAdmin(`UPDATE tenants SET primeros_pasos = '{}'::jsonb WHERE slug = 'el-brillante'`);
});

afterAll(async () => {
  await db.queryAdmin(`UPDATE tenants SET primeros_pasos = $1::jsonb WHERE slug = 'el-brillante'`, [JSON.stringify(original)]);
  await db.pool.end();
});

it('detecta lo que ya hay: datos de contacto, operarios y turnos (la demo los tiene)', async () => {
  const e = await estado();
  expect(e.cerrado).toBe(false);
  expect(e.pasos.map((p: { clave: string }) => p.clave)).toEqual(['datos', 'horario', 'servicios', 'equipo', 'reservas', 'turno']);
  expect(paso(e, 'datos')).toBe(true);
  expect(paso(e, 'equipo')).toBe(true);
  expect(paso(e, 'horario')).toBe(false);
  expect(paso(e, 'servicios')).toBe(false);
});

it('el horario y los servicios se marcan al guardarlos', async () => {
  await request(app).patch('/api/tenants/me').set(auth()).send({ bays_count: 3 });
  expect(paso(await estado(), 'horario')).toBe(true);

  const svc = (await request(app).get('/api/services').set(auth())).body[0];
  await request(app).patch(`/api/services/${svc.id}`).set(auth()).send({ estimatedMinutes: svc.estimated_minutes });
  expect(paso(await estado(), 'servicios')).toBe(true);
});

it('el enlace de reservas se marca a mano (al copiarlo), y la guía se puede cerrar', async () => {
  const r = await request(app).post('/api/tenants/me/primeros-pasos').set(auth()).send({ paso: 'reservas' });
  expect(r.status).toBe(200);
  expect(paso(r.body, 'reservas')).toBe(true);
  expect((await request(app).post('/api/tenants/me/primeros-pasos').set(auth()).send({ paso: 'inventado' })).status).toBe(400);
  const c = await request(app).post('/api/tenants/me/primeros-pasos').set(auth()).send({ cerrar: true });
  expect(c.body.cerrado).toBe(true);
  const a = await request(app).post('/api/tenants/me/primeros-pasos').set(auth()).send({ abrir: true });
  expect(a.body.cerrado).toBe(false);
  expect(paso(a.body, 'reservas')).toBe(true); // reabrirla no borra lo hecho
});
