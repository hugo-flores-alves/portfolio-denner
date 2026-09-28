import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, db } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));
// Em dev (tsx) roda de src/db; no bundle (dist) roda de dist/
const migrationsFolder = path.resolve(here, here.endsWith('db') ? '../../drizzle' : '../drizzle');

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => console.log('✔ Migrações aplicadas'))
    .catch((err) => {
      console.error('✖ Falha ao aplicar migrações', err);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
