/**
 * La mensualidad de Qlarity con el checkout de ePayco.
 *
 * ## El recorrido
 *
 * 1. El administrador elige plan y pulsa «Pagar» (Configuración → Plan).
 *    `POST /api/suscripcion/checkout` crea el pago **pendiente** con el monto que
 *    calcula el servidor —el precio del plan con el descuento fundador— y le
 *    devuelve al panel los datos para abrir el checkout. El navegador no decide
 *    cuánto se cobra: si cambiara el monto, la confirmación no cuadraría.
 * 2. ePayco cobra (tarjeta, PSE, Nequi, Daviplata, efectivo…) y llama a
 *    `/api/epayco/confirmacion` desde su servidor.
 * 3. La confirmación se acepta sólo si la firma es válida, la moneda es COP y
 *    el monto es el del pago. Si es aceptada, el lavadero queda `active` en el
 *    plan pagado y `pagado_hasta` se corre un mes.
 * 4. El cliente vuelve a `/plan/pago?ref_payco=…`. El panel pregunta
 *    `GET /api/suscripcion/verificar`, que si el pago sigue pendiente lo consulta
 *    en ePayco y lo procesa igual que una confirmación. Así no depende de que
 *    la confirmación llegue antes que el cliente (o de que llegue).
 *
 * ## Lo que cubre cada pago
 *
 * Un mes desde el día siguiente a `pagado_hasta`, o desde hoy si ya venció o
 * nunca pagó. En prueba, desde el día en que termina la prueba: pagar antes no
 * hace perder los días gratis.
 *
 * ## Cada consulta lleva su `tenant_id`
 *
 * Aunque `pagos_suscripcion` tiene RLS, ninguna consulta de este archivo se
 * apoya sólo en eso: si la conexión es con un usuario que se salta RLS (como
 * en producción hasta noviembre de 2026), un `SELECT` sin `tenant_id` le
 * mostraba a cada lavadero los pagos de todos. Es la regla del resto del
 * código (docs/05-seguridad.md §3), y aquí no se había cumplido.
 *
 * ## Repeticiones
 *
 * ePayco reintenta la confirmación, y el panel también verifica: el mismo pago
 * puede llegar varias veces. El cambio de estado se hace con el pago bloqueado
 * (`FOR UPDATE`) y el mes se suma sólo al pasar a aceptado, una vez.
 */
import crypto from 'crypto';
import type { Request } from 'express';
import { z } from 'zod';
import * as db from '../../shared/db';
import logger from '../../shared/utils/logger';
import { AppError } from '../../shared/middleware/errorHandler';
import { getPlans } from '../../shared/middleware/planLimits';
import { COLUMNAS_SUSCRIPCION, hoyEn, precioConDescuento, type FilaSuscripcion } from '../../shared/middleware/suscripcion';
import {
  URL_VALIDACION,
  epaycoConfigurado,
  epaycoEnPruebas,
  esDePrueba,
  estadoDeCodigo,
  firmaValida,
  idCliente,
  llavePublica,
  type EstadoPago,
} from './epayco';

export const esquemaCheckout = z.object({ plan: z.string().min(1).max(20) });

interface FilaPago {
  id: string;
  tenant_id: string;
  referencia: string;
  plan: string;
  monto: number;
  estado: EstadoPago;
  prueba: boolean;
  ref_payco: string | null;
  cubre_desde: string | null;
  cubre_hasta: string | null;
}

const COLUMNAS_PAGO = `id, tenant_id, referencia, plan, monto, estado, prueba, ref_payco,
  to_char(cubre_desde, 'YYYY-MM-DD') AS cubre_desde, to_char(cubre_hasta, 'YYYY-MM-DD') AS cubre_hasta`;

