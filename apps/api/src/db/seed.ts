/**
 * Popula o banco com a estrutura inicial (lojas, cargos, usuários) e,
 * opcionalmente, dados de demonstração gerados pelos próprios serviços
 * de domínio (importação, OS, PDV, transferências) — então estoque e
 * kardex ficam consistentes.
 *
 *   npm run db:seed              # estrutura + demonstração
 *   npm run db:seed -- --no-demo # só estrutura
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, gt, ilike, inArray, sql } from 'drizzle-orm';
import type { Permission, ServiceOrderStatus } from '@erp/shared';
import { hashPassword } from '../lib/password';
import { loadAuthContext, type AuthContext } from '../modules/auth/auth-context';
import { importProducts } from '../modules/imports/product-import.service';
import { createSale } from '../modules/sales/sales.service';
import { createServiceOrderSchema } from '../modules/service-orders/service-orders.schemas';
import { changeServiceOrderStatus, createServiceOrder } from '../modules/service-orders/service-orders.service';
import { createTransfer, receiveTransfer } from '../modules/transfers/transfers.service';
import { closeDb, db } from './client';
import {
  customers,
  products,
  rolePermissions,
  roles,
  sales,
  serviceOrders,
  stockLevels,
  stores,
  users,
} from './schema';

export const DEFAULT_PASSWORD = 'Senha@123';

export const ROLE_DEFINITIONS: Array<{
  name: string;
  description: string;
  scope: 'GLOBAL' | 'STORE';
  isSystem?: boolean;
  permissions: Permission[];
}> = [
  {
    name: 'Administrador',
    description: 'Dono da rede: acesso total a todas as lojas (cargo de sistema)',
    scope: 'GLOBAL',
    isSystem: true,
    permissions: [],
  },
  {
    name: 'Supervisor de Rede',
    description: 'Acompanha todas as lojas; consulta e movimenta estoque entre filiais',
    scope: 'GLOBAL',
    permissions: [
      'dashboard.view',
      'service_orders.view',
      'sales.view',
      'customers.view',
      'products.view',
      'stock.view',
      'stock_transfers.view',
      'stock_transfers.create',
      'stock_transfers.receive',
      'imports.view',
      'users.view',
      'stores.view',
    ],
  },
  {
    name: 'Gerente',
    description: 'Acesso completo à operação da própria loja',
    scope: 'STORE',
    permissions: [
      'dashboard.view',
      'service_orders.view',
      'service_orders.create',
      'service_orders.edit',
      'service_orders.delete',
      'service_orders.change_status',
      'sales.view',
      'sales.create',
      'sales.cancel',
      'customers.view',
      'customers.create',
      'customers.edit',
      'products.view',
      'products.create',
      'products.edit',
      'stock.view',
      'stock.adjust',
      'stock_transfers.view',
      'stock_transfers.create',
      'stock_transfers.receive',
      'stock_transfers.cancel',
      'imports.view',
      'users.view',
      'users.create',
      'users.edit',
      'users.delete',
    ],
  },
  {
    name: 'Técnico',
    description: 'Somente Orçamentos/OS da própria loja',
    scope: 'STORE',
    permissions: ['service_orders.view', 'service_orders.create', 'service_orders.edit', 'service_orders.change_status'],
  },
  {
    name: 'Vendedor',
    description: 'Balcão: PDV, clientes e abertura de orçamentos',
    scope: 'STORE',
    permissions: [
      'sales.view',
      'sales.create',
      'customers.view',
      'customers.create',
      'customers.edit',
      'products.view',
      'stock.view',
      'service_orders.view',
      'service_orders.create',
    ],
  },
];

const STORES = [
  { code: 'LJ01', name: 'Loja Centro', phone: '1133334444', address: 'Rua Direita, 100 - Centro' },
  { code: 'LJ02', name: 'Loja Shopping', phone: '1133335555', address: 'Av. Paulista, 2000 - Piso 2, Loja 215' },
  { code: 'LJ03', name: 'Loja Bairro', phone: '1133336666', address: 'Rua das Flores, 45 - Vila Nova' },
];

const USERS = [
  { name: 'Administrador', email: 'admin@erp.local', role: 'Administrador', store: null },
  { name: 'Sofia Supervisora', email: 'supervisor@erp.local', role: 'Supervisor de Rede', store: null },
  { name: 'Carlos Gerente', email: 'gerente.centro@erp.local', role: 'Gerente', store: 'LJ01' },
  { name: 'Tiago Técnico', email: 'tecnico.centro@erp.local', role: 'Técnico', store: 'LJ01' },
  { name: 'Vanessa Vendas', email: 'vendedor.centro@erp.local', role: 'Vendedor', store: 'LJ01' },
  { name: 'Marina Gerente', email: 'gerente.shopping@erp.local', role: 'Gerente', store: 'LJ02' },
  { name: 'Rafael Técnico', email: 'tecnico.shopping@erp.local', role: 'Técnico', store: 'LJ02' },
  { name: 'Bruno Vendas', email: 'vendedor.shopping@erp.local', role: 'Vendedor', store: 'LJ02' },
  { name: 'Paula Gerente', email: 'gerente.bairro@erp.local', role: 'Gerente', store: 'LJ03' },
  { name: 'Lucas Técnico', email: 'tecnico.bairro@erp.local', role: 'Técnico', store: 'LJ03' },
];

export async function seedBase() {
  const storeRows = await db.insert(stores).values(STORES).returning();
  const storeByCode = new Map(storeRows.map((s) => [s.code, s.id]));

  const roleByName = new Map<string, string>();
  for (const def of ROLE_DEFINITIONS) {
    const [role] = await db
      .insert(roles)
      .values({ name: def.name, description: def.description, scope: def.scope, isSystem: def.isSystem ?? false })
      .returning();
    roleByName.set(def.name, role!.id);
    if (def.permissions.length) {
      await db.insert(rolePermissions).values(def.permissions.map((permission) => ({ roleId: role!.id, permission })));
    }
  }

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const userRows = await db
    .insert(users)
    .values(
      USERS.map((u) => ({
        name: u.name,
        email: u.email,
        passwordHash,
        roleId: roleByName.get(u.role)!,
        storeId: u.store ? storeByCode.get(u.store)! : null,
      })),
    )
    .returning();
  return { storeByCode, userRows };
}

// ─── Dados de demonstração ────────────────────────────────────────────────────

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
const daysAgo = (days: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, Math.floor(rand() * 60), 0, 0);
  return d;
};

const FIRST = ['Ana', 'João', 'Maria', 'Pedro', 'Juliana', 'Lucas', 'Fernanda', 'Gabriel', 'Camila', 'Rafael', 'Beatriz', 'Mateus', 'Larissa', 'Diego', 'Patrícia'];
const LAST = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento'];
const DEFECTS = [
  'Tela quebrada após queda, touch não responde',
  'Não carrega, conector com mau contato',
  'Bateria descarregando muito rápido',
  'Câmera traseira embaçada',
  'Sem som no alto-falante durante ligações',
  'Aparelho não liga depois de molhar',
];
const PART_FOR_DEFECT = ['TELA', 'CON', 'BAT', 'CAM', 'ALT', null];

/** Procura o arquivo subindo a partir deste módulo (funciona em src/ e no bundle dist/). */
function findUp(relative: string): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, relative);
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

