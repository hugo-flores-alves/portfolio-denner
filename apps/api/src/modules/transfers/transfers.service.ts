/**
 * Transferência de mercadoria entre lojas em duas etapas:
 *
 *   envio (origem)  ──▶ IN_TRANSIT ──▶ recebimento (destino) ──▶ RECEIVED
 *                            └──▶ cancelamento (origem) ──▶ CANCELLED (estoque volta)
 *
 * Enquanto em trânsito, a mercadoria não está disponível em nenhuma das lojas,
 * refletindo a realidade física (motoboy/malote) e evitando venda "fantasma".
 */
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { TRANSFER_STATUSES } from '@erp/shared';
import { db, type Tx } from '../../db/client';
import { products, stockTransferItems, stockTransfers, stores, users } from '../../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { nextNumber } from '../../lib/counters';
import { paginationSchema, toLimitOffset } from '../../lib/pagination';
import { outerRef } from '../../lib/sql';
import { optionalText, uuidSchema } from '../../lib/validation';
import { hasGlobalAccess, type AuthContext } from '../auth/auth-context';
import { assertActiveStore, canAccessStore, resolveReadScope, resolveWriteStore } from '../auth/store-scope';
import { applyStockChanges } from '../inventory/stock.service';

const fromStore = alias(stores, 'from_store');
const toStore = alias(stores, 'to_store');
const createdBy = alias(users, 'created_by');
const receivedBy = alias(users, 'received_by');

export const createTransferSchema = z.object({
  fromStoreId: uuidSchema.optional(),
  toStoreId: uuidSchema,
  notes: optionalText(1000),
  items: z
    .array(z.object({ productId: uuidSchema, quantity: z.number().int().min(1).max(100_000) }))
    .min(1, 'Adicione ao menos um item')
    .max(500),
});

export const cancelTransferSchema = z.object({ reason: optionalText(500) });

export const listTransfersSchema = paginationSchema.extend({
  storeId: uuidSchema.optional(),
  status: z.enum(TRANSFER_STATUSES).optional(),
  direction: z.enum(['in', 'out']).optional(),
});

export async function createTransfer(auth: AuthContext, input: z.infer<typeof createTransferSchema>) {
  const fromStoreId = resolveWriteStore(auth, input.fromStoreId);
  if (fromStoreId === input.toStoreId) throw badRequest('Loja de origem e destino devem ser diferentes');

  // Agrupa produtos repetidos
  const quantities = new Map<string, number>();
  for (const item of input.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);

  const id = await db.transaction(async (tx) => {
    await assertActiveStore(tx, fromStoreId);
    await assertActiveStore(tx, input.toStoreId);
    const found = await tx
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.id, [...quantities.keys()]));
    if (found.length !== quantities.size) throw badRequest('Um ou mais produtos não existem');

    const number = await nextNumber(tx, 'stock_transfer');
    const [transfer] = await tx
      .insert(stockTransfers)
      .values({ number, fromStoreId, toStoreId: input.toStoreId, notes: input.notes, createdById: auth.userId })
      .returning({ id: stockTransfers.id });
    await tx
      .insert(stockTransferItems)
      .values([...quantities].map(([productId, quantity]) => ({ transferId: transfer!.id, productId, quantity })));
    await applyStockChanges(
      tx,
      [...quantities].map(([productId, quantity]) => ({ storeId: fromStoreId, productId, delta: -quantity })),
      {
        type: 'TRANSFER_OUT',
        referenceType: 'TRANSFER',
        referenceId: transfer!.id,
        userId: auth.userId,
        note: `Transferência #${number} (envio)`,
      },
    );
    return transfer!.id;
  });
  return getTransfer(auth, id);
}

async function lockTransfer(tx: Tx, id: string) {
  const [transfer] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id)).for('update');
  if (!transfer) throw notFound('Transferência não encontrada');
  return transfer;
}

export async function receiveTransfer(auth: AuthContext, id: string) {
  await db.transaction(async (tx) => {
    const transfer = await lockTransfer(tx, id);
    if (!canAccessStore(auth, transfer.fromStoreId) && !canAccessStore(auth, transfer.toStoreId)) throw notFound();
    if (!canAccessStore(auth, transfer.toStoreId)) throw forbidden('Somente a loja de destino pode receber');
    if (transfer.status !== 'IN_TRANSIT') throw conflict('Transferência não está em trânsito');

    const items = await tx.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, id));
    await applyStockChanges(
      tx,
      items.map((i) => ({ storeId: transfer.toStoreId, productId: i.productId, delta: i.quantity })),
      {
        type: 'TRANSFER_IN',
        referenceType: 'TRANSFER',
        referenceId: id,
        userId: auth.userId,
        note: `Transferência #${transfer.number} (recebimento)`,
      },
    );
    await tx
      .update(stockTransfers)
      .set({ status: 'RECEIVED', receivedAt: new Date(), receivedById: auth.userId })
      .where(eq(stockTransfers.id, id));
  });
  return getTransfer(auth, id);
}

