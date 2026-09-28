/**
 * Validação e conversão de cada linha da planilha em um produto.
 * Função pura (sem banco): fácil de testar e reutilizar.
 *
 * Campos opcionais vazios ficam `undefined` — no modo UPSERT significa
 * "manter o valor atual"; na criação, aplica-se o padrão (0 / vazio).
 */
import { parseMoneyToCents } from '@erp/shared';
import type { ImportIssue } from '../../db/schema';
import { BARCODE_PATTERN, normalizeBarcode, normalizeSku, SKU_PATTERN } from '../products/product-rules';
import type { ColumnMapping, ProductField } from './column-mapper';
import type { CellValue, ParsedRow } from './file-parser';

export interface ProductRow {
  row: number;
  sku: string;
  name: string;
  barcode?: string;
  description?: string;
  category?: string;
  brand?: string;
  compatibleModels?: string;
  costCents?: number;
  priceCents?: number;
  minStock?: number;
  /** storeId → quantidade informada (células vazias não entram). */
  stock: Map<string, number>;
}

export type RowResult =
  | { ok: true; value: ProductRow; warnings: ImportIssue[] }
  | { ok: false; errors: ImportIssue[]; warnings: ImportIssue[] };

const SCIENTIFIC = /^\d+(?:[.,]\d+)?e[+-]?\d+$/i;

function asText(value: CellValue): string | undefined {
  if (value === null) return undefined;
  const text = typeof value === 'number' ? String(value) : value.trim();
  return text === '' ? undefined : text;
}

/** Valida o dígito verificador de EAN-8/UPC-12/EAN-13/GTIN-14. */
export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function parseQuantity(value: CellValue): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  const text = value!.trim().replace(/\s/g, '');
  // Aceita "10", "10,0", "1.000" (milhar BR)
  if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ''));
  const n = Number(text.replace(',', '.'));
  return Number.isInteger(n) ? n : null;
}

const MAX_LENGTH: Partial<Record<ProductField, number>> = {
  name: 200,
  description: 2000,
  category: 80,
  brand: 80,
  compatibleModels: 1000,
};

export function parseProductRow(
  row: ParsedRow,
  mapping: ColumnMapping,
  options: { defaultStoreId?: string | null },
): RowResult {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const cell = (field: ProductField): CellValue => {
    const index = mapping.fields[field];
    return index === undefined ? null : (row.cells[index] ?? null);
  };
  const fail = (field: string, message: string, value?: CellValue) =>
    errors.push({ row: row.rowNumber, field, message, ...(value != null ? { value: String(value) } : {}) });

  // SKU
  const rawSku = asText(cell('sku'));
  const sku = rawSku ? normalizeSku(rawSku) : '';
  if (!sku) fail('sku', 'SKU obrigatório');
  else if (sku.length > 64) fail('sku', 'SKU com mais de 64 caracteres', rawSku);
  else if (!SKU_PATTERN.test(sku)) fail('sku', 'SKU contém caracteres inválidos', rawSku);

  // Nome
  const name = asText(cell('name'));
  if (!name) fail('name', 'Nome do produto obrigatório');
  else if (name.length < 2) fail('name', 'Nome muito curto', name);

  // Textos opcionais
  const texts: Partial<Record<ProductField, string>> = {};
  for (const field of ['name', 'description', 'category', 'brand', 'compatibleModels'] as const) {
    const value = asText(cell(field));
    if (value && value.length > (MAX_LENGTH[field] ?? 200)) {
      fail(field, `Texto excede ${MAX_LENGTH[field]} caracteres`);
    }
    if (value) texts[field] = value;
  }

  // Código de barras
  let barcode: string | undefined;
  const rawBarcode = cell('barcode');
  if (rawBarcode !== null) {
    if (typeof rawBarcode === 'number' && !Number.isInteger(rawBarcode)) {
      fail('barcode', 'Código de barras numérico inválido', rawBarcode);
    } else {
      const text = typeof rawBarcode === 'number' ? String(rawBarcode) : rawBarcode.trim();
      if (SCIENTIFIC.test(text)) {
        fail(
          'barcode',
          'Código de barras em notação científica (ex.: 7,89E+12) — o Excel truncou o número. Formate a coluna como Texto e exporte novamente.',
          text,
        );
      } else {
        barcode = normalizeBarcode(text);
        if (barcode.length > 64 || !BARCODE_PATTERN.test(barcode)) {
          fail('barcode', 'Código de barras inválido', text);
          barcode = undefined;
        } else if (/^\d+$/.test(barcode) && [8, 12, 13, 14].includes(barcode.length) && !isValidGtin(barcode)) {
          warnings.push({
            row: row.rowNumber,
            field: 'barcode',
            value: barcode,
            message: 'Dígito verificador do EAN/GTIN não confere — confira o código',
          });
        }
      }
    }
  }

  // Valores monetários
  const money: Partial<Record<'costCents' | 'priceCents', number>> = {};
  for (const field of ['costCents', 'priceCents'] as const) {
    const raw = cell(field);
    if (raw === null) continue;
    const cents = parseMoneyToCents(raw);
    if (cents === null) fail(field, 'Valor monetário inválido', raw);
    else if (cents < 0) fail(field, 'Valor não pode ser negativo', raw);
    else if (cents > 100_000_000) fail(field, 'Valor acima do limite (R$ 1.000.000,00)', raw);
    else money[field] = cents;
  }
  if (money.costCents !== undefined && money.priceCents !== undefined && money.priceCents < money.costCents) {
    warnings.push({ row: row.rowNumber, field: 'priceCents', message: 'Preço de venda abaixo do custo' });
  }

  // Estoque mínimo
  let minStock: number | undefined;
  const rawMin = cell('minStock');
  if (rawMin !== null) {
    const n = parseQuantity(rawMin);
    if (n === null || n < 0) fail('minStock', 'Estoque mínimo deve ser inteiro ≥ 0', rawMin);
    else minStock = n;
  }

  // Quantidades por loja
  const stock = new Map<string, number>();
  const readQty = (value: CellValue, storeId: string, label: string) => {
    if (value === null) return;
    const n = parseQuantity(value);
    if (n === null) fail(label, 'Quantidade deve ser um número inteiro', value);
    else if (n < 0) fail(label, 'Quantidade não pode ser negativa', value);
    else if (n > 1_000_000) fail(label, 'Quantidade acima do limite', value);
    else stock.set(storeId, n);
  };
  for (const col of mapping.stores) readQty(row.cells[col.index] ?? null, col.storeId, col.header);
  if (mapping.fields.quantity !== undefined) {
    const raw = cell('quantity');
    if (raw !== null && !options.defaultStoreId) {
      fail('quantity', 'Informe a loja padrão para a coluna de quantidade');
    } else if (options.defaultStoreId) {
      readQty(raw, options.defaultStoreId, 'quantidade');
    }
  }

  if (errors.length) return { ok: false, errors, warnings };
  return {
    ok: true,
    warnings,
    value: {
      row: row.rowNumber,
      sku,
      name: name!,
      barcode,
      description: texts.description,
      category: texts.category,
      brand: texts.brand,
      compatibleModels: texts.compatibleModels,
      ...money,
      minStock,
      stock,
    },
  };
}
