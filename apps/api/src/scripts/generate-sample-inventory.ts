/**
 * Gera uma planilha de inventário realista (~1.200 peças/acessórios) para
 * testar a importação em massa: `npm run sample:inventory -w @erp/api`.
 * Determinístico (PRNG com semente fixa) para resultados reproduzíveis.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20240901);
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

function ean13(body12: string): string {
  const sum = body12
    .split('')
    .map(Number)
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return body12 + ((10 - (sum % 10)) % 10);
}

const MODELS: Record<string, string[]> = {
  Apple: [
    'iPhone 7', 'iPhone 7 Plus', 'iPhone 8', 'iPhone 8 Plus', 'iPhone X', 'iPhone XR', 'iPhone XS', 'iPhone XS Max',
    'iPhone 11', 'iPhone 11 Pro', 'iPhone 11 Pro Max', 'iPhone 12', 'iPhone 12 Pro', 'iPhone 12 Pro Max',
    'iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max', 'iPhone 14', 'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 15',
  ],
  Samsung: [
    'Galaxy A01', 'Galaxy A02', 'Galaxy A03', 'Galaxy A10', 'Galaxy A11', 'Galaxy A12', 'Galaxy A13', 'Galaxy A14',
    'Galaxy A20', 'Galaxy A21s', 'Galaxy A22', 'Galaxy A30', 'Galaxy A31', 'Galaxy A32', 'Galaxy A50', 'Galaxy A51',
    'Galaxy A52', 'Galaxy A53', 'Galaxy A54', 'Galaxy A71', 'Galaxy A72', 'Galaxy M12', 'Galaxy M22', 'Galaxy M32',
    'Galaxy S20 FE', 'Galaxy S21', 'Galaxy S22', 'Galaxy S23',
  ],
  Motorola: [
    'Moto G7', 'Moto G7 Power', 'Moto G8', 'Moto G8 Power', 'Moto G9 Play', 'Moto G9 Plus', 'Moto G10', 'Moto G20',
    'Moto G22', 'Moto G30', 'Moto G31', 'Moto G32', 'Moto G41', 'Moto G52', 'Moto G53', 'Moto G60', 'Moto G62',
    'Moto G82', 'Moto G84', 'Moto E6s', 'Moto E7', 'Moto E20', 'Moto E22', 'Moto E32', 'Moto Edge 20',
  ],
  Xiaomi: [
    'Redmi Note 8', 'Redmi Note 9', 'Redmi Note 10', 'Redmi Note 11', 'Redmi Note 12', 'Redmi Note 13', 'Redmi 9',
    'Redmi 9A', 'Redmi 9C', 'Redmi 10', 'Redmi 12', 'Redmi 12C', 'Redmi 13C', 'Poco X3', 'Poco X4 Pro', 'Poco X5',
    'Poco M3', 'Poco M4 Pro', 'Mi 11 Lite',
  ],
};

const PARTS = [
  { code: 'TELA', name: 'Tela Frontal', category: 'Telas', cost: [60, 420], variants: ['Incell', 'OLED', 'Original'] },
  { code: 'BAT', name: 'Bateria', category: 'Baterias', cost: [35, 160] },
  { code: 'CON', name: 'Conector de Carga (Flex)', category: 'Conectores', cost: [12, 70] },
  { code: 'CAM', name: 'Câmera Traseira', category: 'Câmeras', cost: [40, 320] },
  { code: 'ALT', name: 'Alto-falante', category: 'Áudio', cost: [8, 45] },
  { code: 'TAMPA', name: 'Tampa Traseira', category: 'Carcaças', cost: [15, 120] },
  { code: 'FLEX', name: 'Flex Botão Power/Volume', category: 'Flex', cost: [10, 55] },
  { code: 'LENTE', name: 'Lente da Câmera', category: 'Câmeras', cost: [6, 30] },
  { code: 'PEL', name: 'Película 3D', category: 'Películas', cost: [3, 12] },
  { code: 'CAPA', name: 'Capinha Silicone', category: 'Capinhas', cost: [5, 18], variants: ['Preta', 'Transparente'] },
] as const;

const ACCESSORIES = [
  ['CARR-20W-USBC', 'Carregador Turbo 20W USB-C', 'Carregadores', 'Genérico', 25],
  ['CARR-25W-SAM', 'Carregador Samsung 25W Super Fast', 'Carregadores', 'Samsung', 55],
  ['CARR-33W-XIA', 'Carregador Xiaomi 33W', 'Carregadores', 'Xiaomi', 48],
  ['CARR-VEIC-DUO', 'Carregador Veicular Duplo USB', 'Carregadores', 'Genérico', 14],
  ['CABO-LIGHT-1M', 'Cabo Lightning 1m', 'Cabos', 'Genérico', 9],
  ['CABO-LIGHT-2M', 'Cabo Lightning 2m', 'Cabos', 'Genérico', 13],
  ['CABO-USBC-1M', 'Cabo USB-C 1m', 'Cabos', 'Genérico', 8],
  ['CABO-USBC-2M', 'Cabo USB-C 2m', 'Cabos', 'Genérico', 11],
  ['CABO-C-C-1M', 'Cabo USB-C para USB-C 1m', 'Cabos', 'Genérico', 12],
  ['CABO-MICRO-1M', 'Cabo Micro USB 1m', 'Cabos', 'Genérico', 6],
  ['FONE-P2-BAS', 'Fone de Ouvido P2 Básico', 'Áudio', 'Genérico', 7],
  ['FONE-BT-TWS', 'Fone Bluetooth TWS', 'Áudio', 'Genérico', 38],
  ['SUP-VEIC-MAG', 'Suporte Veicular Magnético', 'Acessórios', 'Genérico', 12],
  ['PB-10000', 'Power Bank 10.000mAh', 'Carregadores', 'Genérico', 52],
  ['PB-20000', 'Power Bank 20.000mAh', 'Carregadores', 'Genérico', 85],
  ['CART-SD-64', 'Cartão de Memória 64GB', 'Armazenamento', 'SanDisk', 32],
  ['CART-SD-128', 'Cartão de Memória 128GB', 'Armazenamento', 'SanDisk', 55],
  ['PEN-32', 'Pen Drive 32GB', 'Armazenamento', 'SanDisk', 22],
] as const;

const header = [
  'sku', 'codigo_barras', 'nome', 'categoria', 'marca', 'modelos_compativeis',
  'preco_custo', 'preco_venda', 'estoque_minimo', 'estoque_LJ01', 'estoque_LJ02', 'estoque_LJ03',
];

const brl = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const slug = (model: string) =>
  model
    .toUpperCase()
    .replace(/GALAXY |REDMI NOTE /g, (m) => (m.startsWith('G') ? '' : 'RN'))
    .replace(/[^A-Z0-9]+/g, '');

const rows: string[][] = [];
let seq = 1;
const barcodeFor = () => (rand() < 0.8 ? ean13(`789${String(1000000 + seq++).padStart(9, '0')}`) : '');
const stockCells = (popular: boolean) =>
  [0, 1, 2].map(() => (rand() < 0.12 ? '' : String(between(0, popular ? 25 : 8))));

for (const [brand, models] of Object.entries(MODELS)) {
  for (const model of models) {
    for (const part of PARTS) {
      const variants = 'variants' in part ? part.variants : [null];
      for (const variant of variants) {
        const costCents = between(part.cost[0], part.cost[1]) * 100 + pick([0, 50, 90]);
        const priceCents = Math.round((costCents * (1.8 + rand() * 0.9)) / 100) * 100 - 10;
        rows.push([
          `${part.code}-${slug(model)}${variant ? `-${variant.slice(0, 3).toUpperCase()}` : ''}`,
          barcodeFor(),
          `${part.name} ${model}${variant ? ` ${variant}` : ''}`,
          part.category,
          brand,
          model,
          brl(costCents),
          brl(priceCents),
          String(part.code === 'PEL' || part.code === 'CAPA' ? 5 : between(1, 3)),
          ...stockCells(part.code === 'PEL' || part.code === 'CAPA'),
        ]);
      }
    }
  }
}
for (const [sku, name, category, brand, cost] of ACCESSORIES) {
  const costCents = cost * 100;
  rows.push([sku, barcodeFor(), name, category, brand, '', brl(costCents), brl(costCents * 2 + 90), '5', ...stockCells(true)]);
}

const csv = [header, ...rows].map((r) => r.join(';')).join('\r\n');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../../../samples/inventario-exemplo.csv');
writeFileSync(out, `﻿${csv}\r\n`, 'utf8');
console.log(`✔ ${rows.length} produtos gravados em ${path.relative(process.cwd(), out)}`);
