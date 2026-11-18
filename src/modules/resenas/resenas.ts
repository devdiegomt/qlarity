/**
 * Calificaciones de los clientes y el paso a las reseñas de Google.
 *
 * Panel:
 *   POST /api/appointments/:id/encuesta   crea (o reusa) el enlace de un turno
 *   GET  /api/calificaciones?dias=30       promedio, distribución y comentarios
 *
 * Público (sin sesión, por el token del enlace):
 *   GET  /api/publico/calificaciones/:token
 *   POST /api/publico/calificaciones/:token          { estrellas, comentario }
 *   POST /api/publico/calificaciones/:token/google   anota que fue a Google
 *
 * El enlace se manda por WhatsApp desde el celular del lavadero (wa.me, sin
 * bot): el panel arma el mensaje con el token. El botón de Google se le ofrece
 * a todos los que responden, no sólo a los que ponen 4 o 5: filtrar quién llega
 * a dejar reseña va contra las políticas de Google y puede costarle al negocio
 * sus reseñas. Ver shared/db/migrate-resenas.ts.
 */
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';

/** Forma del token: 22 caracteres base64url (128 bits). */
export const FORMA_TOKEN = /^[A-Za-z0-9_-]{22}$/;

// ─── Panel ───────────────────────────────────────────────────────────────────

export async function crearEncuesta(req: Request, res: Response): Promise<void> {
  const { rows: turno } = await db.query<{
    status: string; first_name: string | null; phone: string | null; lavadero: string;
  }>(
    `SELECT a.status, c.first_name, c.phone, t.name AS lavadero
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       JOIN tenants t ON t.id = a.tenant_id
      WHERE a.id = $1 AND a.tenant_id = $2`,
    [req.params.id, req.tenantId],
  );
  if (!turno[0]) throw new AppError('Turno no encontrado', 404);
  if (!['done', 'delivered'].includes(turno[0].status)) {
    throw new AppError('La encuesta se manda cuando el carro está listo o entregado', 409);
  }

  // Uno por turno: mandarlo dos veces reusa el mismo enlace.
  const { rows } = await db.query<{ token: string; answered_at: Date | null }>(
    `INSERT INTO appointment_reviews (tenant_id, appointment_id, token)
     VALUES ($1, $2, $3)
     ON CONFLICT (appointment_id) DO UPDATE SET appointment_id = EXCLUDED.appointment_id
     RETURNING token, answered_at`,
    [req.tenantId, req.params.id, randomBytes(16).toString('base64url')],
  );
  res.status(201).json({
    token: rows[0].token,
    respondida: rows[0].answered_at !== null,
    cliente: turno[0].first_name,
    telefono: turno[0].phone,
    lavadero: turno[0].lavadero,
  });
}

export async function resumen(req: Request, res: Response): Promise<void> {
  const dias = Math.min(365, Math.max(1, parseInt(String(req.query.dias ?? '30'), 10) || 30));
  const { rows: total } = await db.query<{ enviadas: string; respondidas: string; promedio: string | null; a_google: string }>(
    `SELECT COUNT(*) AS enviadas,
            COUNT(answered_at) AS respondidas,
            ROUND(AVG(rating)::numeric, 1)::text AS promedio,
            COUNT(google_click_at) AS a_google
       FROM appointment_reviews
      WHERE tenant_id = $1 AND created_at >= NOW() - make_interval(days => $2)`,
    [req.tenantId, dias],
  );
  const { rows: dist } = await db.query<{ rating: number; n: string }>(
    `SELECT rating, COUNT(*) AS n FROM appointment_reviews
      WHERE tenant_id = $1 AND answered_at >= NOW() - make_interval(days => $2)
      GROUP BY rating`,
    [req.tenantId, dias],
  );
  const { rows: recientes } = await db.query<{
    rating: number; comment: string | null; answered_at: Date; plate: string; first_name: string | null; service_name: string;
  }>(
    `SELECT r.rating, r.comment, r.answered_at, v.plate, c.first_name, s.name AS service_name
       FROM appointment_reviews r
       JOIN appointments a ON a.id = r.appointment_id
       JOIN vehicles v ON v.id = a.vehicle_id
       JOIN customers c ON c.id = a.customer_id
       JOIN services s ON s.id = a.service_id
      WHERE r.tenant_id = $1 AND r.answered_at IS NOT NULL
      ORDER BY r.answered_at DESC
      LIMIT 20`,
    [req.tenantId],
  );
  res.json({
    dias,
    enviadas: parseInt(total[0].enviadas, 10),
    respondidas: parseInt(total[0].respondidas, 10),
    promedio: total[0].promedio === null ? null : Number(total[0].promedio),
    aGoogle: parseInt(total[0].a_google, 10),
    distribucion: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, parseInt(dist.find((d) => d.rating === n)?.n ?? '0', 10)])),
    recientes: recientes.map((r) => ({
      estrellas: r.rating,
      comentario: r.comment,
      fecha: r.answered_at,
      placa: r.plate,
      cliente: r.first_name,
      servicio: r.service_name,
    })),
  });
}

