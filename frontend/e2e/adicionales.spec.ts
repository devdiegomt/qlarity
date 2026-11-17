/**
 * Servicios adicionales («encera tú mismo»), de punta a punta: se ofrecen en
 * la página de reservas sumando precio, y en el tablero el turno pasa por
 * lavado → adicional → listo.
 */
import { test, expect } from '@playwright/test';
import { API, EMAIL, PASSWORD, comprobarBackend, entrar } from './ayudas';

const sufijo = () => String(Date.now()).slice(-3);

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

test('en la página de reservas el adicional suma su precio al total', async ({ page }) => {
  await page.goto('/reservar/el-brillante');
  await page.getByRole('radio', { name: 'Automóvil' }).click();
  await page.getByRole('radio', { name: /Lavado Completo/ }).click();

  // No se ofrece como lavado, sí como adicional.
  await expect(page.getByRole('radio', { name: /Encera tú mismo/ })).toHaveCount(0);
  const adicional = page.getByRole('checkbox', { name: /Encera tú mismo/ });
  await adicional.check();

  await page.getByRole('radiogroup', { name: 'Día' }).getByRole('radio').last().click();
  await page.getByRole('radiogroup', { name: 'Hora' }).getByRole('radio').first().click();
  await expect(page.getByText('+ Encera tú mismo')).toBeVisible();
  await expect(page.getByTestId('resumen')).toContainText('$60.000'); // 40.000 + 20.000

  const placa = `ADE${sufijo()}`;
  await page.locator('#nombre').fill('Prueba Adicional');
  await page.locator('#telefono').fill(`312${String(Date.now()).slice(-7)}`);
  await page.locator('#placa').fill(placa);
  await page.locator('#autoriza').check();
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('¡Listo, quedó reservado!');
  await expect(page.locator('dl')).toContainText('Encera tú mismo');
  await expect(page.locator('dl')).toContainText('$60.000');
});

test('en el tablero: lavado, después el adicional, y al final listo', async ({ page, request }) => {
  // El turno se crea por la API, como lo haría el operario con «Nuevo turno».
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  const token = (await login.json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  const servicios = (await (await request.get(`${API}/services`, { headers })).json()) as Array<{ id: string; name: string }>;
  const completo = servicios.find((s) => s.name === 'Lavado Completo')!;
  const encerado = servicios.find((s) => s.name === 'Encera tú mismo')!;
  const placa = `ADT${sufijo()}`;
  const creado = await request.post(`${API}/appointments/quick`, {
    headers,
    data: {
      autorizaDatos: true, customerPhone: `313${String(Date.now()).slice(-7)}`, customerFirstName: 'Tablero',
      plate: placa, vehicleType: 'sedan', serviceId: completo.id, adicionales: [encerado.id],
    },
  });
  expect(creado.status()).toBe(201);

  await entrar(page);
  await page.goto('/board');
  // El tablero tiene dos versiones en la página (escritorio y móvil); sólo una se ve.
  const tarjeta = page.locator('div.cursor-pointer', { hasText: placa }).filter({ visible: true }).first();
  await expect(tarjeta).toContainText('+ Encera tú mismo');

  await tarjeta.getByRole('button', { name: 'Iniciar', exact: true }).click();
  await tarjeta.getByRole('button', { name: 'Lavado listo → Encera tú mismo' }).click();
  await expect(tarjeta).toContainText('Acompaña:');
  await tarjeta.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(tarjeta.getByRole('button', { name: 'Entregar' })).toBeVisible();
});
