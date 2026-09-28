import { getTableName, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

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

/**
 * Referência SEMPRE qualificada ("tabela"."coluna") a uma coluna da consulta
 * externa, para uso em subconsultas correlacionadas.
 *
 * Em selects de uma única tabela o Drizzle omite o nome da tabela; dentro de
 * uma subconsulta, um "id" solto é resolvido primeiro pela tabela interna e a
 * correlação quebra silenciosamente (ex.: users.role_id = users.id).
 */
export function outerRef(column: AnyPgColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}
