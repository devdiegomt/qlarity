/**
 * La calculadora de precios (`/calculadora`): pública, y la cuenta se ve
 * cambiar con lo que el dueño escribe. La cuenta en sí la prueba
 * __tests__/calculadora.test.ts.
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/calculadora');
  await page.evaluate(() => localStorage.removeItem('qlarity:calculadora'));
  await page.reload();
});

test('se abre sin sesión y con los valores de ejemplo da un precio', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('¿Cuánto cobrar por un lavado?');
  await expect(page.locator('#password')).toHaveCount(0);
  await expect(page.getByTestId('precio')).toHaveText('$32.000');
});

test('el precio cambia con los costos, y la ganancia sugerida se puede recuperar', async ({ page }) => {
  await page.locator('#arriendo').fill('3600000'); // fijos 4,2 M / 300 = 14.000 por lavado
  await expect(page.getByTestId('precio')).toHaveText('$47.000');

  await page.getByRole('slider', { name: 'Porcentaje de ganancia' }).fill('10');
  await expect(page.getByText(/un mes flojo/)).toBeVisible();
  await page.getByRole('button', { name: /Usar la sugerida/ }).click();
  await expect(page.getByTestId('precio')).toHaveText('$47.000');
});

test('si comisión y ganancia se llevan todo, lo dice en vez de inventar un precio', async ({ page }) => {
  await page.locator('#comision').fill('80');
  await expect(page.getByRole('alert')).toContainText('Baja alguna de las dos');
});

test('recuerda lo que el dueño escribió', async ({ page }) => {
  await page.locator('#agua').fill('2000');
  await page.reload();
  await expect(page.locator('#agua')).toHaveValue('2000');
});
