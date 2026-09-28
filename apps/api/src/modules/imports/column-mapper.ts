/**
 * Mapeamento flexível de cabeçalhos da planilha para os campos do produto.
 *
 * Cabeçalhos são normalizados (minúsculas, sem acento, separadores → "_"),
 * então "Preço de Venda", "preco_venda" e "PRECO VENDA" são equivalentes.
 *
 * Distribuição de estoque por loja: uma coluna por loja, no formato
 * `estoque_<CÓDIGO ou NOME da loja>` (também aceita qtd_, quantidade_, saldo_).
 *   ex.: estoque_LJ01 | Qtd Loja Centro | saldo_shopping
 * Alternativa: uma única coluna `quantidade` + loja padrão informada no envio.
 */
import { badRequest } from '../../lib/errors';

export const PRODUCT_FIELDS = [
  'sku',
  'barcode',
  'name',
  'description',
  'category',
  'brand',
  'compatibleModels',
  'costCents',
  'priceCents',
  'minStock',
  'quantity',
] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number];

/** Apelidos em ordem de prioridade. A ordem dos campos também importa (ver `name`/`description`). */
const ALIASES: Record<ProductField, string[]> = {
  sku: ['sku', 'codigo', 'cod', 'codigo_interno', 'cod_interno', 'referencia', 'ref', 'codigo_produto'],
  barcode: ['codigo_de_barras', 'codigo_barras', 'cod_barras', 'cod_de_barras', 'barcode', 'ean', 'ean13', 'gtin'],
  // "descricao" vira nome só se não existir coluna de nome dedicada
  name: ['nome', 'nome_produto', 'nome_do_produto', 'produto', 'name', 'descricao_produto', 'descricao'],
  description: ['descricao', 'descricao_detalhada', 'detalhes', 'description', 'observacao', 'observacoes', 'obs'],
  category: ['categoria', 'category', 'grupo', 'tipo', 'departamento'],
  brand: ['marca', 'brand', 'fabricante'],
  compatibleModels: [
    'modelos_compativeis',
    'modelo_compativel',
    'compatibilidade',
    'compativel_com',
    'compativel',
    'modelos',
    'modelo',
    'aparelho',
    'aparelhos',
  ],
  costCents: ['preco_custo', 'preco_de_custo', 'custo', 'custo_unitario', 'valor_custo', 'valor_de_custo', 'cost'],
  priceCents: ['preco_venda', 'preco_de_venda', 'valor_venda', 'valor_de_venda', 'preco', 'valor', 'price'],
  minStock: ['estoque_minimo', 'estoque_min', 'qtd_minima', 'quantidade_minima', 'minimo', 'min_stock'],
  quantity: ['quantidade', 'qtd', 'qtde', 'estoque', 'saldo', 'qty', 'quantity', 'estoque_inicial'],
};

const STORE_COLUMN = /^(?:estoque|qtd|qtde|quantidade|saldo)_(.+)$/;

export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface StoreRef {
  id: string;
  code: string;
  name: string;
}

export interface ColumnMapping {
  fields: Partial<Record<ProductField, number>>;
  /** Coluna → loja. */
  stores: Array<{ index: number; header: string; storeId: string; storeCode: string }>;
  ignored: string[];
  /** Descrição legível para o relatório (campo → cabeçalho original). */
  summary: Record<string, string>;
}

export function mapColumns(headers: string[], stores: StoreRef[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const fields: ColumnMapping['fields'] = {};

  const dup = normalized.find((h, i) => h && normalized.indexOf(h) !== i);
  if (dup) throw badRequest(`Cabeçalho duplicado na planilha: "${headers[normalized.indexOf(dup)]}"`);

  for (const field of PRODUCT_FIELDS) {
    for (const alias of ALIASES[field]) {
      const index = normalized.findIndex((h, i) => h === alias && !used.has(i));
      if (index >= 0) {
        fields[field] = index;
        used.add(index);
        break;
      }
    }
  }

  const storeKeys = new Map<string, StoreRef>();
  for (const store of stores) {
    storeKeys.set(normalizeHeader(store.code), store);
    storeKeys.set(normalizeHeader(store.name), store);
  }

  const storeColumns: ColumnMapping['stores'] = [];
  const ignored: string[] = [];
  normalized.forEach((h, index) => {
    if (used.has(index) || !h) return;
    const match = STORE_COLUMN.exec(h);
    const store = match ? storeKeys.get(match[1]!) : undefined;
    if (match && !store) {
      throw badRequest(
        `A coluna "${headers[index]}" não corresponde a nenhuma loja. Use o código (${stores
          .map((s) => s.code)
          .join(', ')}) ou o nome da loja.`,
      );
    }
    if (store) {
      if (storeColumns.some((c) => c.storeId === store.id)) {
        throw badRequest(`Mais de uma coluna de estoque para a loja ${store.code}`);
      }
      storeColumns.push({ index, header: headers[index]!, storeId: store.id, storeCode: store.code });
      used.add(index);
    } else {
      ignored.push(headers[index]!);
    }
  });

  const missing = (['sku', 'name'] as const).filter((f) => fields[f] === undefined);
  if (missing.length) {
    const labels = { sku: 'SKU/código', name: 'nome do produto' };
    throw badRequest(
      `Coluna obrigatória ausente: ${missing.map((m) => labels[m]).join(', ')}. Cabeçalhos encontrados: ${headers.join(', ')}`,
    );
  }
  if (fields.quantity !== undefined && storeColumns.length) {
    throw badRequest(
      'Use OU uma coluna "quantidade" (com loja padrão) OU colunas por loja (estoque_<LOJA>), não ambas',
    );
  }

  const summary: Record<string, string> = {};
  for (const [field, index] of Object.entries(fields)) summary[field] = headers[index as number]!;
  return { fields, stores: storeColumns, ignored, summary };
}
