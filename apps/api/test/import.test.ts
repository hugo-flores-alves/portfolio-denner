import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseMoneyToCents } from '@erp/shared';
import { db } from '../src/db/client';
import { normalizeHeader } from '../src/modules/imports/column-mapper';
import { decodeText, detectDelimiter } from '../src/modules/imports/file-parser';
import { isValidGtin } from '../src/modules/imports/row-parser';
import { api, bearer, resetDatabase, stockOf, type Fixture } from './helpers';

// ─── Unidades puras ───────────────────────────────────────────────────────────

describe('Parsers da importação (unidade)', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['R$ 12,50', 1250],
    ['1234.56', 123456],
    ['1.500', 150000],
    ['1.234.567', 123456700],
    ['12', 1200],
    ['0,9', 90],
    [12.345, 1235],
    ['abc', null],
    ['12,', null],
    ['', null],
  ])('parseMoneyToCents(%j) = %j', (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected);
  });

  it('detecta separador fora de aspas', () => {
    expect(detectDelimiter('sku;nome;preco\n1;2;3')).toBe(';');
    expect(detectDelimiter('sku,nome,preco')).toBe(',');
    expect(detectDelimiter('"a;b",c,d')).toBe(',');
    expect(detectDelimiter('sku\tnome')).toBe('\t');
  });

  it('decodifica UTF-8 e cai para Windows-1252 quando necessário', () => {
    expect(decodeText(Buffer.from('Película', 'utf8'))).toEqual({ text: 'Película', encoding: 'utf-8' });
    expect(decodeText(Buffer.from([0x50, 0x65, 0x6c, 0xed, 0x63, 0x75, 0x6c, 0x61]))).toEqual({
      text: 'Película',
      encoding: 'windows-1252',
    });
  });

  it('normaliza cabeçalhos', () => {
    expect(normalizeHeader('  Preço de Venda (R$) ')).toBe('preco_de_venda_r');
    expect(normalizeHeader('Código de Barras')).toBe('codigo_de_barras');
    expect(normalizeHeader('Qtd - Loja Centro')).toBe('qtd_loja_centro');
  });

  it('valida dígito verificador GTIN', () => {
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('96385074')).toBe(true);
  });
});

// ─── Integração ───────────────────────────────────────────────────────────────

let fx: Fixture;
let admin: string;

beforeAll(async () => {
  fx = await resetDatabase();
  admin = fx.tokens.admin!;
});

function csv(rows: (string | number)[][], delimiter = ';') {
  return Buffer.from(`﻿${rows.map((r) => r.join(delimiter)).join('\r\n')}\r\n`, 'utf8');
}

function upload(file: Buffer, name: string, fields: Record<string, string> = {}, token = admin) {
  const req = api().post('/api/imports/products').set(bearer(token));
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  return req.attach('file', file, name);
}

async function count(table: 'products' | 'stock_movements' | 'stock_levels' | 'import_jobs') {
  const res = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  return (res.rows[0] as { n: number }).n;
}

const HEADER = ['sku', 'codigo_barras', 'nome', 'categoria', 'preco_custo', 'preco_venda', 'estoque_minimo', 'estoque_LJ01', 'estoque_LJ02', 'estoque_LJ03'];

