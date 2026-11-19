/**
 * Confianza en las reservas desde el panel: el modo «por confirmar» con el
 * recordatorio por WhatsApp, y «¿No vino?» para liberar la bahía.
 */
import { test, expect } from '@playwright/test';
import { API, EMAIL, PASSWORD, comprobarBackend, entrar } from './ayudas';

// «Hoy» es el del lavadero (Bogotá): de noche, en UTC ya es mañana.
test.use({ timezoneId: 'America/Bogota' });

const sufijo = () => String(Date.now()).slice(-3);
const telefono = () => `323${String(Date.now()).slice(-7)}`;

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

async function cabeceras(request: import('@playwright/test').APIRequestContext) {
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  return { Authorization: `Bearer ${(await login.json()).accessToken}` };
}

test('modo «por confirmar»: el cliente reserva, el lavadero le recuerda y confirma', async ({ page, request, context }) => {
  const headers = await cabeceras(request);
  await request.patch(`${API}/tenants/me`, { headers, data: { reservas_por_confirmar: true } });
  try {
    const placa = `PCF${sufijo()}`;
    await page.goto('/reservar/el-brillante');
    await page.getByRole('radio', { name: 'Automóvil' }).click();
    await page.getByRole('radio', { name: /Lavado Completo/ }).click();
    await page.getByRole('radiogroup', { name: 'Día' }).getByRole('radio').last().click();
    await page.getByRole('radiogroup', { name: 'Hora' }).getByRole('radio').first().click();
    await page.locator('#nombre').fill('Por Confirmar');
    await page.locator('#telefono').fill(telefono());
    await page.locator('#placa').fill(placa);
    await page.locator('#autoriza').check();
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('¡Recibimos tu reserva!');
    await expect(page.getByText(/te escribirá por WhatsApp para confirmarla/)).toBeVisible();

    await context.route('https://wa.me/**', (r) => r.fulfill({ status: 200, body: 'WhatsApp' }));
    await entrar(page);
    const fila = page.locator('li', { hasText: placa });
    await expect(fila).toContainText('Por confirmar');
    const [wa] = await Promise.all([page.waitForEvent('popup'), fila.getByRole('button', { name: 'Recordar' }).click()]);
    await wa.waitForURL(/wa\.me/);
    expect(decodeURIComponent(wa.url())).toContain(`te recordamos tu turno`);
    await wa.close();
    await fila.getByRole('button', { name: 'Confirmar' }).click();
    await expect(fila).not.toContainText('Por confirmar');
    await expect(fila.getByRole('button', { name: /Recordado/ })).toBeVisible();
  } finally {
    await request.patch(`${API}/tenants/me`, { headers, data: { reservas_por_confirmar: false } });
  }
});

test('«¿No vino?» libera la bahía de un turno cuya hora ya pasó', async ({ page, request }) => {
  const headers = await cabeceras(request);
  const servicios = (await (await request.get(`${API}/services`, { headers })).json()) as Array<{ id: string; es_adicional?: boolean }>;
  const placa = `NOV${sufijo()}`;
  const r = await request.post(`${API}/appointments/quick`, {
    headers,
    // A medianoche de hoy.
    data: { autorizaDatos: true, customerPhone: telefono(), customerFirstName: 'Faltón', plate: placa, vehicleType: 'sedan', serviceId: servicios.find((s) => !s.es_adicional)!.id, scheduledTime: '00:00' },
  });
  expect(r.status()).toBe(201);

  // Pasada la medianoche, las 00:00 todavía no llevan 30 minutos: el panel
  // (bien) no ofrece «No vino». El reloj del navegador va a las 11 p. m. de hoy
  // para que la prueba no dependa de la hora a la que corra.
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  await page.clock.setFixedTime(new Date(`${hoy}T23:00:00-05:00`));
  await entrar(page);
  await page.goto('/board');
  const tarjeta = page.locator('div.cursor-pointer', { hasText: placa }).filter({ visible: true }).first();
  await tarjeta.getByRole('button', { name: /No vino/ }).click();
  await expect(page.locator('div.cursor-pointer', { hasText: placa }).filter({ visible: true })).toHaveCount(0);
});
