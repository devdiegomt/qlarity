/**
 * Prueba gratis y suscripción: cuándo el panel queda en sólo lectura.
 *
 * El registro prometía «14 días de prueba en funciones avanzadas» y nada en el
 * código miraba esa fecha: el lavadero nuevo quedaba en el plan Gratis desde el
 * primer día. Ahora entra en prueba del plan Estudio Pro, y al vencer:
 *
 * - **Sigue viendo todo.** Sus clientes, su historial, sus reportes. Nada se
 *   borra ni se esconde: los datos son del lavadero.
 * - **No puede registrar nada nuevo** hasta elegir plan. Toda petición que
 *   cambia algo responde 402 con un mensaje que dice qué pasó y qué hacer.
 *
 * Una excepción a propósito: **anonimizar a un cliente** se puede siempre. Es
 * el derecho de supresión de la Ley 1581, y que el lavadero no haya pagado no
 * se lo quita a la persona.
 *
 * ## La mensualidad (ePayco)
 *
 * Cada pago aceptado deja al lavadero `active` y corre `pagado_hasta` un mes
 * (ver modules/suscripcion). Al pasar esa fecha hay **5 días de gracia** —lo
 * que dicen los términos publicados— con el panel funcionando y un aviso; después,
 * sólo lectura hasta que pague.
 *
 * `active` sin `pagado_hasta` es un lavadero que el superadmin activó a mano:
 * sigue sin vencimiento, como antes de que existiera el cobro.
 */
import type { Request, Response, NextFunction } from 'express';
import * as db from '../db';
import { AppError } from './errorHandler';
import type { SubscriptionStatus } from '../../types/entities';

export interface FilaSuscripcion {
  subscription_status: SubscriptionStatus;
  trial_ends_at: Date | string | null;
  discount_pct: number;
  discount_until: Date | string | null;
  pagado_hasta: Date | string | null;
  timezone?: string | null;
}

/** Las columnas de `tenants` que necesita todo lo de este archivo. */
export const COLUMNAS_SUSCRIPCION =
  "subscription_status, trial_ends_at, discount_pct, discount_until, to_char(pagado_hasta, 'YYYY-MM-DD') AS pagado_hasta, timezone";

const DIA_MS = 24 * 60 * 60 * 1_000;

/** Días de gracia después de `pagado_hasta`: los de los términos publicados. */
export const DIAS_DE_GRACIA = 5;

export interface EstadoSuscripcion {
  soloLectura: boolean;
  diasDePrueba: number | null;
  /** Días hasta `pagado_hasta` (0 = vence hoy, negativo = ya venció). Null sin pagos. */
  diasParaVencer: number | null;
  /** Venció hace poco: sigue funcionando, con aviso. */
  enGracia: boolean;
  /** Venció y pasó la gracia: sólo lectura hasta pagar. */
  vencida: boolean;
}

/** `YYYY-MM-DD` de hoy en la zona del lavadero (Bogotá si no tiene). */
export function hoyEn(zona: string | null | undefined, ahora: Date = new Date()): string {
  try {
    return ahora.toLocaleDateString('en-CA', { timeZone: zona || 'America/Bogota' });
  } catch {
    return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  }
}

const aFecha = (v: Date | string): string => (typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10));
const diasEntre = (desde: string, hasta: string): number =>
  Math.round((Date.parse(hasta + 'T00:00:00Z') - Date.parse(desde + 'T00:00:00Z')) / DIA_MS);

export function estadoDeSuscripcion(
  t: Pick<FilaSuscripcion, 'subscription_status' | 'trial_ends_at'> &
    Partial<Pick<FilaSuscripcion, 'pagado_hasta' | 'timezone'>>,
  ahora: Date = new Date(),
): EstadoSuscripcion {
  const base = { diasDePrueba: null, diasParaVencer: null, enGracia: false, vencida: false };
  if (t.subscription_status === 'suspended') return { ...base, soloLectura: true };

  if (t.subscription_status === 'active') {
    if (!t.pagado_hasta) return { ...base, soloLectura: false };
    const dias = diasEntre(hoyEn(t.timezone, ahora), aFecha(t.pagado_hasta));
    const vencida = dias < -DIAS_DE_GRACIA;
    return { ...base, soloLectura: vencida, diasParaVencer: dias, enGracia: dias < 0 && !vencida, vencida };
  }

  // En prueba. Sin fecha de fin —lavaderos creados a mano o por las pruebas—
  // no hay nada que vencer.
  if (!t.trial_ends_at) return { ...base, soloLectura: false };
  const restante = new Date(t.trial_ends_at).getTime() - ahora.getTime();
  return {
    ...base,
    soloLectura: restante <= 0,
    diasDePrueba: Math.max(0, Math.ceil(restante / DIA_MS)),
  };
}

/** El precio con el descuento del lavadero, si lo tiene y no venció. */
export function precioConDescuento(
  precio: number,
  t: Pick<FilaSuscripcion, 'discount_pct' | 'discount_until'>,
  ahora: Date = new Date(),
): number {
  if (!t.discount_pct) return precio;
  if (t.discount_until && new Date(t.discount_until).getTime() + DIA_MS <= ahora.getTime()) return precio;
  return Math.round((precio * (100 - t.discount_pct)) / 100);
}

const LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Lo que se puede hacer aunque el panel esté en sólo lectura. */
function permitidaSiempre(req: Request): boolean {
  const ruta = req.originalUrl.split('?')[0];
  if (req.method !== 'POST') return false;
  // Derecho de supresión (Ley 1581): no depende de que el lavadero pague.
  if (/^\/api\/customers\/[^/]+\/anonimizar\/?$/.test(ruta)) return true;
  // Pagar: justamente lo que tiene que poder hacer quien tiene la cuenta vencida.
  return /^\/api\/suscripcion\/checkout\/?$/.test(ruta);
}

export async function exigirSuscripcionVigente(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (LECTURA.has(req.method) || permitidaSiempre(req)) return next();
  try {
    const { rows } = await db.query<FilaSuscripcion>(
      `SELECT ${COLUMNAS_SUSCRIPCION} FROM tenants WHERE id = $1`,
      [req.tenantId as string],
    );
    if (rows.length === 0) return next();
    const fila = rows[0];
    const estado = estadoDeSuscripcion(fila);
    if (!estado.soloLectura) return next();

    next(
      new AppError(
        fila.subscription_status === 'suspended'
          ? 'Tu cuenta de Qlarity está suspendida: puedes ver todo, pero no registrar cambios. ' +
              'Escríbenos para reactivarla.'
          : estado.vencida
            ? 'Tu mensualidad de Qlarity venció: puedes ver todos tus datos, pero para registrar ' +
              'turnos, pagos o cambios tienes que pagarla en Configuración → Plan.'
            : 'Tu prueba de Qlarity terminó: puedes ver todos tus datos, pero para registrar ' +
              'turnos, pagos o cambios tienes que elegir un plan en Configuración → Plan.',
        402,
      ),
    );
  } catch (err) {
    next(err);
  }
}