/** Referencia corta, única y sin datos del lavadero: viaja a ePayco como factura. */
export function nuevaReferencia(): string {
  return `QL${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const sinBarra = (u: string) => u.replace(/\/+$/, '');

/** Dónde vuelve el cliente: el panel. PANEL_URL, o el primer origen de CORS. */
function urlPanel(): string {
  const panel = process.env.PANEL_URL ?? (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0];
  return sinBarra(panel.trim());
}

/**
 * Dónde confirma ePayco: esta API. API_URL_PUBLICA, o la dirección por la que
 * llegó la petición (en Render, `x-forwarded-proto` dice que es https).
 */
function urlApi(req: Request): string {
  if (process.env.API_URL_PUBLICA) return sinBarra(process.env.API_URL_PUBLICA.trim());
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

export async function crearCheckout(req: Request) {
  if (!epaycoConfigurado()) {
    throw new AppError('El pago en línea todavía no está disponible. Escríbenos para activar tu plan.', 503);
  }
  const { plan: planId } = req.body as z.infer<typeof esquemaCheckout>;
  const plan = (await getPlans())[planId];
  if (!plan || !plan.is_active || plan.price_monthly <= 0) throw new AppError('Ese plan no está disponible', 400);

  const { rows } = await db.query<FilaSuscripcion & { name: string; email: string | null }>(
    `SELECT name, email, ${COLUMNAS_SUSCRIPCION} FROM tenants WHERE id = $1`,
    [req.tenantId],
  );
  const tenant = rows[0];
  if (!tenant) throw new AppError('Lavadero no encontrado', 404);

  // price_monthly está en centavos; ePayco cobra en pesos.
  const monto = Math.round(precioConDescuento(plan.price_monthly, tenant) / 100);
  const referencia = nuevaReferencia();
  const prueba = epaycoEnPruebas();

  await db.query(
    `INSERT INTO pagos_suscripcion (tenant_id, referencia, plan, monto, prueba, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.tenantId, referencia, plan.id, monto, prueba, req.user?.id ?? null],
  );

  return {
    referencia,
    monto,
    prueba,
    // Lo que recibe ePayco.checkout.configure(...).open(...) en el navegador.
    checkout: {
      key: llavePublica(),
      test: prueba,
      datos: {
        name: `Qlarity ${plan.name}`,
        description: `Mensualidad de Qlarity, plan ${plan.name}`,
        invoice: referencia,
        currency: 'cop',
        amount: String(monto),
        tax_base: '0',
        tax: '0',
        tax_ico: '0',
        country: 'co',
        lang: 'es',
        external: 'false',
        extra1: referencia,
        confirmation: `${urlApi(req)}/api/epayco/confirmacion`,
        response: `${urlPanel()}/plan/pago`,
        email_billing: tenant.email ?? undefined,
        name_billing: tenant.name,
      },
    },
  };
}

/** Lo que llega de ePayco, por la confirmación o por la consulta. */
export type DatosEpayco = Record<string, string | undefined>;

export interface Resultado {
  referencia: string;
  estado: EstadoPago;
  /** Por qué no se tuvo en cuenta (firma, monto…); null si se procesó. */
  ignorado: string | null;
}

/**
 * Procesa una confirmación. Tiene que correr con el contexto del lavadero del
 * pago ya abierto (RLS): la confirmación pública lo abre por la referencia; la
 * verificación del panel, por la sesión.
 */
