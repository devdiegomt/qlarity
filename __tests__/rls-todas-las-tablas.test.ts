/**
 * Ninguna tabla de `public` queda sin RLS.
 *
 * Supabase publica toda tabla de `public` por su API de datos, y avisa por
 * correo cuando una no tiene RLS: esa tabla la lee cualquiera con la clave
 * pública del proyecto. Pasó con `plans` y `refresh_tokens` (2026-11). Esta
 * prueba falla si una migración nueva crea una tabla y se olvida de
 * protegerla, antes de que el aviso llegue desde producción.
 */
import * as db from '../src/shared/db';

afterAll(async () => {
  await db.pool.end();
});

it('todas las tablas de public tienen RLS', async () => {
  const { rows } = await db.queryAdmin<{ tabla: string }>(
    `SELECT c.relname AS tabla
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
      ORDER BY 1`,
  );
  expect(rows.map((r) => r.tabla)).toEqual([]);
});

it('las globales sólo dejan entrar al rol de la aplicación', async () => {
  const { rows } = await db.queryAdmin<{ tablename: string; roles: string[] }>(
    `SELECT tablename, roles::text[] AS roles FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('plans', 'refresh_tokens')
      ORDER BY tablename`,
  );
  expect(rows).toEqual([
    { tablename: 'plans', roles: ['carwash_app'] },
    { tablename: 'refresh_tokens', roles: ['carwash_app'] },
  ]);
});
