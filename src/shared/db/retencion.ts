/**
 * Retención de datos personales (Ley 1581).
 *
 * La ley pide conservar los datos sólo mientras la finalidad lo justifique.
 * Acá viven las dos tareas que lo hacen cumplir: purgar conversaciones viejas
 * y anonimizar clientes que dejaron de venir.
 *
 * **Los plazos son una decisión del responsable del tratamiento, no una
 * constante técnica.** Por eso salen de configuración, y poner `0` desactiva
 * la tarea. Los valores por defecto son un punto de partida defendible, no una
 * recomendación legal.
 *
 * A diferencia del resto de `shared/db`, este módulo sí importa `config`: no
 * es un script de migración que deba correr standalone, sino una tarea del
 * servidor, y los plazos merecen validarse al arrancar y no al vencerse.
 */
import * as db from './index';
import { config } from '../../config';
import logger from '../utils/logger';
import { obtenerAlmacen } from '../storage/fotos';

/** Días que se conservan las fotos de recepción. 0 desactiva la purga. */
const DIAS_FOTOS = config.DATA_RETENTION_PHOTOS_DAYS;

/** Meses que se conservan las conversaciones. 0 desactiva la purga. */
const MESES_MENSAJES = config.DATA_RETENTION_MESSAGES_MONTHS;

/**
 * Meses de inactividad tras los cuales se anonimiza a un cliente.
 *
 * Desactivado por defecto: borrar los datos de un cliente es irreversible y
 * afecta la relación comercial del lavadero. Que lo active quien decide sobre
 * esos datos, no un valor que vino de fábrica.
 */
const MESES_CLIENTES = config.DATA_RETENTION_CUSTOMERS_MONTHS;

/**
 * Meses que se conserva la bitácora de acciones. 0 desactiva la purga.
 *
 * Más largo que el de las conversaciones a propósito: el valor de una bitácora
 * está en poder mirar atrás cuando alguien por fin nota algo raro, y eso rara vez
 * pasa la misma semana.
 */
const MESES_AUDITORIA = config.DATA_RETENTION_AUDIT_MONTHS;

/**
 * Los campos que dejan de identificar a una persona.
 *
 * Vive en una constante porque lo usan la tarea automática y el derecho de
 * supresión: si mañana `customers` gana una columna con dato personal, hay un
 * solo lugar que corregir en vez de dos que se desincronizan.
 */
const CAMPOS_ANONIMIZADOS = `
  first_name      = 'Cliente',
  last_name       = NULL,
  phone           = NULL,
  email           = NULL,
  document_number = NULL,
  wa_lid          = NULL,
  notes           = NULL,
  anonymized_at   = NOW(),
  updated_at      = NOW()
`;

/**
 * Borra las conversaciones más viejas que el plazo configurado.
 *
 * `whatsapp_messages.content` guarda el texto literal de lo que escribió el
 * cliente: es el dato más sensible del sistema y el que menos justifica
 * conservarse indefinidamente.
 *
 * @param meses Plazo a aplicar. Por defecto el configurado; se puede pasar
 *   explícito para una purga puntual sin tocar el `.env`.
 */
export async function purgarMensajesViejos(meses: number = MESES_MENSAJES): Promise<number> {
  if (meses <= 0) return 0;

  try {
    const { rowCount } = await db.query(
      `DELETE FROM whatsapp_messages
       WHERE created_at < NOW() - ($1 || ' months')::interval`,
      [String(meses)],
    );
    const borrados = rowCount ?? 0;
    if (borrados > 0) {
      logger.info({ borrados, meses }, 'Mensajes purgados por retención');
    }
    return borrados;
  } catch (err) {
    logger.error({ err }, 'Error purgando mensajes');
    return 0;
  }
}

/**
 * Anonimiza clientes sin actividad en el plazo configurado.
 *
 * No los borra: los turnos siguen existiendo y contando para las estadísticas
 * del lavadero, pero dejan de estar asociados a una persona identificable. Un
 * `DELETE` rompería la integridad referencial y perdería el historial de
 * negocio, que no es dato personal.
 *
 * @param meses Plazo a aplicar. Por defecto el configurado.
 */
export async function anonimizarClientesInactivos(
  meses: number = MESES_CLIENTES,
): Promise<number> {
  if (meses <= 0) return 0;

  try {
    const { rowCount } = await db.query(
      `UPDATE customers
       SET ${CAMPOS_ANONIMIZADOS}
       WHERE anonymized_at IS NULL
         AND COALESCE(last_visit_at, created_at) < NOW() - ($1 || ' months')::interval`,
      [String(meses)],
    );
    const anonimizados = rowCount ?? 0;
    if (anonimizados > 0) {
      logger.info(
        { anonimizados, meses },
        'Clientes inactivos anonimizados por retención',
      );
    }
    return anonimizados;
  } catch (err) {
    logger.error({ err }, 'Error anonimizando clientes inactivos');
    return 0;
  }
}

/**
 * Anonimiza un cliente concreto: el derecho de supresión del titular.
 *
 * Se expone aparte de la tarea automática porque responde a una petición
 * puntual, que la ley obliga a atender sin esperar a que venza ningún plazo.
 * Va con `tenant_id` en el WHERE: un lavadero no puede borrar el cliente de
 * otro ni por error ni a propósito.
 */
