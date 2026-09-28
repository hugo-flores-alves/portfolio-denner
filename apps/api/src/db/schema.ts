/**
 * Modelo de dados do ERP.
 *
 * Princípios:
 *  - Multi-loja: toda tabela operacional (OS, vendas, estoque, movimentações,
 *    usuários) carrega `store_id`. Catálogo de produtos e clientes são da rede
 *    (compartilhados), pois o mesmo SKU é transferido entre lojas e o mesmo
 *    cliente pode ser atendido em qualquer filial.
 *  - Dinheiro em centavos (integer) para evitar erros de ponto flutuante.
 *  - Estoque = saldo materializado (`stock_levels`) + livro-razão imutável
 *    (`stock_movements`). O CHECK `quantity >= 0` é a última linha de defesa
 *    contra saldo negativo, mesmo sob concorrência.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  IMPORT_MODES,
  IMPORT_STOCK_MODES,
  PAYMENT_METHODS,
  ROLE_SCOPES,
  SALE_STATUSES,
  SERVICE_ORDER_STATUSES,
  STOCK_MOVEMENT_TYPES,
  TRANSFER_STATUSES,
} from '@erp/shared';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ─── Enums ────────────────────────────────────────────────────────────────────
export const roleScopeEnum = pgEnum('role_scope', ROLE_SCOPES);
export const serviceOrderStatusEnum = pgEnum('service_order_status', SERVICE_ORDER_STATUSES);
export const stockMovementTypeEnum = pgEnum('stock_movement_type', STOCK_MOVEMENT_TYPES);
export const transferStatusEnum = pgEnum('transfer_status', TRANSFER_STATUSES);
export const saleStatusEnum = pgEnum('sale_status', SALE_STATUSES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const importModeEnum = pgEnum('import_mode', IMPORT_MODES);
export const importStockModeEnum = pgEnum('import_stock_mode', IMPORT_STOCK_MODES);
export const importStatusEnum = pgEnum('import_status', ['COMPLETED', 'FAILED']);

// ─── Lojas ────────────────────────────────────────────────────────────────────
export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Código curto usado em numeração de documentos e colunas da planilha (ex.: LJ01). */
  code: varchar('code', { length: 12 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  document: varchar('document', { length: 20 }),
  phone: varchar('phone', { length: 20 }),
  address: text('address'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

// ─── Controle de acesso (RBAC) ────────────────────────────────────────────────
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 60 }).notNull().unique(),
  description: text('description'),
  scope: roleScopeEnum('scope').notNull().default('STORE'),
  /** Cargo de sistema (Administrador): acesso total, imutável e não excluível. */
  isSystem: boolean('is_system').notNull().default(false),
  ...timestamps,
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: varchar('permission', { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 160 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    /** Loja do colaborador. Obrigatória para cargos de escopo STORE. */
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('users_store_idx').on(t.storeId), index('users_role_idx').on(t.roleId)],
);

// ─── Clientes (compartilhados na rede) ────────────────────────────────────────
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 160 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 160 }),
    /** CPF/CNPJ somente dígitos. */
    document: varchar('document', { length: 14 }),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('customers_phone_idx').on(t.phone),
    uniqueIndex('customers_document_uq')
      .on(t.document)
      .where(sql`${t.document} is not null`),
  ],
);

// ─── Catálogo de produtos (rede) e estoque (por loja) ─────────────────────────
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sku: varchar('sku', { length: 64 }).notNull().unique(),
    barcode: varchar('barcode', { length: 64 }),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 80 }),
    brand: varchar('brand', { length: 80 }),
    /** Modelos compatíveis (texto livre, ex.: "iPhone 11, iPhone 11 Pro"). */
    compatibleModels: text('compatible_models'),
    costCents: integer('cost_cents').notNull().default(0),
    priceCents: integer('price_cents').notNull().default(0),
    /** Estoque mínimo por loja para alerta de reposição. */
    minStock: integer('min_stock').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('products_barcode_uq')
      .on(t.barcode)
      .where(sql`${t.barcode} is not null`),
    index('products_category_idx').on(t.category),
    check('products_prices_non_negative', sql`${t.costCents} >= 0 and ${t.priceCents} >= 0`),
    check('products_min_stock_non_negative', sql`${t.minStock} >= 0`),
  ],
);

export const stockLevels = pgTable(
  'stock_levels',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.productId] }),
    index('stock_levels_product_idx').on(t.productId),
    check('stock_levels_quantity_non_negative', sql`${t.quantity} >= 0`),
  ],
);

/** Livro-razão (kardex): toda alteração de saldo gera uma linha imutável. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    type: stockMovementTypeEnum('type').notNull(),
    /** Variação com sinal (positivo = entrada, negativo = saída). */
    quantity: integer('quantity').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    referenceType: varchar('reference_type', { length: 30 }),
    referenceId: uuid('reference_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stock_movements_store_product_idx').on(t.storeId, t.productId, t.createdAt),
    index('stock_movements_reference_idx').on(t.referenceType, t.referenceId),
  ],
);

/** Numeração sequencial atômica de documentos (OS e vendas por loja, transferências global). */
export const counters = pgTable('counters', {
  scope: varchar('scope', { length: 80 }).primaryKey(),
  value: integer('value').notNull().default(0),
});

