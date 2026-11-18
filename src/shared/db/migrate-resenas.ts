/**
 * Migración: calificaciones de los clientes y enlace de reseñas de Google.
 * Ejecutar: npm run db:migrate-resenas   (y después db:migrate-rls)
 *
 * Al entregar el carro, el lavadero le manda al cliente por WhatsApp un enlace
 * a una encuesta corta: estrellas de 1 a 5 y un comentario. El dueño lo ve en
 * el panel. Después de responder, al cliente se le ofrece dejar su reseña en
 * Google —a todos, no sólo a los contentos: Google prohíbe filtrar quién llega
 * a dejar reseña—.
 *
 * El token de la encuesta es el único identificador del enlace: aleatorio, de
 * 128 bits, uno por turno.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_review_url TEXT;
COMMENT ON COLUMN tenants.google_review_url IS
  'Enlace para dejar reseña en Google (Perfil de Empresa → Pedir reseñas). Se le ofrece al cliente después de calificar.';

CREATE TABLE IF NOT EXISTS appointment_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id  UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  rating          SMALLINT CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at     TIMESTAMPTZ,
  google_click_at TIMESTAMPTZ,
  CHECK ((rating IS NULL) = (answered_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_appointment_reviews_respondidas
  ON appointment_reviews (tenant_id, answered_at DESC) WHERE answered_at IS NOT NULL;
COMMENT ON TABLE appointment_reviews IS
  'Encuesta de satisfacción de un turno. rating NULL: enviada y sin responder.';
`;

async function migrate(): Promise<void> {
  console.log('🔄 Ejecutando migración de calificaciones...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 tenants.google_review_url');
    console.log('   📋 appointment_reviews (corre db:migrate-rls después)');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
