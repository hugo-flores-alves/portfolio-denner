import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/** Escapa curingas do LIKE para buscas com texto digitado pelo usuário. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function containsInsensitive(column: AnyColumn | SQL, term: string): SQL {
  return sql`${column} ilike ${`%${escapeLike(term)}%`}`;
}

/** Soma inteira segura (bigint → number) para agregações de centavos. */
export function sumInt(expr: AnyColumn | SQL): SQL<number> {
  return sql<number>`coalesce(sum(${expr}), 0)::bigint`.mapWith(Number);
}

export function countInt(expr?: AnyColumn | SQL): SQL<number> {
  return (expr ? sql<number>`count(${expr})::int` : sql<number>`count(*)::int`).mapWith(Number);
}
