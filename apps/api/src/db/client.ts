import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Qualquer executor de queries: conexão do pool ou transação em andamento. */
export type Executor = Database | Tx;

export async function closeDb(): Promise<void> {
  await pool.end();
}
