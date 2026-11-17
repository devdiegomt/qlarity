/**
 * Servicios adicionales de un turno («encera tú mismo» y similares).
 *
 * Un adicional no se reserva solo: se suma a un lavado, alarga lo que el turno
 * ocupa la bahía y suma su precio al total. Lo usan el panel (turno rápido) y
 * la página de reservas, así que la validación vive en un solo lugar. Ver
 * shared/db/migrate-adicionales.ts.
 */
import type { PoolClient } from 'pg';
import { AppError } from '../../shared/middleware/errorHandler';
import { getServicePrice } from '../../shared/utils/pricing';
import type { ServiceRow, VehicleType } from '../../types/entities';

export interface Adicional {
  serviceId: string;
  nombre: string;
  /** Centavos, para el tipo de vehículo del turno. */
  precio: number;
  minutos: number;
}

type Consulta = Pick<PoolClient, 'query'>;

/**
 * Comprueba que cada id sea un adicional activo del lavadero con precio para
 * ese tipo de vehículo, y devuelve su precio y duración de hoy.
 */
export async function resolverAdicionales(
  db: Consulta,
  tenantId: string,
  ids: string[],
  tipo: VehicleType,
): Promise<Adicional[]> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return [];
  const { rows } = await db.query<ServiceRow>(
    `SELECT * FROM services
      WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND is_active = true AND es_adicional = true`,
    [tenantId, unicos],
  );
  if (rows.length !== unicos.length) {
    throw new AppError('Uno de los adicionales no está disponible', 400, { codigo: 'ADICIONAL_INVALIDO' });
  }
  return rows.map((s) => {
    const precio = getServicePrice(s, tipo);
    if (!(precio > 0)) {
      throw new AppError(`«${s.name}» no está disponible para este tipo de vehículo`, 400, { codigo: 'ADICIONAL_INVALIDO' });
    }
    return { serviceId: s.id, nombre: s.name, precio, minutos: s.estimated_minutes || 30 };
  });
}

export async function guardarAdicionales(
  db: Consulta,
  tenantId: string,
  appointmentId: string,
  adicionales: Adicional[],
): Promise<void> {
  for (const a of adicionales) {
    await db.query(
      `INSERT INTO appointment_extras (tenant_id, appointment_id, service_id, price, minutes)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, appointmentId, a.serviceId, a.precio, a.minutos],
    );
  }
}

export const sumaPrecio = (l: Adicional[]): number => l.reduce((t, a) => t + a.precio, 0);
export const sumaMinutos = (l: Adicional[]): number => l.reduce((t, a) => t + a.minutos, 0);

/**
 * Para los SELECT de turnos: los adicionales como JSON y los minutos totales.
 * `a` es el alias de `appointments`.
 */
export const COLUMNAS_ADICIONALES = `
  COALESCE((SELECT json_agg(json_build_object('id', e.service_id, 'nombre', es.name, 'precio', e.price, 'minutos', e.minutes)
                            ORDER BY e.created_at)
              FROM appointment_extras e JOIN services es ON es.id = e.service_id
             WHERE e.appointment_id = a.id), '[]'::json) AS adicionales,
  COALESCE((SELECT SUM(e.minutes) FROM appointment_extras e WHERE e.appointment_id = a.id), 0)::int AS minutos_adicionales`;
