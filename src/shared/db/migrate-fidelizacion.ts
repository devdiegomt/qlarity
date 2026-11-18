/**
 * Migración: fidelización — tarjeta de sellos y clientes que no han vuelto.
 * Ejecutar: npm run db:migrate-fidelizacion
 *
 * El primer lavadero pidió que los clientes vuelvan seguido. Dos piezas:
 *
 * - **Sellos:** cada lavado pagado suma un sello; al completar la meta, el
 *   siguiente lavado es gratis («el 6.º lavado gratis»: meta 6, cinco pagados).
 *   Los sellos no se guardan: salen de los pagos, así no hay un contador que se
 *   pueda desincronizar. El premio queda en el pago (`origen = 'premio'`, con
 *   el `descuento` aplicado) y desde ahí vuelve a contar.
 * - **Clientes que no han vuelto:** los que llevan más de N días sin venir,
 *   para invitarlos por WhatsApp. `invitado_regreso_at` evita invitar al mismo
 *   cliente todas las semanas.
 *
 * Los dos números son del lavadero (Configuración); 0 desactiva cada uno.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS fidelidad_sellos_meta SMALLINT NOT NULL DEFAULT 6;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS fidelidad_dias_regreso SMALLINT NOT NULL DEFAULT 30;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS chk_tenants_sellos_meta;
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_sellos_meta
  CHECK (fidelidad_sellos_meta = 0 OR fidelidad_sellos_meta BETWEEN 2 AND 50);
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS chk_tenants_dias_regreso;
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_dias_regreso
  CHECK (fidelidad_dias_regreso BETWEEN 0 AND 365);
COMMENT ON COLUMN tenants.fidelidad_sellos_meta IS
  'Tarjeta de sellos: el lavado número N es gratis (N-1 pagados). 0 la desactiva.';
COMMENT ON COLUMN tenants.fidelidad_dias_regreso IS
  'Días sin venir tras los cuales un cliente aparece en «clientes que no han vuelto». 0 lo desactiva.';

ALTER TABLE payments ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'normal';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS descuento INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_origen;
ALTER TABLE payments ADD CONSTRAINT chk_payments_origen CHECK (origen IN ('normal', 'premio'));
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_descuento;
ALTER TABLE payments ADD CONSTRAINT chk_payments_descuento CHECK (descuento >= 0 AND amount >= 0);
COMMENT ON COLUMN payments.origen IS
  'normal: pago corriente (suma un sello). premio: lavado gratis de la tarjeta de sellos.';
COMMENT ON COLUMN payments.descuento IS 'Centavos descontados del precio del turno (el premio).';

ALTER TABLE customers ADD COLUMN IF NOT EXISTS invitado_regreso_at TIMESTAMPTZ;
COMMENT ON COLUMN customers.invitado_regreso_at IS
  'Última vez que se le invitó a volver por WhatsApp desde el panel.';
`;

async function migrate(): Promise<void> {
  console.log('🔄 Ejecutando migración de fidelización...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 tenants.fidelidad_sellos_meta (6), fidelidad_dias_regreso (30)');
    console.log('   📋 payments.origen, payments.descuento');
    console.log('   📋 customers.invitado_regreso_at');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
