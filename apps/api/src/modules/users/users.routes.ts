import { Router } from 'express';
import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { ALL_PERMISSIONS } from '@erp/shared';
import { db, type Executor } from '../../db/client';
import { rolePermissions, roles, stores, users } from '../../db/schema';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { paginationSchema, toLimitOffset } from '../../lib/pagination';
import { hashPassword } from '../../lib/password';
import { containsInsensitive } from '../../lib/sql';
import { idParamsSchema, queryBoolean, uuidSchema } from '../../lib/validation';
import { getAuth, requirePermission } from '../../middleware/auth';
import { hasGlobalAccess, type AuthContext } from '../auth/auth-context';
import { assertActiveStore, resolveReadScope } from '../auth/store-scope';
import { assertCanManageRole } from '../roles/role-guards';

export const usersRouter = Router();

const userSelection = {
  id: users.id,
  name: users.name,
  email: users.email,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  roleId: users.roleId,
  roleName: roles.name,
  roleScope: roles.scope,
  roleIsSystem: roles.isSystem,
  storeId: users.storeId,
  storeCode: stores.code,
  storeName: stores.name,
};

function baseQuery(executor: Executor) {
  return executor
    .select(userSelection)
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(stores, eq(stores.id, users.storeId));
}

async function loadRoleForAssignment(executor: Executor, roleId: string) {
  const [role] = await executor.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) throw badRequest('Cargo inexistente');
  const perms = await executor
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return {
    ...role,
    permissions: role.isSystem ? [...ALL_PERMISSIONS] : perms.map((p) => p.permission),
  };
}

/** Valida cargo + loja do usuário-alvo contra os poderes de quem está operando. */
async function assertAssignment(
  executor: Executor,
  auth: AuthContext,
  target: { roleId: string; storeId: string | null },
) {
  const role = await loadRoleForAssignment(executor, target.roleId);
  assertCanManageRole(auth, role);
  if (role.scope === 'STORE' && !role.isSystem && !target.storeId) {
    throw badRequest('Cargos de escopo "loja" exigem uma loja vinculada ao usuário');
  }
  if (target.storeId) {
    if (!hasGlobalAccess(auth) && target.storeId !== auth.storeId) {
      throw forbidden('Você só pode vincular usuários à sua própria loja');
    }
    await assertActiveStore(executor, target.storeId);
  }
}

/** Quem opera precisa ter poder sobre o cargo atual do usuário (não edita um superior). */
async function assertCanManageExisting(executor: Executor, auth: AuthContext, roleId: string) {
  assertCanManageRole(auth, await loadRoleForAssignment(executor, roleId));
}

async function loadManagedUser(executor: Executor, auth: AuthContext, id: string) {
  const [user] = await baseQuery(executor).where(eq(users.id, id)).limit(1);
  if (!user) throw notFound('Usuário não encontrado');
  if (!hasGlobalAccess(auth) && user.storeId !== auth.storeId) throw notFound('Usuário não encontrado');
  return user;
}

const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().optional(),
  storeId: uuidSchema.optional(),
  roleId: uuidSchema.optional(),
  includeInactive: queryBoolean,
});

usersRouter.get('/', requirePermission('users.view'), async (req, res) => {
  const auth = getAuth(req);
  const q = listQuerySchema.parse(req.query);
  const storeId = resolveReadScope(auth, q.storeId);
  const filters: (SQL | undefined)[] = [
    storeId ? eq(users.storeId, storeId) : undefined,
    q.roleId ? eq(users.roleId, q.roleId) : undefined,
    q.includeInactive ? undefined : eq(users.isActive, true),
    q.search ? or(containsInsensitive(users.name, q.search), containsInsensitive(users.email, q.search)) : undefined,
  ];
  const where = and(...filters);
  const { limit, offset } = toLimitOffset(q);
  const [data, [count]] = await Promise.all([
    baseQuery(db).where(where).orderBy(asc(users.name)).limit(limit).offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(where),
  ]);
  res.json({ data, total: count?.total ?? 0, page: q.page, pageSize: q.pageSize });
});

usersRouter.get('/:id', requirePermission('users.view'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  res.json(await loadManagedUser(db, getAuth(req), id));
});

const passwordSchema = z.string().min(8, 'A senha deve ter ao menos 8 caracteres').max(128);
const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  password: passwordSchema,
  roleId: uuidSchema,
  storeId: uuidSchema.nullish().transform((v) => v ?? null),
});

usersRouter.post('/', requirePermission('users.create'), async (req, res) => {
  const auth = getAuth(req);
  const body = createSchema.parse(req.body);
  // Gerente de loja cria usuários na própria loja por padrão
  const storeId = body.storeId ?? (hasGlobalAccess(auth) ? null : auth.storeId);
  const created = await db.transaction(async (tx) => {
    await assertAssignment(tx, auth, { roleId: body.roleId, storeId });
    const [user] = await tx
      .insert(users)
      .values({
        name: body.name,
        email: body.email,
        passwordHash: await hashPassword(body.password),
        roleId: body.roleId,
        storeId,
      })
      .returning({ id: users.id });
    return loadManagedUser(tx, auth, user!.id);
  });
  res.status(201).json(created);
});

const updateSchema = createSchema
  .omit({ password: true })
  .partial()
  .extend({ password: passwordSchema.optional(), isActive: z.boolean().optional() });

usersRouter.patch('/:id', requirePermission('users.edit'), async (req, res) => {
  const auth = getAuth(req);
  const { id } = idParamsSchema.parse(req.params);
  const body = updateSchema.parse(req.body);

  const updated = await db.transaction(async (tx) => {
    const current = await loadManagedUser(tx, auth, id);
    await assertCanManageExisting(tx, auth, current.roleId);

    const isSelf = id === auth.userId;
    if (isSelf && (body.roleId !== undefined || body.storeId !== undefined || body.isActive === false)) {
      throw forbidden('Você não pode alterar o próprio cargo, loja ou status');
    }

    const next = {
      roleId: body.roleId ?? current.roleId,
      storeId: body.storeId !== undefined ? body.storeId : current.storeId,
    };
    if (body.roleId !== undefined || body.storeId !== undefined) {
      await assertAssignment(tx, auth, next);
    }

    await tx
      .update(users)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.password && { passwordHash: await hashPassword(body.password) }),
        roleId: next.roleId,
        storeId: next.storeId,
      })
      .where(eq(users.id, id));
    return loadManagedUser(tx, auth, id);
  });
  res.json(updated);
});

/** Usuários nunca são apagados (histórico de OS/vendas): apenas desativados. */
usersRouter.delete('/:id', requirePermission('users.delete'), async (req, res) => {
  const auth = getAuth(req);
  const { id } = idParamsSchema.parse(req.params);
  if (id === auth.userId) throw forbidden('Você não pode desativar a própria conta');
  await db.transaction(async (tx) => {
    const current = await loadManagedUser(tx, auth, id);
    await assertCanManageExisting(tx, auth, current.roleId);
    await tx.update(users).set({ isActive: false }).where(eq(users.id, id));
  });
  res.status(204).end();
});
