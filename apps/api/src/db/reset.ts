/** Recria o banco do zero (DEV): apaga schema, aplica migrações e roda o seed. */
import { spawnSync } from 'node:child_process';
import { env } from '../config/env';
import { closeDb, db } from './client';
import { runMigrations } from './migrate';
import { sql } from 'drizzle-orm';

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('db:reset é bloqueado em produção');
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations();
  console.log('✔ Schema recriado e migrações aplicadas');
  await closeDb();
  const result = spawnSync(process.execPath, [...process.execArgv, new URL('./seed.ts', import.meta.url).pathname, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
}

main().catch(async (err) => {
  console.error('✖ Falha no reset', err);
  await closeDb();
  process.exitCode = 1;
});
