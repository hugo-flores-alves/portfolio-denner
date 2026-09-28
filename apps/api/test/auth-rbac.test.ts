import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '@erp/shared';
import { api, bearer, customer, resetDatabase, type Fixture } from './helpers';

let fx: Fixture;

beforeAll(async () => {
  fx = await resetDatabase();
});

describe('Autenticação', () => {
  it('rejeita credenciais inválidas sem revelar se o e-mail existe', async () => {
    const wrongPassword = await api().post('/api/auth/login').send({ email: 'admin@erp.local', password: 'errada' });
    const unknownEmail = await api().post('/api/auth/login').send({ email: 'nao@existe.com', password: 'errada' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('exige token nas rotas protegidas', async () => {
    expect((await api().get('/api/service-orders')).status).toBe(401);
    expect((await api().get('/api/service-orders').set(bearer('token.invalido'))).status).toBe(401);
  });

  it('/me retorna cargo, escopo, permissões efetivas e lojas acessíveis', async () => {
    const admin = await api().get('/api/auth/me').set(bearer(fx.tokens.admin!));
    expect(admin.body.hasGlobalAccess).toBe(true);
    expect(admin.body.permissions).toHaveLength(ALL_PERMISSIONS.length);
    expect(admin.body.stores).toHaveLength(3);

    const tech = await api().get('/api/auth/me').set(bearer(fx.tokens['tecnico.centro']!));
    expect(tech.body.hasGlobalAccess).toBe(false);
    expect(tech.body.permissions.sort()).toEqual(
      ['service_orders.change_status', 'service_orders.create', 'service_orders.edit', 'service_orders.view'].sort(),
    );
    expect(tech.body.stores.map((s: { code: string }) => s.code)).toEqual(['LJ01']);
  });
});

describe('RBAC — Técnico só acessa OS da própria loja', () => {
  it('é bloqueado fora da tela de OS', async () => {
    const token = fx.tokens['tecnico.centro']!;
    for (const path of ['/api/dashboard/summary', '/api/sales', '/api/users', '/api/roles', '/api/stock/movements']) {
      expect((await api().get(path).set(bearer(token))).status, path).toBe(403);
    }
    const create = await api().post('/api/products').set(bearer(token)).send({ sku: 'X', name: 'Produto X' });
    expect(create.status).toBe(403);
  });

  it('cria OS sempre na própria loja e não enxerga OS de outras lojas', async () => {
    const tech = fx.tokens['tecnico.centro']!;
    const own = await api()
      .post('/api/service-orders')
      .set(bearer(tech))
      .send({ customer: { name: 'Joana' }, deviceModel: 'iPhone 11', reportedDefect: 'Tela quebrada' });
    expect(own.status).toBe(201);
    expect(own.body.storeId).toBe(fx.stores.LJ01);

    const otherStore = await api()
      .post('/api/service-orders')
      .set(bearer(tech))
      .send({ storeId: fx.stores.LJ02, customer: { name: 'Joana' }, deviceModel: 'iPhone 11', reportedDefect: 'Tela' });
    expect(otherStore.status).toBe(403);

    const c = await customer(fx.tokens.admin!);
    const foreign = await api()
      .post('/api/service-orders')
      .set(bearer(fx.tokens.admin!))
      .send({ storeId: fx.stores.LJ02, customerId: c.id, deviceModel: 'Moto G8', reportedDefect: 'Não liga' });
    expect(foreign.status).toBe(201);

    // Registro de outra loja responde 404 (não revela existência)
    expect((await api().get(`/api/service-orders/${foreign.body.id}`).set(bearer(tech))).status).toBe(404);
    const list = await api().get('/api/service-orders').set(bearer(tech));
    expect(list.body.data.every((o: { storeId: string }) => o.storeId === fx.stores.LJ01)).toBe(true);
    const forced = await api().get(`/api/service-orders?storeId=${fx.stores.LJ02}`).set(bearer(tech));
    expect(forced.status).toBe(403);
  });

  it('administrador vê todas as lojas somadas ou filtra por loja', async () => {
    const all = await api().get('/api/service-orders').set(bearer(fx.tokens.admin!));
    expect(new Set(all.body.data.map((o: { storeId: string }) => o.storeId)).size).toBe(2);
    const onlyLj02 = await api().get(`/api/service-orders?storeId=${fx.stores.LJ02}`).set(bearer(fx.tokens.admin!));
    expect(onlyLj02.body.data.every((o: { storeId: string }) => o.storeId === fx.stores.LJ02)).toBe(true);
  });
});

describe('Cargos configuráveis', () => {
  it('lista o catálogo de permissões para montar a matriz', async () => {
    const res = await api().get('/api/meta/permissions').set(bearer(fx.tokens.admin!));
    const keys = res.body.modules.flatMap((m: { actions: { key: string }[] }) => m.actions.map((a) => a.key));
    expect(keys.sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('alterar permissões de um cargo tem efeito imediato (sem novo login)', async () => {
    const roles = await api().get('/api/roles').set(bearer(fx.tokens.admin!));
    const seller = roles.body.find((r: { name: string }) => r.name === 'Vendedor');
    const token = fx.tokens['vendedor.centro']!;
    expect((await api().get('/api/sales').set(bearer(token))).status).toBe(200);

    const revoked = seller.permissions.filter((p: string) => p !== 'sales.view');
    const patch = await api().patch(`/api/roles/${seller.id}`).set(bearer(fx.tokens.admin!)).send({ permissions: revoked });
    expect(patch.status).toBe(200);
    expect((await api().get('/api/sales').set(bearer(token))).status).toBe(403);

    await api().patch(`/api/roles/${seller.id}`).set(bearer(fx.tokens.admin!)).send({ permissions: seller.permissions });
    expect((await api().get('/api/sales').set(bearer(token))).status).toBe(200);
  });

  it('rejeita permissões inexistentes e protege o cargo Administrador', async () => {
    const bad = await api()
      .post('/api/roles')
      .set(bearer(fx.tokens.admin!))
      .send({ name: 'Hacker', scope: 'STORE', permissions: ['tudo.liberado'] });
    expect(bad.status).toBe(400);

    const roles = await api().get('/api/roles').set(bearer(fx.tokens.admin!));
    const adminRole = roles.body.find((r: { isSystem: boolean }) => r.isSystem);
    expect((await api().patch(`/api/roles/${adminRole.id}`).set(bearer(fx.tokens.admin!)).send({ name: 'Dono Supremo' })).status).toBe(403);
    expect((await api().delete(`/api/roles/${adminRole.id}`).set(bearer(fx.tokens.admin!))).status).toBe(403);
  });

  it('não exclui cargo em uso', async () => {
    const roles = await api().get('/api/roles').set(bearer(fx.tokens.admin!));
    const tech = roles.body.find((r: { name: string }) => r.name === 'Técnico');
    expect((await api().delete(`/api/roles/${tech.id}`).set(bearer(fx.tokens.admin!))).status).toBe(409);
  });
});

describe('Prevenção de escalonamento de privilégio (Gerente de loja)', () => {
  const roleId = async (name: string) => {
    const roles = await api().get('/api/roles').set(bearer(fx.tokens.admin!));
    return roles.body.find((r: { name: string }) => r.name === name).id as string;
  };

  it('cria técnico na própria loja', async () => {
    const res = await api()
      .post('/api/users')
      .set(bearer(fx.tokens['gerente.centro']!))
      .send({ name: 'Novo Técnico', email: 'novo.tecnico@erp.local', password: 'Senha@123', roleId: await roleId('Técnico') });
    expect(res.status).toBe(201);
    expect(res.body.storeId).toBe(fx.stores.LJ01);
  });

  it('não cria usuário em outra loja', async () => {
    const res = await api()
      .post('/api/users')
      .set(bearer(fx.tokens['gerente.centro']!))
      .send({
        name: 'Intruso',
        email: 'intruso@erp.local',
        password: 'Senha@123',
        roleId: await roleId('Técnico'),
        storeId: fx.stores.LJ02,
      });
    expect(res.status).toBe(403);
  });

  it('não atribui Administrador nem cargos globais', async () => {
    for (const role of ['Administrador', 'Supervisor de Rede']) {
      const res = await api()
        .post('/api/users')
        .set(bearer(fx.tokens['gerente.centro']!))
        .send({ name: 'Esperto', email: `esperto.${role.length}@erp.local`, password: 'Senha@123', roleId: await roleId(role) });
      expect(res.status, role).toBe(403);
    }
  });

  it('não atribui cargo de loja que contenha permissões que ele não possui', async () => {
    const special = await api()
      .post('/api/roles')
      .set(bearer(fx.tokens.admin!))
      .send({ name: 'Estoquista Especial', scope: 'STORE', permissions: ['stock.view', 'stores.edit'] });
    expect(special.status).toBe(201);
    const res = await api()
      .post('/api/users')
      .set(bearer(fx.tokens['gerente.centro']!))
      .send({ name: 'Estoquista', email: 'estoquista@erp.local', password: 'Senha@123', roleId: special.body.id });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('stores.edit');

    const listed = await api().get('/api/roles').set(bearer(fx.tokens['gerente.centro']!));
    const flags = Object.fromEntries(listed.body.map((r: { name: string; assignable: boolean }) => [r.name, r.assignable]));
    expect(flags).toMatchObject({ Técnico: true, Vendedor: true, Administrador: false, 'Estoquista Especial': false });
  });

  it('não promove a si mesmo nem edita usuário de outra loja', async () => {
    const self = await api()
      .patch(`/api/users/${fx.users['gerente.centro']}`)
      .set(bearer(fx.tokens['gerente.centro']!))
      .send({ roleId: await roleId('Administrador') });
    expect(self.status).toBe(403);
    const other = await api()
      .patch(`/api/users/${fx.users['tecnico.shopping']}`)
      .set(bearer(fx.tokens['gerente.centro']!))
      .send({ name: 'Renomeado' });
    expect(other.status).toBe(404);
  });

  it('usuário desativado perde acesso imediatamente', async () => {
    const token = fx.tokens['tecnico.bairro']!;
    expect((await api().get('/api/service-orders').set(bearer(token))).status).toBe(200);
    const res = await api().delete(`/api/users/${fx.users['tecnico.bairro']}`).set(bearer(fx.tokens.admin!));
    expect(res.status).toBe(204);
    expect((await api().get('/api/service-orders').set(bearer(token))).status).toBe(401);
  });
});
