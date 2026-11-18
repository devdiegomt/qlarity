/**
 * Fotos de recepción en el detalle del turno: se toman, se achican en el
 * navegador, se suben y se ven; y el reclamo que impide borrarlas.
 */
import { test, expect } from '@playwright/test';
import { API, EMAIL, PASSWORD, comprobarBackend, entrar } from './ayudas';

// Un PNG de 8x8 que el navegador sabe decodificar (createImageBitmap lo exige).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4YaOBFTEMLQkAdntLARs7+acAAAAASUVORK5CYII=',
  'base64',
);

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

test('se toma una foto al recibir el carro, se ve, y un reclamo la protege', async ({ page, request }) => {
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const servicios = (await (await request.get(`${API}/services`, { headers })).json()) as Array<{ id: string; es_adicional?: boolean }>;
  const placa = `FTE${String(Date.now()).slice(-3)}`;
  const creado = await request.post(`${API}/appointments/quick`, {
    headers,
    data: {
      autorizaDatos: true, customerPhone: `314${String(Date.now()).slice(-7)}`, customerFirstName: 'Fotos',
      plate: placa, vehicleType: 'sedan', serviceId: servicios.find((s) => !s.es_adicional)!.id,
    },
  });
  expect(creado.status()).toBe(201);

  await entrar(page);
  await page.goto('/board');
  // Sobre la placa: el centro de la tarjeta es el selector de operario, que no abre el detalle.
  await page.locator('div.cursor-pointer', { hasText: placa }).filter({ visible: true }).first().getByText(placa).click();
  await expect(page.getByText('Todavía no hay fotos de cómo llegó el vehículo.')).toBeVisible();

  await page.getByTestId('entrada-fotos').setInputFiles({ name: 'puerta.png', mimeType: 'image/png', buffer: PNG });
  const miniaturas = page.getByRole('list', { name: 'Fotos de recepción' }).getByRole('button');
  await expect(miniaturas).toHaveCount(1);

  // La miniatura carga de verdad (el enlace firmado sirve).
  const img = page.getByRole('list', { name: 'Fotos de recepción' }).locator('img').first();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

  // Reclamo: se abre con nota y, mientras esté abierto, no aparece «Borrar».
  await page.getByRole('button', { name: 'El cliente reclama por un daño' }).click();
  await page.locator('#nota-reclamo').fill('Dice que el rayón de la puerta no estaba');
  await page.getByRole('button', { name: 'Abrir reclamo' }).click();
  await expect(page.getByText('Reclamo abierto', { exact: true })).toBeVisible();
  await miniaturas.first().click();
  await expect(page.getByRole('dialog', { name: 'Foto ampliada' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Foto ampliada' }).getByRole('button', { name: 'Borrar' })).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Foto ampliada' }).getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.getByRole('button', { name: 'Cerrar reclamo' }).click();
  await miniaturas.first().click();
  await expect(page.getByRole('dialog', { name: 'Foto ampliada' }).getByRole('button', { name: 'Borrar' })).toBeVisible();
});
