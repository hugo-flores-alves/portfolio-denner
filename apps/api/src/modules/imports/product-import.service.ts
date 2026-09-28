/**
 * Importação em massa de produtos + estoque inicial por loja.
 *
 * Pipeline:
 *   1. Leitura do arquivo (CSV/XLSX) ........................ file-parser
 *   2. Mapeamento de colunas e lojas ......................... column-mapper
 *   3. Validação linha a linha (sem banco) ................... row-parser
 *   4. Duplicidades no arquivo (SKU e código de barras)
 *   5. Classificação contra o banco: criar / atualizar / ignorar,
 *      conflito de código de barras com outro SKU
 *   6. dryRun → apenas relatório (pré-visualização)
 *   7. Gravação em UMA transação, em lotes (batch insert/update de até
 *      BATCH_SIZE linhas por comando), com lock consultivo para impedir
 *      importações simultâneas, saldo por loja e kardex (IMPORT).
 *
 * Linhas inválidas não bloqueiam as válidas (a menos que `strict`), e o
 * relatório aponta linha, campo e motivo de cada problema.
 */
import { randomUUID } from 'node:crypto';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { ImportMode, ImportStockMode } from '@erp/shared';
import { env } from '../../config/env';
import { db, type Executor, type Tx } from '../../db/client';
import { importJobs, products, stockLevels, stockMovements, stores, type ImportIssue } from '../../db/schema';
import { badRequest, conflict, forbidden } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { mapColumns, type ColumnMapping } from './column-mapper';
import { parseSpreadsheet, type ParsedSheet } from './file-parser';
import { parseProductRow, type ProductRow } from './row-parser';

export const BATCH_SIZE = 500;
const MAX_ISSUES_IN_REPORT = 1000;
const PREVIEW_SIZE = 20;

export interface ImportOptions {
  mode: ImportMode;
  stockMode: ImportStockMode;
  dryRun: boolean;
  /** Se houver qualquer erro, não grava nada. */
  strict: boolean;
  /** Loja usada quando a planilha tem uma única coluna "quantidade". */
  defaultStoreId?: string | null;
  /** Lojas em que o usuário pode lançar estoque (null = todas). */
  allowedStoreIds?: string[] | null;
}

export interface ImportFile {
  buffer: Buffer;
  fileName: string;
}

type PlannedRow = ProductRow & { action: 'CREATE' | 'UPDATE' | 'SKIP'; productId?: string };

export interface ImportReport {
  jobId: string | null;
  dryRun: boolean;
  status: 'COMPLETED' | 'FAILED';
  fileName: string;
  fileType: 'csv' | 'xlsx';
  meta: Record<string, string>;
  mode: ImportMode;
  stockMode: ImportStockMode;
  columns: {
    mapped: Record<string, string>;
    stores: Array<{ header: string; storeCode: string }>;
    ignored: string[];
  };
  totalRows: number;
  validRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  stockEntries: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  errorsTruncated: boolean;
  warningsTruncated: boolean;
  preview: Array<{
    row: number;
    action: PlannedRow['action'];
    sku: string;
    name: string;
    priceCents?: number;
    stock: Record<string, number>;
  }>;
  durationMs: number;
}

