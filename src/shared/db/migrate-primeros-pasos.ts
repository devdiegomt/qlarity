/**
 * Migración: «Primeros pasos», la guía de un lavadero nuevo.
 * Ejecutar: npm run db:migrate-primeros-pasos
 *
 * Quien entraba por primera vez no sabía qué hacer ni a dónde ir. Inicio muestra
 * ahora una lista de pasos que se marcan solos. Algunos se detectan mirando los
 * datos (un turno creado, un operario); otros no, porque el registro ya deja
 * valores por defecto (horario, servicios): ésos se marcan cuando el dueño los
 * guarda por primera vez, y quedan anotados acá.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primeros_pasos JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN tenants.primeros_pasos IS
  'Pasos de la guía inicial que el dueño ya hizo (horario, servicios, equipo, reservas) y si la cerró ({"cerrado": true}).';
`;

async function migrate(): Promise<void> {
  console.log('🔄 Ejecutando migración de primeros pasos...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 tenants.primeros_pasos');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
