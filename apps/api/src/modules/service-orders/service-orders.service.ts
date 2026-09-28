import { and, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  canTransition,
  EDITABLE_SERVICE_ORDER_STATUSES,
  isStockDeductedStatus,
  SERVICE_ORDER_STATUS_LABELS,
  type ServiceOrderStatus,
} from '@erp/shared';
import { db, type Tx } from '../../db/client';
import {
  customers,
  products,
  roles,
  serviceOrderHistory,
  serviceOrderItems,
  serviceOrders,
  stores,
  users,
} from '../../db/schema';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { nextNumber } from '../../lib/counters';
import { toLimitOffset } from '../../lib/pagination';
import { containsInsensitive } from '../../lib/sql';
import type { AuthContext } from '../auth/auth-context';
import { assertActiveStore, assertStoreAccess, resolveReadScope, resolveWriteStore } from '../auth/store-scope';
import { applyStockChanges } from '../inventory/stock.service';
import { resolveLineItems, sumTotals, type ResolvedLineItem } from '../products/line-items';
import type {
  ChangeStatusInput,
  CreateServiceOrderInput,
  ListServiceOrdersInput,
  UpdateServiceOrderInput,
} from './service-orders.schemas';

const technicians = alias(users, 'technician');

function computeTotals(items: ResolvedLineItem[], laborCents: number, discountCents: number) {
  const partsCents = sumTotals(items);
  const gross = partsCents + laborCents;
  if (discountCents > gross) throw badRequest('Desconto maior que o valor do orçamento');
  return { partsCents, totalCents: gross - discountCents };
}

async function assertTechnician(tx: Tx, technicianId: string | null | undefined, storeId: string) {
  if (!technicianId) return;
  const [tech] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(
      and(
        eq(users.id, technicianId),
        eq(users.isActive, true),
        or(eq(users.storeId, storeId), eq(roles.scope, 'GLOBAL'), eq(roles.isSystem, true)),
      ),
    )
    .limit(1);
  if (!tech) throw badRequest('Técnico inválido para esta loja');
}

/** Trava a OS para alteração e verifica o acesso à loja. */
async function lockOrder(tx: Tx, auth: AuthContext, id: string) {
  const [order] = await tx.select().from(serviceOrders).where(eq(serviceOrders.id, id)).for('update');
  if (!order) throw notFound('Ordem de serviço não encontrada');
  assertStoreAccess(auth, order.storeId);
  return order;
}

async function loadItems(tx: Tx, serviceOrderId: string) {
  return tx.select().from(serviceOrderItems).where(eq(serviceOrderItems.serviceOrderId, serviceOrderId));
}

export async function createServiceOrder(auth: AuthContext, input: CreateServiceOrderInput) {
  const storeId = resolveWriteStore(auth, input.storeId);

  const id = await db.transaction(async (tx) => {
    await assertActiveStore(tx, storeId);
    await assertTechnician(tx, input.technicianId, storeId);

    // Cliente: existente, ou cadastro rápido (reaproveita pelo CPF/CNPJ se já existir)
    let customerId = input.customerId;
    if (customerId) {
      const [exists] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId));
      if (!exists) throw badRequest('Cliente não encontrado');
    } else if (input.customer) {
      const byDocument = input.customer.document
        ? await tx.select({ id: customers.id }).from(customers).where(eq(customers.document, input.customer.document))
        : [];
      customerId =
        byDocument[0]?.id ??
        (await tx.insert(customers).values(input.customer).returning({ id: customers.id }))[0]!.id;
    }

    const items = await resolveLineItems(tx, input.items);
    const totals = computeTotals(items, input.laborCents, input.discountCents);
    const number = await nextNumber(tx, `service_order:${storeId}`);

    const [order] = await tx
      .insert(serviceOrders)
      .values({
        storeId,
        number,
        customerId: customerId!,
        technicianId: input.technicianId ?? null,
        createdById: auth.userId,
        deviceBrand: input.deviceBrand,
        deviceModel: input.deviceModel,
        deviceSerial: input.deviceSerial,
        deviceCondition: input.deviceCondition,
        accessories: input.accessories,
        reportedDefect: input.reportedDefect,
        diagnosis: input.diagnosis,
        notes: input.notes,
        laborCents: input.laborCents,
        discountCents: input.discountCents,
        warrantyDays: input.warrantyDays,
        estimatedAt: input.estimatedAt ?? null,
        ...totals,
      })
      .returning({ id: serviceOrders.id });

    if (items.length) {
      await tx.insert(serviceOrderItems).values(items.map((i) => ({ ...i, serviceOrderId: order!.id })));
    }
    await tx.insert(serviceOrderHistory).values({
      serviceOrderId: order!.id,
      fromStatus: null,
      toStatus: 'AWAITING_APPROVAL',
      userId: auth.userId,
      note: 'Orçamento criado',
    });
    return order!.id;
  });

  return getServiceOrder(auth, id);
}

