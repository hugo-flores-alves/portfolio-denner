import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, createProduct, resetDatabase, stockOf, type Fixture } from './helpers';

let fx: Fixture;
let admin: string;
let charger: { id: string; priceCents: number };
let cable: { id: string; priceCents: number };

beforeAll(async () => {
  fx = await resetDatabase();
  admin = fx.tokens.admin!;
  charger = await createProduct(admin, { sku: 'CARR-20W', priceCents: 7990, costCents: 2500, minStock: 3 }, { [fx.stores.LJ01]: 10 });
  cable = await createProduct(admin, { sku: 'CABO-C', priceCents: 2990, costCents: 800 }, { [fx.stores.LJ01]: 20, [fx.stores.LJ02]: 2 });
});

describe('Ajustes de estoque', () => {
  it('SET define o saldo e ADD soma/subtrai, sempre com kardex', async () => {
    const set = await api()
      .post('/api/stock/adjustments')
      .set(bearer(admin))
      .send({ storeId: fx.stores.LJ03, reason: 'Inventário', items: [{ productId: charger.id, mode: 'SET', quantity: 7 }] });
    expect(set.status).toBe(201);
    const add = await api()
      .post('/api/stock/adjustments')
      .set(bearer(admin))
      .send({ storeId: fx.stores.LJ03, reason: 'Avaria', items: [{ productId: charger.id, mode: 'ADD', quantity: -2 }] });
    expect(add.body.applied[0]).toMatchObject({ delta: -2, balanceAfter: 5 });

    const moves = await api()
      .get(`/api/stock/movements?storeId=${fx.stores.LJ03}&productId=${charger.id}`)
      .set(bearer(admin));
    expect(moves.body.data.map((m: { quantity: number }) => m.quantity)).toEqual([-2, 7]);
  });

  it('não permite saldo negativo', async () => {
    const res = await api()
      .post('/api/stock/adjustments')
      .set(bearer(admin))
      .send({ storeId: fx.stores.LJ03, reason: 'Erro', items: [{ productId: charger.id, mode: 'ADD', quantity: -99 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('gerente só ajusta a própria loja', async () => {
    const res = await api()
      .post('/api/stock/adjustments')
      .set(bearer(fx.tokens['gerente.centro']!))
      .send({ storeId: fx.stores.LJ02, reason: 'Teste', items: [{ productId: charger.id, mode: 'SET', quantity: 1 }] });
    expect(res.status).toBe(403);
  });
});

describe('Transferência entre lojas', () => {
  let transferId: string;

  it('envio retira da origem e deixa em trânsito', async () => {
    const res = await api()
      .post('/api/stock-transfers')
      .set(bearer(fx.tokens['gerente.centro']!))
      .send({ toStoreId: fx.stores.LJ02, items: [{ productId: charger.id, quantity: 4 }], notes: 'Motoboy' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'IN_TRANSIT', fromStoreId: fx.stores.LJ01, itemCount: 4 });
    expect(await stockOf(charger.id, fx.stores.LJ01)).toBe(6);
    expect(await stockOf(charger.id, fx.stores.LJ02)).toBe(0);
    transferId = res.body.id;
  });

  it('origem não pode receber; destino recebe e o saldo entra', async () => {
    const fromOrigin = await api().post(`/api/stock-transfers/${transferId}/receive`).set(bearer(fx.tokens['gerente.centro']!));
    expect(fromOrigin.status).toBe(403);

    const received = await api()
      .post(`/api/stock-transfers/${transferId}/receive`)
      .set(bearer(fx.tokens['gerente.shopping']!));
    expect(received.status).toBe(200);
    expect(received.body.status).toBe('RECEIVED');
    expect(await stockOf(charger.id, fx.stores.LJ02)).toBe(4);

    const again = await api().post(`/api/stock-transfers/${transferId}/receive`).set(bearer(fx.tokens['gerente.shopping']!));
    expect(again.status).toBe(409);
  });

  it('cancelamento devolve à origem; loja alheia não enxerga', async () => {
    const res = await api()
      .post('/api/stock-transfers')
      .set(bearer(fx.tokens['gerente.centro']!))
      .send({ toStoreId: fx.stores.LJ03, items: [{ productId: cable.id, quantity: 5 }] });
    expect(await stockOf(cable.id, fx.stores.LJ01)).toBe(15);

    const outsider = await api().get(`/api/stock-transfers/${res.body.id}`).set(bearer(fx.tokens['gerente.shopping']!));
    expect(outsider.status).toBe(404);

    const cancel = await api()
      .post(`/api/stock-transfers/${res.body.id}/cancel`)
      .set(bearer(fx.tokens['gerente.centro']!))
      .send({ reason: 'Loja destino fechada' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect(await stockOf(cable.id, fx.stores.LJ01)).toBe(20);
    expect(await stockOf(cable.id, fx.stores.LJ03)).toBe(0);
  });

  it('não envia mais do que o disponível nem para a própria loja', async () => {
    const tooMuch = await api()
      .post('/api/stock-transfers')
      .set(bearer(fx.tokens['gerente.centro']!))
      .send({ toStoreId: fx.stores.LJ02, items: [{ productId: cable.id, quantity: 999 }] });
    expect(tooMuch.status).toBe(409);
    const same = await api()
      .post('/api/stock-transfers')
      .set(bearer(fx.tokens['gerente.centro']!))
      .send({ toStoreId: fx.stores.LJ01, items: [{ productId: cable.id, quantity: 1 }] });
    expect(same.status).toBe(400);
  });
});

describe('PDV — venda rápida de balcão', () => {
  let saleId: string;

  it('vende, calcula troco em dinheiro e baixa o estoque', async () => {
    const res = await api()
      .post('/api/sales')
      .set(bearer(fx.tokens['vendedor.centro']!))
      .send({
        items: [
          { productId: charger.id, quantity: 1 },
          { productId: cable.id, quantity: 2 },
        ],
        discountCents: 970,
        payments: [
          { method: 'PIX', amountCents: 10000 },
          { method: 'CASH', amountCents: 5000 },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const subtotal = 7990 + 2 * 2990;
    expect(res.body).toMatchObject({
      number: 1,
      subtotalCents: subtotal,
      totalCents: subtotal - 970,
      paidCents: 15000,
      changeCents: 15000 - (subtotal - 970),
      storeId: fx.stores.LJ01,
    });
    expect(await stockOf(charger.id, fx.stores.LJ01)).toBe(5);
    expect(await stockOf(cable.id, fx.stores.LJ01)).toBe(18);
    saleId = res.body.id;
  });

  it('recusa pagamento insuficiente e troco em cartão', async () => {
    const short = await api()
      .post('/api/sales')
      .set(bearer(fx.tokens['vendedor.centro']!))
      .send({ items: [{ productId: cable.id, quantity: 1 }], payments: [{ method: 'PIX', amountCents: 100 }] });
    expect(short.status).toBe(400);
    const cardChange = await api()
      .post('/api/sales')
      .set(bearer(fx.tokens['vendedor.centro']!))
      .send({ items: [{ productId: cable.id, quantity: 1 }], payments: [{ method: 'CREDIT_CARD', amountCents: 5000 }] });
    expect(cardChange.status).toBe(400);
  });

  it('não vende sem saldo na loja do vendedor', async () => {
    const res = await api()
      .post('/api/sales')
      .set(bearer(fx.tokens['vendedor.shopping']!))
      .send({ items: [{ productId: cable.id, quantity: 3 }], payments: [{ method: 'PIX', amountCents: 8970 }] });
    expect(res.status).toBe(409);
    expect(await stockOf(cable.id, fx.stores.LJ02)).toBe(2);
  });

  it('cancelamento exige permissão, estorna o estoque e não pode repetir', async () => {
    const seller = await api().post(`/api/sales/${saleId}/cancel`).set(bearer(fx.tokens['vendedor.centro']!)).send({ reason: 'Desistiu' });
    expect(seller.status).toBe(403);
    const manager = await api().post(`/api/sales/${saleId}/cancel`).set(bearer(fx.tokens['gerente.centro']!)).send({ reason: 'Desistiu' });
    expect(manager.status).toBe(200);
    expect(manager.body.status).toBe('CANCELLED');
    expect(await stockOf(charger.id, fx.stores.LJ01)).toBe(6);
    expect(await stockOf(cable.id, fx.stores.LJ01)).toBe(20);
    const again = await api().post(`/api/sales/${saleId}/cancel`).set(bearer(fx.tokens['gerente.centro']!)).send({ reason: 'x'.repeat(5) });
    expect(again.status).toBe(409);
  });
});

describe('Dashboard', () => {
  it('consolida a rede e quebra por loja para o administrador', async () => {
    await api()
      .post('/api/sales')
      .set(bearer(fx.tokens['vendedor.shopping']!))
      .send({ items: [{ productId: charger.id, quantity: 1 }], payments: [{ method: 'CASH', amountCents: 10000 }] });
    await api()
      .post('/api/sales')
      .set(bearer(fx.tokens['vendedor.centro']!))
      .send({ items: [{ productId: cable.id, quantity: 1 }], payments: [{ method: 'DEBIT_CARD', amountCents: 2990 }] });

    const res = await api().get('/api/dashboard/summary').set(bearer(admin));
    expect(res.status).toBe(200);
    // Venda cancelada não entra
    expect(res.body.totals).toMatchObject({ salesCount: 2, salesCents: 7990 + 2990 });
    expect(res.body.totals.grossProfitCents).toBe(7990 + 2990 - 2500 - 800);
    const lj02 = res.body.byStore.find((s: { code: string }) => s.code === 'LJ02');
    expect(lj02.salesCents).toBe(7990);
    // Dinheiro líquido = recebido - troco
    const cash = res.body.paymentMethods.find((p: { method: string }) => p.method === 'CASH');
    expect(cash.amountCents).toBe(7990);
    expect(res.body.daily.length).toBeGreaterThan(0);
  });

  it('filtra por loja e força o escopo do gerente', async () => {
    const filtered = await api().get(`/api/dashboard/summary?storeId=${fx.stores.LJ01}`).set(bearer(admin));
    expect(filtered.body.totals.salesCents).toBe(2990);
    expect(filtered.body.byStore).toBeNull();

    const manager = await api().get('/api/dashboard/summary').set(bearer(fx.tokens['gerente.shopping']!));
    expect(manager.body.storeId).toBe(fx.stores.LJ02);
    expect(manager.body.totals.salesCents).toBe(7990);
    const forbidden = await api()
      .get(`/api/dashboard/summary?storeId=${fx.stores.LJ01}`)
      .set(bearer(fx.tokens['gerente.shopping']!));
    expect(forbidden.status).toBe(403);
  });

  it('alerta de estoque mínimo por loja', async () => {
    const low = await api().get(`/api/products?storeId=${fx.stores.LJ02}&lowStock=true`).set(bearer(admin));
    // Carregador: mínimo 3, LJ02 tem 3 após a venda
    expect(low.body.data.map((p: { sku: string }) => p.sku)).toContain('CARR-20W');
  });
});

describe('Visão consolidada (sem filtro de loja)', () => {
  it('soma o saldo das lojas e aplica o alerta de mínimo em qualquer loja', async () => {
    const ok = await createProduct(admin, { sku: 'MIN-OK', minStock: 2 }, { [fx.stores.LJ01]: 5, [fx.stores.LJ02]: 5, [fx.stores.LJ03]: 5 });
    const low = await createProduct(admin, { sku: 'MIN-LOW', minStock: 2 }, { [fx.stores.LJ01]: 5, [fx.stores.LJ02]: 5, [fx.stores.LJ03]: 1 });

    const all = await api().get('/api/products?search=MIN-').set(bearer(admin));
    const byId = Object.fromEntries(all.body.data.map((p: { id: string; quantity: number }) => [p.id, p.quantity]));
    expect(byId[ok.id]).toBe(15);
    expect(byId[low.id]).toBe(11);

    const lowOnly = await api().get('/api/products?search=MIN-&lowStock=true').set(bearer(admin));
    expect(lowOnly.body.data.map((p: { sku: string }) => p.sku)).toEqual(['MIN-LOW']);
  });

  it('lista vendas com a quantidade de itens de cada uma', async () => {
    const res = await api().get('/api/sales').set(bearer(admin));
    for (const sale of res.body.data) {
      const detail = await api().get(`/api/sales/${sale.id}`).set(bearer(admin));
      const units = detail.body.items.reduce((acc: number, i: { quantity: number }) => acc + i.quantity, 0);
      expect(sale.itemCount).toBe(units);
    }
  });
});
