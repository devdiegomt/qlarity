/**
 * Tiquetera: paquetes prepagados de lavados.
 *
 *   GET   /api/paquetes                     los que ofrece el lavadero
 *   POST  /api/paquetes                     crear (admin)
 *   PATCH /api/paquetes/:id                 editar / activar / desactivar (admin)
 *   GET   /api/customers/:id/tiqueteras     las del cliente, con su saldo
 *   POST  /api/customers/:id/tiqueteras     vender una  { paqueteId, metodoPago }
 *   GET   /api/appointments/:id/tiqueteras  las que sirven para pagar ese turno
 *
 * El uso se registra al cobrar (`POST /payments` con `tiqueteraId`): ver
 * `usarTiquetera`. La plata entra al vender; los reportes la suman ese día.
 * Ver shared/db/migrate-tiquetera.ts.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { getTenantToday } from '../../shared/utils/dateUtils';

type Consulta = typeof db.query;

const uuid = z.string().uuid();

export const esquemaPaquete = z.object({
  nombre: z.string().trim().min(2, 'Ponle un nombre').max(100),
  serviceId: uuid,
  cantidad: z.number().int().min(2, 'Mínimo 2 lavados').max(50, 'Máximo 50 lavados'),
  precio: z.number().int().positive('El precio tiene que ser mayor a 0'),
  vigenciaDias: z.number().int().min(7).max(730).nullable().optional(),
});
export const esquemaPaqueteParche = esquemaPaquete.partial().extend({ activo: z.boolean().optional() });

export const esquemaVenta = z.object({
  paqueteId: uuid,
  metodoPago: z.enum(['cash', 'nequi', 'daviplata', 'transfer', 'card'], {
    errorMap: () => ({ message: 'Método de pago inválido' }),
  }),
});

const SELECT_PAQUETE = `
  SELECT p.id, p.nombre, p.service_id, s.name AS servicio, p.cantidad, p.precio, p.vigencia_dias, p.is_active,
         s.price_sedan AS precio_suelto
    FROM paquetes_lavado p JOIN services s ON s.id = p.service_id`;

export async function listarPaquetes(req: Request, res: Response): Promise<void> {
  const soloActivos = req.query.todos !== 'true';
  const { rows } = await db.query(
    `${SELECT_PAQUETE} WHERE p.tenant_id = $1 ${soloActivos ? 'AND p.is_active' : ''} ORDER BY p.created_at`,
    [req.tenantId],
  );
  res.json(rows);
}

async function exigirServicio(tenantId: string, serviceId: string): Promise<void> {
  const { rows } = await db.query(
    'SELECT 1 FROM services WHERE id = $1 AND tenant_id = $2 AND is_active AND NOT es_adicional',
    [serviceId, tenantId],
  );
  if (!rows[0]) throw new AppError('Elige un lavado activo de tu catálogo', 400);
}

export async function crearPaquete(req: Request, res: Response): Promise<void> {
  const b = req.body as z.infer<typeof esquemaPaquete>;
  await exigirServicio(req.tenantId!, b.serviceId);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO paquetes_lavado (tenant_id, nombre, service_id, cantidad, precio, vigencia_dias)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [req.tenantId, b.nombre, b.serviceId, b.cantidad, b.precio, b.vigenciaDias ?? null],
  );
  const { rows: p } = await db.query(`${SELECT_PAQUETE} WHERE p.id = $1`, [rows[0].id]);
  res.status(201).json(p[0]);
}

export async function editarPaquete(req: Request, res: Response): Promise<void> {
  const b = req.body as z.infer<typeof esquemaPaqueteParche>;
  if (b.serviceId) await exigirServicio(req.tenantId!, b.serviceId);
  const campos: Record<string, unknown> = {
    nombre: b.nombre, service_id: b.serviceId, cantidad: b.cantidad, precio: b.precio,
    vigencia_dias: b.vigenciaDias, is_active: b.activo,
  };
  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const [col, v] of Object.entries(campos)) {
    if (v === undefined) continue;
    valores.push(v);
    sets.push(`${col} = $${valores.length}`);
  }
  if (sets.length === 0) throw new AppError('No hay nada que cambiar', 400);
  valores.push(req.params.id, req.tenantId);
  const { rowCount } = await db.query(
    `UPDATE paquetes_lavado SET ${sets.join(', ')} WHERE id = $${valores.length - 1} AND tenant_id = $${valores.length}`,
    valores as (string | number | boolean | null)[],
  );
  if (!rowCount) throw new AppError('Paquete no encontrado', 404);
  const { rows } = await db.query(`${SELECT_PAQUETE} WHERE p.id = $1`, [req.params.id]);
  res.json(rows[0]);
}

const SELECT_TIQUETERA = `
  SELECT t.id, t.nombre, t.service_id, s.name AS servicio, t.cantidad, t.usados, t.cantidad - t.usados AS quedan,
         t.precio, t.metodo_pago, to_char(t.vence_el, 'YYYY-MM-DD') AS vence_el, t.created_at
    FROM tiqueteras t JOIN services s ON s.id = t.service_id`;

export async function tiqueterasDeCliente(req: Request, res: Response): Promise<void> {
  const { rows: c } = await db.query('SELECT 1 FROM customers WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  if (!c[0]) throw new AppError('Cliente no encontrado', 404);
  const hoy = await getTenantToday(req.tenantId!);
  const { rows } = await db.query<{ quedan: number; vence_el: string | null }>(
    `${SELECT_TIQUETERA} WHERE t.tenant_id = $1 AND t.customer_id = $2 ORDER BY t.created_at DESC`,
    [req.tenantId, req.params.id],
  );
  res.json(rows.map((t) => ({ ...t, vencida: t.vence_el !== null && t.vence_el < hoy, agotada: t.quedan <= 0 })));
}

export async function venderTiquetera(req: Request, res: Response): Promise<void> {
  const { paqueteId, metodoPago } = req.body as z.infer<typeof esquemaVenta>;
  const { rows: c } = await db.query('SELECT 1 FROM customers WHERE id = $1 AND tenant_id = $2 AND anonymized_at IS NULL', [req.params.id, req.tenantId]);
  if (!c[0]) throw new AppError('Cliente no encontrado', 404);
  const { rows: p } = await db.query<{ nombre: string; service_id: string; cantidad: number; precio: number; vigencia_dias: number | null }>(
    'SELECT nombre, service_id, cantidad, precio, vigencia_dias FROM paquetes_lavado WHERE id = $1 AND tenant_id = $2 AND is_active',
    [paqueteId, req.tenantId],
  );
  if (!p[0]) throw new AppError('Ese paquete no está disponible', 404);
  const hoy = await getTenantToday(req.tenantId!);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO tiqueteras (tenant_id, customer_id, paquete_id, service_id, nombre, cantidad, precio, metodo_pago, vence_el, vendida_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::int IS NULL THEN NULL ELSE $10::date + $9::int END, $11)
     RETURNING id`,
    [req.tenantId, req.params.id, paqueteId, p[0].service_id, p[0].nombre, p[0].cantidad, p[0].precio, metodoPago,
     p[0].vigencia_dias, hoy, req.user!.id],
  );
  const { rows: t } = await db.query(`${SELECT_TIQUETERA} WHERE t.id = $1`, [rows[0].id]);
  res.status(201).json(t[0]);
}

/** Tiqueteras del cliente del turno que sirven para su servicio: con saldo y sin vencer. */
async function aplicables(tenantId: string, appointmentId: string, consulta: Consulta = db.query) {
  const hoy = await getTenantToday(tenantId);
  const { rows } = await consulta<{ id: string; nombre: string; cantidad: number; usados: number; quedan: number; vence_el: string | null }>(
    `${SELECT_TIQUETERA}
       JOIN appointments a ON a.customer_id = t.customer_id AND a.service_id = t.service_id
      WHERE a.id = $1 AND t.tenant_id = $2 AND t.usados < t.cantidad AND (t.vence_el IS NULL OR t.vence_el >= $3::date)
      ORDER BY t.vence_el NULLS LAST, t.created_at`,
    [appointmentId, tenantId, hoy],
  );
  return rows;
}