export async function procesarConfirmacion(d: DatosEpayco, tenantId: string): Promise<Resultado> {
  const referencia = String(d.x_id_invoice ?? d.x_extra1 ?? '').trim();
  const { rows } = await db.query<FilaPago>(
    `SELECT ${COLUMNAS_PAGO} FROM pagos_suscripcion WHERE referencia = $1 AND tenant_id = $2`,
    [referencia, tenantId],
  );
  const pago = rows[0];
  if (!pago) throw new AppError('Pago no encontrado', 404);

  const ignorar = (motivo: string): Resultado => {
    logger.warn({ referencia, motivo, refPayco: d.x_ref_payco }, 'Confirmación de ePayco ignorada');
    return { referencia, estado: pago.estado, ignorado: motivo };
  };

  const campos = {
    x_ref_payco: String(d.x_ref_payco ?? ''),
    x_transaction_id: String(d.x_transaction_id ?? ''),
    x_amount: String(d.x_amount ?? ''),
    x_currency_code: String(d.x_currency_code ?? ''),
    x_signature: d.x_signature,
  };
  if (!firmaValida(campos)) return ignorar('firma inválida');
  if (d.x_cust_id_cliente && String(d.x_cust_id_cliente) !== idCliente()) return ignorar('otro comercio');
  if (campos.x_currency_code.toUpperCase() !== 'COP') return ignorar('moneda distinta de COP');
  if (Number(campos.x_amount) !== pago.monto) return ignorar(`monto ${campos.x_amount} en lugar de ${pago.monto}`);
  // Un pago de prueba no activa nada cuando se está cobrando de verdad.
  if (!epaycoEnPruebas() && esDePrueba(d.x_test_request)) return ignorar('transacción de prueba en producción');

  const codigo = Number(d.x_cod_response);
  const nuevo = estadoDeCodigo(codigo);

  await db.query('BEGIN');
  try {
    const { rows: bloqueado } = await db.query<FilaPago>(
      `SELECT ${COLUMNAS_PAGO} FROM pagos_suscripcion WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [pago.id, tenantId],
    );
    const actual = bloqueado[0];
    const datos: Array<string | number | null> = [
      campos.x_ref_payco || null,
      campos.x_transaction_id || null,
      Number.isFinite(codigo) ? codigo : null,
      String(d.x_response_reason_text ?? d.x_response ?? '').slice(0, 200) || null,
      String(d.x_franchise ?? '').slice(0, 40) || null,
    ];

    if (nuevo === 'aceptado' && actual.estado !== 'aceptado') {
      await aceptar(actual, datos);
    } else if (nuevo === 'reversado' && actual.estado === 'aceptado') {
      await reversar(actual, datos);
    } else if (actual.estado === 'pendiente' && nuevo !== 'aceptado' && nuevo !== 'reversado') {
      await db.query(
        `UPDATE pagos_suscripcion SET estado = $2, ref_payco = $3, transaccion = $4, codigo = $5, motivo = $6,
                metodo = $7, updated_at = NOW() WHERE id = $1 AND tenant_id = $8`,
        [actual.id, nuevo, ...datos, tenantId],
      );
    }
    // Cualquier otra combinación (aceptado que vuelve a llegar, rechazo tardío
    // de algo ya aceptado…) no cambia nada.
    await db.query('COMMIT');
    const { rows: final } = await db.query<{ estado: EstadoPago }>(
      'SELECT estado FROM pagos_suscripcion WHERE id = $1 AND tenant_id = $2',
      [pago.id, tenantId],
    );
    return { referencia, estado: final[0].estado, ignorado: null };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

async function aceptar(pago: FilaPago, datos: Array<string | number | null>): Promise<void> {
  const { rows } = await db.query<FilaSuscripcion>(
    `SELECT ${COLUMNAS_SUSCRIPCION} FROM tenants WHERE id = $1 FOR UPDATE`,
    [pago.tenant_id],
  );
  const t = rows[0];
  const hoy = hoyEn(t.timezone);
  const candidatos = [hoy];
  if (t.pagado_hasta) candidatos.push(sumarDias(String(t.pagado_hasta).slice(0, 10), 1));
  if (t.subscription_status === 'trial' && t.trial_ends_at) {
    candidatos.push(hoyEn(t.timezone, new Date(t.trial_ends_at)));
  }
  const desde = candidatos.sort().pop()!;

  const { rows: periodo } = await db.query<{ hasta: string }>(
    `SELECT to_char(($1::date + INTERVAL '1 month' - INTERVAL '1 day')::date, 'YYYY-MM-DD') AS hasta`,
    [desde],
  );
  const hasta = periodo[0].hasta;

  await db.query(
    `UPDATE pagos_suscripcion SET estado = 'aceptado', ref_payco = $2, transaccion = $3, codigo = $4, motivo = $5,
            metodo = $6, cubre_desde = $7, cubre_hasta = $8, updated_at = NOW() WHERE id = $1 AND tenant_id = $9`,
    [pago.id, ...datos, desde, hasta, pago.tenant_id],
  );
  await db.query(
    `UPDATE tenants SET subscription_status = 'active', plan = $2, pagado_hasta = $3 WHERE id = $1`,
    [pago.tenant_id, pago.plan, hasta],
  );
  logger.info({ referencia: pago.referencia, desde, hasta, plan: pago.plan }, 'Mensualidad pagada con ePayco');
}

/** Una reversión (contracargo, anulación) quita el mes que había sumado. */
async function reversar(pago: FilaPago, datos: Array<string | number | null>): Promise<void> {
  await db.query(
    `UPDATE pagos_suscripcion SET estado = 'reversado', ref_payco = COALESCE($2, ref_payco),
            transaccion = COALESCE($3, transaccion), codigo = $4, motivo = $5, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $6`,
    [pago.id, ...datos.slice(0, 4), pago.tenant_id],
  );
  if (pago.cubre_desde && pago.cubre_hasta) {
    await db.query(
      `UPDATE tenants SET pagado_hasta = pagado_hasta - (($3::date - $2::date) + 1) WHERE id = $1 AND pagado_hasta IS NOT NULL`,
      [pago.tenant_id, pago.cubre_desde, pago.cubre_hasta],
    );
  }
  logger.warn({ referencia: pago.referencia }, 'Pago de mensualidad reversado en ePayco');
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Al volver del checkout: si el pago sigue pendiente, se pregunta a ePayco y se
 * procesa la respuesta con las mismas reglas (firma incluida). Si ePayco no
 * responde, se devuelve lo que haya: la confirmación llegará sola.
 */
export async function verificar(
  tenantId: string,
  refPayco: string,
  propia?: string,
): Promise<{ referencia: string | null; estado: EstadoPago | null }> {
  if (refPayco && !/^[0-9A-Za-z-]{1,40}$/.test(refPayco)) throw new AppError('Referencia inválida', 400);
  if (propia && !/^QL[0-9A-Z]{6,30}$/.test(propia)) throw new AppError('Referencia inválida', 400);
  if (!refPayco && !propia) throw new AppError('Falta la referencia del pago', 400);

  // Lo que ya sabemos del pago que abrió este panel (la confirmación pudo
  // llegar primero). Con RLS, uno de otro lavadero no aparece.
  const enBase = async () => {
    if (!propia) return { referencia: null, estado: null };
    const { rows } = await db.query<{ estado: EstadoPago }>(
      'SELECT estado FROM pagos_suscripcion WHERE referencia = $1 AND tenant_id = $2',
      [propia, tenantId],
    );
    return rows[0] ? { referencia: propia, estado: rows[0].estado } : { referencia: null, estado: null };
  };
  const yaSabido = await enBase();
  if (yaSabido.estado && yaSabido.estado !== 'pendiente') return yaSabido;
  if (!refPayco) return yaSabido;

  let datos: DatosEpayco | null = null;
  try {
    const r = await fetch(URL_VALIDACION + encodeURIComponent(refPayco), { signal: AbortSignal.timeout(8_000) });
    if (r.ok) {
      const cuerpo = (await r.json()) as { data?: DatosEpayco };
      datos = cuerpo?.data ?? null;
    }
  } catch (err) {
    logger.warn({ err, refPayco }, 'No se pudo consultar el pago en ePayco');
  }
  if (!datos) return yaSabido;

  const referencia = String(datos.x_id_invoice ?? datos.x_extra1 ?? '').trim();
  // Un pago de otro lavadero no aparece: no se puede verificar ajeno.
  const { rows } = await db.query<{ estado: EstadoPago }>(
    'SELECT estado FROM pagos_suscripcion WHERE referencia = $1 AND tenant_id = $2',
    [referencia, tenantId],
  );
  if (!rows[0]) return yaSabido;
  if (rows[0].estado !== 'pendiente') return { referencia, estado: rows[0].estado };

  const r = await procesarConfirmacion(datos, tenantId);
  return { referencia, estado: r.estado };
}

export async function listarPagos(tenantId: string): Promise<unknown[]> {
  const { rows } = await db.query(
    `SELECT p.referencia, p.plan, pl.name AS plan_nombre, p.monto, p.estado, p.prueba, p.metodo, p.motivo,
            to_char(p.cubre_desde, 'YYYY-MM-DD') AS cubre_desde, to_char(p.cubre_hasta, 'YYYY-MM-DD') AS cubre_hasta,
            p.created_at
       FROM pagos_suscripcion p JOIN plans pl ON pl.id = p.plan
      WHERE p.tenant_id = $1 AND (p.estado <> 'pendiente' OR p.created_at > NOW() - INTERVAL '1 day')
      ORDER BY p.created_at DESC
      LIMIT 24`,
    [tenantId],
  );
  return rows;
}
