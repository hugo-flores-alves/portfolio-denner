import { Router } from 'express';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { STOCK_MOVEMENT_TYPES } from '@erp/shared';
import { db } from '../../db/client';
import { products, stockMovements, stores, users } from '../../db/schema';
import { badRequest } from '../../lib/errors';
import { paginationSchema, toLimitOffset } from '../../lib/pagination';
import { uuidSchema } from '../../lib/validation';
import { getAuth, requirePermission } from '../../middleware/auth';
import { assertActiveStore, resolveReadScope, resolveWriteStore } from '../auth/store-scope';
import { applyStockChanges, lockStockRows } from './stock.service';

export const inventoryRouter = Router();

const movementsQuery = paginationSchema.extend({
  storeId: uuidSchema.optional(),
  productId: uuidSchema.optional(),
  type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

inventoryRouter.get('/movements', requirePermission('stock.view'), async (req, res) => {
  const auth = getAuth(req);
  const q = movementsQuery.parse(req.query);
  const storeId = resolveReadScope(auth, q.storeId);
  const where = and(
    storeId ? eq(stockMovements.storeId, storeId) : undefined,
    q.productId ? eq(stockMovements.productId, q.productId) : undefined,
    q.type ? eq(stockMovements.type, q.type) : undefined,
    q.from ? gte(stockMovements.createdAt, q.from) : undefined,
    q.to ? lte(stockMovements.createdAt, q.to) : undefined,
  );
  const { limit, offset } = toLimitOffset(q);
  const [data, [count]] = await Promise.all([
    db
      .select({
        id: stockMovements.id,
        createdAt: stockMovements.createdAt,
        type: stockMovements.type,
        quantity: stockMovements.quantity,
        balanceAfter: stockMovements.balanceAfter,
        referenceType: stockMovements.referenceType,
        referenceId: stockMovements.referenceId,
        note: stockMovements.note,
        storeId: stockMovements.storeId,
        storeCode: stores.code,
        productId: stockMovements.productId,
        productSku: products.sku,
        productName: products.name,
        userName: users.name,
      })
      .from(stockMovements)
      .innerJoin(stores, eq(stores.id, stockMovements.storeId))
      .innerJoin(products, eq(products.id, stockMovements.productId))
      .leftJoin(users, eq(users.id, stockMovements.userId))
      .where(where)
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(stockMovements).where(where),
  ]);
  res.json({ data, total: count?.total ?? 0, page: q.page, pageSize: q.pageSize });
});

const adjustmentSchema = z.object({
  storeId: uuidSchema.optional(),
  reason: z.string().trim().min(3, 'Informe o motivo do ajuste').max(500),
  items: z
    .array(
      z.discriminatedUnion('mode', [
        // SET: define o saldo final (inventário/contagem)
        z.object({ productId: uuidSchema, mode: z.literal('SET'), quantity: z.number().int().min(0) }),
        // ADD: soma/subtrai (entrada de mercadoria, perda, avaria)
        z.object({
          productId: uuidSchema,
          mode: z.literal('ADD'),
          quantity: z
            .number()
            .int()
            .refine((n) => n !== 0, 'Quantidade não pode ser zero'),
        }),
      ]),
    )
    .min(1, 'Informe ao menos um item')
    .max(500),
});

inventoryRouter.post('/adjustments', requirePermission('stock.adjust'), async (req, res) => {
  const auth = getAuth(req);
  const body = adjustmentSchema.parse(req.body);
  const storeId = resolveWriteStore(auth, body.storeId);
  const productIds = body.items.map((i) => i.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw badRequest('O mesmo produto aparece mais de uma vez no ajuste');
  }

  const applied = await db.transaction(async (tx) => {
    await assertActiveStore(tx, storeId);
    const current = await lockStockRows(tx, storeId, productIds);
    const changes = body.items.map((item) => ({
      storeId,
      productId: item.productId,
      delta: item.mode === 'SET' ? item.quantity - (current.get(item.productId) ?? 0) : item.quantity,
    }));
    return applyStockChanges(tx, changes, {
      type: 'ADJUSTMENT',
      referenceType: 'ADJUSTMENT',
      userId: auth.userId,
      note: body.reason,
    });
  });
  res.status(201).json({ storeId, applied });
});
