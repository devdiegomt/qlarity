/**
 * Fotos de recepción en el detalle del turno: se toman, se achican en el
 * navegador, se suben y se ven; y el reclamo que impide borrarlas.
 */
import { test, expect, type Page } from '@playwright/test';
import { API, EMAIL, PASSWORD, comprobarBackend, entrar } from './ayudas';

/**
 * Elige una foto en el campo de archivo como lo haría el celular. La imagen se
 * dibuja en el propio navegador: así es una imagen que createImageBitmap sabe
 * decodificar, y la prueba no depende de los tipos de Node (que este tsconfig no
 * incluye).
 */
async function elegirFoto(page: Page): Promise<void> {
  await page.getByTestId('entrada-fotos').evaluate(async (entrada: HTMLInputElement) => {
    const lienzo = document.createElement('canvas');
    lienzo.width = 64;
    lienzo.height = 48;
    const ctx = lienzo.getContext('2d')!;
    ctx.fillStyle = '#b4504a';
    ctx.fillRect(0, 0, 64, 48);
    const blob = await new Promise<Blob>((ok) => lienzo.toBlob((b) => ok(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'puerta.png', { type: 'image/png' }));
    entrada.files = dt.files;
    entrada.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

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

  await elegirFoto(page);
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