export async function updateServiceOrder(auth: AuthContext, id: string, input: UpdateServiceOrderInput) {
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, auth, id);
    const editable = EDITABLE_SERVICE_ORDER_STATUSES.includes(order.status);
    const closed = order.status === 'DELIVERED' || order.status === 'CANCELLED';
    if (closed) throw unprocessable(`OS ${SERVICE_ORDER_STATUS_LABELS[order.status].toLowerCase()} não pode ser alterada`);

    // Após a conclusão, só anotações/diagnóstico/técnico podem mudar (valores e peças ficam travados)
    const lockedFields = [
      'customerId',
      'deviceBrand',
      'deviceModel',
      'deviceSerial',
      'deviceCondition',
      'accessories',
      'reportedDefect',
      'laborCents',
      'discountCents',
      'warrantyDays',
      'items',
    ] as const;
    if (!editable) {
      const touched = lockedFields.filter((f) => input[f] !== undefined);
      if (touched.length) {
        throw unprocessable(
          `Com status "${SERVICE_ORDER_STATUS_LABELS[order.status]}" não é possível alterar: ${touched.join(', ')}`,
        );
      }
    }

    if (input.technicianId !== undefined) await assertTechnician(tx, input.technicianId, order.storeId);
    if (input.customerId) {
      const [exists] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, input.customerId));
      if (!exists) throw badRequest('Cliente não encontrado');
    }

    let items: ResolvedLineItem[] | undefined;
    if (input.items) {
      items = await resolveLineItems(tx, input.items);
      await tx.delete(serviceOrderItems).where(eq(serviceOrderItems.serviceOrderId, id));
      if (items.length) {
        await tx.insert(serviceOrderItems).values(items.map((i) => ({ ...i, serviceOrderId: id })));
      }
    }
    const currentItems = items ?? (await loadItems(tx, id));
    const laborCents = input.laborCents ?? order.laborCents;
    const discountCents = input.discountCents ?? order.discountCents;
    const totals = computeTotals(currentItems, laborCents, discountCents);

    const { items: _items, ...fields } = input;
    await tx
      .update(serviceOrders)
      .set({ ...fields, laborCents, discountCents, ...totals })
      .where(eq(serviceOrders.id, id));
  });
  return getServiceOrder(auth, id);
}

/**
 * Transição de status com efeito no estoque.
 *
 * Invariante: peças baixadas ⇔ status ∈ {COMPLETED, DELIVERED}.
 * - Entrar no conjunto (finalizar) baixa as peças na loja da OS — falha com 409
 *   listando as peças sem saldo, sem alterar nada.
 * - Sair do conjunto (reabrir) estorna as peças.
 * A flag `stock_deducted` torna a operação idempotente.
 */
export async function changeServiceOrderStatus(auth: AuthContext, id: string, input: ChangeStatusInput) {
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, auth, id);
    const to = input.status as ServiceOrderStatus;
    if (order.status === to) throw badRequest('A OS já está neste status');
    if (!canTransition(order.status, to)) {
      throw unprocessable(
        `Transição não permitida: ${SERVICE_ORDER_STATUS_LABELS[order.status]} → ${SERVICE_ORDER_STATUS_LABELS[to]}`,
      );
    }

    const shouldBeDeducted = isStockDeductedStatus(to);
    const now = new Date();
    const patch: Partial<typeof serviceOrders.$inferInsert> = { status: to };

    if (shouldBeDeducted !== order.stockDeducted) {
      const items = await loadItems(tx, id);
      const sign = shouldBeDeducted ? -1 : 1;
      await applyStockChanges(
        tx,
        items.map((i) => ({ storeId: order.storeId, productId: i.productId, delta: sign * i.quantity })),
        {
          type: shouldBeDeducted ? 'SERVICE_ORDER' : 'SERVICE_ORDER_REVERSAL',
          referenceType: 'SERVICE_ORDER',
          referenceId: id,
          userId: auth.userId,
          note: `OS #${order.number}${input.note ? ` — ${input.note}` : ''}`,
        },
      );
      patch.stockDeducted = shouldBeDeducted;
    }

    if (to === 'IN_PROGRESS' && order.status === 'AWAITING_APPROVAL') patch.approvedAt = now;
    if (to === 'COMPLETED') patch.completedAt = now;
    if (to === 'IN_PROGRESS' && order.status === 'COMPLETED') patch.completedAt = null;
    if (to === 'DELIVERED') patch.deliveredAt = now;

    await tx.update(serviceOrders).set(patch).where(eq(serviceOrders.id, id));
    await tx.insert(serviceOrderHistory).values({
      serviceOrderId: id,
      fromStatus: order.status,
      toStatus: to,
      userId: auth.userId,
      note: input.note,
    });
  });
  return getServiceOrder(auth, id);
}

