import { Router } from 'express';
import { and, asc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { products, stockLevels, stores } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { paginationSchema, toLimitOffset } from '../../lib/pagination';
import { containsInsensitive } from '../../lib/sql';
import { centsSchema, idParamsSchema, optionalText, queryBoolean, uuidSchema } from '../../lib/validation';
import { getAuth, requireAnyPermission, requirePermission } from '../../middleware/auth';
import { resolveReadScope } from '../auth/store-scope';
import { barcodeSchema, normalizeSku, skuSchema } from './product-rules';

export const productsRouter = Router();

const productSchema = z.object({
  sku: skuSchema,
  barcode: barcodeSchema,
  name: z.string().trim().min(2, 'Informe o nome do produto').max(200),
  description: optionalText(2000),
  category: optionalText(80),
  brand: optionalText(80),
  compatibleModels: optionalText(1000),
  costCents: centsSchema.default(0),
  priceCents: centsSchema.default(0),
  minStock: z.number().int().min(0).default(0),
  isActive: z.boolean().optional(),
});

/** Saldo do produto no escopo: loja específica ou soma das lojas ativas. */
function quantityExpr(storeId: string | null): SQL<number> {
  return storeId
    ? sql<number>`coalesce((select ${stockLevels.quantity} from ${stockLevels} where ${stockLevels.storeId} = ${storeId} and ${stockLevels.productId} = ${products.id}), 0)`
    : sql<number>`coalesce((select sum(${stockLevels.quantity}) from ${stockLevels} inner join ${stores} on ${stores.id} = ${stockLevels.storeId} where ${stockLevels.productId} = ${products.id} and ${stores.isActive}), 0)::int`;
}

/** Produto com saldo igual ou abaixo do mínimo (na loja, ou em qualquer loja ativa). */
function lowStockExpr(storeId: string | null): SQL {
  return storeId
    ? sql`${products.minStock} > 0 and ${quantityExpr(storeId)} <= ${products.minStock}`
    : sql`${products.minStock} > 0 and exists (
        select 1 from ${stores} s where s.is_active and coalesce(
          (select sl.quantity from ${stockLevels} sl where sl.store_id = s.id and sl.product_id = ${products.id}), 0
        ) <= ${products.minStock})`;
}

const productColumns = {
  id: products.id,
  sku: products.sku,
  barcode: products.barcode,
  name: products.name,
  description: products.description,
  category: products.category,
  brand: products.brand,
  compatibleModels: products.compatibleModels,
  costCents: products.costCents,
  priceCents: products.priceCents,
  minStock: products.minStock,
  isActive: products.isActive,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
};

async function stockBreakdown(productIds: string[], storeId: string | null) {
  if (!productIds.length) return new Map<string, Record<string, number>>();
  const rows = await db
    .select({ productId: stockLevels.productId, storeId: stockLevels.storeId, quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(and(inArray(stockLevels.productId, productIds), storeId ? eq(stockLevels.storeId, storeId) : undefined));
  const map = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const entry = map.get(r.productId) ?? {};
    entry[r.storeId] = r.quantity;
    map.set(r.productId, entry);
  }
  return map;
}

const listSchema = paginationSchema.extend({
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
  storeId: uuidSchema.optional(),
  lowStock: queryBoolean,
  inStock: queryBoolean,
  includeInactive: queryBoolean,
});

// Consulta de peças atende: catálogo, estoque, PDV, OS e transferências
const catalogReaders = [
  'products.view',
  'stock.view',
  'sales.create',
  'service_orders.create',
  'service_orders.edit',
  'stock_transfers.create',
] as const;

productsRouter.get('/', requireAnyPermission(...catalogReaders), async (req, res) => {
  const auth = getAuth(req);
  const q = listSchema.parse(req.query);
  const storeId = resolveReadScope(auth, q.storeId);
  const qty = quantityExpr(storeId);

  const where = and(
    q.includeInactive ? undefined : eq(products.isActive, true),
    q.category ? eq(products.category, q.category) : undefined,
    q.lowStock ? lowStockExpr(storeId) : undefined,
    q.inStock ? sql`${qty} > 0` : undefined,
    q.search
      ? or(
          containsInsensitive(products.name, q.search),
          containsInsensitive(products.sku, q.search),
          containsInsensitive(products.barcode, q.search),
          containsInsensitive(products.brand, q.search),
          containsInsensitive(products.compatibleModels, q.search),
        )
      : undefined,
  );

  const { limit, offset } = toLimitOffset(q);
  const [rows, [count]] = await Promise.all([
    db
      .select({ ...productColumns, quantity: qty })
      .from(products)
      .where(where)
      .orderBy(asc(products.name))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(products).where(where),
  ]);
  const breakdown = await stockBreakdown(
    rows.map((r) => r.id),
    storeId,
  );
  res.json({
    data: rows.map((r) => ({ ...r, stockByStore: breakdown.get(r.id) ?? {} })),
    total: count?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  });
});

productsRouter.get('/categories', requireAnyPermission(...catalogReaders), async (_req, res) => {
  const rows = await db
    .selectDistinct({ category: products.category })
    .from(products)
    .where(and(isNotNull(products.category), eq(products.isActive, true)))
    .orderBy(asc(products.category));
  res.json(rows.map((r) => r.category));
});

/** Busca exata por SKU ou código de barras (leitor no PDV). */
productsRouter.get('/lookup/:code', requireAnyPermission(...catalogReaders), async (req, res) => {
  const auth = getAuth(req);
  const code = z.string().trim().min(1).parse(req.params.code);
  const storeId = resolveReadScope(auth, uuidSchema.optional().parse(req.query.storeId));
  const [product] = await db
    .select({ ...productColumns, quantity: quantityExpr(storeId) })
    .from(products)
    .where(
      and(
        eq(products.isActive, true),
        or(eq(products.sku, normalizeSku(code)), eq(products.barcode, code.replace(/\s+/g, ''))),
      ),
    )
    .limit(1);
  if (!product) throw notFound('Produto não encontrado para este código');
  res.json(product);
});

productsRouter.get('/:id', requireAnyPermission(...catalogReaders), async (req, res) => {
  const auth = getAuth(req);
  const { id } = idParamsSchema.parse(req.params);
  const storeId = resolveReadScope(auth);
  const [product] = await db
    .select({ ...productColumns, quantity: quantityExpr(storeId) })
    .from(products)
    .where(eq(products.id, id));
  if (!product) throw notFound('Produto não encontrado');
  const breakdown = await stockBreakdown([id], storeId);
  res.json({ ...product, stockByStore: breakdown.get(id) ?? {} });
});

productsRouter.post('/', requirePermission('products.create'), async (req, res) => {
  const body = productSchema.parse(req.body);
  const [product] = await db.insert(products).values(body).returning();
  res.status(201).json(product);
});

productsRouter.patch('/:id', requirePermission('products.edit'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  // .partial() não herda defaults: campos ausentes não são sobrescritos
  const body = productSchema
    .extend({
      costCents: centsSchema,
      priceCents: centsSchema,
      minStock: z.number().int().min(0),
    })
    .partial()
    .parse(req.body);
  const [product] = await db.update(products).set(body).where(eq(products.id, id)).returning();
  if (!product) throw notFound('Produto não encontrado');
  res.json(product);
});

/**
 * Produtos têm histórico (kardex, vendas, OS), então "excluir" = desativar.
 * O SKU continua reservado e o produto some das buscas do PDV/OS.
 */
productsRouter.delete('/:id', requirePermission('products.delete'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const [product] = await db
    .update(products)
    .set({ isActive: false })
    .where(eq(products.id, id))
    .returning({ id: products.id });
  if (!product) throw notFound('Produto não encontrado');
  res.status(204).end();
});
