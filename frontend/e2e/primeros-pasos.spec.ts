/**
 * Para quien entra por primera vez: la guía de primeros pasos en Inicio y la
 * pista de cada sección.
 */
import { test, expect } from '@playwright/test';
import { API, EMAIL, PASSWORD, comprobarBackend, entrar } from './ayudas';

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

test.beforeEach(async ({ request }) => {
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  await request.post(`${API}/tenants/me/primeros-pasos`, { headers, data: { abrir: true } });
});

test('la guía muestra los pasos, lleva a hacerlos, y se oculta y se recupera', async ({ page }) => {
  await entrar(page);
  const guia = page.locator('section', { has: page.getByRole('heading', { name: 'Primeros pasos' }) });
  await expect(guia).toBeVisible();
  await expect(guia).toContainText(/de 6 listos/);
  // La demo ya tiene dirección, operarios y turnos: esos aparecen hechos.
  await expect(guia.getByText('Completa los datos del lavadero')).toHaveClass(/line-through/);

  // El paso actual tiene su botón, que lleva a donde se hace.
  const boton = guia.getByRole('link').first();
  const destino = await boton.getAttribute('href');
  await boton.click();
  await expect(page).toHaveURL(new RegExp(destino!.replace('?', '\\?')));

  await page.goto('/');
  await guia.getByRole('button', { name: 'Ocultar primeros pasos' }).click();
  await expect(guia).toHaveCount(0);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Ver la guía de primeros pasos' }).click();
  await page.goto('/');
  await expect(guia).toBeVisible();
});

test('cada sección explica qué es la primera vez, y la pista no vuelve después de cerrarla', async ({ page }) => {
  await entrar(page);
  for (const [ruta, id] of [['/board', 'tablero'], ['/appointments', 'agenda'], ['/customers', 'clientes']]) {
    await page.goto(ruta);
    const pista = page.getByTestId(`pista-${id}`);
    await expect(pista).toBeVisible();
    await pista.getByRole('button', { name: /ocultar esta pista/ }).click();
    await expect(pista).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId(`pista-${id}`)).toHaveCount(0);
  }
});
