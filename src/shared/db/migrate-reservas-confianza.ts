/**
 * Migración: confianza en las reservas — los que no van, los datos falsos y
 * opciones del lavadero.
 * Ejecutar: npm run db:migrate-reservas-confianza
 *
 * - Estado `no_show` («No vino») en appointments: libera la bahía y cuenta
 *   como falta del cliente. Con 2 faltas en 90 días, ese número no puede
 *   reservar por la página web. (status es VARCHAR sin CHECK: no hay que tocar
 *   la columna.)
 * - `customers.bloqueado_web`: el lavadero bloquea a mano un número.
 * - `tenants.reservas_por_confirmar` + `appointments.por_confirmar`: modo en el
 *   que las reservas web entran «por confirmar» hasta que el lavadero las
 *   confirma (por WhatsApp). Siguen ocupando su cupo.
 * - `appointments.recordado_at`: cuándo se le recordó el turno al cliente.
 * - `tenants.fidelidad_tiquetera_suma_sellos`: si lo pagado con tiquetera suma
 *   sellos (por defecto no: ya tiene descuento).
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bloqueado_web BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN customers.bloqueado_web IS 'El lavadero no deja que este cliente reserve por la página web.';

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reservas_por_confirmar BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS fidelidad_tiquetera_suma_sellos BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN tenants.reservas_por_confirmar IS
  'Las reservas web entran «por confirmar» hasta que el lavadero las confirma.';
COMMENT ON COLUMN tenants.fidelidad_tiquetera_suma_sellos IS
  'Si los lavados pagados con tiquetera suman sellos.';

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS por_confirmar BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recordado_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_appointments_no_show ON appointments (customer_id, scheduled_date) WHERE status = 'no_show';
`;

async function migrate(): Promise<void> {
  console.log('🔄 Ejecutando migración de confianza en reservas...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 customers.bloqueado_web');
    console.log('   📋 tenants.reservas_por_confirmar, fidelidad_tiquetera_suma_sellos');
    console.log('   📋 appointments.por_confirmar, recordado_at; estado no_show');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
