import { inArray } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { products } from '../../db/schema';
import { badRequest } from '../../lib/errors';

export interface LineItemInput {
  productId: string;
  quantity: number;
  unitPriceCents?: number;
}

export interface ResolvedLineItem {
  productId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  totalCents: number;
}

/**
 * Valida os produtos de uma venda/OS e congela descrição, preço e custo no item.
 * Produtos inexistentes ou inativos são rejeitados.
 */
export async function resolveLineItems(executor: Executor, items: LineItemInput[]): Promise<ResolvedLineItem[]> {
  if (!items.length) return [];
  const ids = [...new Set(items.map((i) => i.productId))];
  const rows = await executor
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      priceCents: products.priceCents,
      costCents: products.costCents,
      isActive: products.isActive,
    })
    .from(products)
    .where(inArray(products.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));

  return items.map((item, index) => {
    const product = byId.get(item.productId);
    if (!product || !product.isActive) {
      throw badRequest(`Item ${index + 1}: produto inexistente ou inativo`, { index, productId: item.productId });
    }
    const unitPriceCents = item.unitPriceCents ?? product.priceCents;
    return {
      productId: product.id,
      description: `${product.name} (${product.sku})`.slice(0, 200),
      quantity: item.quantity,
      unitPriceCents,
      unitCostCents: product.costCents,
      totalCents: unitPriceCents * item.quantity,
    };
  });
}

export function sumTotals(items: ResolvedLineItem[]): number {
  return items.reduce((acc, i) => acc + i.totalCents, 0);
}
