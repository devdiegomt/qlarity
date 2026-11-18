/**
 * Migración: tiquetera (paquetes prepagados de lavados).
 * Ejecutar: npm run db:migrate-tiquetera   (y después db:migrate-rls)
 *
 * El cliente compra, por ejemplo, «5 lavados completos por $180.000»: el
 * lavadero cobra por adelantado y el cliente vuelve hasta gastarlos.
 *
 * - `paquetes_lavado`: lo que el lavadero ofrece (Configuración → Servicios).
 * - `tiqueteras`: las vendidas. Copian nombre, servicio, cantidad y precio del
 *   paquete al venderse: si el paquete cambia después, lo vendido no.
 * - `payments.tiquetera_id` + `origen = 'tiquetera'`: un lavado pagado con la
 *   tiquetera. Su monto es lo que se cobró aparte (los adicionales), muchas
 *   veces 0: **la plata entró al vender la tiquetera**, y los reportes la suman
 *   ese día (`tiqueteras.precio`, `created_at`).
 *
 * Las dos tablas tienen `tenant_id`: `db:migrate-rls` les pone su política.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
CREATE TABLE IF NOT EXISTS paquetes_lavado (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre        VARCHAR(100) NOT NULL,
  service_id    UUID NOT NULL REFERENCES services(id),
  cantidad      SMALLINT NOT NULL CHECK (cantidad BETWEEN 2 AND 50),
  precio        INTEGER NOT NULL CHECK (precio > 0),
  vigencia_dias SMALLINT CHECK (vigencia_dias IS NULL OR vigencia_dias BETWEEN 7 AND 730),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE paquetes_lavado IS 'Tiqueteras que ofrece el lavadero: N lavados de un servicio por un precio.';

CREATE TABLE IF NOT EXISTS tiqueteras (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  paquete_id  UUID REFERENCES paquetes_lavado(id) ON DELETE SET NULL,
  service_id  UUID NOT NULL REFERENCES services(id),
  nombre      VARCHAR(100) NOT NULL,
  cantidad    SMALLINT NOT NULL CHECK (cantidad > 0),
  usados      SMALLINT NOT NULL DEFAULT 0,
  precio      INTEGER NOT NULL CHECK (precio >= 0),
  metodo_pago VARCHAR(20) NOT NULL,
  vence_el    DATE,
  vendida_por UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (usados BETWEEN 0 AND cantidad)
);
CREATE INDEX IF NOT EXISTS idx_tiqueteras_cliente ON tiqueteras (customer_id);
CREATE INDEX IF NOT EXISTS idx_tiqueteras_venta ON tiqueteras (tenant_id, created_at);
COMMENT ON TABLE tiqueteras IS
  'Tiqueteras vendidas. precio entra a los ingresos el día de la venta; cada uso es un pago con origen tiquetera.';

ALTER TABLE payments ADD COLUMN IF NOT EXISTS tiquetera_id UUID REFERENCES tiqueteras(id);
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_origen;
ALTER TABLE payments ADD CONSTRAINT chk_payments_origen CHECK (origen IN ('normal', 'premio', 'tiquetera'));
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_tiquetera;
ALTER TABLE payments ADD CONSTRAINT chk_payments_tiquetera CHECK ((origen = 'tiquetera') = (tiquetera_id IS NOT NULL));
`;

async function migrate(): Promise<void> {
  console.log('🔄 Ejecutando migración de tiquetera...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 paquetes_lavado, tiqueteras (corre db:migrate-rls después)');
    console.log('   📋 payments.tiquetera_id; origen admite tiquetera');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
