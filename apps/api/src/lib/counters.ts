import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { counters } from '../db/schema';

/**
 * Próximo número sequencial de um escopo (ex.: `service_order:<storeId>`).
 * O upsert trava a linha do contador até o fim da transação, garantindo
 * numeração sem lacunas nem duplicidade sob concorrência.
 */
export async function nextNumber(tx: Executor, scope: string): Promise<number> {
  const [row] = await tx
    .insert(counters)
    .values({ scope, value: 1 })
    .onConflictDoUpdate({ target: counters.scope, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return row!.value;
}
