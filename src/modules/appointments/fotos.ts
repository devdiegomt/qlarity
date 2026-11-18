/**
 * Fotos de recepción de un turno, y el reclamo que las protege del borrado.
 *
 *   GET    /api/appointments/:id/fotos          lista, con enlaces firmados
 *   POST   /api/appointments/:id/fotos          sube una (cuerpo: la imagen)
 *   DELETE /api/appointments/:id/fotos/:fotoId  la borra (admin o quien la tomó)
 *   PATCH  /api/appointments/:id/reclamo        abre o cierra un reclamo
 *
 * El panel achica cada foto antes de subirla (unos 200-400 KB); acá se acepta
 * hasta 1,5 MB y se comprueba que de verdad sea una imagen por sus primeros
 * bytes, no por lo que diga la cabecera. Ver shared/storage/fotos.ts y
 * shared/db/migrate-fotos.ts.
 */
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { obtenerAlmacen, type Almacen } from '../../shared/storage/fotos';
import logger from '../../shared/utils/logger';

export const MAX_FOTOS_POR_TURNO = 12;
export const MAX_BYTES_FOTO = 1_500_000;
/** Cuánto dura un enlace para ver una foto. */
const SEGUNDOS_ENLACE = 15 * 60;

/** El tipo real de la imagen por su firma de bytes, o null si no es imagen. */
export function tipoDeImagen(b: Buffer): { tipo: string; ext: 'jpg' | 'png' | 'webp' } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { tipo: 'image/jpeg', ext: 'jpg' };
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { tipo: 'image/png', ext: 'png' };
  }
  if (b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { tipo: 'image/webp', ext: 'webp' };
  }
  return null;
}

function exigirAlmacen(): Almacen {
  const a = obtenerAlmacen();
  if (!a) {
    throw new AppError(
      'Las fotos todavía no están configuradas en este servidor. Pídele al administrador de Qlarity que las active.',
      503,
      { codigo: 'FOTOS_SIN_CONFIGURAR' },
    );
  }
  return a;
}

async function exigirTurno(req: Request): Promise<void> {
  const { rows } = await db.query('SELECT 1 FROM appointments WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  if (rows.length === 0) throw new AppError('Turno no encontrado', 404);
}

interface FilaFoto {
  id: string;
  storage_path: string;
  taken_by: string | null;
  created_at: Date;
  tomada_por: string | null;
}

export async function listar(req: Request, res: Response): Promise<void> {
  await exigirTurno(req);
  const almacen = exigirAlmacen();
  const { rows } = await db.query<FilaFoto>(
    `SELECT p.id, p.storage_path, p.taken_by, p.created_at, u.first_name AS tomada_por
       FROM appointment_photos p LEFT JOIN users u ON u.id = p.taken_by
      WHERE p.appointment_id = $1 AND p.tenant_id = $2
      ORDER BY p.created_at`,
    [req.params.id, req.tenantId],
  );
  const fotos = await Promise.all(
    rows.map(async (f) => ({
      id: f.id,
      url: await almacen.urlFirmada(f.storage_path, SEGUNDOS_ENLACE),
      creadaEn: f.created_at,
      tomadaPor: f.tomada_por,
      propia: f.taken_by === req.user!.id,
    })),
  );
  res.json(fotos);
}

export async function subir(req: Request, res: Response): Promise<void> {
  await exigirTurno(req);
  const almacen = exigirAlmacen();

  const cuerpo = req.body as unknown;
  if (!Buffer.isBuffer(cuerpo) || cuerpo.length === 0) {
    throw new AppError('Manda la foto como imagen (JPEG, PNG o WebP)', 400);
  }
  if (cuerpo.length > MAX_BYTES_FOTO) throw new AppError('La foto es demasiado grande', 413);
  const imagen = tipoDeImagen(cuerpo);
  if (!imagen) throw new AppError('El archivo no es una imagen JPEG, PNG o WebP', 400);

  const { rows: cuenta } = await db.query<{ n: string }>(
    'SELECT COUNT(*) AS n FROM appointment_photos WHERE appointment_id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId],
  );
  if (parseInt(cuenta[0].n, 10) >= MAX_FOTOS_POR_TURNO) {
    throw new AppError(`Un turno puede tener hasta ${MAX_FOTOS_POR_TURNO} fotos`, 409, { codigo: 'TOPE_FOTOS' });
  }

  const ruta = `${req.tenantId}/${req.params.id}/${randomUUID()}.${imagen.ext}`;
  // Primero el archivo, después la fila: una fila sin archivo sería una foto
  // rota en el panel. Si la fila falla, se borra el archivo.
  await almacen.subir(ruta, cuerpo, imagen.tipo);
  let id: string;
  try {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO appointment_photos (tenant_id, appointment_id, storage_path, bytes, taken_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.tenantId, req.params.id, ruta, cuerpo.length, req.user!.id],
    );
    id = rows[0].id;
  } catch (err) {
    await almacen.borrar([ruta]).catch((e: unknown) => logger.error({ err: e, ruta }, 'No se pudo borrar una foto huérfana'));
    throw err;
  }
  res.status(201).json({ id, url: await almacen.urlFirmada(ruta, SEGUNDOS_ENLACE) });
}

export async function borrar(req: Request, res: Response): Promise<void> {
  const almacen = exigirAlmacen();
  const { rows } = await db.query<{ storage_path: string; taken_by: string | null }>(
    'SELECT storage_path, taken_by FROM appointment_photos WHERE id = $1 AND appointment_id = $2 AND tenant_id = $3',
    [req.params.fotoId, req.params.id, req.tenantId],
  );
  if (rows.length === 0) throw new AppError('Foto no encontrada', 404);
  const esAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';
  if (!esAdmin && rows[0].taken_by !== req.user!.id) {
    throw new AppError('Sólo un administrador o quien tomó la foto puede borrarla', 403);
  }
  // Una foto es evidencia: con un reclamo abierto no se borra.
  const { rows: rec } = await db.query<{ reclamo_abierto_at: Date | null }>(
    'SELECT reclamo_abierto_at FROM appointments WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId],
  );
  if (rec[0]?.reclamo_abierto_at) {
    throw new AppError('Este turno tiene un reclamo abierto: sus fotos no se pueden borrar hasta cerrarlo', 409);
  }
  await almacen.borrar([rows[0].storage_path]);
  await db.query('DELETE FROM appointment_photos WHERE id = $1 AND tenant_id = $2', [req.params.fotoId, req.tenantId]);
  res.status(204).end();
}

export const esquemaReclamo = z.object({
  abierto: z.boolean(),
  nota: z.string().trim().max(500).optional().nullable(),
});

export async function reclamo(req: Request, res: Response): Promise<void> {
  const { abierto, nota } = req.body as z.infer<typeof esquemaReclamo>;
  const { rows } = await db.query<{ reclamo_abierto_at: Date | null; reclamo_nota: string | null }>(
    `UPDATE appointments
        SET reclamo_abierto_at = CASE WHEN $3 THEN COALESCE(reclamo_abierto_at, NOW()) ELSE NULL END,
            reclamo_nota = CASE WHEN $3 THEN COALESCE($4, reclamo_nota) ELSE reclamo_nota END,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING reclamo_abierto_at, reclamo_nota`,
    [req.params.id, req.tenantId, abierto, nota ?? null],
  );
  if (rows.length === 0) throw new AppError('Turno no encontrado', 404);
  res.json({ reclamoAbiertoEn: rows[0].reclamo_abierto_at, reclamoNota: rows[0].reclamo_nota });
}
