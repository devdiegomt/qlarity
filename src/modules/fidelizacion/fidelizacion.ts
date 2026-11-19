/**
 * Fidelización: tarjeta de sellos y clientes que no han vuelto.
 *
 *   GET  /api/appointments/:id/fidelidad   sellos del cliente del turno (al cobrar)
 *   GET  /api/customers/:id/fidelidad      sellos de un cliente
 *   GET  /api/customers/sin-volver         los que llevan más de N días sin venir
 *   POST /api/customers/:id/invitado       anota que se le invitó, y da los datos
 *                                          para el mensaje de WhatsApp
 *
 * **Los sellos no se guardan: se cuentan.** Un sello es un turno entregado con
 * un pago normal; el conteo empieza después del último premio. Así no hay un
 * contador que se desincronice si se borra o se corrige un pago. Ver
 * shared/db/migrate-fidelizacion.ts.
 */
import { getTenantToday } from '../../shared/utils/dateUtils';
import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';

type Consulta = typeof db.query;

export interface Sellos {
  /** El lavado número `meta` es gratis. 0: la tarjeta está desactivada. */
  meta: number;
  /** Lavados pagados desde el último premio. */
  sellos: number;
  /** Cuántos faltan para el premio (0 si ya lo tiene). */
  faltan: number;
  premioDisponible: boolean;
  /** Turnos en «No vino» en los últimos 90 días. */
  faltas: number;
}

/** Faltas que bloquean reservar por la web. */
export const FALTAS_PARA_BLOQUEO = 2;
export const DIAS_FALTAS = 90;

export async function faltasDe(tenantId: string, customerId: string, consulta: Consulta = db.query): Promise<number> {
  const { rows } = await consulta<{ n: string }>(
    `SELECT COUNT(*) AS n FROM appointments a JOIN tenants t ON t.id = a.tenant_id
      WHERE a.tenant_id = $1 AND a.customer_id = $2 AND a.status = 'no_show'
        AND a.scheduled_date >= (NOW() AT TIME ZONE t.timezone)::date - $3::int`,
    [tenantId, customerId, DIAS_FALTAS],
  );
  return parseInt(rows[0].n, 10);
}

/** Los sellos de un cliente. `consulta` permite usarlo dentro de una transacción. */
export async function sellosDe(tenantId: string, customerId: string, consulta: Consulta = db.query): Promise<Sellos> {
  const { rows: t } = await consulta<{ meta: number; con_tiquetera: boolean }>(
    'SELECT fidelidad_sellos_meta AS meta, fidelidad_tiquetera_suma_sellos AS con_tiquetera FROM tenants WHERE id = $1',
    [tenantId],
  );
  const meta = t[0]?.meta ?? 0;
  const faltas = await faltasDe(tenantId, customerId, consulta);
  if (meta <= 0) return { meta: 0, sellos: 0, faltan: 0, premioDisponible: false, faltas };
  // Lo pagado con tiquetera suma sellos sólo si el lavadero lo eligió.
  const origenes = t[0]?.con_tiquetera ? ['normal', 'tiquetera'] : ['normal'];

  const { rows } = await consulta<{ n: string }>(
    `SELECT COUNT(*) AS n
       FROM payments p JOIN appointments a ON a.id = p.appointment_id
      WHERE a.tenant_id = $1 AND a.customer_id = $2 AND p.origen = ANY($3::text[])
        AND p.created_at > COALESCE((
              SELECT MAX(p2.created_at) FROM payments p2 JOIN appointments a2 ON a2.id = p2.appointment_id
               WHERE a2.tenant_id = $1 AND a2.customer_id = $2 AND p2.origen = 'premio'
            ), '-infinity'::timestamptz)`,
    [tenantId, customerId, origenes],
  );
  const pagados = meta - 1;
  const sellos = Math.min(parseInt(rows[0].n, 10), pagados);
  return { meta, sellos, faltan: pagados - sellos, premioDisponible: sellos >= pagados, faltas };
}

export async function fidelidadDeTurno(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<{ customer_id: string }>(
    'SELECT customer_id FROM appointments WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId],
  );
  if (!rows[0]) throw new AppError('Turno no encontrado', 404);
  res.json(await sellosDe(req.tenantId!, rows[0].customer_id));
}

