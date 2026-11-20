/**
 * Migración: pago de la mensualidad de Qlarity con ePayco.
 * Ejecutar: npm run db:migrate-pagos-epayco   (y después db:migrate-rls)
 *
 * - `tenants.pagado_hasta`: el último día cubierto por lo pagado. NULL para los
 *   lavaderos que se activaron a mano (siguen activos sin vencimiento, como
 *   hasta ahora) y para los que nunca han pagado.
 * - `pagos_suscripcion`: cada intento de pago. Se crea `pendiente` al abrir el
 *   checkout, con el monto que calcula el servidor; ePayco confirma después.
 *   `referencia` es la que viaja a ePayco como número de factura y por la que
 *   se encuentra el pago al llegar la confirmación.
 *
 * Tiene `tenant_id`: `db:migrate-rls` le pone su política.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pagado_hasta DATE;
COMMENT ON COLUMN tenants.pagado_hasta IS
  'Último día cubierto por la mensualidad pagada con ePayco. NULL: activado a mano o sin pagos.';

CREATE TABLE IF NOT EXISTS pagos_suscripcion (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  referencia      VARCHAR(40) NOT NULL UNIQUE,
  plan            VARCHAR(20) NOT NULL REFERENCES plans(id),
  monto           INTEGER NOT NULL CHECK (monto > 0),
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  prueba          BOOLEAN NOT NULL,
  creado_por      UUID REFERENCES users(id) ON DELETE SET NULL,
  ref_payco       VARCHAR(40),
  transaccion     VARCHAR(80),
  codigo          SMALLINT,
  motivo          VARCHAR(200),
  metodo          VARCHAR(40),
  cubre_desde     DATE,
  cubre_hasta     DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pagos_suscripcion_estado
    CHECK (estado IN ('pendiente', 'aceptado', 'rechazado', 'reversado'))
);
CREATE INDEX IF NOT EXISTS idx_pagos_suscripcion_tenant ON pagos_suscripcion (tenant_id, created_at DESC);
COMMENT ON TABLE pagos_suscripcion IS
  'Pagos de la mensualidad de Qlarity con ePayco. monto en pesos (sin centavos), como lo cobra ePayco.';
`;

async function migrate(): Promise<void> {
  console.log('🔄 Ejecutando migración de pagos con ePayco...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 tenants.pagado_hasta');
    console.log('   📋 pagos_suscripcion (corre db:migrate-rls después)');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