export async function cancelTransfer(auth: AuthContext, id: string, input: z.infer<typeof cancelTransferSchema>) {
  await db.transaction(async (tx) => {
    const transfer = await lockTransfer(tx, id);
    if (!canAccessStore(auth, transfer.fromStoreId) && !canAccessStore(auth, transfer.toStoreId)) throw notFound();
    if (!canAccessStore(auth, transfer.fromStoreId)) throw forbidden('Somente a loja de origem pode cancelar');
    if (transfer.status !== 'IN_TRANSIT') throw conflict('Somente transferências em trânsito podem ser canceladas');

    const items = await tx.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, id));
    await applyStockChanges(
      tx,
      items.map((i) => ({ storeId: transfer.fromStoreId, productId: i.productId, delta: i.quantity })),
      {
        type: 'TRANSFER_RETURN',
        referenceType: 'TRANSFER',
        referenceId: id,
        userId: auth.userId,
        note: `Transferência #${transfer.number} cancelada${input.reason ? `: ${input.reason}` : ''}`,
      },
    );
    await tx
      .update(stockTransfers)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: auth.userId,
        notes: input.reason ? `${transfer.notes ? `${transfer.notes}\n` : ''}Cancelamento: ${input.reason}` : transfer.notes,
      })
      .where(eq(stockTransfers.id, id));
  });
  return getTransfer(auth, id);
}

const transferColumns = {
  id: stockTransfers.id,
  number: stockTransfers.number,
  status: stockTransfers.status,
  notes: stockTransfers.notes,
  createdAt: stockTransfers.createdAt,
  receivedAt: stockTransfers.receivedAt,
  cancelledAt: stockTransfers.cancelledAt,
  fromStoreId: stockTransfers.fromStoreId,
  fromStoreCode: fromStore.code,
  fromStoreName: fromStore.name,
  toStoreId: stockTransfers.toStoreId,
  toStoreCode: toStore.code,
  toStoreName: toStore.name,
  createdByName: createdBy.name,
  receivedByName: receivedBy.name,
  itemCount: sql<number>`(select coalesce(sum(ti.quantity), 0)::int from ${stockTransferItems} ti where ti.transfer_id = ${outerRef(stockTransfers.id)})`,
};

function transferQuery() {
  return db
    .select(transferColumns)
    .from(stockTransfers)
    .innerJoin(fromStore, eq(fromStore.id, stockTransfers.fromStoreId))
    .innerJoin(toStore, eq(toStore.id, stockTransfers.toStoreId))
    .innerJoin(createdBy, eq(createdBy.id, stockTransfers.createdById))
    .leftJoin(receivedBy, eq(receivedBy.id, stockTransfers.receivedById));
}

export async function getTransfer(auth: AuthContext, id: string) {
  const [transfer] = await transferQuery().where(eq(stockTransfers.id, id));
  if (!transfer) throw notFound('Transferência não encontrada');
  if (!canAccessStore(auth, transfer.fromStoreId) && !canAccessStore(auth, transfer.toStoreId)) {
    throw notFound('Transferência não encontrada');
  }
  const items = await db
    .select({
      id: stockTransferItems.id,
      productId: stockTransferItems.productId,
      sku: products.sku,
      name: products.name,
      quantity: stockTransferItems.quantity,
    })
    .from(stockTransferItems)
    .innerJoin(products, eq(products.id, stockTransferItems.productId))
    .where(eq(stockTransferItems.transferId, id))
    .orderBy(asc(products.name));
  return { ...transfer, items };
}

export async function listTransfers(auth: AuthContext, q: z.infer<typeof listTransfersSchema>) {
  // Usuário de loja vê transferências em que sua loja é origem OU destino
  const storeId = hasGlobalAccess(auth) ? (q.storeId ?? null) : resolveReadScope(auth, q.storeId);
  const storeFilter = storeId
    ? q.direction === 'in'
      ? eq(stockTransfers.toStoreId, storeId)
      : q.direction === 'out'
        ? eq(stockTransfers.fromStoreId, storeId)
        : or(eq(stockTransfers.fromStoreId, storeId), eq(stockTransfers.toStoreId, storeId))
    : undefined;
  const where = and(storeFilter, q.status ? eq(stockTransfers.status, q.status) : undefined);
  const { limit, offset } = toLimitOffset(q);
  const [data, [count]] = await Promise.all([
    transferQuery().where(where).orderBy(desc(stockTransfers.createdAt)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(stockTransfers).where(where),
  ]);
  return { data, total: count?.total ?? 0, page: q.page, pageSize: q.pageSize };
}
