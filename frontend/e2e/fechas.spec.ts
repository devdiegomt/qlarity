/**
 * «Hoy» es el día del celular, no el de UTC.
 *
 * La Agenda y Pagos calculaban hoy con `toISOString()`, que da la fecha en UTC:
 * en Colombia, de 7 p. m. a medianoche eso ya es mañana. El primer lavadero
 * buscó de noche las reservas web del día y la Agenda le mostraba las del día
 * siguiente. Ver frontend/src/lib/fechas.ts.
 */
import { test, expect } from '@playwright/test';
import { comprobarBackend, entrar } from './ayudas';

test.use({ timezoneId: 'America/Bogota' });

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

test('a las 8:30 p. m. en Colombia la Agenda abre en hoy, no en mañana', async ({ page }) => {
  // 8:30 p. m. del 16 en Bogotá = 1:30 a. m. del 17 en UTC.
  await page.clock.setFixedTime(new Date('2026-11-16T20:30:00-05:00'));
  await entrar(page);
  await page.goto('/appointments');
  await expect(page.locator('input[type="date"]')).toHaveValue('2026-11-16');
  await expect(page.getByText(/· Hoy/)).toBeVisible();

  // Las flechas cambian de día y «Hoy» vuelve.
  await page.getByRole('button', { name: 'Día siguiente' }).click();
  await expect(page.locator('input[type="date"]')).toHaveValue('2026-11-17');
  await expect(page.getByText(/· Mañana/)).toBeVisible();
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(page.locator('input[type="date"]')).toHaveValue('2026-11-16');
});
