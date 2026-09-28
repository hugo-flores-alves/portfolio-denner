/**
 * Importação de produtos via linha de comando (setup inicial / migração de sistema).
 * Usa exatamente o mesmo serviço da rota HTTP.
 *
 *   npm run import:products -- --file ../../samples/inventario-exemplo.csv --dry-run
 *   npm run import:products -- --file inventario.xlsx --mode UPSERT --stock-mode SET --user admin@erp.local
 *   npm run import:products -- --file estoque-centro.csv --default-store LJ01
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { IMPORT_MODES, IMPORT_STOCK_MODES, type ImportMode, type ImportStockMode } from '@erp/shared';
import { closeDb, db } from '../db/client';
import { stores, users } from '../db/schema';
import { importProducts } from '../modules/imports/product-import.service';

const { values } = parseArgs({
  options: {
    file: { type: 'string', short: 'f' },
    mode: { type: 'string', default: 'UPSERT' },
    'stock-mode': { type: 'string', default: 'SET' },
    'default-store': { type: 'string' },
    user: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
  },
});

async function main() {
  if (!values.file) throw new Error('Informe o arquivo: --file caminho/planilha.(csv|xlsx)');
  const mode = values.mode!.toUpperCase() as ImportMode;
  const stockMode = values['stock-mode']!.toUpperCase() as ImportStockMode;
  if (!IMPORT_MODES.includes(mode)) throw new Error(`--mode deve ser ${IMPORT_MODES.join(' | ')}`);
  if (!IMPORT_STOCK_MODES.includes(stockMode)) throw new Error(`--stock-mode deve ser ${IMPORT_STOCK_MODES.join(' | ')}`);

  let defaultStoreId: string | null = null;
  if (values['default-store']) {
    const [store] = await db.select().from(stores).where(eq(stores.code, values['default-store'].toUpperCase()));
    if (!store) throw new Error(`Loja ${values['default-store']} não encontrada`);
    defaultStoreId = store.id;
  }
  let userId: string | null = null;
  if (values.user) {
    const [user] = await db.select().from(users).where(eq(users.email, values.user.toLowerCase()));
    if (!user) throw new Error(`Usuário ${values.user} não encontrado`);
    userId = user.id;
  }

  const filePath = path.resolve(values.file);
  const report = await importProducts(
    { buffer: readFileSync(filePath), fileName: path.basename(filePath) },
    { mode, stockMode, dryRun: values['dry-run']!, strict: values.strict!, defaultStoreId },
    { userId },
  );

  console.log(`\n${report.dryRun ? '🔎 PRÉ-VISUALIZAÇÃO (nada foi gravado)' : '📦 IMPORTAÇÃO'} — ${report.fileName}`);
  console.table({
    'Linhas no arquivo': report.totalRows,
    'Novos produtos': report.createdCount,
    Atualizados: report.updatedCount,
    Ignorados: report.skippedCount,
    'Linhas com erro': report.errorCount,
    'Saldos por loja gravados': report.stockEntries,
    'Tempo (ms)': report.durationMs,
  });
  console.log('Colunas:', report.columns.mapped, '| Lojas:', report.columns.stores.map((s) => s.storeCode).join(', '));
  if (report.errors.length) {
    console.log(`\nErros (${report.errors.length}${report.errorsTruncated ? '+' : ''}):`);
    for (const e of report.errors.slice(0, 30)) console.log(`  linha ${e.row} [${e.field ?? '-'}] ${e.message}`);
  }
  if (report.warnings.length) console.log(`\nAvisos: ${report.warnings.length} (primeiro: ${report.warnings[0]!.message})`);
  if (report.status === 'FAILED') process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`✖ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
