/**
 * Tiquetera de punta a punta: el dueño crea el paquete, se lo vende a un
 * cliente desde Clientes, y al entregar el carro el cobro usa la tiquetera.
 */
import { test, expect } from '@playwright/test';
import { API, EMAIL, PASSWORD, comprobarBackend, entrar } from './ayudas';

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

test('se crea el paquete, se vende y se usa al entregar', async ({ page, request }) => {
  const sufijo = String(Date.now()).slice(-4);
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const servicios = (await (await request.get(`${API}/services`, { headers })).json()) as Array<{ id: string; name: string }>;
  const completo = servicios.find((s) => s.name === 'Lavado Completo')!.id;
  const placa = `TQE${sufijo.slice(-3)}`;
  const nombre = `Tiq${sufijo}`;
  const t = await (await request.post(`${API}/appointments/quick`, {
    headers,
    data: { autorizaDatos: true, customerPhone: `321${String(Date.now()).slice(-7)}`, customerFirstName: nombre, plate: placa, vehicleType: 'sedan', serviceId: completo },
  })).json();
  for (const status of ['in_progress', 'done']) await request.patch(`${API}/appointments/${t.id}/status`, { headers, data: { status } });

  await entrar(page);

  // 1. El dueño crea el paquete en Configuración → Servicios.
  await page.goto('/settings?tab=services');
  const paquetes = page.getByTestId('paquetes');
  await paquetes.getByRole('button', { name: '+ Nuevo paquete' }).click();
  await paquetes.getByLabel('Nombre').fill(`Prueba E2E ${sufijo}`);
  await paquetes.getByLabel('Lavado').selectOption(completo);
  await paquetes.getByLabel('Precio ($)').fill('180000');
  await paquetes.getByRole('button', { name: 'Crear paquete' }).click();
  await expect(paquetes).toContainText(`Prueba E2E ${sufijo}`);

  // 2. Se la vende al cliente desde Clientes.
  await page.goto('/customers');
  await page.getByPlaceholder(/Buscar/).fill(nombre);
  const fila = page.locator('div.bg-white', { hasText: nombre }).filter({ has: page.getByRole('button', { name: 'Tiquetera' }) }).first();
  await fila.getByRole('button', { name: 'Tiquetera' }).click();
  const modal = page.getByRole('dialog', { name: new RegExp(`Tiqueteras de ${nombre}`) });
  await modal.getByLabel('Paquete').selectOption({ label: `Prueba E2E ${sufijo} · $ 180.000` });
  await modal.getByRole('radio', { name: 'Nequi' }).click();
  await modal.getByRole('button', { name: /Cobrar .* y entregar tiquetera/ }).click();
  await expect(modal).toContainText('Le quedan 5 de 5');
  await modal.getByRole('button', { name: 'Cerrar' }).click();

  // 3. Al entregar, el cobro usa la tiquetera.
  await page.goto('/board');
  await page.locator('div.cursor-pointer', { hasText: placa }).filter({ visible: true }).first().getByRole('button', { name: 'Entregar', exact: true }).click();
  await expect(page.getByText(`Usar tiquetera: Prueba E2E ${sufijo}`)).toBeVisible();
  await page.getByRole('button', { name: 'Entregar con tiquetera' }).click();
  await expect(page.locator('div.cursor-pointer', { hasText: placa }).filter({ visible: true })).toHaveCount(0);

});
