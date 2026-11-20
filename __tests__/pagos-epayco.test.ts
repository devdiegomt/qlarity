/**
 * Mensualidad con ePayco: crear el pago, confirmarlo (firma, monto, moneda,
 * repeticiones, reversiones), verificarlo al volver del checkout y el
 * vencimiento con días de gracia. Ver src/modules/suscripcion.
 */
import crypto from 'crypto';
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import { estadoDeSuscripcion } from '../src/shared/middleware/suscripcion';
import { calcularFirma, estadoDeCodigo } from '../src/modules/suscripcion/epayco';

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const CLIENTE = '123456';
const P_KEY = 'llave-secreta-de-prueba';
const ENV = { P_CUST_ID_CLIENT: CLIENTE, P_KEY, PUBLIC_KEY: 'llave-publica-de-prueba' };

let admin: string;
let operario: string;
let original: Record<string, unknown>;
const auth = (t = admin) => ({ Authorization: `Bearer ${t}` });
const login = async (email: string) =>
  (await request(app).post('/api/auth/login').send({ email, password: 'admin123' })).body.accessToken as string;

const hoy = async (): Promise<string> =>
  (
    await db.queryAdmin<{ d: string }>(
      `SELECT to_char((NOW() AT TIME ZONE timezone)::date, 'YYYY-MM-DD') AS d FROM tenants WHERE id = $1`,
      [TENANT],
    )
  ).rows[0].d;
const sumar = async (fecha: string, expr: string): Promise<string> =>
  (await db.queryAdmin<{ d: string }>(`SELECT to_char(($1::date + $2::interval)::date, 'YYYY-MM-DD') AS d`, [fecha, expr]))
    .rows[0].d;
const tenant = async () =>
  (
    await db.queryAdmin<{ subscription_status: string; plan: string; pagado_hasta: string | null }>(
      `SELECT subscription_status, plan, to_char(pagado_hasta, 'YYYY-MM-DD') AS pagado_hasta FROM tenants WHERE id = $1`,
      [TENANT],
    )
  ).rows[0];
const pago = async (referencia: string) =>
  (
    await db.queryAdmin<{ estado: string; cubre_desde: string | null; cubre_hasta: string | null; metodo: string | null }>(
      `SELECT estado, metodo, to_char(cubre_desde, 'YYYY-MM-DD') AS cubre_desde, to_char(cubre_hasta, 'YYYY-MM-DD') AS cubre_hasta
         FROM pagos_suscripcion WHERE referencia = $1`,
      [referencia],
    )
  ).rows[0];

