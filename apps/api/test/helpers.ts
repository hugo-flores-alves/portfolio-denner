import { sql } from 'drizzle-orm';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../src/app';
import { db } from '../src/db/client';
import { DEFAULT_PASSWORD, seedBase } from '../src/db/seed';

export const app = createApp();
export const api = () => request(app);

const TABLES = [
  'import_jobs',
  'sale_payments',
  'sale_items',
  'sales',
  'service_order_history',
  'service_order_items',
  'service_orders',
  'stock_transfer_items',
  'stock_transfers',
  'stock_movements',
  'stock_levels',
  'counters',
  'products',
  'customers',
  'users',
  'role_permissions',
  'roles',
  'stores',
];

export interface Fixture {
  stores: Record<'LJ01' | 'LJ02' | 'LJ03', string>;
  tokens: Record<string, string>;
  users: Record<string, string>;
}

/** Limpa o banco e recria lojas, cargos e usuários padrão. */
export async function resetDatabase(): Promise<Fixture> {
  await db.execute(sql.raw(`truncate table ${TABLES.join(', ')} restart identity cascade`));
  const { storeByCode, userRows } = await seedBase();
  const tokens: Record<string, string> = {};
  const users: Record<string, string> = {};
  for (const u of userRows) {
    const key = u.email.split('@')[0]!;
    users[key] = u.id;
    const res = await api().post('/api/auth/login').send({ email: u.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    tokens[key] = res.body.token;
  }
  return {
    stores: Object.fromEntries(storeByCode) as Fixture['stores'],
    tokens,
    users,
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Cria produto via API e, opcionalmente, dá entrada de estoque por loja. */
export async function createProduct(
  token: string,
  data: { sku: string; name?: string; priceCents?: number; costCents?: number; barcode?: string; minStock?: number },
  stock: Record<string, number> = {},
) {
  const res = await api()
    .post('/api/products')
    .set(bearer(token))
    .send({ name: `Produto ${data.sku}`, priceCents: 1000, costCents: 400, ...data });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  for (const [storeId, quantity] of Object.entries(stock)) {
    const adj = await api()
      .post('/api/stock/adjustments')
      .set(bearer(token))
      .send({ storeId, reason: 'Estoque inicial', items: [{ productId: res.body.id, mode: 'SET', quantity }] });
    expect(adj.status, JSON.stringify(adj.body)).toBe(201);
  }
  return res.body as { id: string; sku: string; priceCents: number };
}

export async function stockOf(productId: string, storeId: string): Promise<number> {
  const result = await db.execute(
    sql`select quantity from stock_levels where product_id = ${productId} and store_id = ${storeId}`,
  );
  return (result.rows[0] as { quantity: number } | undefined)?.quantity ?? 0;
}

export async function customer(token: string, name = 'Cliente Teste') {
  const res = await api().post('/api/customers').set(bearer(token)).send({ name, phone: '(11) 98888-7777' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string };
}
