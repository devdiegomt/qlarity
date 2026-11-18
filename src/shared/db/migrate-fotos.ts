/**
 * Migración: fotos de recepción y reclamos.
 * Ejecutar: npm run db:migrate-fotos   (y después db:migrate-rls)
 *
 * Al recibir un carro, el operario toma fotos de cómo llegó: si después el
 * cliente reclama por un rayón que ya estaba, el lavadero tiene con qué
 * mostrarlo. Los archivos viven en Supabase Storage (ver
 * shared/storage/fotos.ts); acá queda dónde está cada uno, de qué turno es y
 * quién la tomó.
 *
 * Se borran a los 90 días (DATA_RETENTION_PHOTOS_DAYS), **salvo** las de un turno
 * con reclamo abierto: son justamente las que hay que conservar.
 *
 * `appointment_photos` tiene `tenant_id`, así que `db:migrate-rls` le pone su
 * política sola. Por eso va antes de esa migración en `db:migrate-all`.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
CREATE TABLE IF NOT EXISTS appointment_photos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  storage_path   TEXT NOT NULL UNIQUE,
  bytes          INTEGER NOT NULL CHECK (bytes > 0),
  taken_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appointment_photos_turno ON appointment_photos (appointment_id);
CREATE INDEX IF NOT EXISTS idx_appointment_photos_creada ON appointment_photos (created_at);
COMMENT ON TABLE appointment_photos IS
  'Fotos de cómo llegó el vehículo. El archivo está en Supabase Storage (storage_path). Se borran a los 90 días salvo reclamo abierto.';

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reclamo_abierto_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reclamo_nota TEXT;
COMMENT ON COLUMN appointments.reclamo_abierto_at IS
  'Cuándo se abrió un reclamo del cliente por este turno. Mientras no sea NULL, sus fotos no se borran.';
`;

async function migrate(): Promise<void> {
  console.log('🔄 Ejecutando migración de fotos de recepción...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 appointment_photos (corre db:migrate-rls después)');
    console.log('   📋 appointments.reclamo_abierto_at, reclamo_nota');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