export async function fidelidadDeCliente(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query('SELECT 1 FROM customers WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  if (!rows[0]) throw new AppError('Cliente no encontrado', 404);
  res.json(await sellosDe(req.tenantId!, req.params.id));
}

/** No se vuelve a sugerir invitar al mismo cliente antes de esto. */
const DIAS_ENTRE_INVITACIONES = 14;

export async function sinVolver(req: Request, res: Response): Promise<void> {
  const { rows: t } = await db.query<{ dias: number }>(
    'SELECT fidelidad_dias_regreso AS dias FROM tenants WHERE id = $1',
    [req.tenantId],
  );
  const dias = t[0]?.dias ?? 0;
  if (dias <= 0) {
    res.json({ dias: 0, clientes: [] });
    return;
  }
  // La última visita es el último turno entregado. Fuera: los que tienen un
  // turno pendiente (ya van a volver), los anonimizados, los sin teléfono, y a
  // los que se invitó hace poco.
  const { rows } = await db.query<{
    id: string; first_name: string | null; phone: string; ultima: Date; visitas: string; placa: string | null; servicio: string | null;
  }>(
    `WITH ultima AS (
       SELECT DISTINCT ON (a.customer_id) a.customer_id, a.scheduled_date AS ultima, v.plate AS placa, s.name AS servicio
         FROM appointments a
         JOIN vehicles v ON v.id = a.vehicle_id
         JOIN services s ON s.id = a.service_id
        WHERE a.tenant_id = $1 AND a.status = 'delivered'
        ORDER BY a.customer_id, a.scheduled_date DESC, a.created_at DESC
     )
     SELECT c.id, c.first_name, c.phone, u.ultima, u.placa, u.servicio,
            (SELECT COUNT(*) FROM appointments x WHERE x.customer_id = c.id AND x.status = 'delivered') AS visitas
       FROM ultima u JOIN customers c ON c.id = u.customer_id
      WHERE c.tenant_id = $1
        AND c.anonymized_at IS NULL AND c.deleted_at IS NULL AND c.phone IS NOT NULL
        AND u.ultima < $4::date - $2::int
        AND (c.invitado_regreso_at IS NULL OR c.invitado_regreso_at < NOW() - make_interval(days => $3))
        AND NOT EXISTS (
          SELECT 1 FROM appointments f WHERE f.customer_id = c.id AND f.status = 'pending' AND f.scheduled_date >= $4::date
        )
      ORDER BY u.ultima DESC
      LIMIT 50`,
    // «Hoy» del lavadero, no de la base: la base corre en UTC, y de 7 p. m. a
    // medianoche en Colombia CURRENT_DATE ya es mañana (un cliente con turno
    // para hoy salía como «no ha vuelto»).
    [req.tenantId, dias, DIAS_ENTRE_INVITACIONES, await getTenantToday(req.tenantId!)],
  );
  const hoy = await getTenantToday(req.tenantId!);
  res.json({
    dias,
    clientes: rows.map((r) => ({
      id: r.id,
      nombre: r.first_name,
      telefono: r.phone,
      ultimaVisita: r.ultima,
      diasSinVenir: Math.round((new Date(`${hoy}T12:00:00Z`).getTime() - new Date(`${String(r.ultima instanceof Date ? r.ultima.toISOString() : r.ultima).slice(0, 10)}T12:00:00Z`).getTime()) / 86_400_000),
      visitas: parseInt(r.visitas, 10),
      placa: r.placa,
      servicio: r.servicio,
    })),
  });
}

export async function marcarInvitado(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<{ first_name: string | null; phone: string | null; lavadero: string; slug: string }>(
    `UPDATE customers c SET invitado_regreso_at = NOW()
       FROM tenants t
      WHERE c.id = $1 AND c.tenant_id = $2 AND t.id = c.tenant_id
      RETURNING c.first_name, c.phone, t.name AS lavadero, t.slug`,
    [req.params.id, req.tenantId],
  );
  if (!rows[0]) throw new AppError('Cliente no encontrado', 404);
  res.json({
    nombre: rows[0].first_name,
    telefono: rows[0].phone,
    lavadero: rows[0].lavadero,
    slug: rows[0].slug,
    sellos: await sellosDe(req.tenantId!, req.params.id),
  });
}
