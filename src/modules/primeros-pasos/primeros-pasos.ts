/**
 * «Primeros pasos»: la guía de Inicio para un lavadero nuevo.
 *
 *   GET  /api/tenants/me/primeros-pasos   qué pasos están hechos
 *   POST /api/tenants/me/primeros-pasos   { paso } lo marca, { cerrar: true } la oculta,
 *                                         { abrir: true } la vuelve a mostrar
 *
 * Unos pasos se detectan en los datos; los que el registro deja con valores por
 * defecto (horario, servicios) se marcan con `marcarPaso` cuando el dueño los
 * guarda. Ver shared/db/migrate-primeros-pasos.ts.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../../shared/db';
import logger from '../../shared/utils/logger';

export const PASOS = ['datos', 'horario', 'servicios', 'equipo', 'reservas', 'turno'] as const;
export type Paso = (typeof PASOS)[number];

/** Anota un paso como hecho. Nunca hace fallar la acción que lo dispara. */
export async function marcarPaso(tenantId: string, paso: Paso): Promise<void> {
  try {
    await db.query(
      `UPDATE tenants SET primeros_pasos = primeros_pasos || jsonb_build_object($2::text, true)
        WHERE id = $1 AND NOT (primeros_pasos ? $2::text)`,
      [tenantId, paso],
    );
  } catch (err) {
    logger.error({ err, paso }, 'No se pudo marcar un primer paso');
  }
}

export async function estado(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<{
    marcados: Record<string, boolean>; datos: boolean; equipo: boolean; turno: boolean;
  }>(
    `SELECT t.primeros_pasos AS marcados,
            (t.address IS NOT NULL AND t.address <> '' AND t.phone IS NOT NULL AND t.phone <> '') AS datos,
            EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND u.role = 'operator' AND u.is_active) AS equipo,
            EXISTS (SELECT 1 FROM appointments a WHERE a.tenant_id = t.id) AS turno
       FROM tenants t WHERE t.id = $1`,
    [req.tenantId],
  );
  const r = rows[0];
  const detectado: Partial<Record<Paso, boolean>> = { datos: r.datos, equipo: r.equipo, turno: r.turno };
  const pasos = PASOS.map((clave) => ({ clave, hecho: Boolean(detectado[clave] || r.marcados[clave]) }));
  res.json({
    cerrado: Boolean(r.marcados.cerrado),
    pasos,
    completos: pasos.filter((p) => p.hecho).length,
  });
}

export const esquemaPaso = z.union([
  z.object({ paso: z.enum(PASOS) }),
  z.object({ cerrar: z.literal(true) }),
  // Volver a mostrarla (Configuración → «Ver la guía de primeros pasos»).
  z.object({ abrir: z.literal(true) }),
]);

export async function marcar(req: Request, res: Response): Promise<void> {
  const b = req.body as z.infer<typeof esquemaPaso>;
  if ('abrir' in b) {
    await db.query(`UPDATE tenants SET primeros_pasos = primeros_pasos - 'cerrado' WHERE id = $1`, [req.tenantId]);
  } else if ('cerrar' in b) {
    await db.query(
      `UPDATE tenants SET primeros_pasos = primeros_pasos || '{"cerrado": true}'::jsonb WHERE id = $1`,
      [req.tenantId],
    );
  } else {
    await marcarPaso(req.tenantId!, b.paso);
  }
  await estado(req, res);
}
