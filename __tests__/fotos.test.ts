/**
 * Fotos de recepción: subir, ver con enlace firmado, borrar, el reclamo que las
 * protege, la purga a los 90 días y el borrado por supresión del cliente.
 *
 * Corre contra el almacén en disco (el de desarrollo), que firma los enlaces
 * igual que Supabase: vencen y no se pueden adivinar. Ver
 * src/shared/storage/fotos.ts.
 */
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.FOTOS_DIR = mkdtempSync(path.join(tmpdir(), 'fotos-test-'));

import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import { almacenLocal, usarAlmacen } from '../src/shared/storage/fotos';
import { anonimizarCliente, purgarFotosViejas } from '../src/shared/db/retencion';
import { conBypassRlsFueraDePeticion } from '../src/shared/middleware/rls';
import { MAX_FOTOS_POR_TURNO, tipoDeImagen } from '../src/modules/appointments/fotos';

const TEL = '+573158880101';
const PLACA = 'FOT001';
let admin: string;
let operario: string;
let turnoId: string;
let customerId: string;
let tenantId: string;

/** Un JPEG mínimo: la firma de bytes y relleno. Al backend sólo le importa la firma. */
const jpeg = (n = 2_000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
const subir = (token: string, cuerpo: Buffer, tipo = 'image/jpeg') =>
  request(app).post(`/api/appointments/${turnoId}/fotos`).set('Authorization', `Bearer ${token}`).set('Content-Type', tipo).send(cuerpo);
const listar = (token: string) => request(app).get(`/api/appointments/${turnoId}/fotos`).set('Authorization', `Bearer ${token}`);
const login = async (email: string) =>
  (await request(app).post('/api/auth/login').send({ email, password: 'admin123' })).body.accessToken as string;
const archivoDe = (url: string) => path.join(process.env.FOTOS_DIR!, url.split('/api/archivos/')[1].split('?')[0]);

async function limpiar(): Promise<void> {
  await db.queryAdmin(`DELETE FROM appointments WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate = $1)`, [PLACA]);
  await db.queryAdmin(`DELETE FROM vehicles WHERE plate = $1`, [PLACA]);
  await db.queryAdmin(`DELETE FROM customers WHERE phone = $1`, [TEL]);
}

beforeAll(async () => {
  usarAlmacen(undefined); // que tome FOTOS_DIR
  admin = await login('admin@elbrillante.co');
  operario = await login('maria@elbrillante.co');
  await limpiar();
  const svc = (await request(app).get('/api/services').set('Authorization', `Bearer ${admin}`)).body[0];
  const turno = await request(app).post('/api/appointments/quick').set('Authorization', `Bearer ${admin}`).send({
    autorizaDatos: true, customerPhone: TEL, customerFirstName: 'Fotos', plate: PLACA, vehicleType: 'sedan', serviceId: svc.id,
  });
  turnoId = turno.body.id;
  customerId = turno.body.customer_id;
  tenantId = turno.body.tenant_id;
});

afterEach(async () => {
  await db.queryAdmin('UPDATE appointments SET reclamo_abierto_at = NULL WHERE id = $1', [turnoId]);
  await db.queryAdmin('DELETE FROM appointment_photos WHERE appointment_id = $1', [turnoId]);
});

afterAll(async () => {
  usarAlmacen(undefined);
  await limpiar();
  await db.pool.end();
});

it('reconoce las imágenes por sus bytes, no por la cabecera', () => {
  expect(tipoDeImagen(jpeg())?.ext).toBe('jpg');
  expect(tipoDeImagen(Buffer.from('<?php echo 1; ?>'))).toBeNull();
});

it('el operario sube una foto y se ve con un enlace firmado', async () => {
  const res = await subir(operario, jpeg());
  expect(res.status).toBe(201);

  const lista = await listar(admin);
  expect(lista.status).toBe(200);
  expect(lista.body).toHaveLength(1);
  expect(lista.body[0]).toMatchObject({ tomadaPor: 'María', propia: false });

  const img = await request(app).get(lista.body[0].url);
  expect(img.status).toBe(200);
  expect(img.headers['content-type']).toBe('image/jpeg');
  expect(Buffer.compare(img.body as Buffer, jpeg())).toBe(0);
});

it('un enlace alterado o vencido no sirve', async () => {
  const { url } = (await subir(admin, jpeg())).body as { url: string };
  // Cambiar el primer carácter de la firma por otro que seguro sea distinto
  // (cambiarlo siempre por «X» fallaba 1 de cada 64 veces: cuando ya era X).
  const alterada = url.replace(/firma=(.)/, (_, c: string) => `firma=${c === 'A' ? 'B' : 'A'}`);
  expect(alterada).not.toBe(url);
  expect((await request(app).get(alterada)).status).toBe(404);
  const vencido = url.replace(/vence=\d+/, `vence=${Math.floor(Date.now() / 1000) - 10}`);
  expect((await request(app).get(vencido)).status).toBe(404);
});

it('rechaza lo que no es imagen, lo que pesa de más, y la foto número 13', async () => {
  expect((await subir(admin, Buffer.from('no soy una imagen'))).status).toBe(400);
  expect((await subir(admin, jpeg(1_600_000))).status).toBe(413);
  for (let i = 0; i < MAX_FOTOS_POR_TURNO; i++) expect((await subir(admin, jpeg())).status).toBe(201);
  const otra = await subir(admin, jpeg());
  expect(otra.status).toBe(409);
});

it('un turno que no existe es 404', async () => {
  const res = await request(app)
    .get('/api/appointments/00000000-0000-4000-8000-000000000000/fotos')
    .set('Authorization', `Bearer ${admin}`);
  expect(res.status).toBe(404);
});

it('borrar: el operario no borra la foto de otro; el admin sí, y el archivo desaparece', async () => {
  const { id, url } = (await subir(admin, jpeg())).body as { id: string; url: string };
  const borrar = (token: string) =>
    request(app).delete(`/api/appointments/${turnoId}/fotos/${id}`).set('Authorization', `Bearer ${token}`);
  expect((await borrar(operario)).status).toBe(403);
  expect(existsSync(archivoDe(url))).toBe(true);
  expect((await borrar(admin)).status).toBe(204);
  expect(existsSync(archivoDe(url))).toBe(false);
});

it('con un reclamo abierto no se borran: ni a mano ni por la purga', async () => {
  const { id, url } = (await subir(admin, jpeg())).body as { id: string; url: string };
  const r = await request(app).patch(`/api/appointments/${turnoId}/reclamo`).set('Authorization', `Bearer ${operario}`)
    .send({ abierto: true, nota: 'Dice que el rayón de la puerta no estaba' });
  expect(r.status).toBe(200);
  expect(r.body.reclamoAbiertoEn).not.toBeNull();

  expect((await request(app).delete(`/api/appointments/${turnoId}/fotos/${id}`).set('Authorization', `Bearer ${admin}`)).status).toBe(409);

  await db.queryAdmin(`UPDATE appointment_photos SET created_at = NOW() - INTERVAL '100 days' WHERE id = $1`, [id]);
  await conBypassRlsFueraDePeticion(() => purgarFotosViejas(90));
  expect(existsSync(archivoDe(url))).toBe(true);

  // Cerrado el reclamo, la purga sí la borra.
  await request(app).patch(`/api/appointments/${turnoId}/reclamo`).set('Authorization', `Bearer ${admin}`).send({ abierto: false });
  await conBypassRlsFueraDePeticion(() => purgarFotosViejas(90));
  expect(existsSync(archivoDe(url))).toBe(false);
  expect((await listar(admin)).body).toHaveLength(0);
});

it('la purga no toca las fotos recientes', async () => {
  const { url } = (await subir(admin, jpeg())).body as { url: string };
  await conBypassRlsFueraDePeticion(() => purgarFotosViejas(90));
  expect(existsSync(archivoDe(url))).toBe(true);
});

it('si el cliente pide suprimir sus datos, sus fotos se borran', async () => {
  const { url } = (await subir(admin, jpeg())).body as { url: string };
  await conBypassRlsFueraDePeticion(() => anonimizarCliente(tenantId, customerId));
  expect(existsSync(archivoDe(url))).toBe(false);
  expect((await listar(admin)).body).toHaveLength(0);
});

it('sin almacén configurado lo dice, en vez de perder la foto', async () => {
  usarAlmacen(null);
  try {
    const res = await subir(admin, jpeg());
    expect(res.status).toBe(503);
    expect(res.body.details?.codigo).toBe('FOTOS_SIN_CONFIGURAR');
  } finally {
    usarAlmacen(undefined);
  }
});

it('el almacén de pruebas es el de disco', () => {
  expect(almacenLocal()).not.toBeNull();
});
