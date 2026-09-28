import { applyTestEnv } from './test-env';

/** Recria o schema do banco de testes uma única vez por execução. */
export default async function setup() {
  applyTestEnv();
  const { db, closeDb } = await import('../src/db/client');
  const { runMigrations } = await import('../src/db/migrate');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations();
  await closeDb();
}