export function chunk<T>(list: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ─── Etapas puras ─────────────────────────────────────────────────────────────

function validateRows(sheet: ParsedSheet, mapping: ColumnMapping, options: ImportOptions) {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const valid: ProductRow[] = [];
  for (const row of sheet.rows) {
    const result = parseProductRow(row, mapping, options);
    warnings.push(...result.warnings);
    if (result.ok) valid.push(result.value);
    else errors.push(...result.errors);
  }
  return { valid, errors, warnings };
}

/** SKU ou código de barras repetido no arquivo: todas as ocorrências são rejeitadas (ambíguo). */
function rejectInFileDuplicates(rows: ProductRow[]) {
  const errors: ImportIssue[] = [];
  const rejected = new Set<number>();
  const check = (key: 'sku' | 'barcode', label: string) => {
    const groups = new Map<string, ProductRow[]>();
    for (const r of rows) {
      const value = r[key];
      if (!value) continue;
      groups.set(value, [...(groups.get(value) ?? []), r]);
    }
    for (const [value, group] of groups) {
      if (group.length < 2) continue;
      const lines = group.map((r) => r.row).join(', ');
      for (const r of group) {
        rejected.add(r.row);
        errors.push({ row: r.row, field: key, value, message: `${label} repetido no arquivo (linhas ${lines})` });
      }
    }
  };
  check('sku', 'SKU');
  check('barcode', 'Código de barras');
  return { unique: rows.filter((r) => !rejected.has(r.row)), errors };
}

// ─── Classificação contra o banco ─────────────────────────────────────────────

async function classify(executor: Executor, rows: ProductRow[], mode: ImportMode) {
  const bySku = new Map<string, { id: string; sku: string }>();
  const byBarcode = new Map<string, { id: string; sku: string }>();
  for (const part of chunk(rows.map((r) => r.sku), 1000)) {
    const found = await executor.select({ id: products.id, sku: products.sku }).from(products).where(inArray(products.sku, part));
    for (const p of found) bySku.set(p.sku, p);
  }
  const barcodes = rows.map((r) => r.barcode).filter((b): b is string => !!b);
  for (const part of chunk(barcodes, 1000)) {
    const found = await executor
      .select({ id: products.id, sku: products.sku, barcode: products.barcode })
      .from(products)
      .where(inArray(products.barcode, part));
    for (const p of found) byBarcode.set(p.barcode!, p);
  }

  const planned: PlannedRow[] = [];
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  for (const row of rows) {
    const owner = row.barcode ? byBarcode.get(row.barcode) : undefined;
    if (owner && owner.sku !== row.sku) {
      errors.push({
        row: row.row,
        field: 'barcode',
        value: row.barcode,
        message: `Código de barras já cadastrado no produto SKU ${owner.sku}`,
      });
      continue;
    }
    const existing = bySku.get(row.sku);
    if (!existing) planned.push({ ...row, action: 'CREATE' });
    else if (mode === 'UPSERT') planned.push({ ...row, action: 'UPDATE', productId: existing.id });
    else {
      planned.push({ ...row, action: 'SKIP', productId: existing.id });
      warnings.push({ row: row.row, field: 'sku', value: row.sku, message: 'SKU já cadastrado — ignorado (modo "somente novos")' });
    }
  }
  return { planned, errors, warnings };
}

// ─── Escrita em lote ──────────────────────────────────────────────────────────

async function insertProducts(tx: Tx, rows: PlannedRow[]): Promise<void> {
  for (const part of chunk(rows)) {
    const inserted = await tx
      .insert(products)
      .values(
        part.map((r) => ({
          sku: r.sku,
          barcode: r.barcode ?? null,
          name: r.name,
          description: r.description ?? null,
          category: r.category ?? null,
          brand: r.brand ?? null,
          compatibleModels: r.compatibleModels ?? null,
          costCents: r.costCents ?? 0,
          priceCents: r.priceCents ?? 0,
          minStock: r.minStock ?? 0,
        })),
      )
      .onConflictDoNothing({ target: products.sku })
      .returning({ id: products.id, sku: products.sku });
    if (inserted.length !== part.length) {
      throw conflict('Produtos foram cadastrados por outro processo durante a importação. Tente novamente.');
    }
    const ids = new Map(inserted.map((p) => [p.sku, p.id]));
    for (const r of part) r.productId = ids.get(r.sku);
  }
}

/** UPDATE ... FROM (VALUES ...) — campos vazios na planilha mantêm o valor atual (coalesce). */
async function updateProducts(tx: Tx, rows: PlannedRow[]): Promise<void> {
  for (const part of chunk(rows)) {
    const values = sql.join(
      part.map(
        (r) => sql`(${r.productId}::uuid, ${r.name}::varchar, ${r.barcode ?? null}::varchar, ${
          r.description ?? null
        }::text, ${r.category ?? null}::varchar, ${r.brand ?? null}::varchar, ${
          r.compatibleModels ?? null
        }::text, ${r.costCents ?? null}::int, ${r.priceCents ?? null}::int, ${r.minStock ?? null}::int)`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      update ${products} as p set
        name = v.name,
        barcode = coalesce(v.barcode, p.barcode),
        description = coalesce(v.description, p.description),
        category = coalesce(v.category, p.category),
        brand = coalesce(v.brand, p.brand),
        compatible_models = coalesce(v.compatible_models, p.compatible_models),
        cost_cents = coalesce(v.cost_cents, p.cost_cents),
        price_cents = coalesce(v.price_cents, p.price_cents),
        min_stock = coalesce(v.min_stock, p.min_stock),
        is_active = true,
        updated_at = now()
      from (values ${values}) as v(id, name, barcode, description, category, brand, compatible_models, cost_cents, price_cents, min_stock)
      where p.id = v.id`);
  }
}

/**
 * Grava saldos com valor ABSOLUTO (SET ou saldo atual + quantidade em ADD),
 * calculado sobre linhas travadas, e registra no kardex a diferença real.
 */
async function applyImportStock(
  tx: Tx,
  rows: PlannedRow[],
  stockMode: ImportStockMode,
  ctx: { jobId: string; userId: string | null; note: string },
): Promise<number> {
  const entries = rows.flatMap((r) =>
    [...r.stock].map(([storeId, quantity]) => ({ storeId, productId: r.productId!, quantity })),
  );
  if (!entries.length) return 0;

  const current = new Map<string, number>();
  const productIds = [...new Set(entries.map((e) => e.productId))];
  for (const part of chunk(productIds, 1000)) {
    const locked = await tx
      .select({ storeId: stockLevels.storeId, productId: stockLevels.productId, quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(inArray(stockLevels.productId, part))
      .orderBy(asc(stockLevels.storeId), asc(stockLevels.productId))
      .for('update');
    for (const l of locked) current.set(`${l.storeId}|${l.productId}`, l.quantity);
  }

  const levels: Array<{ storeId: string; productId: string; quantity: number }> = [];
  const movements: Array<typeof stockMovements.$inferInsert> = [];
  for (const e of entries) {
    const key = `${e.storeId}|${e.productId}`;
    const before = current.get(key);
    const target = stockMode === 'SET' ? e.quantity : (before ?? 0) + e.quantity;
    const delta = target - (before ?? 0);
    if (delta === 0 && before !== undefined) continue;
    levels.push({ storeId: e.storeId, productId: e.productId, quantity: target });
    if (delta !== 0) {
      movements.push({
        storeId: e.storeId,
        productId: e.productId,
        type: 'IMPORT',
        quantity: delta,
        balanceAfter: target,
        referenceType: 'IMPORT',
        referenceId: ctx.jobId,
        userId: ctx.userId,
        note: ctx.note,
      });
    }
  }

  for (const part of chunk(levels, 1000)) {
    await tx
      .insert(stockLevels)
      .values(part)
      .onConflictDoUpdate({
        target: [stockLevels.storeId, stockLevels.productId],
        set: { quantity: sql`excluded.quantity`, updatedAt: sql`now()` },
      });
  }
  for (const part of chunk(movements, 1000)) await tx.insert(stockMovements).values(part);
  return levels.length;
}

// ─── Orquestração ─────────────────────────────────────────────────────────────

export async function importProducts(
  file: ImportFile,
  options: ImportOptions,
  actor: { userId: string | null },
): Promise<ImportReport> {
  const startedAt = performance.now();
  const sheet = await parseSpreadsheet(file.buffer, file.fileName);
  if (!sheet.rows.length) throw badRequest('A planilha não possui linhas de dados');
  if (sheet.rows.length > env.IMPORT_MAX_ROWS) {
    throw badRequest(`Limite de ${env.IMPORT_MAX_ROWS} linhas por arquivo excedido (${sheet.rows.length})`);
  }

  const activeStores = await db
    .select({ id: stores.id, code: stores.code, name: stores.name })
    .from(stores)
    .where(eq(stores.isActive, true));
  const mapping = mapColumns(sheet.headers, activeStores);

  if (options.defaultStoreId && !activeStores.some((s) => s.id === options.defaultStoreId)) {
    throw badRequest('Loja padrão inexistente ou inativa');
  }
  const storeCode = new Map(activeStores.map((s) => [s.id, s.code]));
  if (options.allowedStoreIds) {
    const allowed = options.allowedStoreIds;
    const targets = new Set([...mapping.stores.map((s) => s.storeId), options.defaultStoreId].filter(Boolean));
    const denied = [...targets].filter((id) => !allowed.includes(id!)).map((id) => storeCode.get(id!) ?? id);
    if (denied.length) throw forbidden(`Você não pode lançar estoque nas lojas: ${denied.join(', ')}`);
  }

  const validation = validateRows(sheet, mapping, options);
  const dedup = rejectInFileDuplicates(validation.valid);
  const errors = [...validation.errors, ...dedup.errors];
  const warnings = [...validation.warnings];
  if (!mapping.stores.length && mapping.fields.quantity === undefined) {
    warnings.unshift({ row: 1, message: 'Nenhuma coluna de estoque encontrada — produtos serão cadastrados sem saldo' });
  }
  for (const header of mapping.ignored) warnings.unshift({ row: 1, field: header, message: `Coluna "${header}" ignorada` });

  const buildReport = (
    planned: PlannedRow[],
    extra: { jobId: string | null; status: 'COMPLETED' | 'FAILED'; stockEntries: number },
  ): ImportReport => {
    const sortedErrors = errors.sort((a, b) => a.row - b.row);
    const sortedWarnings = warnings.sort((a, b) => a.row - b.row);
    const count = (action: PlannedRow['action']) => planned.filter((p) => p.action === action).length;
    return {
      jobId: extra.jobId,
      dryRun: options.dryRun,
      status: extra.status,
      fileName: file.fileName,
      fileType: sheet.fileType,
      meta: sheet.meta,
      mode: options.mode,
      stockMode: options.stockMode,
      columns: {
        mapped: mapping.summary,
        stores: mapping.stores.map((s) => ({ header: s.header, storeCode: s.storeCode })),
        ignored: mapping.ignored,
      },
      totalRows: sheet.rows.length,
      validRows: planned.length,
      createdCount: count('CREATE'),
      updatedCount: count('UPDATE'),
      skippedCount: count('SKIP'),
      errorCount: new Set(sortedErrors.map((e) => e.row)).size,
      stockEntries: extra.stockEntries,
      errors: sortedErrors.slice(0, MAX_ISSUES_IN_REPORT),
      warnings: sortedWarnings.slice(0, MAX_ISSUES_IN_REPORT),
      errorsTruncated: sortedErrors.length > MAX_ISSUES_IN_REPORT,
      warningsTruncated: sortedWarnings.length > MAX_ISSUES_IN_REPORT,
      preview: planned.slice(0, PREVIEW_SIZE).map((p) => ({
        row: p.row,
        action: p.action,
        sku: p.sku,
        name: p.name,
        priceCents: p.priceCents,
        stock: Object.fromEntries([...p.stock].map(([id, q]) => [storeCode.get(id) ?? id, q])),
      })),
      durationMs: Math.round(performance.now() - startedAt),
    };
  };

  const plannedStockEntries = (planned: PlannedRow[]) =>
    planned.filter((p) => p.action !== 'SKIP').reduce((acc, p) => acc + p.stock.size, 0);

  // Pré-visualização / modo estrito: nada é gravado
  if (options.dryRun || (options.strict && errors.length)) {
    const plan = await classify(db, dedup.unique, options.mode);
    errors.push(...plan.errors);
    warnings.push(...plan.warnings);
    const failed = options.strict && errors.length > 0;
    return buildReport(plan.planned, {
      jobId: null,
      status: failed ? 'FAILED' : 'COMPLETED',
      stockEntries: plannedStockEntries(plan.planned),
    });
  }

  const jobId = randomUUID();
  const fileType = sheet.fileType;
  try {
    return await db.transaction(async (tx) => {
      // Serializa importações concorrentes (duas planilhas com o mesmo SKU ao mesmo tempo)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('erp:product-import'))`);
      const plan = await classify(tx, dedup.unique, options.mode);
      errors.push(...plan.errors);
      warnings.push(...plan.warnings);
      if (options.strict && errors.length) {
        return buildReport(plan.planned, { jobId: null, status: 'FAILED', stockEntries: 0 });
      }

      const toCreate = plan.planned.filter((p) => p.action === 'CREATE');
      const toUpdate = plan.planned.filter((p) => p.action === 'UPDATE');
      await insertProducts(tx, toCreate);
      await updateProducts(tx, toUpdate);
      const stockEntries = await applyImportStock(tx, [...toCreate, ...toUpdate], options.stockMode, {
        jobId,
        userId: actor.userId,
        note: `Importação: ${file.fileName}`,
      });

      const report = buildReport(plan.planned, { jobId, status: 'COMPLETED', stockEntries });
      await tx.insert(importJobs).values({
        id: jobId,
        userId: actor.userId,
        fileName: file.fileName.slice(0, 255),
        fileType,
        mode: options.mode,
        stockMode: options.stockMode,
        dryRun: false,
        status: 'COMPLETED',
        totalRows: report.totalRows,
        validRows: report.validRows,
        createdCount: report.createdCount,
        updatedCount: report.updatedCount,
        skippedCount: report.skippedCount,
        errorCount: report.errorCount,
        stockEntries,
        errors: report.errors,
        warnings: report.warnings,
        durationMs: report.durationMs,
      });
      return report;
    });
  } catch (err) {
    // Registra a falha no histórico (fora da transação revertida)
    await db
      .insert(importJobs)
      .values({
        id: jobId,
        userId: actor.userId,
        fileName: file.fileName.slice(0, 255),
        fileType,
        mode: options.mode,
        stockMode: options.stockMode,
        status: 'FAILED',
        totalRows: sheet.rows.length,
        errors: [{ row: 0, message: (err as Error).message }],
        durationMs: Math.round(performance.now() - startedAt),
      })
      .catch((logErr) => logger.error({ logErr }, 'Falha ao registrar importação com erro'));
    throw err;
  }
}

export async function listStoresForTemplate() {
  return db
    .select({ id: stores.id, code: stores.code, name: stores.name })
    .from(stores)
    .where(eq(stores.isActive, true))
    .orderBy(asc(stores.code));
}