async function seedDemo(admin: AuthContext, storeByCode: Map<string, string>) {
  const samplePath = findUp('samples/inventario-exemplo.csv');
  if (!samplePath) {
    console.warn('  (planilha de exemplo não encontrada — gere com npm run sample:inventory)');
    return;
  }

  const report = await importProducts(
    { buffer: readFileSync(samplePath), fileName: 'inventario-exemplo.csv' },
    { mode: 'UPSERT', stockMode: 'SET', dryRun: false, strict: false },
    { userId: admin.userId },
  );
  console.log(`  ✔ Importação: ${report.createdCount} produtos, ${report.stockEntries} saldos (${report.durationMs} ms)`);

  // Clientes
  const customerRows = await db
    .insert(customers)
    .values(
      Array.from({ length: 30 }, (_, i) => ({
        name: `${pick(FIRST)} ${pick(LAST)} ${pick(LAST)}`,
        phone: `119${String(80000000 + i * 7919).slice(0, 8)}`,
        email: i % 3 === 0 ? `cliente${i}@exemplo.com` : null,
      })),
    )
    .returning({ id: customers.id });

  // Ordens de serviço em vários estágios
  const storeIds = [...storeByCode.values()];
  const models = await db
    .selectDistinct({ model: products.compatibleModels })
    .from(products)
    .where(ilike(products.sku, 'TELA-%'));

  let osCount = 0;
  for (let i = 0; i < 45; i++) {
    const storeId = storeIds[i % storeIds.length]!;
    const model = pick(models).model!;
    const defectIndex = Math.floor(rand() * DEFECTS.length);
    const partCode = PART_FOR_DEFECT[defectIndex];
    const [part] = partCode
      ? await db
          .select({ id: products.id })
          .from(products)
          .innerJoin(stockLevels, and(eq(stockLevels.productId, products.id), eq(stockLevels.storeId, storeId)))
          .where(and(ilike(products.sku, `${partCode}-%`), eq(products.compatibleModels, model), gt(stockLevels.quantity, 0)))
          .limit(1)
      : [];

    const order = await createServiceOrder(admin, createServiceOrderSchema.parse({
      storeId,
      customerId: pick(customerRows).id,
      deviceBrand: model.startsWith('iPhone') ? 'Apple' : model.startsWith('Moto') ? 'Motorola' : model.includes('Galaxy') ? 'Samsung' : 'Xiaomi',
      deviceModel: model,
      reportedDefect: DEFECTS[defectIndex]!,
      laborCents: pick([6000, 8000, 10000, 12000, 15000]),
      discountCents: 0,
      warrantyDays: 90,
      items: part ? [{ productId: part.id, quantity: 1 }] : [],
    }));

    // Distribuição de status: finalizadas/entregues no passado, abertas recentes
    const age = Math.floor(rand() * 28);
    const steps: ServiceOrderStatus[] =
      age > 20
        ? ['IN_PROGRESS', 'COMPLETED', 'DELIVERED']
        : age > 10
          ? pick([['IN_PROGRESS', 'COMPLETED', 'DELIVERED'], ['IN_PROGRESS', 'COMPLETED'], ['REJECTED']])
          : pick([[], ['IN_PROGRESS'], ['IN_PROGRESS', 'COMPLETED'], []]);
    try {
      for (const status of steps) await changeServiceOrderStatus(admin, order.id, { status, note: null });
    } catch {
      // Sem saldo da peça: permanece no estágio atual (cenário real)
    }
    const created = daysAgo(age + 2, 9);
    await db.execute(sql`
      update ${serviceOrders} set
        created_at = ${created},
        approved_at = case when approved_at is not null then ${daysAgo(age + 1, 11)}::timestamptz end,
        completed_at = case when completed_at is not null then ${daysAgo(age, 16)}::timestamptz end,
        delivered_at = case when delivered_at is not null then ${daysAgo(Math.max(age - 1, 0), 17)}::timestamptz end
      where id = ${order.id}`);
    osCount++;
  }
  console.log(`  ✔ ${osCount} ordens de serviço`);

  // Vendas de balcão dos últimos 30 dias (acessórios em estoque)
  for (let day = 29; day >= 0; day--) {
    for (const storeId of storeIds) {
      const available = await db
        .select({ id: products.id, priceCents: products.priceCents })
        .from(products)
        .innerJoin(stockLevels, and(eq(stockLevels.productId, products.id), eq(stockLevels.storeId, storeId)))
        .where(
          and(
            gt(stockLevels.quantity, 2),
            inArray(products.category, ['Películas', 'Capinhas', 'Carregadores', 'Cabos', 'Áudio', 'Acessórios']),
          ),
        )
        .limit(60);
      if (!available.length) continue;
      const perDay = 1 + Math.floor(rand() * 4);
      for (let n = 0; n < perDay; n++) {
        const chosen = [...new Set(Array.from({ length: 1 + Math.floor(rand() * 2) }, () => pick(available)))];
        const total = chosen.reduce((acc, p) => acc + p.priceCents, 0);
        const method = pick(['PIX', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'] as const);
        await createSale(admin, {
          storeId,
          items: chosen.map((p) => ({ productId: p.id, quantity: 1 })),
          discountCents: 0,
          // Dinheiro: cliente paga com nota "redonda" e recebe troco
          payments: [{ method, amountCents: method === 'CASH' ? Math.ceil(total / 1000) * 1000 : total }],
          notes: null,
        }).catch(() => undefined); // sem saldo: venda não acontece
      }
    }
  }
  await backdateSales();
  const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`count(*)::int` }).from(sales);
  console.log(`  ✔ ${total} vendas no PDV`);

  // Transferências: uma recebida, uma em trânsito
  const [movable] = await db
    .select({ id: products.id })
    .from(products)
    .innerJoin(stockLevels, eq(stockLevels.productId, products.id))
    .where(and(eq(stockLevels.storeId, storeByCode.get('LJ01')!), gt(stockLevels.quantity, 5)))
    .limit(1);
  if (movable) {
    const t1 = await createTransfer(admin, {
      fromStoreId: storeByCode.get('LJ01')!,
      toStoreId: storeByCode.get('LJ02')!,
      notes: 'Reposição para o fim de semana',
      items: [{ productId: movable.id, quantity: 2 }],
    });
    await receiveTransfer(admin, t1.id);
    await createTransfer(admin, {
      fromStoreId: storeByCode.get('LJ01')!,
      toStoreId: storeByCode.get('LJ03')!,
      notes: 'Enviado por motoboy',
      items: [{ productId: movable.id, quantity: 1 }],
    });
    console.log('  ✔ 2 transferências (1 recebida, 1 em trânsito)');
  }
}