// ─── Transferências entre lojas ───────────────────────────────────────────────
export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: integer('number').notNull().unique(),
    fromStoreId: uuid('from_store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    toStoreId: uuid('to_store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    status: transferStatusEnum('status').notNull().default('IN_TRANSIT'),
    notes: text('notes'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    receivedById: uuid('received_by_id').references(() => users.id, { onDelete: 'restrict' }),
    cancelledById: uuid('cancelled_by_id').references(() => users.id, { onDelete: 'restrict' }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('stock_transfers_from_idx').on(t.fromStoreId, t.createdAt),
    index('stock_transfers_to_idx').on(t.toStoreId, t.createdAt),
    check('stock_transfers_distinct_stores', sql`${t.fromStoreId} <> ${t.toStoreId}`),
  ],
);

export const stockTransferItems = pgTable(
  'stock_transfer_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => stockTransfers.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    index('stock_transfer_items_transfer_idx').on(t.transferId),
    check('stock_transfer_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

// ─── Orçamentos / Ordens de Serviço ───────────────────────────────────────────
export const serviceOrders = pgTable(
  'service_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    technicianId: uuid('technician_id').references(() => users.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: serviceOrderStatusEnum('status').notNull().default('AWAITING_APPROVAL'),
    deviceBrand: varchar('device_brand', { length: 60 }),
    deviceModel: varchar('device_model', { length: 120 }).notNull(),
    deviceSerial: varchar('device_serial', { length: 40 }),
    deviceCondition: text('device_condition'),
    accessories: text('accessories'),
    reportedDefect: text('reported_defect').notNull(),
    diagnosis: text('diagnosis'),
    notes: text('notes'),
    laborCents: integer('labor_cents').notNull().default(0),
    partsCents: integer('parts_cents').notNull().default(0),
    discountCents: integer('discount_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    warrantyDays: integer('warranty_days').notNull().default(90),
    estimatedAt: timestamp('estimated_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    /** Espelha o invariante: true ⇔ peças baixadas do estoque. */
    stockDeducted: boolean('stock_deducted').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique('service_orders_store_number_uq').on(t.storeId, t.number),
    index('service_orders_store_status_idx').on(t.storeId, t.status),
    index('service_orders_store_created_idx').on(t.storeId, t.createdAt),
    index('service_orders_customer_idx').on(t.customerId),
    check(
      'service_orders_amounts_non_negative',
      sql`${t.laborCents} >= 0 and ${t.partsCents} >= 0 and ${t.discountCents} >= 0 and ${t.totalCents} >= 0`,
    ),
  ],
);

export const serviceOrderItems = pgTable(
  'service_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceOrderId: uuid('service_order_id')
      .notNull()
      .references(() => serviceOrders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    description: varchar('description', { length: 200 }).notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    /** Custo congelado no momento do lançamento (margem histórica não muda com reajustes). */
    unitCostCents: integer('unit_cost_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
  },
  (t) => [
    index('service_order_items_order_idx').on(t.serviceOrderId),
    check('service_order_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

export const serviceOrderHistory = pgTable(
  'service_order_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceOrderId: uuid('service_order_id')
      .notNull()
      .references(() => serviceOrders.id, { onDelete: 'cascade' }),
    fromStatus: serviceOrderStatusEnum('from_status'),
    toStatus: serviceOrderStatusEnum('to_status').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('service_order_history_order_idx').on(t.serviceOrderId, t.createdAt)],
);

// ─── Vendas de balcão (PDV) ───────────────────────────────────────────────────
export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: saleStatusEnum('status').notNull().default('COMPLETED'),
    subtotalCents: integer('subtotal_cents').notNull(),
    discountCents: integer('discount_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    paidCents: integer('paid_cents').notNull(),
    changeCents: integer('change_cents').notNull().default(0),
    notes: text('notes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledById: uuid('cancelled_by_id').references(() => users.id, { onDelete: 'restrict' }),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sales_store_number_uq').on(t.storeId, t.number),
    index('sales_store_created_idx').on(t.storeId, t.createdAt),
  ],
);

export const saleItems = pgTable(
  'sale_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    description: varchar('description', { length: 200 }).notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    unitCostCents: integer('unit_cost_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
  },
  (t) => [
    index('sale_items_sale_idx').on(t.saleId),
    index('sale_items_product_idx').on(t.productId),
    check('sale_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

export const salePayments = pgTable(
  'sale_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    method: paymentMethodEnum('method').notNull(),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [
    index('sale_payments_sale_idx').on(t.saleId),
    check('sale_payments_amount_positive', sql`${t.amountCents} > 0`),
  ],
);

// ─── Importação em massa ──────────────────────────────────────────────────────
export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileType: varchar('file_type', { length: 10 }).notNull(),
    mode: importModeEnum('mode').notNull(),
    stockMode: importStockModeEnum('stock_mode').notNull(),
    dryRun: boolean('dry_run').notNull().default(false),
    status: importStatusEnum('status').notNull(),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    stockEntries: integer('stock_entries').notNull().default(0),
    /** Erros por linha (limitado) — [{ row, field?, message }] */
    errors: jsonb('errors').$type<ImportIssue[]>().notNull().default([]),
    warnings: jsonb('warnings').$type<ImportIssue[]>().notNull().default([]),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('import_jobs_created_idx').on(t.createdAt)],
);

export interface ImportIssue {
  row: number;
  field?: string;
  value?: string;
  message: string;
}
