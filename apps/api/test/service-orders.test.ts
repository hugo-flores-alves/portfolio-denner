import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import { api, bearer, createProduct, customer, resetDatabase, stockOf, type Fixture } from './helpers';

let fx: Fixture;
let admin: string;
let tech: string;
let screen: { id: string };
let battery: { id: string };
let customerId: string;

const setStatus = (token: string, id: string, status: string, note?: string) =>
  api().post(`/api/service-orders/${id}/status`).set(bearer(token)).send({ status, note });

beforeAll(async () => {
  fx = await resetDatabase();
  admin = fx.tokens.admin!;
  tech = fx.tokens['tecnico.centro']!;
  screen = await createProduct(admin, { sku: 'TELA-IP11', priceCents: 28990, costCents: 12000 }, { [fx.stores.LJ01]: 3, [fx.stores.LJ02]: 10 });
  battery = await createProduct(admin, { sku: 'BAT-IP11', priceCents: 14990, costCents: 5000 }, { [fx.stores.LJ01]: 5 });
  customerId = (await customer(admin)).id;
});

describe('Orçamento / OS', () => {
  let orderId: string;

  it('cria orçamento com peças, mão de obra e desconto', async () => {
    const res = await api()
      .post('/api/service-orders')
      .set(bearer(tech))
      .send({
        customerId,
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 11',
        deviceSerial: '356789101112131',
        reportedDefect: 'Tela quebrada e bateria viciada',
        laborCents: 10000,
        discountCents: 1990,
        items: [
          { productId: screen.id, quantity: 1 },
          { productId: battery.id, quantity: 1, unitPriceCents: 12990 },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      status: 'AWAITING_APPROVAL',
      number: 1,
      partsCents: 28990 + 12990,
      laborCents: 10000,
      totalCents: 28990 + 12990 + 10000 - 1990,
      stockDeducted: false,
    });
    expect(res.body.items).toHaveLength(2);
    expect(res.body.history[0]).toMatchObject({ fromStatus: null, toStatus: 'AWAITING_APPROVAL' });
    orderId = res.body.id;
  });

  it('numera OS sequencialmente por loja', async () => {
    const second = await api()
      .post('/api/service-orders')
      .set(bearer(tech))
      .send({ customerId, deviceModel: 'Moto G8', reportedDefect: 'Não carrega' });
    const otherStore = await api()
      .post('/api/service-orders')
      .set(bearer(admin))
      .send({ storeId: fx.stores.LJ02, customerId, deviceModel: 'Moto G8', reportedDefect: 'Não carrega' });
    expect(second.body.number).toBe(2);
    expect(otherStore.body.number).toBe(1);
  });

  it('aprovar NÃO mexe no estoque', async () => {
    const res = await setStatus(tech, orderId, 'IN_PROGRESS', 'Cliente aprovou por WhatsApp');
    expect(res.status).toBe(200);
    expect(res.body.approvedAt).toBeTruthy();
    expect(await stockOf(screen.id, fx.stores.LJ01)).toBe(3);
  });

  it('finalizar dá baixa automática das peças na loja da OS', async () => {
    const res = await setStatus(tech, orderId, 'COMPLETED');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'COMPLETED', stockDeducted: true });
    expect(await stockOf(screen.id, fx.stores.LJ01)).toBe(2);
    expect(await stockOf(battery.id, fx.stores.LJ01)).toBe(4);
    // Estoque de outra loja intacto
    expect(await stockOf(screen.id, fx.stores.LJ02)).toBe(10);

    const moves = await db.execute(
      sql`select type, quantity, balance_after from stock_movements where reference_id = ${orderId} order by type`,
    );
    expect(moves.rows).toHaveLength(2);
    expect(moves.rows.every((m) => (m as { type: string }).type === 'SERVICE_ORDER')).toBe(true);
  });

  it('bloqueia alteração de peças/valores após a conclusão', async () => {
    const res = await api().patch(`/api/service-orders/${orderId}`).set(bearer(tech)).send({ laborCents: 1 });
    expect(res.status).toBe(422);
    const notes = await api().patch(`/api/service-orders/${orderId}`).set(bearer(tech)).send({ diagnosis: 'Troca OK' });
    expect(notes.status).toBe(200);
  });

  it('reabrir estorna as peças e finalizar novamente baixa de novo (idempotente)', async () => {
    expect((await setStatus(tech, orderId, 'IN_PROGRESS', 'Cliente voltou com defeito')).status).toBe(200);
    expect(await stockOf(screen.id, fx.stores.LJ01)).toBe(3);
    expect(await stockOf(battery.id, fx.stores.LJ01)).toBe(5);

    expect((await setStatus(tech, orderId, 'COMPLETED')).status).toBe(200);
    expect(await stockOf(screen.id, fx.stores.LJ01)).toBe(2);
  });

  it('entregar mantém a baixa e encerra a OS', async () => {
    const res = await setStatus(tech, orderId, 'DELIVERED');
    expect(res.body).toMatchObject({ status: 'DELIVERED', stockDeducted: true });
    expect(res.body.deliveredAt).toBeTruthy();
    expect(await stockOf(screen.id, fx.stores.LJ01)).toBe(2);
    expect((await setStatus(tech, orderId, 'IN_PROGRESS')).status).toBe(422);
    expect(res.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      'AWAITING_APPROVAL',
      'IN_PROGRESS',
      'COMPLETED',
      'IN_PROGRESS',
      'COMPLETED',
      'DELIVERED',
    ]);
  });

  it('recusa transições inválidas', async () => {
    const res = await api()
      .post('/api/service-orders')
      .set(bearer(tech))
      .send({ customerId, deviceModel: 'iPhone 11', reportedDefect: 'Sem som' });
    expect((await setStatus(tech, res.body.id, 'DELIVERED')).status).toBe(422);
    expect((await setStatus(tech, res.body.id, 'COMPLETED')).status).toBe(422);
  });

  it('sem saldo: não conclui, lista as peças faltantes e não altera nada', async () => {
    const res = await api()
      .post('/api/service-orders')
      .set(bearer(tech))
      .send({ customerId, deviceModel: 'iPhone 11', reportedDefect: 'Tela', items: [{ productId: screen.id, quantity: 5 }] });
    await setStatus(tech, res.body.id, 'IN_PROGRESS');
    const fail = await setStatus(tech, res.body.id, 'COMPLETED');
    expect(fail.status).toBe(409);
    expect(fail.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(fail.body.error.details[0]).toMatchObject({ sku: 'TELA-IP11', available: 2, requested: 5 });

    const after = await api().get(`/api/service-orders/${res.body.id}`).set(bearer(tech));
    expect(after.body).toMatchObject({ status: 'IN_PROGRESS', stockDeducted: false });
    expect(await stockOf(screen.id, fx.stores.LJ01)).toBe(2);
  });

  it('cadastro rápido de cliente reaproveita CPF existente', async () => {
    const payload = {
      customer: { name: 'Maria Souza', document: '123.456.789-09', phone: '11 91234-5678' },
      deviceModel: 'Galaxy A12',
      reportedDefect: 'Bateria',
    };
    const a = await api().post('/api/service-orders').set(bearer(tech)).send(payload);
    const b = await api().post('/api/service-orders').set(bearer(tech)).send(payload);
    expect(a.status).toBe(201);
    expect(a.body.customer.document).toBe('12345678909');
    expect(b.body.customerId).toBe(a.body.customerId);
  });

  it('exclui apenas orçamentos que não movimentaram estoque', async () => {
    const draft = await api()
      .post('/api/service-orders')
      .set(bearer(admin))
      .send({ storeId: fx.stores.LJ01, customerId, deviceModel: 'Mi 9', reportedDefect: 'Teste' });
    expect((await api().delete(`/api/service-orders/${draft.body.id}`).set(bearer(admin))).status).toBe(204);
    expect((await api().delete(`/api/service-orders/${orderId}`).set(bearer(admin))).status).toBe(409);
    // Técnico não tem permissão de excluir
    const other = await api()
      .post('/api/service-orders')
      .set(bearer(tech))
      .send({ customerId, deviceModel: 'Mi 9', reportedDefect: 'Teste' });
    expect((await api().delete(`/api/service-orders/${other.body.id}`).set(bearer(tech))).status).toBe(403);
  });
});

describe('Concorrência', () => {
  it('duas OS disputando a última peça: exatamente uma conclui', async () => {
    const lastUnit = await createProduct(admin, { sku: 'CON-ULTIMO' }, { [fx.stores.LJ01]: 1 });
    const orders = await Promise.all(
      [1, 2].map(async () => {
        const res = await api()
          .post('/api/service-orders')
          .set(bearer(tech))
          .send({ customerId, deviceModel: 'Moto G8', reportedDefect: 'Conector', items: [{ productId: lastUnit.id, quantity: 1 }] });
        await setStatus(tech, res.body.id, 'IN_PROGRESS');
        return res.body.id as string;
      }),
    );
    const results = await Promise.all(orders.map((id) => setStatus(tech, id, 'COMPLETED')));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stockOf(lastUnit.id, fx.stores.LJ01)).toBe(0);
  });
});
