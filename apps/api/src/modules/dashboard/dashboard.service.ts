/**
 * Métricas do dashboard. Com `storeId = null` (usuário global, "Todas as lojas")
 * os números são a soma da rede e a resposta inclui a quebra por loja.
 *
 * Receita de OS é reconhecida na conclusão (completed_at), quando as peças são
 * baixadas; vendas de balcão na data da venda. Datas agrupadas no fuso da empresa.
 */
import { sql, type SQL } from 'drizzle-orm';
import { OPEN_SERVICE_ORDER_STATUSES, type PaymentMethod, type ServiceOrderStatus } from '@erp/shared';
import { env } from '../../config/env';
import { db } from '../../db/client';

export interface DashboardRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD (inclusivo)
}

export function defaultRange(now = new Date()): DashboardRange {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE }).format(now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

async function rows<T>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

export async function getDashboardSummary(storeId: string | null, range: DashboardRange) {
  const tz = env.APP_TIMEZONE;
  const start = sql`(${range.from}::date)::timestamp at time zone ${tz}`;
  const end = sql`((${range.to}::date) + 1)::timestamp at time zone ${tz}`;
  const saleStore = storeId ? sql`and s.store_id = ${storeId}` : sql``;
  const osStore = storeId ? sql`and o.store_id = ${storeId}` : sql``;
  const levelStore = storeId ? sql`and st.id = ${storeId}` : sql``;
  const day = (col: SQL) => sql`to_char(date_trunc('day', ${col} at time zone ${tz}), 'YYYY-MM-DD')`;

  const completedSales = sql`s.status = 'COMPLETED' and s.created_at >= ${start} and s.created_at < ${end} ${saleStore}`;
  const completedOrders = sql`o.stock_deducted and o.completed_at >= ${start} and o.completed_at < ${end} ${osStore}`;

  const [
    salesByStore,
    salesCost,
    ordersByStore,
    ordersCost,
    openOrders,
    inventory,
    lowStock,
    inTransit,
    salesDaily,
    ordersDaily,
    topProducts,
    payments,
    change,
  ] = await Promise.all([
    rows<{ store_id: string; count: number; revenue: number }>(sql`
      select s.store_id, count(*)::int as count, coalesce(sum(s.total_cents), 0)::float8 as revenue
      from sales s where ${completedSales} group by s.store_id`),
    rows<{ cost: number }>(sql`
      select coalesce(sum(si.quantity * si.unit_cost_cents), 0)::float8 as cost
      from sale_items si join sales s on s.id = si.sale_id where ${completedSales}`),
    rows<{ store_id: string; count: number; revenue: number }>(sql`
      select o.store_id, count(*)::int as count, coalesce(sum(o.total_cents), 0)::float8 as revenue
      from service_orders o where ${completedOrders} group by o.store_id`),
    rows<{ cost: number }>(sql`
      select coalesce(sum(i.quantity * i.unit_cost_cents), 0)::float8 as cost
      from service_order_items i join service_orders o on o.id = i.service_order_id where ${completedOrders}`),
    rows<{ store_id: string; status: ServiceOrderStatus; count: number }>(sql`
      select o.store_id, o.status, count(*)::int as count from service_orders o
      where o.status in (${sql.join(
        OPEN_SERVICE_ORDER_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )}) ${osStore}
      group by o.store_id, o.status`),
    rows<{ store_id: string; value: number; units: number; skus: number }>(sql`
      select st.id as store_id,
             coalesce(sum(sl.quantity * p.cost_cents), 0)::float8 as value,
             coalesce(sum(sl.quantity), 0)::float8 as units,
             count(*) filter (where sl.quantity > 0)::int as skus
      from stock_levels sl
      join products p on p.id = sl.product_id and p.is_active
      join stores st on st.id = sl.store_id and st.is_active
      where true ${levelStore}
      group by st.id`),
    rows<{ store_id: string; count: number }>(sql`
      select st.id as store_id, count(*)::int as count
      from stores st
      cross join products p
      left join stock_levels sl on sl.store_id = st.id and sl.product_id = p.id
      where st.is_active and p.is_active and p.min_stock > 0
        and coalesce(sl.quantity, 0) <= p.min_stock ${levelStore}
      group by st.id`),
    rows<{ count: number }>(sql`
      select count(*)::int as count from stock_transfers t where t.status = 'IN_TRANSIT'
      ${storeId ? sql`and (t.from_store_id = ${storeId} or t.to_store_id = ${storeId})` : sql``}`),
    rows<{ day: string; revenue: number }>(sql`
      select ${day(sql`s.created_at`)} as day, sum(s.total_cents)::float8 as revenue
      from sales s where ${completedSales} group by 1`),
    rows<{ day: string; revenue: number }>(sql`
      select ${day(sql`o.completed_at`)} as day, sum(o.total_cents)::float8 as revenue
      from service_orders o where ${completedOrders} group by 1`),
    rows<{ product_id: string; sku: string; name: string; quantity: number; revenue: number }>(sql`
      select p.id as product_id, p.sku, p.name, sum(x.quantity)::int as quantity, sum(x.total)::float8 as revenue
      from (
        select si.product_id, si.quantity, si.total_cents as total
        from sale_items si join sales s on s.id = si.sale_id where ${completedSales}
        union all
        select i.product_id, i.quantity, i.total_cents as total
        from service_order_items i join service_orders o on o.id = i.service_order_id where ${completedOrders}
      ) x join products p on p.id = x.product_id
      group by p.id, p.sku, p.name
      order by quantity desc, revenue desc
      limit 8`),
    rows<{ method: PaymentMethod; amount: number }>(sql`
      select sp.method, sum(sp.amount_cents)::float8 as amount
      from sale_payments sp join sales s on s.id = sp.sale_id where ${completedSales}
      group by sp.method`),
    rows<{ change: number }>(sql`
      select coalesce(sum(s.change_cents), 0)::float8 as change from sales s where ${completedSales}`),
  ]);

  const sum = <T>(list: T[], pick: (t: T) => number) => list.reduce((acc, x) => acc + pick(x), 0);

  const salesRevenue = sum(salesByStore, (r) => r.revenue);
  const salesCount = sum(salesByStore, (r) => r.count);
  const ordersRevenue = sum(ordersByStore, (r) => r.revenue);
  const ordersCount = sum(ordersByStore, (r) => r.count);
  const revenue = salesRevenue + ordersRevenue;
  const cost = (salesCost[0]?.cost ?? 0) + (ordersCost[0]?.cost ?? 0);

  const openByStatus = Object.fromEntries(OPEN_SERVICE_ORDER_STATUSES.map((s) => [s, 0])) as Record<
    ServiceOrderStatus,
    number
  >;
  for (const r of openOrders) openByStatus[r.status] += r.count;

  // Série diária contínua (dias sem movimento = 0)
  const daily = new Map<string, { date: string; salesCents: number; serviceOrdersCents: number }>();
  for (
    let d = new Date(`${range.from}T12:00:00Z`);
    d <= new Date(`${range.to}T12:00:00Z`) && daily.size < 400;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const key = d.toISOString().slice(0, 10);
    daily.set(key, { date: key, salesCents: 0, serviceOrdersCents: 0 });
  }
  for (const r of salesDaily) {
    const entry = daily.get(r.day);
    if (entry) entry.salesCents = r.revenue;
  }
  for (const r of ordersDaily) {
    const entry = daily.get(r.day);
    if (entry) entry.serviceOrdersCents = r.revenue;
  }

  // Quebra por loja (apenas na visão consolidada)
  let byStore: Array<Record<string, unknown>> | null = null;
  if (!storeId) {
    const storeRows = await rows<{ id: string; code: string; name: string }>(
      sql`select id, code, name from stores where is_active order by code`,
    );
    const pick = <T extends { store_id: string }>(list: T[], id: string) => list.filter((r) => r.store_id === id);
    byStore = storeRows.map((s) => {
      const salesCents = sum(pick(salesByStore, s.id), (r) => r.revenue);
      const serviceOrdersCents = sum(pick(ordersByStore, s.id), (r) => r.revenue);
      return {
        storeId: s.id,
        code: s.code,
        name: s.name,
        revenueCents: salesCents + serviceOrdersCents,
        salesCents,
        salesCount: sum(pick(salesByStore, s.id), (r) => r.count),
        serviceOrdersCents,
        serviceOrdersCompleted: sum(pick(ordersByStore, s.id), (r) => r.count),
        openServiceOrders: sum(pick(openOrders, s.id), (r) => r.count),
        stockValueCents: sum(pick(inventory, s.id), (r) => r.value),
        lowStockCount: sum(pick(lowStock, s.id), (r) => r.count),
      };
    });
  }

  return {
    range,
    storeId,
    totals: {
      revenueCents: revenue,
      grossProfitCents: revenue - cost,
      salesCents: salesRevenue,
      salesCount,
      averageTicketCents: salesCount ? Math.round(salesRevenue / salesCount) : 0,
      serviceOrdersCents: ordersRevenue,
      serviceOrdersCompleted: ordersCount,
    },
    serviceOrders: { open: openByStatus, openTotal: sum(openOrders, (r) => r.count) },
    inventory: {
      stockValueCents: sum(inventory, (r) => r.value),
      units: sum(inventory, (r) => r.units),
      lowStockCount: sum(lowStock, (r) => r.count),
      transfersInTransit: inTransit[0]?.count ?? 0,
    },
    daily: [...daily.values()],
    topProducts: topProducts.map((p) => ({
      productId: p.product_id,
      sku: p.sku,
      name: p.name,
      quantity: p.quantity,
      revenueCents: p.revenue,
    })),
    // Valor líquido por forma de pagamento: o troco sai do dinheiro recebido
    paymentMethods: payments
      .map((p) => ({ method: p.method, amountCents: p.method === 'CASH' ? p.amount - (change[0]?.change ?? 0) : p.amount }))
      .sort((a, b) => b.amountCents - a.amountCents),
    byStore,
  };
}