export async function tiqueterasDeTurno(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query('SELECT 1 FROM appointments WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  if (!rows[0]) throw new AppError('Turno no encontrado', 404);
  res.json(await aplicables(req.tenantId!, req.params.id));
}

/**
 * Descuenta un lavado de la tiquetera, si sirve para este turno. El
 * `usados < cantidad` va en el UPDATE: dos cobros a la vez no pueden gastar el
 * mismo lavado.
 */
export async function usarTiquetera(tenantId: string, appointmentId: string, tiqueteraId: string): Promise<void> {
  const sirve = (await aplicables(tenantId, appointmentId)).some((t) => t.id === tiqueteraId);
  if (!sirve) throw new AppError('Esa tiquetera no sirve para este turno (otro servicio, vencida o sin lavados)', 409, { codigo: 'TIQUETERA_NO_APLICA' });
  const { rowCount } = await db.query(
    'UPDATE tiqueteras SET usados = usados + 1 WHERE id = $1 AND tenant_id = $2 AND usados < cantidad',
    [tiqueteraId, tenantId],
  );
  if (!rowCount) throw new AppError('A esa tiquetera ya no le quedan lavados', 409, { codigo: 'TIQUETERA_NO_APLICA' });
}

/** Ventas de tiqueteras entre dos fechas (en la zona del lavadero), por día y por método. */
export async function ventasTiquetera(tenantId: string, desde: string, hasta: string) {
  const { rows } = await db.query<{ dia: string; metodo_pago: string; n: string; total: string }>(
    `SELECT to_char((t.created_at AT TIME ZONE tn.timezone)::date, 'YYYY-MM-DD') AS dia, t.metodo_pago,
            COUNT(*) AS n, SUM(t.precio) AS total
       FROM tiqueteras t JOIN tenants tn ON tn.id = t.tenant_id
      WHERE t.tenant_id = $1 AND (t.created_at AT TIME ZONE tn.timezone)::date BETWEEN $2::date AND $3::date
      GROUP BY 1, 2`,
    [tenantId, desde, hasta],
  );
  return rows.map((r) => ({ dia: r.dia, metodo: r.metodo_pago, n: parseInt(r.n, 10), total: parseInt(r.total, 10) }));
}
