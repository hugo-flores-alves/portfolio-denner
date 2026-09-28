import { Router } from 'express';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { customers, serviceOrders, stores } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { paginationSchema, toLimitOffset } from '../../lib/pagination';
import { containsInsensitive, escapeLike } from '../../lib/sql';
import { digitsOnly, idParamsSchema, optionalText } from '../../lib/validation';
import { getAuth, requireAnyPermission, requirePermission } from '../../middleware/auth';
import { resolveReadScope } from '../auth/store-scope';

export const customersRouter = Router();

export const customerInputSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do cliente').max(160),
  phone: digitsOnly(20),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .nullish()
    .transform((v) => v || null)
    .pipe(z.email('E-mail inválido').nullable()),
  document: digitsOnly(14).refine((v) => v === null || v.length === 11 || v.length === 14, 'CPF/CNPJ inválido'),
  notes: optionalText(2000),
});

const listSchema = paginationSchema.extend({ search: z.string().trim().optional() });

// A busca de clientes também atende o formulário de OS e o PDV
customersRouter.get(
  '/',
  requireAnyPermission('customers.view', 'service_orders.create', 'service_orders.edit', 'sales.create'),
  async (req, res) => {
    const q = listSchema.parse(req.query);
    const digits = q.search?.replace(/\D/g, '') ?? '';
    const where = q.search
      ? or(
          containsInsensitive(customers.name, q.search),
          containsInsensitive(customers.email, q.search),
          ...(digits.length >= 3
            ? [
                sql`${customers.phone} like ${`%${escapeLike(digits)}%`}`,
                sql`${customers.document} like ${`${escapeLike(digits)}%`}`,
              ]
            : []),
        )
      : undefined;
    const { limit, offset } = toLimitOffset(q);
    const [data, [count]] = await Promise.all([
      db.select().from(customers).where(where).orderBy(customers.name).limit(limit).offset(offset),
      db.select({ total: sql<number>`count(*)::int` }).from(customers).where(where),
    ]);
    res.json({ data, total: count?.total ?? 0, page: q.page, pageSize: q.pageSize });
  },
);

customersRouter.get('/:id', requirePermission('customers.view'), async (req, res) => {
  const auth = getAuth(req);
  const { id } = idParamsSchema.parse(req.params);
  const [customer] = await db.select().from(customers).where(eq(customers.id, id));
  if (!customer) throw notFound('Cliente não encontrado');
  // Histórico de OS respeita o escopo de loja do usuário
  const storeId = resolveReadScope(auth);
  const orders = await db
    .select({
      id: serviceOrders.id,
      number: serviceOrders.number,
      status: serviceOrders.status,
      deviceModel: serviceOrders.deviceModel,
      totalCents: serviceOrders.totalCents,
      createdAt: serviceOrders.createdAt,
      storeCode: stores.code,
    })
    .from(serviceOrders)
    .innerJoin(stores, eq(stores.id, serviceOrders.storeId))
    .where(and(eq(serviceOrders.customerId, id), storeId ? eq(serviceOrders.storeId, storeId) : undefined))
    .orderBy(desc(serviceOrders.createdAt))
    .limit(50);
  res.json({ ...customer, serviceOrders: orders });
});

customersRouter.post('/', requirePermission('customers.create'), async (req, res) => {
  const body = customerInputSchema.parse(req.body);
  const [customer] = await db.insert(customers).values(body).returning();
  res.status(201).json(customer);
});

customersRouter.patch('/:id', requirePermission('customers.edit'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const body = customerInputSchema.partial().parse(req.body);
  const [customer] = await db.update(customers).set(body).where(eq(customers.id, id)).returning();
  if (!customer) throw notFound('Cliente não encontrado');
  res.json(customer);
});

// Clientes com OS/vendas vinculadas não podem ser excluídos (FK → 409)
customersRouter.delete('/:id', requirePermission('customers.delete'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const [deleted] = await db.delete(customers).where(eq(customers.id, id)).returning({ id: customers.id });
  if (!deleted) throw notFound('Cliente não encontrado');
  res.status(204).end();
});
