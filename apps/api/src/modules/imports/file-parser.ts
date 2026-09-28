/**
 * Leitura de planilhas (CSV ou XLSX) para uma estrutura tabular neutra.
 *
 * Particularidades tratadas:
 *  - CSV exportado pelo Excel em português usa ";" como separador e costuma vir
 *    em Windows-1252 (acentos quebrados se lidos como UTF-8).
 *  - XLSX preserva números como números — não convertemos preços para texto
 *    (evita ambiguidade de "12.345") e códigos de barras numéricos continuam exatos.
 */
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { badRequest } from '../../lib/errors';

export type CellValue = string | number | null;

export interface ParsedRow {
  /** Número da linha na planilha original (1 = cabeçalho). */
  rowNumber: number;
  cells: CellValue[];
}

export interface ParsedSheet {
  fileType: 'csv' | 'xlsx';
  headers: string[];
  rows: ParsedRow[];
  /** Metadados de leitura (separador, encoding, aba). */
  meta: Record<string, string>;
}

export function detectFileType(fileName: string): 'csv' | 'xlsx' {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'xls') throw badRequest('Formato .xls (Excel 97-2003) não suportado. Salve como .xlsx ou .csv.');
  throw badRequest('Formato de arquivo não suportado. Envie .csv ou .xlsx.');
}

export async function parseSpreadsheet(buffer: Buffer, fileName: string): Promise<ParsedSheet> {
  const fileType = detectFileType(fileName);
  const sheet = fileType === 'csv' ? parseCsv(buffer) : await parseXlsx(buffer);
  if (!sheet.headers.some((h) => h.trim())) throw badRequest('Arquivo vazio ou sem linha de cabeçalho');
  return sheet;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function decodeText(buffer: Buffer): { text: string; encoding: string } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
  } catch {
    // Bytes inválidos em UTF-8: arquivo salvo pelo Excel/Windows em ANSI
    return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'windows-1252' };
  }
}

/** Escolhe o separador mais frequente (fora de aspas) na linha de cabeçalho. */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0, '|': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]! += 1;
  }
  const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return best && best[1] > 0 ? best[0] : ',';
}

function parseCsv(buffer: Buffer): ParsedSheet {
  const { text, encoding } = decodeText(buffer);
  const delimiter = detectDelimiter(text);
  let records: Array<{ record: string[]; info: { lines: number } }>;
  try {
    records = parse(text, {
      delimiter,
      bom: true,
      info: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
    }) as unknown as Array<{ record: string[]; info: { lines: number } }>;
  } catch (err) {
    throw badRequest(`Não foi possível ler o CSV: ${(err as Error).message}`);
  }
  const [header, ...body] = records;
  return {
    fileType: 'csv',
    headers: header?.record ?? [],
    rows: body.map(({ record, info }) => ({
      rowNumber: info.lines,
      cells: record.map((v) => (v === '' ? null : v)),
    })),
    meta: { delimiter: delimiter === '\t' ? 'TAB' : delimiter, encoding },
  };
}

// ─── XLSX ─────────────────────────────────────────────────────────────────────

function cellToValue(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return cellToValue(value.richText.map((r) => r.text).join(''));
    if ('result' in value) return cellToValue((value.result ?? null) as ExcelJS.CellValue);
    if ('text' in value) return cellToValue(String(value.text));
    if ('error' in value) return null;
  }
  return null;
}

async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw badRequest('Arquivo .xlsx inválido ou corrompido');
  }
  // Primeira aba visível que tenha conteúdo
  const sheet = workbook.worksheets.find((ws) => ws.state === 'visible' && ws.actualRowCount > 0);
  if (!sheet) throw badRequest('A planilha não contém dados');

  let headers: string[] | null = null;
  const rows: ParsedRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const width = headers ? headers.length : row.cellCount;
    const cells: CellValue[] = [];
    for (let col = 1; col <= width; col++) cells.push(cellToValue(row.getCell(col).value));
    if (!headers) {
      headers = cells.map((c) => (c === null ? '' : String(c)));
      return;
    }
    if (cells.some((c) => c !== null)) rows.push({ rowNumber, cells });
  });
  return { fileType: 'xlsx', headers: headers ?? [], rows, meta: { sheet: sheet.name } };
}
