/**
 * Tarjeta de sellos en el panel: el detalle del turno muestra los sellos, y al
 * entregar el lavado que completa la meta, el cobro ofrece el premio.
 */
import { test, expect } from '@playwright/test';
import { API, EMAIL, PASSWORD, comprobarBackend, entrar } from './ayudas';

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

test('al completar los sellos, el lavado se entrega gratis', async ({ page, request }) => {
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  // El 3.er lavado gratis: dos pagados y el tercero es el premio.
  await request.patch(`${API}/tenants/me`, { headers, data: { fidelidad_sellos_meta: 3 } });
  try {
    const servicios = (await (await request.get(`${API}/services`, { headers })).json()) as Array<{ id: string; name: string }>;
    const completo = servicios.find((s) => s.name === 'Lavado Completo')!.id;
    const tel = `318${String(Date.now()).slice(-7)}`;
    const placa = `FDL${String(Date.now()).slice(-3)}`;
    const turno = async () => {
      const t = await (await request.post(`${API}/appointments/quick`, {
        headers,
        data: { autorizaDatos: true, customerPhone: tel, customerFirstName: 'Fiel', plate: placa, vehicleType: 'sedan', serviceId: completo },
      })).json();
      for (const status of ['in_progress', 'done']) await request.patch(`${API}/appointments/${t.id}/status`, { headers, data: { status } });
      return t.id as string;
    };
    for (let i = 0; i < 2; i++) {
      const id = await turno();
      expect((await request.post(`${API}/payments`, { headers, data: { appointmentId: id, amount: 4000000, paymentMethod: 'cash' } })).status()).toBe(201);
      await request.patch(`${API}/appointments/${id}/status`, { headers, data: { status: 'delivered' } });
    }
    await turno();

    await entrar(page);
    await page.goto('/board');
    const tarjeta = page.locator('div.cursor-pointer', { hasText: placa }).filter({ visible: true }).first();

    await tarjeta.getByText(placa).click();
    await expect(page.getByTestId('sellos')).toContainText('¡Este lavado le sale gratis!');
    await page.goto('/board'); // cierra el detalle

    await page.locator('div.cursor-pointer', { hasText: placa }).filter({ visible: true }).first().getByRole('button', { name: 'Entregar', exact: true }).click();
    await expect(page.getByText('¡Lavado gratis por fidelidad!')).toBeVisible();
    await page.getByRole('button', { name: 'Entregar gratis' }).click();
    await expect(page.locator('div.cursor-pointer', { hasText: placa }).filter({ visible: true })).toHaveCount(0);
  } finally {
    await request.patch(`${API}/tenants/me`, { headers, data: { fidelidad_sellos_meta: 6 } });
  }
});