export async function deleteServiceOrder(auth: AuthContext, id: string) {
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, auth, id);
    if (order.stockDeducted || !['AWAITING_APPROVAL', 'REJECTED', 'CANCELLED'].includes(order.status)) {
      throw conflict('Somente orçamentos não aprovados, reprovados ou cancelados podem ser excluídos');
    }
    await tx.delete(serviceOrders).where(eq(serviceOrders.id, id));
  });
}

export async function getServiceOrder(auth: AuthContext, id: string) {
  const [order] = await db
    .select({
      order: serviceOrders,
      customer: customers,
      store: { id: stores.id, code: stores.code, name: stores.name, phone: stores.phone, address: stores.address },
      technicianName: technicians.name,
    })
    .from(serviceOrders)
    .innerJoin(customers, eq(customers.id, serviceOrders.customerId))
    .innerJoin(stores, eq(stores.id, serviceOrders.storeId))
    .leftJoin(technicians, eq(technicians.id, serviceOrders.technicianId))
    .where(eq(serviceOrders.id, id));
  if (!order) throw notFound('Ordem de serviço não encontrada');
  assertStoreAccess(auth, order.order.storeId);

  const [items, history] = await Promise.all([
    db
      .select({
        id: serviceOrderItems.id,
        productId: serviceOrderItems.productId,
        sku: products.sku,
        description: serviceOrderItems.description,
        quantity: serviceOrderItems.quantity,
        unitPriceCents: serviceOrderItems.unitPriceCents,
        totalCents: serviceOrderItems.totalCents,
      })
      .from(serviceOrderItems)
      .innerJoin(products, eq(products.id, serviceOrderItems.productId))
      .where(eq(serviceOrderItems.serviceOrderId, id))
      .orderBy(asc(serviceOrderItems.description)),
    db
      .select({
        id: serviceOrderHistory.id,
        fromStatus: serviceOrderHistory.fromStatus,
        toStatus: serviceOrderHistory.toStatus,
        note: serviceOrderHistory.note,
        createdAt: serviceOrderHistory.createdAt,
        userName: users.name,
      })
      .from(serviceOrderHistory)
      .leftJoin(users, eq(users.id, serviceOrderHistory.userId))
      .where(eq(serviceOrderHistory.serviceOrderId, id))
      .orderBy(asc(serviceOrderHistory.createdAt)),
  ]);

  return {
    ...order.order,
    customer: order.customer,
    store: order.store,
    technicianName: order.technicianName,
    items,
    history,
  };
}

export async function listServiceOrders(auth: AuthContext, q: ListServiceOrdersInput) {
  const storeId = resolveReadScope(auth, q.storeId);
  const numeric = q.search && /^\d+$/.test(q.search) ? Number(q.search) : null;
  const filters: (SQL | undefined)[] = [
    storeId ? eq(serviceOrders.storeId, storeId) : undefined,
    q.status.length ? inArray(serviceOrders.status, q.status) : undefined,
    q.technicianId ? eq(serviceOrders.technicianId, q.technicianId) : undefined,
    q.customerId ? eq(serviceOrders.customerId, q.customerId) : undefined,
    q.from ? gte(serviceOrders.createdAt, q.from) : undefined,
    q.to ? lt(serviceOrders.createdAt, q.to) : undefined,
    q.search
      ? or(
          numeric !== null && numeric <= 2_147_483_647 ? eq(serviceOrders.number, numeric) : undefined,
          containsInsensitive(customers.name, q.search),
          containsInsensitive(customers.phone, q.search.replace(/\D/g, '') || q.search),
          containsInsensitive(serviceOrders.deviceModel, q.search),
          containsInsensitive(serviceOrders.deviceSerial, q.search),
        )
      : undefined,
  ];
  const where = and(...filters);
  const { limit, offset } = toLimitOffset(q);

  const [data, [count]] = await Promise.all([
    db
      .select({
        id: serviceOrders.id,
        number: serviceOrders.number,
        status: serviceOrders.status,
        deviceBrand: serviceOrders.deviceBrand,
        deviceModel: serviceOrders.deviceModel,
        reportedDefect: serviceOrders.reportedDefect,
        totalCents: serviceOrders.totalCents,
        createdAt: serviceOrders.createdAt,
        estimatedAt: serviceOrders.estimatedAt,
        storeId: serviceOrders.storeId,
        storeCode: stores.code,
        customerId: customers.id,
        customerName: customers.name,
        customerPhone: customers.phone,
        technicianName: technicians.name,
      })
      .from(serviceOrders)
      .innerJoin(customers, eq(customers.id, serviceOrders.customerId))
      .innerJoin(stores, eq(stores.id, serviceOrders.storeId))
      .leftJoin(technicians, eq(technicians.id, serviceOrders.technicianId))
      .where(where)
      .orderBy(desc(serviceOrders.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(serviceOrders)
      .innerJoin(customers, eq(customers.id, serviceOrders.customerId))
      .where(where),
  ]);
  return { data, total: count?.total ?? 0, page: q.page, pageSize: q.pageSize };
}
