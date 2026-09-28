/**
 * Serviço central de estoque. TODA alteração de saldo passa por aqui.
 *
 * Garantias:
 *  1. Atomicidade — roda dentro da transação do chamador (venda, OS, transferência).
 *  2. Sem saldo negativo — linhas são travadas (SELECT ... FOR UPDATE) em ordem
 *     determinística (loja, produto) para evitar deadlocks; faltas são reportadas
 *     todas de uma vez; o CHECK do banco é a última barreira.
 *  3. Rastreabilidade — cada variação gera uma linha no kardex (stock_movements).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { StockMovementType } from '@erp/shared';
import type { Tx } from '../../db/client';
import { products, stockLevels, stockMovements } from '../../db/schema';
import { conflict } from '../../lib/errors';

export interface StockChange {
  storeId: string;
  productId: string;
  /** Variação com sinal: positivo = entrada, negativo = saída. */
  delta: number;
}

export interface MovementContext {
  type: StockMovementType;
  referenceType?: string;
  referenceId?: string;
  userId?: string | null;
  note?: string | null;
}

export interface AppliedChange extends StockChange {
  balanceAfter: number;
}

export interface StockShortage {
  storeId: string;
  productId: string;
  sku: string;
  name: string;
  available: number;
  requested: number;
}

const keyOf = (storeId: string, productId: string) => `${storeId}|${productId}`;

/** Soma variações repetidas do mesmo produto/loja e ordena para travamento determinístico. */
function aggregate(changes: StockChange[]): StockChange[] {
  const map = new Map<string, StockChange>();
  for (const c of changes) {
    if (!Number.isInteger(c.delta)) throw new Error('Variação de estoque deve ser inteira');
    const key = keyOf(c.storeId, c.productId);
    const acc = map.get(key);
    if (acc) acc.delta += c.delta;
    else map.set(key, { ...c });
  }
  return [...map.values()]
    .filter((c) => c.delta !== 0)
    .sort((a, b) => a.storeId.localeCompare(b.storeId) || a.productId.localeCompare(b.productId));
}

/** Trava e retorna os saldos atuais de uma loja para os produtos informados. */
export async function lockStockRows(tx: Tx, storeId: string, productIds: string[]): Promise<Map<string, number>> {
  if (!productIds.length) return new Map();
  const rows = await tx
    .select({ productId: stockLevels.productId, quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(and(eq(stockLevels.storeId, storeId), inArray(stockLevels.productId, productIds)))
    .orderBy(asc(stockLevels.productId))
    .for('update');
  return new Map(rows.map((r) => [r.productId, r.quantity]));
}

export async function applyStockChanges(
  tx: Tx,
  changes: StockChange[],
  ctx: MovementContext,
): Promise<AppliedChange[]> {
  const list = aggregate(changes);
  if (!list.length) return [];

  // 1. Trava as linhas existentes, loja por loja, em ordem
  const current = new Map<string, number>();
  const storeIds = [...new Set(list.map((c) => c.storeId))].sort();
  for (const storeId of storeIds) {
    const locked = await lockStockRows(
      tx,
      storeId,
      list.filter((c) => c.storeId === storeId).map((c) => c.productId),
    );
    for (const [productId, qty] of locked) current.set(keyOf(storeId, productId), qty);
  }

  // 2. Verifica faltas (todas de uma vez, para uma mensagem útil)
  const short = list.filter((c) => c.delta < 0 && (current.get(keyOf(c.storeId, c.productId)) ?? 0) + c.delta < 0);
  if (short.length) {
    const info = await tx
      .select({ id: products.id, sku: products.sku, name: products.name })
      .from(products)
      .where(inArray(products.id, [...new Set(short.map((s) => s.productId))]));
    const byId = new Map(info.map((p) => [p.id, p]));
    const details: StockShortage[] = short.map((s) => ({
      storeId: s.storeId,
      productId: s.productId,
      sku: byId.get(s.productId)?.sku ?? '?',
      name: byId.get(s.productId)?.name ?? '?',
      available: current.get(keyOf(s.storeId, s.productId)) ?? 0,
      requested: -s.delta,
    }));
    const summary = details
      .map((d) => `${d.name} (SKU ${d.sku}): disponível ${d.available}, necessário ${d.requested}`)
      .join('; ');
    throw conflict(`Estoque insuficiente — ${summary}`, details, 'INSUFFICIENT_STOCK');
  }

  // 3. Aplica. Entradas via upsert (a linha pode não existir);
  //    saídas via UPDATE em linhas já travadas (o CHECK do Postgres é avaliado
  //    na linha proposta do INSERT, então upsert com valor negativo falharia).
  const balances = new Map<string, number>();
  const incoming = list.filter((c) => c.delta > 0);
  const outgoing = list.filter((c) => c.delta < 0);

  if (incoming.length) {
    const rows = await tx
      .insert(stockLevels)
      .values(incoming.map((c) => ({ storeId: c.storeId, productId: c.productId, quantity: c.delta })))
      .onConflictDoUpdate({
        target: [stockLevels.storeId, stockLevels.productId],
        set: { quantity: sql`${stockLevels.quantity} + excluded.quantity`, updatedAt: sql`now()` },
      })
      .returning({ storeId: stockLevels.storeId, productId: stockLevels.productId, quantity: stockLevels.quantity });
    for (const r of rows) balances.set(keyOf(r.storeId, r.productId), r.quantity);
  }

  for (const c of outgoing) {
    const [row] = await tx
      .update(stockLevels)
      .set({ quantity: sql`${stockLevels.quantity} + ${c.delta}` })
      .where(and(eq(stockLevels.storeId, c.storeId), eq(stockLevels.productId, c.productId)))
      .returning({ quantity: stockLevels.quantity });
    balances.set(keyOf(c.storeId, c.productId), row!.quantity);
  }

  // 4. Kardex
  const applied = list.map((c) => ({ ...c, balanceAfter: balances.get(keyOf(c.storeId, c.productId))! }));
  await tx.insert(stockMovements).values(
    applied.map((c) => ({
      storeId: c.storeId,
      productId: c.productId,
      type: ctx.type,
      quantity: c.delta,
      balanceAfter: c.balanceAfter,
      referenceType: ctx.referenceType ?? null,
      referenceId: ctx.referenceId ?? null,
      userId: ctx.userId ?? null,
      note: ctx.note ?? null,
    })),
  );
  return applied;
}
