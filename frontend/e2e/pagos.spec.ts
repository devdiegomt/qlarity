/**
 * Pagar la mensualidad desde el panel, de punta a punta: el botón abre el
 * checkout de ePayco con lo que fijó el servidor, ePayco confirma (firmado), y
 * al volver el panel muestra el pago y el plan pagado.
 *
 * El checkout de verdad no se carga: en CI no hay salida a ePayco, y no es lo
 * que se prueba. Un sustituto toma su lugar y guarda con qué se abrió.
 *
 * Las llaves son las de mentira que la CI le pone al backend (panel.yml). Con
 * otras —un backend local con las de verdad— la prueba se salta: no puede
 * firmar como ePayco sin la llave.
 */
import { test, expect } from '@playwright/test';
import { API, EMAIL, PASSWORD, comprobarBackend, entrar } from './ayudas';

const CLIENTE = 'ci-epayco-cliente';
const P_KEY = 'ci-epayco-llave';
const PUBLICA = 'ci-epayco-publica';

const SUSTITUTO = `window.ePayco = { checkout: { configure: function (o) {
  return { open: function (d) { window.__epayco = { config: o, datos: d }; } };
} } };`;

async function sha256(texto: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

test('el administrador paga la mensualidad con ePayco y su plan queda pagado', async ({ page, request }) => {
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const uso = await (await request.get(`${API}/tenants/me/usage`, { headers })).json();
  test.skip(!uso.subscription.payments?.enabled, 'El backend no tiene llaves de ePayco');

  await page.route('https://checkout.epayco.co/checkout.js', (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: SUSTITUTO }),
  );
  await entrar(page);
  await page.goto('/settings?tab=plan');
  await expect(page.getByText('Modo de prueba: los pagos no son reales.')).toBeVisible();

  const boton = page.getByRole('button', { name: /^(Pagar|Cambiar y pagar) 1 mes · \$\s?249\.000$/ });
  await boton.click();
  await page.waitForFunction(() => (window as unknown as { __epayco?: unknown }).__epayco);
  const abierto = await page.evaluate(
    () => (window as unknown as { __epayco: { config: { key: string; test: boolean }; datos: Record<string, string> } }).__epayco,
  );
  test.skip(abierto.config.key !== PUBLICA, 'El backend tiene otras llaves: no se puede firmar como ePayco');
  expect(abierto.config.test).toBe(true);
  expect(abierto.datos).toMatchObject({ amount: '249000', currency: 'cop', external: 'false' });
  expect(abierto.datos.response).toMatch(/\/plan\/pago$/);

  // ePayco confirma, firmado con la llave.
  const refPayco = String(Date.now());
  const d: Record<string, string> = {
    x_cust_id_cliente: CLIENTE,
    x_ref_payco: refPayco,
    x_transaction_id: `tx${refPayco}`,
    x_amount: abierto.datos.amount,
    x_currency_code: 'COP',
    x_id_invoice: abierto.datos.invoice,
    x_cod_response: '1',
    x_franchise: 'PSE',
    x_test_request: 'TRUE',
  };
  d.x_signature = await sha256([CLIENTE, P_KEY, d.x_ref_payco, d.x_transaction_id, d.x_amount, d.x_currency_code].join('^'));
  const conf = await request.post(`${API}/epayco/confirmacion`, { form: d });
  expect(conf.status()).toBe(200);

  // Y vuelve del checkout.
  await page.goto(`/plan/pago?ref_payco=${refPayco}`);
  await expect(page.getByRole('heading', { name: '¡Listo, pago recibido!' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: 'Ver mi plan' }).click();
  await expect(page.getByText('Pagado hasta')).toBeVisible();
  const pagos = page.locator('section', { has: page.getByRole('heading', { name: 'Tus pagos' }) });
  await expect(pagos.locator('li').first()).toContainText('Estudio Pro');
  await expect(pagos.locator('li').first()).toContainText('Pagado');
});

test('un operario ve los planes pero no el botón de pagar', async ({ page }) => {
  await page.goto('/');
  await page.fill('#email', 'maria@elbrillante.co');
  await page.fill('#password', 'admin123');
  await page.click('button[type="submit"]');
  await expect(page.locator('#password')).toHaveCount(0, { timeout: 15_000 });
  await page.goto('/settings?tab=plan');
  await expect(page.getByRole('heading', { name: 'Planes' })).toBeVisible();
  await expect(page.getByRole('button', { name: /pagar 1 mes/i })).toHaveCount(0);
});
