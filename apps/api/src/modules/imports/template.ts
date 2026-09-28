import ExcelJS from 'exceljs';
import type { StoreRef } from './column-mapper';

const BASE_COLUMNS = [
  { header: 'sku', width: 16, note: 'Obrigatório. Código interno único do produto' },
  { header: 'codigo_barras', width: 18, note: 'Opcional. EAN/GTIN — formate a coluna como TEXTO' },
  { header: 'nome', width: 40, note: 'Obrigatório' },
  { header: 'descricao', width: 30, note: 'Opcional' },
  { header: 'categoria', width: 18, note: 'Opcional. Ex.: Telas, Baterias, Capinhas' },
  { header: 'marca', width: 14, note: 'Opcional' },
  { header: 'modelos_compativeis', width: 30, note: 'Opcional. Ex.: iPhone 11, iPhone 11 Pro' },
  { header: 'preco_custo', width: 12, note: 'Opcional. Aceita 12,50 ou 12.50' },
  { header: 'preco_venda', width: 12, note: 'Opcional. Aceita 1.234,56' },
  { header: 'estoque_minimo', width: 14, note: 'Opcional. Alerta de reposição por loja' },
] as const;

const EXAMPLES = [
  ['TELA-IP11-INC', '7891234567895', 'Tela Frontal iPhone 11 Incell', 'Display LCD com touch', 'Telas', 'Genérica', 'iPhone 11', '120,00', '289,90', '2'],
  ['BAT-SM-A12', '', 'Bateria Samsung Galaxy A12', '', 'Baterias', 'Samsung', 'Galaxy A12, Galaxy A13', '45,00', '119,90', '3'],
];

function exampleStock(storeIndex: number, rowIndex: number) {
  return String(((storeIndex + 1) * 3 + rowIndex * 2) % 10);
}

export function templateHeaders(stores: StoreRef[]): string[] {
  return [...BASE_COLUMNS.map((c) => c.header), ...stores.map((s) => `estoque_${s.code}`)];
}

export function buildCsvTemplate(stores: StoreRef[]): Buffer {
  const lines = [
    templateHeaders(stores),
    ...EXAMPLES.map((row, r) => [...row, ...stores.map((_, i) => exampleStock(i, r))]),
  ].map((cols) => cols.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';'));
  // BOM + ";" para o Excel pt-BR abrir com acentos e colunas corretas
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

export async function buildXlsxTemplate(stores: StoreRef[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERP Assistência Técnica';
  const ws = wb.addWorksheet('Produtos', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    ...BASE_COLUMNS.map((c) => ({ header: c.header, key: c.header, width: c.width })),
    ...stores.map((s) => ({ header: `estoque_${s.code}`, key: `estoque_${s.code}`, width: 14 })),
  ];
  ws.getColumn('codigo_barras').numFmt = '@';
  ws.getColumn('sku').numFmt = '@';
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };

  EXAMPLES.forEach((row, r) => {
    const [sku, barcode, name, description, category, brand, models, cost, price, min] = row;
    ws.addRow([
      sku,
      barcode,
      name,
      description,
      category,
      brand,
      models,
      Number(cost!.replace(',', '.')),
      Number(price!.replace(',', '.')),
      Number(min),
      ...stores.map((_, i) => Number(exampleStock(i, r))),
    ]);
  });

  const help = wb.addWorksheet('Instruções');
  help.columns = [
    { header: 'Coluna', key: 'col', width: 24 },
    { header: 'Descrição', key: 'desc', width: 80 },
  ];
  help.getRow(1).font = { bold: true };
  for (const c of BASE_COLUMNS) help.addRow({ col: c.header, desc: c.note });
  for (const s of stores) {
    help.addRow({ col: `estoque_${s.code}`, desc: `Quantidade inicial na loja ${s.name}. Vazio = não altera o saldo` });
  }
  help.addRow({});
  help.addRow({ col: 'Dica', desc: 'Apague as linhas de exemplo antes de importar. Só a 1ª aba é lida.' });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