// ─── Público ─────────────────────────────────────────────────────────────────

interface FilaEncuesta {
  rating: number | null;
  answered_at: Date | null;
  lavadero: string;
  google_review_url: string | null;
  servicio: string;
  fecha: string;
}

async function leerEncuesta(token: string): Promise<FilaEncuesta> {
  const { rows } = await db.query<FilaEncuesta>(
    `SELECT r.rating, r.answered_at, t.name AS lavadero, t.google_review_url,
            s.name AS servicio, to_char(a.scheduled_date, 'YYYY-MM-DD') AS fecha
       FROM appointment_reviews r
       JOIN appointments a ON a.id = r.appointment_id
       JOIN services s ON s.id = a.service_id
       JOIN tenants t ON t.id = r.tenant_id
      WHERE r.token = $1`,
    [token],
  );
  if (!rows[0]) throw new AppError('Encuesta no encontrada', 404);
  return rows[0];
}

/** Lo que ve el cliente: sólo el lavadero, el servicio y la fecha. Nada suyo. */
function vista(e: FilaEncuesta) {
  return {
    lavadero: e.lavadero,
    servicio: e.servicio,
    fecha: e.fecha,
    respondida: e.answered_at !== null,
    estrellas: e.rating,
    googleUrl: e.google_review_url,
  };
}

export async function verEncuesta(req: Request, res: Response): Promise<void> {
  res.json(vista(await leerEncuesta(req.params.token)));
}

export const esquemaRespuesta = z.object({
  estrellas: z.number().int().min(1, 'Elige de 1 a 5 estrellas').max(5, 'Elige de 1 a 5 estrellas'),
  comentario: z.string().trim().max(1000).optional().nullable(),
});

export async function responder(req: Request, res: Response): Promise<void> {
  const { estrellas, comentario } = req.body as z.infer<typeof esquemaRespuesta>;
  // Se responde una vez: la condición va en el UPDATE para que dos envíos a la
  // vez no se pisen.
  const { rowCount } = await db.query(
    `UPDATE appointment_reviews SET rating = $2, comment = $3, answered_at = NOW()
      WHERE token = $1 AND answered_at IS NULL`,
    [req.params.token, estrellas, comentario || null],
  );
  const e = await leerEncuesta(req.params.token);
  if (!rowCount) throw new AppError('Esta encuesta ya fue respondida. ¡Gracias!', 409, { codigo: 'YA_RESPONDIDA' });
  res.status(201).json(vista(e));
}

export async function irAGoogle(req: Request, res: Response): Promise<void> {
  await db.query(
    `UPDATE appointment_reviews SET google_click_at = COALESCE(google_click_at, NOW()) WHERE token = $1`,
    [req.params.token],
  );
  res.status(204).end();
}
