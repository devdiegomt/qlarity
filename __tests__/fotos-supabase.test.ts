/**
 * El almacén de Supabase Storage habla bien con su API: rutas, cabeceras y
 * cuerpos. Sin red: se reemplaza `fetch`. Contra Supabase de verdad lo prueba
 * el primer despliegue (ver docs/05-seguridad.md, fotos).
 */
import { AlmacenSupabase } from '../src/shared/storage/fotos';

const URL_SB = 'https://proyecto.supabase.co';
const CLAVE = 'clave-de-servicio-de-prueba';
let llamadas: Array<{ url: string; init: RequestInit }>;
let respuesta: Response;

beforeEach(() => {
  llamadas = [];
  respuesta = new Response('{}', { status: 200 });
  jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return respuesta;
  });
});
afterEach(() => jest.restoreAllMocks());

const almacen = () => new AlmacenSupabase(URL_SB, CLAVE, 'fotos-recepcion');
const cabeceras = (i: number) => llamadas[i].init.headers as Record<string, string>;

it('sube al bucket privado, sin pisar un archivo que ya exista', async () => {
  await almacen().subir('t/a/f.jpg', Buffer.from('x'), 'image/jpeg');
  expect(llamadas[0].url).toBe(`${URL_SB}/storage/v1/object/fotos-recepcion/t/a/f.jpg`);
  expect(llamadas[0].init.method).toBe('POST');
  expect(cabeceras(0)).toMatchObject({ Authorization: `Bearer ${CLAVE}`, apikey: CLAVE, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' });
});

it('firma un enlace que vence, y lo devuelve completo', async () => {
  respuesta = new Response(JSON.stringify({ signedURL: '/object/sign/fotos-recepcion/t/a/f.jpg?token=abc' }), { status: 200 });
  const url = await almacen().urlFirmada('t/a/f.jpg', 900);
  expect(llamadas[0].url).toBe(`${URL_SB}/storage/v1/object/sign/fotos-recepcion/t/a/f.jpg`);
  expect(JSON.parse(String(llamadas[0].init.body))).toEqual({ expiresIn: 900 });
  expect(url).toBe(`${URL_SB}/storage/v1/object/sign/fotos-recepcion/t/a/f.jpg?token=abc`);
});

it('borra varias de una vez, y nada si no hay qué borrar', async () => {
  await almacen().borrar([]);
  expect(llamadas).toHaveLength(0);
  await almacen().borrar(['t/a/1.jpg', 't/a/2.jpg']);
  expect(llamadas[0].init.method).toBe('DELETE');
  expect(JSON.parse(String(llamadas[0].init.body))).toEqual({ prefixes: ['t/a/1.jpg', 't/a/2.jpg'] });
});

it('un error de Storage se convierte en excepción con el motivo, para el log', async () => {
  respuesta = new Response('{"message":"Bucket not found"}', { status: 404 });
  await expect(almacen().subir('t/a/f.jpg', Buffer.from('x'), 'image/jpeg')).rejects.toThrow(/HTTP 404.*Bucket not found/);
});