/** Espalha as vendas criadas agora pelos últimos 30 dias (mantém ordem de número). */
async function backdateSales() {
  await db.execute(sql`
    with ordered as (
      select id, row_number() over (partition by store_id order by number) as rn,
             count(*) over (partition by store_id) as total
      from ${sales}
    )
    update ${sales} s set created_at =
      date_trunc('day', now()) - ((29 - floor((o.rn - 1) * 30.0 / o.total))::int * interval '1 day')
      + interval '9 hours' + (random() * interval '9 hours')
    from ordered o where o.id = s.id`);
}

async function main() {
  const withDemo = !process.argv.includes('--no-demo');
  const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`count(*)::int` }).from(stores);
  if (total > 0) {
    console.log('ℹ Banco já possui dados — seed ignorado. Use "npm run db:reset" para recriar.');
    return;
  }
  console.log('🌱 Criando estrutura inicial...');
  const { storeByCode, userRows } = await seedBase();
  console.log(`  ✔ ${storeByCode.size} lojas, ${ROLE_DEFINITIONS.length} cargos, ${userRows.length} usuários`);

  if (withDemo) {
    console.log('🎭 Gerando dados de demonstração...');
    const admin = await loadAuthContext(userRows.find((u) => u.email === 'admin@erp.local')!.id);
    await seedDemo(admin!, storeByCode);
  }

  console.log(`\n✅ Pronto! Acesse com admin@erp.local / ${DEFAULT_PASSWORD}`);
  console.log('   Outros usuários (mesma senha): gerente.centro@, tecnico.centro@, vendedor.centro@, supervisor@ ...');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error('✖ Falha no seed', err);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
