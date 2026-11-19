/**
 * Con el captcha activo (TURNSTILE_SECRET), una reserva web sin un token válido
 * no entra. Sin red: se reemplaza `fetch` hacia Cloudflare.
 */
process.env.TURNSTILE_SECRET = 'secreto-de-prueba';
process.env.TURNSTILE_SITE_KEY = 'clave-publica-de-prueba';

import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

const BASE = '/api/publico/lavaderos/el-brillante/reservas';
const TEL = '+573157776701';
const PLACA = 'CAP001';
const fetchReal = global.fetch;
let respuestaCloudflare = { success: false };

beforeAll(() => {
  jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).includes('challenges.cloudflare.com')) return new Response(JSON.stringify(respuestaCloudflare));
    return fetchReal(url, init);
  });
});
afterAll(async () => {
  jest.restoreAllMocks();
  await db.queryAdmin(`DELETE FROM appointments WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate = $1)`, [PLACA]);
  await db.queryAdmin(`DELETE FROM vehicles WHERE plate = $1`, [PLACA]);
  await db.queryAdmin(`DELETE FROM customers WHERE phone = $1`, [TEL]);
  await db.pool.end();
});

it('la página entrega la clave pública del captcha, y sin token válido la reserva no entra', async () => {
  const datos = (await request(app).get(BASE)).body;
  expect(datos.captchaSiteKey).toBe('clave-publica-de-prueba');
  const completo = datos.servicios.find((s: { nombre: string }) => s.nombre === 'Lavado Completo');
  const dias = (await request(app).get(`${BASE}/horarios`).query({ servicio: completo.id })).body.dias;
  const dia = dias[dias.length - 1];
  const cuerpo = { autorizaDatos: true, servicioId: completo.id, tipoVehiculo: 'sedan', fecha: dia.fecha, hora: dia.horas[1], nombre: 'Captcha', telefono: TEL, placa: PLACA };

  const sin = await request(app).post(BASE).send(cuerpo);
  expect(sin.status).toBe(400);
  expect(sin.body.details?.codigo).toBe('CAPTCHA');

  respuestaCloudflare = { success: false };
  expect((await request(app).post(BASE).send({ ...cuerpo, captcha: 'falso' })).status).toBe(400);

  respuestaCloudflare = { success: true };
  expect((await request(app).post(BASE).send({ ...cuerpo, captcha: 'bueno' })).status).toBe(201);
});
