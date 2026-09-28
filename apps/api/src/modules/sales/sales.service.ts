import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { PAYMENT_METHODS, SALE_STATUSES } from '@erp/shared';
import { db } from '../../db/client';
import { customers, products, saleItems, salePayments, sales, stores, users } from '../../db/schema';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { nextNumber } from '../../lib/counters';
import { paginationSchema, toLimitOffset } from '../../lib/pagination';
import { centsSchema, optionalText, uuidSchema } from '../../lib/validation';
import type { AuthContext } from '../auth/auth-context';
import { assertActiveStore, assertStoreAccess, resolveReadScope, resolveWriteStore } from '../auth/store-scope';
import { applyStockChanges } from '../inventory/stock.service';
import { resolveLineItems, sumTotals } from '../products/line-items';

const cancelledBy = alias(users, 'cancelled_by');

export const createSaleSchema = z.object({
  storeId: uuidSchema.optional(),
  customerId: uuidSchema.nullish(),
  items: z
    .array(
      z.object({
        productId: uuidSchema,
        quantity: z.number().int().min(1).max(9999),
        unitPriceCents: centsSchema.optional(),
      }),
    )
    .min(1, 'Adicione ao menos um item')
    .max(200),
  discountCents: centsSchema.default(0),
  payments: z
    .array(z.object({ method: z.enum(PAYMENT_METHODS), amountCents: z.number().int().positive() }))
    .min(1, 'Informe a forma de pagamento')
    .max(10),
  notes: optionalText(1000),
});

export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(3, 'Informe o motivo do cancelamento').max(500),
});

export const listSalesSchema = paginationSchema.extend({
  storeId: uuidSchema.optional(),
  status: z.enum(SALE_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  number: z.coerce.number().int().positive().max(2_147_483_647).optional(),
});

/**
 * Venda de balcão (PDV): valida itens, calcula totais/troco, numera por loja
 * e baixa o estoque — tudo em uma única transação.
 */
export async function createSale(auth: AuthContext, input: z.infer<typeof createSaleSchema>) {
  const storeId = resolveWriteStore(auth, input.storeId);

  const id = await db.transaction(async (tx) => {
    await assertActiveStore(tx, storeId);
    const items = await resolveLineItems(tx, input.items);
    const subtotalCents = sumTotals(items);
    if (input.discountCents > subtotalCents) throw badRequest('Desconto maior que o subtotal');
    const totalCents = subtotalCents - input.discountCents;

    const paidCents = input.payments.reduce((acc, p) => acc + p.amountCents, 0);
    if (paidCents < totalCents) throw badRequest('Valor pago é menor que o total da venda');
    const changeCents = paidCents - totalCents;
    const cashCents = input.payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + p.amountCents, 0);
    if (changeCents > cashCents) throw badRequest('Troco só é permitido para pagamento em dinheiro');

    const number = await nextNumber(tx, `sale:${storeId}`);
    const [sale] = await tx
      .insert(sales)
      .values({
        storeId,
        number,
        customerId: input.customerId ?? null,
        userId: auth.userId,
        subtotalCents,
        discountCents: input.discountCents,
        totalCents,
        paidCents,
        changeCents,
        notes: input.notes,
      })
      .returning({ id: sales.id });

    await tx.insert(saleItems).values(items.map((i) => ({ ...i, saleId: sale!.id })));
    await tx.insert(salePayments).values(input.payments.map((p) => ({ ...p, saleId: sale!.id })));
    await applyStockChanges(
      tx,
      items.map((i) => ({ storeId, productId: i.productId, delta: -i.quantity })),
      { type: 'SALE', referenceType: 'SALE', referenceId: sale!.id, userId: auth.userId, note: `Venda #${number}` },
    );
    return sale!.id;
  });
  return getSale(auth, id);
}

export async function cancelSale(auth: AuthContext, id: string, input: z.infer<typeof cancelSaleSchema>) {
  await db.transaction(async (tx) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, id)).for('update');
    if (!sale) throw notFound('Venda não encontrada');
    assertStoreAccess(auth, sale.storeId);
    if (sale.status !== 'COMPLETED') throw conflict('Esta venda já está cancelada');

    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, id));
    await applyStockChanges(
      tx,
      items.map((i) => ({ storeId: sale.storeId, productId: i.productId, delta: i.quantity })),
      {
        type: 'SALE_CANCEL',
        referenceType: 'SALE',
        referenceId: id,
        userId: auth.userId,
        note: `Cancelamento da venda #${sale.number}: ${input.reason}`,
      },
    );
    await tx
      .update(sales)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), cancelledById: auth.userId, cancelReason: input.reason })
      .where(eq(sales.id, id));
  });
  return getSale(auth, id);
}

export async function getSale(auth: AuthContext, id: string) {
  const [row] = await db
    .select({
      sale: sales,
      storeCode: stores.code,
      storeName: stores.name,
      sellerName: users.name,
      customerName: customers.name,
      cancelledByName: cancelledBy.name,
    })
    .from(sales)
    .innerJoin(stores, eq(stores.id, sales.storeId))
    .innerJoin(users, eq(users.id, sales.userId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(cancelledBy, eq(cancelledBy.id, sales.cancelledById))
    .where(eq(sales.id, id));
  if (!row) throw notFound('Venda não encontrada');
  assertStoreAccess(auth, row.sale.storeId);

  const [items, payments] = await Promise.all([
    db
      .select({
        id: saleItems.id,
        productId: saleItems.productId,
        sku: products.sku,
        description: saleItems.description,
        quantity: saleItems.quantity,
        unitPriceCents: saleItems.unitPriceCents,
        totalCents: saleItems.totalCents,
      })
      .from(saleItems)
      .innerJoin(products, eq(products.id, saleItems.productId))
      .where(eq(saleItems.saleId, id))
      .orderBy(asc(saleItems.description)),
    db.select().from(salePayments).where(eq(salePayments.saleId, id)),
  ]);
  const { sale, ...rest } = row;
  return { ...sale, ...rest, items, payments };
}

export async function listSales(auth: AuthContext, q: z.infer<typeof listSalesSchema>) {
  const storeId = resolveReadScope(auth, q.storeId);
  const where = and(
    storeId ? eq(sales.storeId, storeId) : undefined,
    q.status ? eq(sales.status, q.status) : undefined,
    q.from ? gte(sales.createdAt, q.from) : undefined,
    q.to ? lt(sales.createdAt, q.to) : undefined,
    q.number ? eq(sales.number, q.number) : undefined,
  );
  const { limit, offset } = toLimitOffset(q);
  const [data, [count]] = await Promise.all([
    db
      .select({
        id: sales.id,
        number: sales.number,
        status: sales.status,
        totalCents: sales.totalCents,
        discountCents: sales.discountCents,
        createdAt: sales.createdAt,
        storeId: sales.storeId,
        storeCode: stores.code,
        sellerName: users.name,
        customerName: customers.name,
        itemCount: sql<number>`(select coalesce(sum(${saleItems.quantity}), 0)::int from ${saleItems} where ${saleItems.saleId} = ${sales.id})`,
      })
      .from(sales)
      .innerJoin(stores, eq(stores.id, sales.storeId))
      .innerJoin(users, eq(users.id, sales.userId))
      .leftJoin(customers, eq(customers.id, sales.customerId))
      .where(where)
      .orderBy(desc(sales.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(sales).where(where),
  ]);
  return { data, total: count?.total ?? 0, page: q.page, pageSize: q.pageSize };
}
