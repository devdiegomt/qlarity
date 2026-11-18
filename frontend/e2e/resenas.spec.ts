/**
 * Calificaciones de punta a punta: el lavadero manda la encuesta por WhatsApp,
 * el cliente califica, se le ofrece Google, y el dueño lo ve en Reportes.
 */
import { test, expect } from '@playwright/test';
import { API, EMAIL, PASSWORD, comprobarBackend, entrar } from './ayudas';

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

test('encuesta: se manda por WhatsApp, el cliente califica, va a Google y el dueño lo ve', async ({ page, request, context }) => {
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  await request.patch(`${API}/tenants/me`, { headers, data: { google_review_url: 'https://g.page/r/prueba/review' } });
  const servicios = (await (await request.get(`${API}/services`, { headers })).json()) as Array<{ id: string; es_adicional?: boolean }>;
  const placa = `RSE${String(Date.now()).slice(-3)}`;
  const tel = `315${String(Date.now()).slice(-7)}`;
  const turno = await (await request.post(`${API}/appointments/quick`, {
    headers,
    data: { autorizaDatos: true, customerPhone: tel, customerFirstName: 'Lucía', plate: placa, vehicleType: 'sedan', serviceId: servicios.find((s) => !s.es_adicional)!.id },
  })).json();
  for (const status of ['in_progress', 'done']) {
    await request.patch(`${API}/appointments/${turno.id}/status`, { headers, data: { status } });
  }

  // El lavadero: desde el tablero abre WhatsApp con el mensaje y el enlace.
  await context.route('https://wa.me/**', (r) => r.fulfill({ status: 200, body: 'WhatsApp' }));
  await entrar(page);
  await page.goto('/board');
  await page.locator('div.cursor-pointer', { hasText: placa }).filter({ visible: true }).first().getByText(placa).click();
  const [ventana] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Enviar encuesta por WhatsApp' }).click(),
  ]);
  await ventana.waitForURL(/wa\.me/);
  const wa = new URL(ventana.url());
  expect(wa.pathname).toBe(`/57${tel}`);
  const texto = wa.searchParams.get('text')!;
  expect(texto).toContain('Hola Lucía');
  const enlace = texto.match(/https?:\/\/\S+\/calificar\/[A-Za-z0-9_-]{22}/)![0];
  await ventana.close();

  // El cliente: califica sin sesión.
  const cliente = await context.browser()!.newPage();
  await cliente.goto(new URL(enlace).pathname);
  await expect(cliente.getByRole('heading', { level: 1 })).toHaveText('¿Cómo te fue en Lavadero El Brillante?');
  await cliente.getByRole('button', { name: 'Enviar' }).click();
  await expect(cliente.getByRole('alert')).toContainText('estrellas');
  await cliente.getByRole('radio', { name: '4 estrellas' }).click();
  await cliente.locator('#comentario').fill('Quedó muy limpio');
  await cliente.getByRole('button', { name: 'Enviar' }).click();
  await expect(cliente.getByRole('heading', { level: 1 })).toHaveText('¡Gracias por contarnos!');
  await expect(cliente.getByRole('link', { name: 'Dejar reseña en Google' })).toHaveAttribute('href', 'https://g.page/r/prueba/review');
  await cliente.close();

  // El dueño: lo ve en Reportes.
  await page.goto('/reports');
  const seccion = page.locator('section', { has: page.getByRole('heading', { name: 'Lo que dicen tus clientes' }) });
  await expect(seccion).toContainText('Quedó muy limpio');
});
