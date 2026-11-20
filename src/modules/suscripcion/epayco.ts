/**
 * Lo que habla con ePayco, sin base de datos: credenciales, firma y códigos.
 *
 * ## Credenciales
 *
 * Las del panel de ePayco (Integraciones → Llaves API), como variables de
 * entorno en Render:
 *
 * | Variable           | Para qué                                              |
 * |--------------------|-------------------------------------------------------|
 * | `P_CUST_ID_CLIENT` | ID del cliente: entra en la firma                     |
 * | `P_KEY`            | Llave secreta de la firma. **Nunca sale del servidor** |
 * | `PUBLIC_KEY`       | La que usa el checkout en el navegador                |
 * | `PRIVATE_KEY`      | (API de ePayco; no la usa el checkout)                |
 * | `EPAYCO_PRUEBAS`   | `false` para cobrar de verdad. Cualquier otra cosa, o sin definir: modo prueba |
 *
 * Sin `P_CUST_ID_CLIENT`, `P_KEY` y `PUBLIC_KEY`, el pago desde el panel no se
 * ofrece y crear un pago responde 503.
 *
 * ## La firma de la confirmación
 *
 * ePayco firma cada confirmación con
 *
 *     sha256(P_CUST_ID_CLIENT ^ P_KEY ^ x_ref_payco ^ x_transaction_id ^ x_amount ^ x_currency_code)
 *
 * en hexadecimal, con `^` literal como separador y los valores tal como llegan
 * (x_amount como texto: «149000» no es lo mismo que «149000.00»). Quien no
 * conoce `P_KEY` no puede fabricar una confirmación válida: es lo que impide que
 * alguien llame a la URL de confirmación y se active el plan gratis.
 */
import crypto from 'crypto';

export const URL_CHECKOUT_JS = 'https://checkout.epayco.co/checkout.js';
export const URL_VALIDACION = 'https://secure.epayco.co/validation/v1/reference/';

interface Credenciales {
  cliente: string;
  pKey: string;
  publica: string;
}

function credenciales(): Credenciales | null {
  const cliente = (process.env.P_CUST_ID_CLIENT ?? process.env.P_CUST_ID_CLIENTE ?? '').trim();
  const pKey = (process.env.P_KEY ?? '').trim();
  const publica = (process.env.PUBLIC_KEY ?? '').trim();
  if (!cliente || !pKey || !publica) return null;
  return { cliente, pKey, publica };
}

export const epaycoConfigurado = (): boolean => credenciales() !== null;

/** Modo prueba salvo que se diga lo contrario: cobrar de verdad es lo que se elige. */
export const epaycoEnPruebas = (): boolean => (process.env.EPAYCO_PRUEBAS ?? '').trim().toLowerCase() !== 'false';

export function llavePublica(): string | null {
  return credenciales()?.publica ?? null;
}

export function idCliente(): string | null {
  return credenciales()?.cliente ?? null;
}

/** Los campos de una confirmación que entran en la firma. */
export interface CamposFirma {
  x_ref_payco: string;
  x_transaction_id: string;
  x_amount: string;
  x_currency_code: string;
}

export function calcularFirma(c: CamposFirma, cliente: string, pKey: string): string {
  return crypto
    .createHash('sha256')
    .update([cliente, pKey, c.x_ref_payco, c.x_transaction_id, c.x_amount, c.x_currency_code].join('^'), 'utf8')
    .digest('hex');
}

export function firmaValida(c: CamposFirma & { x_signature?: string }): boolean {
  const cred = credenciales();
  if (!cred || typeof c.x_signature !== 'string') return false;
  const esperada = Buffer.from(calcularFirma(c, cred.cliente, cred.pKey), 'utf8');
  const recibida = Buffer.from(c.x_signature.trim().toLowerCase(), 'utf8');
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

export type EstadoPago = 'pendiente' | 'aceptado' | 'rechazado' | 'reversado';

/**
 * `x_cod_response` de ePayco: 1 aceptada, 2 rechazada, 3 pendiente, 4 fallida,
 * 6 reversada, 7 retenida, 8 iniciada, 9 expirada, 10 abandonada,
 * 11 cancelada, 12 antifraude.
 */
export function estadoDeCodigo(codigo: number): EstadoPago {
  if (codigo === 1) return 'aceptado';
  if (codigo === 3 || codigo === 7 || codigo === 8) return 'pendiente';
  if (codigo === 6) return 'reversado';
  return 'rechazado';
}

/** `x_test_request` llega como «TRUE»/«FALSE» (o «true», «1»…). */
export const esDePrueba = (v: unknown): boolean => /^(true|1|si|sí)$/i.test(String(v ?? '').trim());
