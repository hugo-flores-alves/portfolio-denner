import { Router } from 'express';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ALL_PERMISSIONS, isPermission, ROLE_SCOPES } from '@erp/shared';
import { db, type Executor } from '../../db/client';
import { rolePermissions, roles, users } from '../../db/schema';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { outerRef } from '../../lib/sql';
import { idParamsSchema, optionalText } from '../../lib/validation';
import { getAuth, requireAnyPermission, requirePermission } from '../../middleware/auth';
import { assertCanManageRole, canManageRole } from './role-guards';

export const rolesRouter = Router();

const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: optionalText(500),
  scope: z.enum(ROLE_SCOPES),
  permissions: z
    .array(z.string())
    .max(ALL_PERMISSIONS.length)
    .transform((list) => [...new Set(list)])
    .refine((list) => list.every(isPermission), {
      message: 'Lista contém permissões desconhecidas',
    }),
});

async function loadRoles(executor: Executor, ids?: string[]) {
  const rows = await executor
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      scope: roles.scope,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      userCount: sql<number>`(select count(*)::int from ${users} u where u.role_id = ${outerRef(roles.id)} and u.is_active)`,
    })
    .from(roles)
    .where(ids ? inArray(roles.id, ids) : undefined)
    .orderBy(asc(roles.name));

  const perms = rows.length
    ? await executor
        .select()
        .from(rolePermissions)
        .where(
          inArray(
            rolePermissions.roleId,
            rows.map((r) => r.id),
          ),
        )
    : [];

  return rows.map((role) => ({
    ...role,
    // O cargo de sistema tem acesso total, inclusive a permissões criadas no futuro
    permissions: role.isSystem
      ? [...ALL_PERMISSIONS]
      : perms.filter((p) => p.roleId === role.id).map((p) => p.permission),
  }));
}

async function loadRole(executor: Executor, id: string) {
  const [role] = await loadRoles(executor, [id]);
  if (!role) throw notFound('Cargo não encontrado');
  return role;
}

// Listagem também serve ao formulário de usuários (cargos atribuíveis)
rolesRouter.get('/', requireAnyPermission('roles.view', 'users.create', 'users.edit'), async (req, res) => {
  const auth = getAuth(req);
  const list = await loadRoles(db);
  res.json(list.map((role) => ({ ...role, assignable: canManageRole(auth, role) })));
});

rolesRouter.get('/:id', requirePermission('roles.view'), async (req, res) => {
  const auth = getAuth(req);
  const { id } = idParamsSchema.parse(req.params);
  const role = await loadRole(db, id);
  res.json({ ...role, assignable: canManageRole(auth, role) });
});

rolesRouter.post('/', requirePermission('roles.create'), async (req, res) => {
  const auth = getAuth(req);
  const body = roleSchema.parse(req.body);
  assertCanManageRole(auth, { ...body, isSystem: false });

  const created = await db.transaction(async (tx) => {
    const [role] = await tx
      .insert(roles)
      .values({ name: body.name, description: body.description, scope: body.scope })
      .returning({ id: roles.id });
    if (body.permissions.length) {
      await tx.insert(rolePermissions).values(body.permissions.map((permission) => ({ roleId: role!.id, permission })));
    }
    return loadRole(tx, role!.id);
  });
  res.status(201).json(created);
});

rolesRouter.patch('/:id', requirePermission('roles.edit'), async (req, res) => {
  const auth = getAuth(req);
  const { id } = idParamsSchema.parse(req.params);
  const body = roleSchema.partial().parse(req.body);

  const updated = await db.transaction(async (tx) => {
    const current = await loadRole(tx, id);
    if (current.isSystem) throw forbidden('O cargo Administrador é protegido e não pode ser alterado');
    // Precisa poder gerenciar o cargo como ele é hoje E como ficará
    assertCanManageRole(auth, current);
    const next = { ...current, ...body, permissions: body.permissions ?? current.permissions };
    assertCanManageRole(auth, next);
    if (auth.roleId === id && body.permissions) {
      throw forbidden('Você não pode alterar as permissões do seu próprio cargo');
    }

    await tx
      .update(roles)
      .set({ name: next.name, description: next.description, scope: next.scope })
      .where(eq(roles.id, id));
    if (body.permissions) {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      if (body.permissions.length) {
        await tx.insert(rolePermissions).values(body.permissions.map((permission) => ({ roleId: id, permission })));
      }
    }
    return loadRole(tx, id);
  });
  res.json(updated);
});

rolesRouter.delete('/:id', requirePermission('roles.delete'), async (req, res) => {
  const auth = getAuth(req);
  const { id } = idParamsSchema.parse(req.params);
  const role = await loadRole(db, id);
  if (role.isSystem) throw forbidden('O cargo Administrador não pode ser excluído');
  assertCanManageRole(auth, role);
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.roleId, id));
  if (total > 0) {
    throw conflict(`Este cargo está atribuído a ${total} usuário(s). Reatribua-os antes de excluir.`);
  }
  await db.delete(roles).where(eq(roles.id, id));
  res.status(204).end();
});
