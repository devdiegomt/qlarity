/**
 * La calculadora de precios: cuánto cobrar por un servicio a partir de lo que
 * cuesta hacerlo.
 *
 * ## La cuenta
 *
 *   costo directo   = insumos por lavado + agua + pago fijo al lavador
 *   costo fijo      = (arriendo + servicios + otros) / lavados al mes
 *   precio          = (costo directo + costo fijo) / (1 − comisión − ganancia)
 *
 * La comisión del lavador y la ganancia van **sobre el precio**, no sobre el
 * costo, porque así se habla en un lavadero («al lavador le toca el 35 %») y así
 * se reparte la plata que entra. Por eso dividen y no suman: si el lavador se
 * lleva el 35 % del precio y el dueño quiere quedarse con el 25 %, los costos
 * tienen que caber en el 40 % que sobra.
 *
 * ## De dónde salen los valores por defecto (noviembre de 2026)
 *
 * Son un punto de partida para quien no tiene sus números, no una verdad: cada
 * lavadero los cambia por los suyos. Salieron de precios publicados en tiendas
 * colombianas y de guías del sector, que se contradicen entre sí; se tomó un
 * valor del medio de cada rango.
 *
 * - Shampoo: galón de $25.000 a $60.000 (Homecenter $35.900), rinde 40 a 80
 *   lavados según la dilución.
 * - Cera rápida y silicona de llantas: $20.000 a $30.000 los 500 ml.
 * - Agua: unos $800 a $1.500 por lavado.
 * - Lavador: entre 25 % y 45 % del valor del servicio; 35 % es lo más citado.
 * - Ganancia: las guías citan 15 % a 35 % según el servicio; se sugiere 25 %.
 * - Referencia de mercado, Bogotá: básico $15.000 a $25.000, completo $25.000
 *   a $45.000.
 */

export interface Insumo {
  nombre: string;
  /** Lo que cuesta el envase, en pesos. */
  precio: number;
  /** Cuántos lavados alcanza. */
  rinde: number;
}

export interface Entradas {
  insumos: Insumo[];
  aguaPorLavado: number;
  /** Cómo se le paga al lavador. */
  pagoLavador: 'comision' | 'fijo';
  /** Porcentaje del precio (0 a 100), si es por comisión. */
  comisionPct: number;
  /** Pesos por lavado, si es fijo. */
  pagoFijo: number;
  arriendo: number;
  servicios: number;
  otrosFijos: number;
  lavadosAlMes: number;
  /** Porcentaje del precio (0 a 100) que queda de ganancia. */
  gananciaPct: number;
}

export interface Resultado {
  /** null si con esos porcentajes no hay precio posible (suman 100 % o más). */
  precio: number | null;
  /** El precio redondeado hacia arriba a los mil pesos, que es como se cobra. */
  precioRedondeado: number | null;
  insumos: number;
  agua: number;
  lavador: number;
  fijos: number;
  ganancia: number;
}

/** Ganancia sugerida: el medio de lo que citan las guías del sector (15 % a 35 %). */
export const GANANCIA_SUGERIDA = 25;
export const GANANCIA_RANGO: [number, number] = [15, 35];
/** Comisión del lavador más citada (rango habitual 25 % a 45 %). */
export const COMISION_TIPICA = 35;

export const VALORES_INICIALES: Entradas = {
  insumos: [
    { nombre: 'Shampoo (galón)', precio: 40_000, rinde: 60 },
    { nombre: 'Cera rápida (500 ml)', precio: 21_000, rinde: 15 },
    { nombre: 'Silicona de llantas (500 ml)', precio: 26_000, rinde: 25 },
    { nombre: 'Paños de microfibra (paquete)', precio: 30_000, rinde: 150 },
  ],
  aguaPorLavado: 1_200,
  pagoLavador: 'comision',
  comisionPct: COMISION_TIPICA,
  pagoFijo: 8_000,
  arriendo: 1_800_000,
  servicios: 400_000,
  otrosFijos: 200_000,
  lavadosAlMes: 300,
  gananciaPct: GANANCIA_SUGERIDA,
};

const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

export function calcular(e: Entradas): Resultado {
  const insumos = e.insumos.reduce((t, i) => t + (n(i.rinde) > 0 ? n(i.precio) / n(i.rinde) : 0), 0);
  const agua = n(e.aguaPorLavado);
  const fijos = n(e.lavadosAlMes) > 0 ? (n(e.arriendo) + n(e.servicios) + n(e.otrosFijos)) / n(e.lavadosAlMes) : 0;
  const pagoFijo = e.pagoLavador === 'fijo' ? n(e.pagoFijo) : 0;
  const comision = e.pagoLavador === 'comision' ? n(e.comisionPct) / 100 : 0;
  const ganancia = n(e.gananciaPct) / 100;

  const costos = insumos + agua + fijos + pagoFijo;
  const resto = 1 - comision - ganancia;
  if (resto <= 0.05) {
    return { precio: null, precioRedondeado: null, insumos, agua, lavador: pagoFijo, fijos, ganancia: 0 };
  }
  const precio = costos / resto;
  return {
    precio,
    precioRedondeado: Math.ceil(precio / 1_000) * 1_000,
    insumos,
    agua,
    lavador: pagoFijo + precio * comision,
    fijos,
    ganancia: precio * ganancia,
  };
}
