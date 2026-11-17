/**
 * La cuenta de la calculadora de precios (frontend/src/lib/calculadora.ts).
 *
 * Es una función pura del panel; se prueba acá porque el panel no tiene un
 * runner de pruebas unitarias y la cuenta es lo que más importa que esté bien:
 * un error ahí le hace cobrar mal a un lavadero que está empezando.
 */
import { calcular, VALORES_INICIALES, type Entradas } from '../frontend/src/lib/calculadora';

const base: Entradas = {
  insumos: [{ nombre: 'Shampoo', precio: 60_000, rinde: 60 }], // $1.000 por lavado
  aguaPorLavado: 1_000,
  pagoLavador: 'comision',
  comisionPct: 30,
  pagoFijo: 0,
  arriendo: 2_000_000,
  servicios: 0,
  otrosFijos: 0,
  lavadosAlMes: 500, // $4.000 por lavado
  gananciaPct: 20,
};

it('reparte el precio: costos + comisión + ganancia suman el precio', () => {
  const r = calcular(base);
  // costos $6.000 deben caber en el 50 % que dejan comisión (30) y ganancia (20).
  expect(r.precio).toBeCloseTo(12_000);
  expect(r.lavador).toBeCloseTo(3_600);
  expect(r.ganancia).toBeCloseTo(2_400);
  expect(r.insumos + r.agua + r.fijos + r.lavador + r.ganancia).toBeCloseTo(r.precio!);
});

it('redondea hacia arriba a los mil pesos', () => {
  const r = calcular({ ...base, aguaPorLavado: 1_100 }); // costos 6.100 / 0,5 = 12.200
  expect(r.precioRedondeado).toBe(13_000);
});

it('con pago fijo al lavador, ese pago es costo y no porcentaje', () => {
  const r = calcular({ ...base, pagoLavador: 'fijo', pagoFijo: 4_000, comisionPct: 30 });
  // costos 10.000 / (1 − 0,2) = 12.500
  expect(r.precio).toBeCloseTo(12_500);
  expect(r.lavador).toBe(4_000);
});

it('si comisión y ganancia se comen todo el precio, no inventa un número', () => {
  expect(calcular({ ...base, comisionPct: 50, gananciaPct: 50 }).precio).toBeNull();
});

it('un insumo que rinde 0, o campos vacíos, no rompen la cuenta', () => {
  const r = calcular({ ...base, insumos: [{ nombre: 'x', precio: 10_000, rinde: 0 }], lavadosAlMes: 0 });
  expect(Number.isFinite(r.precio!)).toBe(true);
});

it('con los valores iniciales da un lavado completo dentro de lo que se cobra en Bogotá', () => {
  const r = calcular(VALORES_INICIALES);
  expect(r.precioRedondeado).toBeGreaterThanOrEqual(20_000);
  expect(r.precioRedondeado).toBeLessThanOrEqual(45_000);
});
