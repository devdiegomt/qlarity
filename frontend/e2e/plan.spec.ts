/**
 * La sección «Plan» de Configuración: que el lavadero vea qué tiene y qué
 * hay. Antes no había ninguna pantalla con esto, aunque los límites ya se
 * aplicaban.
 */
import { test, expect } from '@playwright/test';
import { comprobarBackend, entrar } from './ayudas';

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

test('el administrador ve su plan y los que se ofrecen', async ({ page }) => {
  await entrar(page);
  await page.goto('/settings?tab=plan');

  // «Tu plan» sale también en la tarjeta del plan actual cuando ese plan se
  // sigue ofreciendo (pasa después de pagarlo: e2e/pagos.spec.ts).
  await expect(page.getByText('Tu plan', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Planes' })).toBeVisible();
  // Los dos que se ofrecen, con su precio.
  // Nivel 4: las tarjetas de «Planes». El plan actual también es un título.
  await expect(page.getByRole('heading', { name: 'Estudio', exact: true, level: 4 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Estudio Pro', exact: true, level: 4 })).toBeVisible();
  await expect(page.locator('main')).toContainText('149.000');
  await expect(page.locator('main')).toContainText('249.000');
});

test('la pestaña va en la dirección, para poder enlazarla', async ({ page }) => {
  await entrar(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: /plan/i }).click();
  await expect(page).toHaveURL(/tab=plan/);
});