async function ponerTenant(cambios: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(cambios);
  await db.queryAdmin(
    `UPDATE tenants SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [TENANT, ...Object.values(cambios)] as never[],
  );
}

const checkout = (plan = 'estudio', token = admin) =>
  request(app).post('/api/suscripcion/checkout').set(auth(token)).send({ plan });

/** Lo que mandaría ePayco, firmado como lo firma ePayco. */
function confirmacion(referencia: string, monto: number | string, extra: Record<string, string> = {}): Record<string, string> {
  const d: Record<string, string> = {
    x_cust_id_cliente: CLIENTE,
    x_ref_payco: String(Math.floor(Math.random() * 1e9)),
    x_transaction_id: crypto.randomBytes(8).toString('hex'),
    x_amount: String(monto),
    x_currency_code: 'COP',
    x_id_invoice: referencia,
    x_cod_response: '1',
    x_response_reason_text: 'Aprobada',
    x_franchise: 'PSE',
    x_test_request: 'TRUE',
    ...extra,
  };
  d.x_signature = extra.x_signature ?? calcularFirma(d as never, CLIENTE, P_KEY);
  return d;
}
const confirmar = (d: Record<string, string>) =>
  request(app).post('/api/epayco/confirmacion').type('form').send(d);

beforeAll(async () => {
  admin = await login('admin@elbrillante.co');
  operario = await login('maria@elbrillante.co');
  original = (
    await db.queryAdmin(
      `SELECT plan, subscription_status, trial_ends_at, discount_pct, discount_until, pagado_hasta FROM tenants WHERE id = $1`,
      [TENANT],
    )
  ).rows[0];
});
beforeEach(async () => {
  Object.assign(process.env, ENV);
  delete process.env.EPAYCO_PRUEBAS;
  await db.queryAdmin(`DELETE FROM pagos_suscripcion WHERE tenant_id = $1`, [TENANT]);
  await ponerTenant({ subscription_status: 'active', plan: 'estudio_pro', pagado_hasta: null, discount_pct: 0, discount_until: null, trial_ends_at: null });
});
afterAll(async () => {
  for (const k of [...Object.keys(ENV), 'EPAYCO_PRUEBAS']) delete process.env[k];
  await db.queryAdmin(`DELETE FROM pagos_suscripcion WHERE tenant_id = $1`, [TENANT]);
  await ponerTenant(original);
  await db.pool.end();
});

describe('crear el pago', () => {
  it('sin las llaves de ePayco no se ofrece', async () => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    expect((await checkout()).status).toBe(503);
    const uso = await request(app).get('/api/tenants/me/usage').set(auth());
    expect(uso.body.subscription.payments).toEqual({ enabled: false, test: true });
  });

  it('el servidor fija el monto: precio del plan con el descuento fundador, en pesos', async () => {
    await ponerTenant({ discount_pct: 30, discount_until: null });
    const r = await checkout('estudio');
    expect(r.status).toBe(201);
    expect(r.body.monto).toBe(104300); // $149.000 - 30%
    expect(r.body.referencia).toMatch(/^QL[0-9A-Z]{6,30}$/);
    expect(r.body.prueba).toBe(true);
    expect(r.body.checkout.key).toBe('llave-publica-de-prueba');
    expect(r.body.checkout.datos).toMatchObject({ amount: '104300', currency: 'cop', invoice: r.body.referencia, external: 'false' });
    expect(r.body.checkout.datos.confirmation).toMatch(/\/api\/epayco\/confirmacion$/);
    expect(r.body.checkout.datos.response).toMatch(/\/plan\/pago$/);
    // La llave secreta no sale nunca.
    expect(JSON.stringify(r.body)).not.toContain(P_KEY);
    expect((await pago(r.body.referencia)).estado).toBe('pendiente');
  });

  it('sólo el administrador paga, y sólo planes que se ofrecen', async () => {
    expect((await checkout('estudio', operario)).status).toBe(403);
    expect((await checkout('free')).status).toBe(400); // ya no se ofrece
    expect((await checkout('no-existe')).status).toBe(400);
  });
});

describe('la confirmación de ePayco', () => {
  it('aceptada: el lavadero queda activo en el plan pagado, por un mes desde hoy', async () => {
    const { referencia, monto } = (await checkout('estudio')).body;
    const r = await confirmar(confirmacion(referencia, monto));
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('aceptado');

    const d = await hoy();
    const hasta = await sumar(await sumar(d, '1 month'), '-1 day');
    expect(await tenant()).toEqual({ subscription_status: 'active', plan: 'estudio', pagado_hasta: hasta });
    expect(await pago(referencia)).toMatchObject({ estado: 'aceptado', cubre_desde: d, cubre_hasta: hasta, metodo: 'PSE' });

    const uso = await request(app).get('/api/tenants/me/usage').set(auth());
    expect(uso.body.subscription).toMatchObject({ paidUntil: hasta, inGrace: false, readOnly: false });
  });

  it('si llega dos veces, el mes se suma una sola vez', async () => {
    const { referencia, monto } = (await checkout()).body;
    const d = confirmacion(referencia, monto);
    await confirmar(d);
    const antes = (await tenant()).pagado_hasta;
    expect((await confirmar(d)).status).toBe(200);
    expect((await confirmar(confirmacion(referencia, monto))).status).toBe(200);
    expect((await tenant()).pagado_hasta).toBe(antes);
  });

  it('con la firma mal no cambia nada: así nadie se activa el plan gratis', async () => {
    const { referencia, monto } = (await checkout()).body;
    const falsa = confirmacion(referencia, monto, { x_signature: 'a'.repeat(64) });
    expect((await confirmar(falsa)).status).toBe(400);
    // Firmada con otra llave tampoco.
    const otra = confirmacion(referencia, monto);
    otra.x_signature = calcularFirma(otra as never, CLIENTE, 'otra-llave');
    expect((await confirmar(otra)).status).toBe(400);
    expect((await pago(referencia)).estado).toBe('pendiente');
    expect((await tenant()).pagado_hasta).toBeNull();
  });

  it('con otro monto u otra moneda no cuenta, aunque esté bien firmada', async () => {
    const { referencia, monto } = (await checkout()).body;
    expect((await confirmar(confirmacion(referencia, monto - 1000))).status).toBe(400);
    expect((await confirmar(confirmacion(referencia, monto, { x_currency_code: 'USD' }))).status).toBe(400);
    expect((await pago(referencia)).estado).toBe('pendiente');
  });

  it('cobrando de verdad, una transacción de prueba no activa nada', async () => {
    const { referencia, monto } = (await checkout()).body;
    process.env.EPAYCO_PRUEBAS = 'false';
    expect((await confirmar(confirmacion(referencia, monto, { x_test_request: 'TRUE' }))).status).toBe(400);
    expect((await pago(referencia)).estado).toBe('pendiente');
    expect((await confirmar(confirmacion(referencia, monto, { x_test_request: 'FALSE' }))).status).toBe(200);
    expect((await pago(referencia)).estado).toBe('aceptado');
  });

  it('rechazada no cambia el plan; pendiente y después aceptada, sí', async () => {
    const a = (await checkout()).body;
    await confirmar(confirmacion(a.referencia, a.monto, { x_cod_response: '2', x_response_reason_text: 'Fondos insuficientes' }));
    expect((await pago(a.referencia)).estado).toBe('rechazado');
    expect((await tenant()).pagado_hasta).toBeNull();

    const b = (await checkout()).body;
    await confirmar(confirmacion(b.referencia, b.monto, { x_cod_response: '3' }));
    expect((await pago(b.referencia)).estado).toBe('pendiente');
    await confirmar(confirmacion(b.referencia, b.monto, { x_cod_response: '1' }));
    expect((await pago(b.referencia)).estado).toBe('aceptado');
  });

  it('un rechazo que llega tarde no deshace un pago ya aceptado', async () => {
    const { referencia, monto } = (await checkout()).body;
    await confirmar(confirmacion(referencia, monto));
    const hasta = (await tenant()).pagado_hasta;
    await confirmar(confirmacion(referencia, monto, { x_cod_response: '4' }));
    expect((await pago(referencia)).estado).toBe('aceptado');
    expect((await tenant()).pagado_hasta).toBe(hasta);
  });

  it('el segundo mes empieza donde termina el primero', async () => {
    const a = (await checkout()).body;
    await confirmar(confirmacion(a.referencia, a.monto));
    const primero = (await tenant()).pagado_hasta!;
    const b = (await checkout()).body;
    await confirmar(confirmacion(b.referencia, b.monto));
    const desde = await sumar(primero, '1 day');
    expect(await pago(b.referencia)).toMatchObject({ cubre_desde: desde, cubre_hasta: await sumar(await sumar(desde, '1 month'), '-1 day') });
  });

  it('pagar en la prueba no hace perder los días gratis', async () => {
    const fin = await sumar(await hoy(), '5 days');
    await ponerTenant({ subscription_status: 'trial', trial_ends_at: `${fin}T23:00:00-05:00` });
    const { referencia, monto } = (await checkout()).body;
    await confirmar(confirmacion(referencia, monto));
    expect((await pago(referencia)).cubre_desde).toBe(fin);
    expect((await tenant()).subscription_status).toBe('active');
  });

  it('una reversión quita el mes que había sumado', async () => {
    const { referencia, monto } = (await checkout()).body;
    await confirmar(confirmacion(referencia, monto));
    await confirmar(confirmacion(referencia, monto, { x_cod_response: '6' }));
    expect((await pago(referencia)).estado).toBe('reversado');
    expect((await tenant()).pagado_hasta).toBe(await sumar(await hoy(), '-1 day'));
  });

  it('también llega por GET; una referencia desconocida es 404', async () => {
    const { referencia, monto } = (await checkout()).body;
    const r = await request(app).get('/api/epayco/confirmacion').query(confirmacion(referencia, monto));
    expect(r.status).toBe(200);
    expect((await confirmar(confirmacion('QLNOEXISTE000', 1000))).status).toBe(404);
    expect((await confirmar(confirmacion("'; DROP TABLE tenants; --", 1000))).status).toBe(404);
  });
});

describe('al volver del checkout', () => {
  afterEach(() => jest.restoreAllMocks());

  it('si la confirmación no llegó, consulta a ePayco y procesa con las mismas reglas', async () => {
    const { referencia, monto } = (await checkout()).body;
    const d = confirmacion(referencia, monto);
    const real = global.fetch;
    jest.spyOn(global, 'fetch').mockImplementation((url, init) =>
      String(url).startsWith('https://secure.epayco.co/')
        ? Promise.resolve(new Response(JSON.stringify({ success: true, data: d }), { status: 200 }))
        : real(url as never, init),
    );
    const r = await request(app).get('/api/suscripcion/verificar').query({ ref_payco: d.x_ref_payco }).set(auth());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ referencia, estado: 'aceptado' });
    expect((await tenant()).plan).toBe('estudio');
  });

  it('una respuesta sin firma válida tampoco cuenta; si ePayco no responde, sigue pendiente', async () => {
    const { referencia, monto } = (await checkout()).body;
    const d = confirmacion(referencia, monto, { x_signature: 'b'.repeat(64) });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ data: d }), { status: 200 }));
    await request(app).get('/api/suscripcion/verificar').query({ ref_payco: d.x_ref_payco }).set(auth());
    expect((await pago(referencia)).estado).toBe('pendiente');

    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('sin red'));
    const r = await request(app).get('/api/suscripcion/verificar').query({ ref_payco: '12345' }).set(auth());
    expect(r.body).toEqual({ referencia: null, estado: null });
    expect((await request(app).get('/api/suscripcion/verificar').query({ ref_payco: '../../x' }).set(auth())).status).toBe(400);
  });

  it('si ePayco no responde pero la confirmación ya llegó, muestra lo que hay en la base', async () => {
    const { referencia, monto } = (await checkout()).body;
    await confirmar(confirmacion(referencia, monto));
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('sin red'));
    const r = await request(app).get('/api/suscripcion/verificar').query({ ref_payco: '999', referencia }).set(auth());
    expect(r.body).toEqual({ referencia, estado: 'aceptado' });
    // Sin ref_payco, sólo con la propia, también.
    expect((await request(app).get('/api/suscripcion/verificar').query({ referencia }).set(auth())).body.estado).toBe('aceptado');
    expect((await request(app).get('/api/suscripcion/verificar').set(auth())).status).toBe(400);
  });

  it('el historial muestra los pagos del lavadero', async () => {
    const { referencia, monto } = (await checkout()).body;
    await confirmar(confirmacion(referencia, monto));
    const r = await request(app).get('/api/suscripcion/pagos').set(auth());
    expect(r.body[0]).toMatchObject({ referencia, estado: 'aceptado', plan_nombre: 'Estudio', monto });
  });
});

describe('el vencimiento', () => {
  const quick = () =>
    request(app).post('/api/appointments/quick').set(auth()).send({
      autorizaDatos: true, customerPhone: '+573157773499', customerFirstName: 'Vence', plate: 'VEN001', vehicleType: 'sedan',
      serviceId: 'no-importa',
    });

  it('vencida hace 3 días: sigue funcionando, con aviso de gracia', async () => {
    await ponerTenant({ pagado_hasta: await sumar(await hoy(), '-3 days') });
    const uso = await request(app).get('/api/tenants/me/usage').set(auth());
    expect(uso.body.subscription).toMatchObject({ inGrace: true, readOnly: false, daysUntilDue: -3 });
    expect((await quick()).status).not.toBe(402);
  });

  it('pasada la gracia: sólo lectura, pero puede pagar', async () => {
    await ponerTenant({ pagado_hasta: await sumar(await hoy(), '-6 days') });
    const r = await quick();
    expect(r.status).toBe(402);
    expect(r.body.error).toMatch(/mensualidad .*venció/);
    expect((await request(app).get('/api/customers').set(auth())).status).toBe(200);
    expect((await checkout()).status).toBe(201);
  });

  it('activo sin fecha de pago (activado a mano) no vence', async () => {
    await ponerTenant({ pagado_hasta: null });
    expect((await request(app).get('/api/tenants/me/usage').set(auth())).body.subscription).toMatchObject({
      readOnly: false, paidUntil: null, inGrace: false,
    });
  });
});

describe('piezas sueltas', () => {
  it('la firma es sha256 de cliente^llave^ref^transacción^monto^moneda', () => {
    const esperada = crypto.createHash('sha256').update('1^k^2^3^4^COP').digest('hex');
    expect(calcularFirma({ x_ref_payco: '2', x_transaction_id: '3', x_amount: '4', x_currency_code: 'COP' }, '1', 'k')).toBe(esperada);
  });

  it('los códigos de ePayco', () => {
    expect([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12].map(estadoDeCodigo)).toEqual([
      'aceptado', 'rechazado', 'pendiente', 'rechazado', 'reversado', 'pendiente', 'pendiente',
      'rechazado', 'rechazado', 'rechazado', 'rechazado',
    ]);
  });

  it('la gracia cuenta en días del lavadero, no de la base', () => {
    // 11 p. m. en Bogotá del 10 de marzo: ya es 11 de marzo en UTC.
    const ahora = new Date('2026-03-11T04:00:00Z');
    const t = { subscription_status: 'active' as const, trial_ends_at: null, timezone: 'America/Bogota' };
    expect(estadoDeSuscripcion({ ...t, pagado_hasta: '2026-03-10' }, ahora)).toMatchObject({ diasParaVencer: 0, enGracia: false });
    expect(estadoDeSuscripcion({ ...t, pagado_hasta: '2026-03-05' }, ahora)).toMatchObject({ diasParaVencer: -5, enGracia: true, soloLectura: false });
    expect(estadoDeSuscripcion({ ...t, pagado_hasta: '2026-03-04' }, ahora)).toMatchObject({ vencida: true, soloLectura: true });
  });
});
