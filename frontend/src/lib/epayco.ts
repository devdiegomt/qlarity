/**
 * El checkout de ePayco en el navegador.
 *
 * El script se carga sólo cuando el administrador pulsa «Pagar», no en cada
 * pantalla: es de un tercero y nadie más lo necesita. Los datos del pago
 * (monto, referencia, URLs) vienen del servidor; acá sólo se abre la ventana.
 */
import { api } from './api';

const URL_SCRIPT = 'https://checkout.epayco.co/checkout.js';

interface ManejadorEpayco {
  open(datos: Record<string, unknown>): void;
}
declare global {
  interface Window {
    ePayco?: { checkout: { configure(o: { key: string; test: boolean }): ManejadorEpayco } };
  }
}

export interface RespuestaCheckout {
  referencia: string;
  monto: number;
  prueba: boolean;
  checkout: { key: string; test: boolean; datos: Record<string, unknown> };
}

let cargando: Promise<void> | null = null;

export const CLAVE_ULTIMO = 'qlarity:ultimo-pago';

export function ultimoPago(): string | null {
  try {
    return sessionStorage.getItem(CLAVE_ULTIMO);
  } catch {
    return null;
  }
}

function cargarScript(): Promise<void> {
  if (window.ePayco) return Promise.resolve();
  cargando ??= new Promise<void>((ok, falla) => {
    const s = document.createElement('script');
    s.src = URL_SCRIPT;
    s.async = true;
    s.onload = () => (window.ePayco ? ok() : falla(new Error('ePayco no cargó')));
    s.onerror = () => {
      cargando = null;
      s.remove();
      falla(new Error('No se pudo cargar el pago de ePayco. Revisa tu conexión e inténtalo de nuevo.'));
    };
    document.head.appendChild(s);
  });
  return cargando;
}

/** Crea el pago en el servidor y abre el checkout de ePayco. */
export async function pagarMensualidad(plan: string): Promise<RespuestaCheckout> {
  const [r] = await Promise.all([
    api<RespuestaCheckout>('/suscripcion/checkout', { method: 'POST', body: { plan } }),
    cargarScript(),
  ]);
  // Al volver, la página del resultado la manda junto con la de ePayco: así sabe
  // qué pago mostrar aunque no se pueda consultar a ePayco en ese momento.
  try {
    sessionStorage.setItem(CLAVE_ULTIMO, r.referencia);
  } catch {
    // Sin almacenamiento, se verifica sólo con la referencia de ePayco.
  }
  window.ePayco!.checkout.configure({ key: r.checkout.key, test: r.checkout.test }).open(r.checkout.datos);
  return r;
}
