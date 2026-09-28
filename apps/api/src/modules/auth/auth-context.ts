import { eq } from 'drizzle-orm';
import { isPermission, type Permission, type RoleScope } from '@erp/shared';
import { db } from '../../db/client';
import { rolePermissions, roles, stores, users } from '../../db/schema';

export interface AuthContext {
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  /** Cargo de sistema (Administrador): todas as permissões em todas as lojas. */
  isSuperAdmin: boolean;
  scope: RoleScope;
  /** Loja do usuário (obrigatória para escopo STORE; "loja padrão" para GLOBAL). */
  storeId: string | null;
  permissions: ReadonlySet<Permission>;
}

/**
 * Carrega usuário + cargo + permissões a cada requisição. Assim, alterar
 * permissões de um cargo ou desativar um usuário tem efeito imediato,
 * sem esperar o token expirar.
 */
export async function loadAuthContext(userId: string): Promise<AuthContext | null> {
  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      storeId: users.storeId,
      storeActive: stores.isActive,
      roleId: roles.id,
      roleName: roles.name,
      scope: roles.scope,
      isSystem: roles.isSystem,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(stores, eq(stores.id, users.storeId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row || !row.isActive) return null;
  // Usuário de loja desativada perde o acesso (exceto cargos globais)
  if (row.scope === 'STORE' && !row.isSystem && (!row.storeId || row.storeActive === false)) {
    return null;
  }

  const perms = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, row.roleId));

  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    roleId: row.roleId,
    roleName: row.roleName,
    isSuperAdmin: row.isSystem,
    scope: row.isSystem ? 'GLOBAL' : row.scope,
    storeId: row.storeId,
    permissions: new Set(perms.map((p) => p.permission).filter(isPermission)),
  };
}

export function can(auth: AuthContext, permission: Permission): boolean {
  return auth.isSuperAdmin || auth.permissions.has(permission);
}

export function hasGlobalAccess(auth: AuthContext): boolean {
  return auth.isSuperAdmin || auth.scope === 'GLOBAL';
}

/** Lista efetiva de permissões (o superadmin recebe todas). */
export function effectivePermissions(auth: AuthContext, all: readonly Permission[]): Permission[] {
  return auth.isSuperAdmin ? [...all] : [...auth.permissions];
}