function ean13(n: number) {
  const body = `789${String(n).padStart(9, '0')}`;
  const sum = body.split('').reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

describe('Importação em massa — setup inicial com 1.500 peças', () => {
  const TOTAL = 1500;
  const rows = Array.from({ length: TOTAL }, (_, i) => [
    `PECA-${String(i + 1).padStart(5, '0')}`,
    ean13(i + 1),
    `Peça de teste número ${i + 1}`,
    i % 2 ? 'Telas' : 'Baterias',
    '10,00',
    '25,90',
    '2',
    i % 3, // LJ01
    i % 5, // LJ02
    i % 7 === 0 ? '' : 4, // LJ03 (vazio = não lança saldo)
  ]);
  const file = csv([HEADER, ...rows]);

  it('dry-run valida tudo e não grava nada', async () => {
    const res = await upload(file, 'inventario.csv', { dryRun: 'true' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, totalRows: TOTAL, createdCount: TOTAL, errorCount: 0, jobId: null });
    expect(res.body.preview).toHaveLength(20);
    expect(await count('products')).toBe(0);
  });

  it('importa em lote, distribuindo o saldo inicial por loja', async () => {
    const started = Date.now();
    const res = await upload(file, 'inventario.csv');
    const elapsed = Date.now() - started;
    expect(res.status, JSON.stringify(res.body.errors?.slice(0, 3))).toBe(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', createdCount: TOTAL, updatedCount: 0, errorCount: 0 });
    expect(elapsed).toBeLessThan(15_000);

    expect(await count('products')).toBe(TOTAL);
    const expectedLevels = TOTAL * 2 + rows.filter((r) => r[9] !== '').length;
    expect(res.body.stockEntries).toBe(expectedLevels);
    expect(await count('stock_levels')).toBe(expectedLevels);

    const totals = await db.execute(sql`
      select s.code, sum(sl.quantity)::int as qty from stock_levels sl join stores s on s.id = sl.store_id group by s.code order by s.code`);
    const expected = (col: number) => rows.reduce((acc, r) => acc + (r[col] === '' ? 0 : Number(r[col])), 0);
    expect(totals.rows).toEqual([
      { code: 'LJ01', qty: expected(7) },
      { code: 'LJ02', qty: expected(8) },
      { code: 'LJ03', qty: expected(9) },
    ]);
    // Movimento só para saldo diferente de zero
    const nonZero = rows.reduce((acc, r) => acc + [7, 8, 9].filter((c) => r[c] !== '' && Number(r[c]) > 0).length, 0);
    expect(await count('stock_movements')).toBe(nonZero);
  });

  it('reimportar a mesma planilha (UPSERT + SET) é idempotente', async () => {
    const movementsBefore = await count('stock_movements');
    const res = await upload(file, 'inventario.csv');
    expect(res.body).toMatchObject({ createdCount: 0, updatedCount: TOTAL, errorCount: 0 });
    expect(await count('products')).toBe(TOTAL);
    expect(await count('stock_movements')).toBe(movementsBefore);
  });

  it('registra o histórico de importações', async () => {
    const res = await api().get('/api/imports').set(bearer(admin));
    expect(res.body.total).toBe(2);
    expect(res.body.data[0]).toMatchObject({ fileName: 'inventario.csv', status: 'COMPLETED' });
  });
});

describe('Validação de SKU e código de barras repetidos', () => {
  it('rejeita repetidos no arquivo e conflito com o banco, importando o restante', async () => {
    const res = await upload(
      csv([
        HEADER,
        ['DUP-1', '', 'Duplicado A', '', '1', '2', '', '1', '', ''],
        ['dup-1', '', 'Duplicado B (minúsculo)', '', '1', '2', '', '1', '', ''],
        ['BAR-1', ean13(900001), 'Barras A', '', '1', '2', '', '1', '', ''],
        ['BAR-2', ean13(900001), 'Barras B', '', '1', '2', '', '1', '', ''],
        ['CONFLITO', ean13(1), 'Usa barras de PECA-00001', '', '1', '2', '', '1', '', ''],
        ['OK-1', '', 'Produto válido', '', '1', '2', '', '1', '', ''],
      ]),
      'dups.csv',
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ createdCount: 1, errorCount: 5 });
    const messages = res.body.errors.map((e: { row: number; message: string }) => `${e.row}:${e.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        '2:SKU repetido no arquivo (linhas 2, 3)',
        '3:SKU repetido no arquivo (linhas 2, 3)',
        '4:Código de barras repetido no arquivo (linhas 4, 5)',
        '6:Código de barras já cadastrado no produto SKU PECA-00001',
      ]),
    );
  });

  it('modo "somente novos" ignora SKUs existentes sem alterá-los', async () => {
    const res = await upload(
      csv([HEADER, ['PECA-00001', '', 'Nome alterado', '', '', '999,00', '', '50', '', ''], ['NOVO-XYZ', '', 'Novo', '', '', '', '', '', '', '']]),
      'novos.csv',
      { mode: 'CREATE_ONLY' },
    );
    expect(res.body).toMatchObject({ createdCount: 1, skippedCount: 1, updatedCount: 0 });
    const product = await db.execute(sql`select name, price_cents from products where sku = 'PECA-00001'`);
    expect(product.rows[0]).toEqual({ name: 'Peça de teste número 1', price_cents: 2590 });
  });

  it('UPSERT atualiza só as células preenchidas; ADD soma ao saldo', async () => {
    const [before] = (await db.execute(sql`select id from products where sku = 'PECA-00002'`)).rows as { id: string }[];
    const lj01Before = await stockOf(before!.id, fx.stores.LJ01);
    const res = await upload(
      csv([['sku', 'nome', 'preco_venda', 'estoque_LJ01'], ['PECA-00002', 'Peça renomeada', '', '10']]),
      'entrada.csv',
      { stockMode: 'ADD' },
    );
    expect(res.body.updatedCount).toBe(1);
    const after = await db.execute(sql`select name, price_cents, cost_cents, barcode from products where sku = 'PECA-00002'`);
    expect(after.rows[0]).toEqual({ name: 'Peça renomeada', price_cents: 2590, cost_cents: 1000, barcode: ean13(2) });
    expect(await stockOf(before!.id, fx.stores.LJ01)).toBe(lj01Before + 10);
  });
});

describe('Formatos e opções', () => {
  it('XLSX: preços numéricos e códigos de barras numéricos preservados', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Planilha1');
    ws.addRow(['SKU', 'EAN', 'Nome do Produto', 'Preço', 'Custo', 'Qtd LJ02']);
    ws.addRow(['XL-1', 7891234567895, 'Via Excel', 12.345, 5, 3]);
    ws.addRow(['XL-2', { formula: '"78912"&"34567888"', result: '7891234567888' }, 'Com fórmula', 10, 4, 1]);
    const res = await upload(Buffer.from(await wb.xlsx.writeBuffer()), 'planilha.xlsx');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.fileType).toBe('xlsx');
    const rows = await db.execute(sql`select sku, barcode, price_cents from products where sku like 'XL-%' order by sku`);
    expect(rows.rows).toEqual([
      { sku: 'XL-1', barcode: '7891234567895', price_cents: 1235 },
      { sku: 'XL-2', barcode: '7891234567888', price_cents: 1000 },
    ]);
  });

  it('coluna única "quantidade" exige loja padrão', async () => {
    const file = csv([['sku', 'nome', 'quantidade'], ['UNI-1', 'Unica', '7']]);
    const without = await upload(file, 'unica.csv');
    expect(without.body.errorCount).toBe(1);
    const withStore = await upload(file, 'unica.csv', { defaultStoreId: fx.stores.LJ03 });
    expect(withStore.body.createdCount).toBe(1);
    const [p] = (await db.execute(sql`select id from products where sku = 'UNI-1'`)).rows as { id: string }[];
    expect(await stockOf(p!.id, fx.stores.LJ03)).toBe(7);
  });

  it('modo estrito: qualquer erro cancela tudo (422)', async () => {
    const before = await count('products');
    const res = await upload(
      csv([['sku', 'nome', 'preco_venda'], ['STRICT-1', 'Válido', '10'], ['STRICT-2', 'Inválido', 'dez reais']]),
      'estrito.csv',
      { strict: 'true' },
    );
    expect(res.status).toBe(422);
    expect(res.body.status).toBe('FAILED');
    expect(await count('products')).toBe(before);
  });

  it('erros estruturais: coluna obrigatória, loja inexistente, formato', async () => {
    const noSku = await upload(csv([['nome', 'preco'], ['A', '1']]), 'x.csv');
    expect(noSku.status).toBe(400);
    expect(noSku.body.error.message).toContain('SKU');
    const badStore = await upload(csv([['sku', 'nome', 'estoque_LJ99'], ['A1', 'Nome', '1']]), 'x.csv');
    expect(badStore.status).toBe(400);
    expect(badStore.body.error.message).toContain('LJ99');
    const xls = await upload(Buffer.from('x'), 'antigo.xls');
    expect(xls.status).toBe(400);
  });

  it('modelo de planilha traz uma coluna de estoque por loja ativa', async () => {
    const res = await api().get('/api/imports/products/template?format=csv').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.text.split('\r\n')[0]).toContain('estoque_LJ01;estoque_LJ02;estoque_LJ03');
  });
});

describe('Permissões da importação', () => {
  it('técnico não importa', async () => {
    const res = await upload(csv([['sku', 'nome'], ['T1', 'Teste']]), 't.csv', {}, fx.tokens['tecnico.centro']!);
    expect(res.status).toBe(403);
  });

  it('usuário de loja só lança estoque na própria loja', async () => {
    const role = await api()
      .post('/api/roles')
      .set(bearer(admin))
      .send({ name: 'Estoquista', scope: 'STORE', permissions: ['imports.execute', 'imports.view'] });
    await api()
      .post('/api/users')
      .set(bearer(admin))
      .send({ name: 'Estoquista', email: 'estoque@erp.local', password: 'Senha@123', roleId: role.body.id, storeId: fx.stores.LJ01 });
    const login = await api().post('/api/auth/login').send({ email: 'estoque@erp.local', password: 'Senha@123' });
    const token = login.body.token;

    const other = await upload(csv([['sku', 'nome', 'estoque_LJ02'], ['E1', 'Teste', '1']]), 'e.csv', {}, token);
    expect(other.status).toBe(403);
    const own = await upload(csv([['sku', 'nome', 'estoque_LJ01'], ['E1', 'Teste', '1']]), 'e.csv', {}, token);
    expect(own.status).toBe(201);
  });
});