export async function anonimizarCliente(
  tenantId: string,
  customerId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE customers
     SET ${CAMPOS_ANONIMIZADOS}
     WHERE tenant_id = $1 AND id = $2 AND anonymized_at IS NULL`,
    [tenantId, customerId],
  );
  const hecho = (rowCount ?? 0) > 0;
  if (hecho) {
    // Las fotos de su vehículo también son datos suyos (la placa se ve). Se
    // conservan sólo las de un turno con reclamo abierto: ahí hay un deber de
    // conservar la prueba, que es la excepción que la Ley 1581 contempla.
    const { rows } = await db.query<{ id: string; storage_path: string }>(
      `SELECT p.id, p.storage_path FROM appointment_photos p
         JOIN appointments a ON a.id = p.appointment_id
        WHERE a.tenant_id = $1 AND a.customer_id = $2 AND a.reclamo_abierto_at IS NULL`,
      [tenantId, customerId],
    );
    await borrarFotos(rows, 'supresión del cliente');
  }
  return hecho;
}

/**
 * Borra fotos: primero los archivos, después las filas. Si Storage falla, las
 * filas quedan y la purga diaria lo vuelve a intentar; al revés quedarían
 * archivos sin nadie que sepa que existen.
 */
async function borrarFotos(fotos: Array<{ id: string; storage_path: string }>, motivo: string): Promise<number> {
  if (fotos.length === 0) return 0;
  const almacen = obtenerAlmacen();
  if (!almacen) return 0;
  try {
    await almacen.borrar(fotos.map((f) => f.storage_path));
  } catch (err) {
    logger.error({ err, motivo, fotos: fotos.length }, 'No se pudieron borrar fotos de Storage; se reintenta en la próxima purga');
    return 0;
  }
  await db.query('DELETE FROM appointment_photos WHERE id = ANY($1::uuid[])', [fotos.map((f) => f.id)]);
  return fotos.length;
}

/**
 * Borra las fotos de recepción más viejas que el plazo, salvo las de turnos con
 * reclamo abierto. De a 500 por corrida para no mandar un borrado gigante a
 * Storage; si hay más, siguen al día siguiente.
 *
 * Recorre todos los lavaderos: corre con bypass de RLS (ver cron.ts).
 */
export async function purgarFotosViejas(dias: number = DIAS_FOTOS): Promise<number> {
  if (dias <= 0) return 0;
  const { rows } = await db.query<{ id: string; storage_path: string }>(
    `SELECT p.id, p.storage_path FROM appointment_photos p
       JOIN appointments a ON a.id = p.appointment_id
      WHERE p.created_at < NOW() - make_interval(days => $1)
        AND a.reclamo_abierto_at IS NULL
      ORDER BY p.created_at
      LIMIT 500`,
    [dias],
  );
  const borradas = await borrarFotos(rows, 'retención');
  if (borradas > 0) logger.info({ borradas, dias }, 'Fotos de recepción borradas por retención');
  return borradas;
}

/**
 * Clientes cuyos datos se guardaron sin autorización registrada.
 *
 * Son los creados antes de que existiera el paso de consentimiento. Sirve para
 * saber el tamaño del pasivo: la ley pide autorización de todos, no sólo de
 * los nuevos.
 */
export async function clientesSinAutorizacion(tenantId?: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM customers
     WHERE consent_at IS NULL
       AND anonymized_at IS NULL
       AND deleted_at IS NULL
       ${tenantId ? 'AND tenant_id = $1' : ''}`,
    tenantId ? [tenantId] : [],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Configuración vigente, para reportarla al arrancar. */
/**
 * Purga la bitácora de acciones vencida.
 *
 * Tiene su propio plazo, más largo que el de las conversaciones, y por una razón
 * distinta: una bitácora que se borra rápido deja de servir justo para lo que
 * existe —reconstruir qué pasó semanas atrás, cuando alguien finalmente nota
 * algo raro—. El plazo por defecto son 24 meses.
 *
 * No contiene datos personales de clientes: guarda nombres de campos, no valores
 * (ver `migrate-auditoria.ts`). Lo que sí contiene es qué hizo cada empleado, que
 * es dato personal **del empleado**, y por eso tiene plazo en vez de quedarse
 * para siempre.
 */
export async function purgarAuditoriaVieja(meses: number = MESES_AUDITORIA): Promise<number> {
  if (meses <= 0) return 0;

  try {
    const { rowCount } = await db.query(
      `DELETE FROM action_log
       WHERE created_at < NOW() - ($1 || ' months')::interval`,
      [String(meses)],
    );
    const borrados = rowCount ?? 0;
    if (borrados > 0) {
      logger.info({ borrados, meses }, 'Bitácora de acciones purgada por retención');
    }
    return borrados;
  } catch (err) {
    logger.error({ err }, 'Error purgando la bitácora de acciones');
    return 0;
  }
}

export const politicaRetencion = {
  mesesMensajes: MESES_MENSAJES,
  mesesClientes: MESES_CLIENTES,
  mesesAuditoria: MESES_AUDITORIA,
  diasFotos: DIAS_FOTOS,
};
