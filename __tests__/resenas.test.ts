/**
 * Calificaciones: el enlace que manda el lavadero, la página pública donde el
 * cliente responde, el paso a Google y el resumen del dueño. Ver
 * src/modules/resenas/resenas.ts.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

const TEL = '+573157771201';
const PLACA = 'RES001';
const PUB = '/api/publico/calificaciones';
let admin: string;
let operario: string;
let turnoId: string;
let googleOriginal: string | null;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const login = async (email: string) =>
  (await request(app).post('/api/auth/login').send({ email, password: 'admin123' })).body.accessToken as string;

async function limpiar(): Promise<void> {
  await db.queryAdmin(`DELETE FROM appointments WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate = $1)`, [PLACA]);
  await db.queryAdmin(`DELETE FROM vehicles WHERE plate = $1`, [PLACA]);
  await db.queryAdmin(`DELETE FROM customers WHERE phone = $1`, [TEL]);
}

const encuesta = () => request(app).post(`/api/appointments/${turnoId}/encuesta`).set(auth(admin));

beforeAll(async () => {
  admin = await login('admin@elbrillante.co');
  operario = await login('maria@elbrillante.co');
  await limpiar();
  const { rows } = await db.queryAdmin<{ google_review_url: string | null }>(`SELECT google_review_url FROM tenants WHERE slug = 'el-brillante'`);
  googleOriginal = rows[0].google_review_url;
  const svc = (await request(app).get('/api/services').set(auth(admin))).body[0];
  const t = await request(app).post('/api/appointments/quick').set(auth(admin)).send({
    autorizaDatos: true, customerPhone: TEL, customerFirstName: 'Reseña', plate: PLACA, vehicleType: 'sedan', serviceId: svc.id,
  });
  turnoId = t.body.id;
});

afterAll(async () => {
  await db.queryAdmin(`UPDATE tenants SET google_review_url = $1 WHERE slug = 'el-brillante'`, [googleOriginal]);
  await limpiar();
  await db.pool.end();
});

it('el enlace de Google del lavadero tiene que ser https, y vacío lo borra', async () => {
  const mal = await request(app).patch('/api/tenants/me').set(auth(admin)).send({ google_review_url: 'http://g.page/r/x' });
  expect(mal.status).toBe(400);
  const ok = await request(app).patch('/api/tenants/me').set(auth(admin)).send({ google_review_url: 'https://g.page/r/prueba/review' });
  expect(ok.status).toBe(200);
  expect(ok.body.google_review_url).toBe('https://g.page/r/prueba/review');
});

it('la encuesta se manda con el carro listo o entregado, y un turno tiene un solo enlace', async () => {
  expect((await encuesta()).status).toBe(409); // todavía esperando

  await db.queryAdmin(`UPDATE appointments SET status = 'delivered' WHERE id = $1`, [turnoId]);
  const primera = await encuesta();
  expect(primera.status).toBe(201);
  expect(primera.body.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(primera.body).toMatchObject({ cliente: 'Reseña', telefono: TEL, respondida: false });

  const otra = await encuesta();
  expect(otra.body.token).toBe(primera.body.token);
});

describe('la página del cliente', () => {
  let token: string;
  beforeAll(async () => {
    token = (await encuesta()).body.token;
  });

  it('muestra el lavadero y el servicio, y nada del cliente', async () => {
    const res = await request(app).get(`${PUB}/${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lavadero: 'Lavadero El Brillante', respondida: false });
    expect(JSON.stringify(res.body)).not.toMatch(/Reseña|3157771201|RES001/);
  });

  it('un token inventado o con forma rara es 404', async () => {
    expect((await request(app).get(`${PUB}/AAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(404);
    expect((await request(app).get(`${PUB}/x' OR 1=1`)).status).toBe(404);
  });

  it('se responde una sola vez, y después se ofrece Google', async () => {
    expect((await request(app).post(`${PUB}/${token}`).send({ estrellas: 0 })).status).toBe(400);

    const res = await request(app).post(`${PUB}/${token}`).send({ estrellas: 4, comentario: 'Muy bien, pero tardaron un poco' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ respondida: true, estrellas: 4, googleUrl: 'https://g.page/r/prueba/review' });

    const otra = await request(app).post(`${PUB}/${token}`).send({ estrellas: 1 });
    expect(otra.status).toBe(409);
    expect((await request(app).get(`${PUB}/${token}`)).body.estrellas).toBe(4);
  });

  it('ir a Google queda anotado', async () => {
    expect((await request(app).post(`${PUB}/${token}/google`)).status).toBe(204);
  });
});

describe('el resumen del dueño', () => {
  it('trae el promedio, la distribución y los comentarios', async () => {
    const res = await request(app).get('/api/calificaciones?dias=30').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.respondidas).toBeGreaterThanOrEqual(1);
    expect(res.body.distribucion['4']).toBeGreaterThanOrEqual(1);
    expect(res.body.aGoogle).toBeGreaterThanOrEqual(1);
    expect(res.body.recientes[0]).toMatchObject({ estrellas: 4, comentario: 'Muy bien, pero tardaron un poco', placa: PLACA });
  });

  it('un operario no lo ve', async () => {
    expect((await request(app).get('/api/calificaciones').set(auth(operario))).status).toBe(403);
  });
});
