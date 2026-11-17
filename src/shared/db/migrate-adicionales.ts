/**
 * Migración: servicios adicionales («encera tú mismo» y similares).
 * Ejecutar: npm run db:migrate-adicionales   (y después db:migrate-rls)
 *
 * Un adicional no se reserva solo: se suma a un lavado. El primer caso lo
 * pidió el primer lavadero —el cliente encera su carro, acompañado por alguien
 * del lavadero, después del lavado— pero la forma es general: cualquier
 * servicio marcado como adicional se ofrece así.
 *
 * - `services.es_adicional`: el servicio no aparece como lavado principal;
 *   se ofrece como agregado a uno.
 * - `appointment_extras`: los adicionales de cada turno, con el precio y la
 *   duración **del momento** en que se agregaron (si el servicio cambia de
 *   precio después, el turno no cambia).
 * - `appointments.adicional_iniciado_at`: cuándo terminó el lavado y empezó
 *   el adicional. Mientras es NULL, el turno está en el lavado.
 *
 * El precio del turno (`appointments.price`) pasa a ser el **total**: lavado
 * más adicionales. Es lo que se cobra, y así pagos, caja y reportes cuadran sin
 * tocarlos.
 *
 * `appointment_extras` tiene `tenant_id`, así que `db:migrate-rls` la encuentra
 * sola y le pone su política. Por eso va antes de esa migración en
 * `db:migrate-all`.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
ALTER TABLE services ADD COLUMN IF NOT EXISTS es_adicional BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN services.es_adicional IS
  'Se ofrece sumado a un lavado, no se reserva solo. Ej.: «encera tú mismo».';

CREATE TABLE IF NOT EXISTS appointment_extras (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id     UUID NOT NULL REFERENCES services(id),
  price          INTEGER NOT NULL CHECK (price >= 0),
  minutes        SMALLINT NOT NULL CHECK (minutes > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (appointment_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_appointment_extras_turno ON appointment_extras (appointment_id);
COMMENT ON TABLE appointment_extras IS
  'Servicios adicionales de un turno, con precio (centavos) y minutos del momento en que se agregaron.';

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS adicional_iniciado_at TIMESTAMPTZ;
COMMENT ON COLUMN appointments.adicional_iniciado_at IS
  'Cuándo terminó el lavado y empezó el adicional (p. ej. el encerado con el cliente). NULL: sigue el lavado.';
`;

async function migrate(): Promise<void> {
  console.log('🔄 Ejecutando migración de servicios adicionales...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 services.es_adicional');
    console.log('   📋 appointment_extras (corre db:migrate-rls después)');
    console.log('   📋 appointments.adicional_iniciado_at');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
