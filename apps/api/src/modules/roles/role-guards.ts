/**
 * Prevenção de escalonamento de privilégio.
 *
 * Um usuário só pode criar/editar/atribuir cargos cujas permissões ele mesmo
 * possui, e só usuários com acesso global podem lidar com cargos GLOBAL.
 * O cargo de sistema (Administrador) só é atribuível pelo próprio Administrador.
 */
import type { Permission, RoleScope } from '@erp/shared';
import { forbidden } from '../../lib/errors';
import { hasGlobalAccess, type AuthContext } from '../auth/auth-context';

export interface RoleShape {
  scope: RoleScope;
  isSystem: boolean;
  permissions: readonly string[];
}

export function missingPermissions(auth: AuthContext, permissions: readonly string[]): string[] {
  if (auth.isSuperAdmin) return [];
  return permissions.filter((p) => !auth.permissions.has(p as Permission));
}

export function canManageRole(auth: AuthContext, role: RoleShape): boolean {
  if (auth.isSuperAdmin) return true;
  if (role.isSystem) return false;
  if (role.scope === 'GLOBAL' && !hasGlobalAccess(auth)) return false;
  return missingPermissions(auth, role.permissions).length === 0;
}

export function assertCanManageRole(auth: AuthContext, role: RoleShape): void {
  if (auth.isSuperAdmin) return;
  if (role.isSystem) throw forbidden('Somente o Administrador pode gerenciar o cargo de sistema');
  if (role.scope === 'GLOBAL' && !hasGlobalAccess(auth)) {
    throw forbidden('Somente usuários com acesso global podem gerenciar cargos globais');
  }
  const missing = missingPermissions(auth, role.permissions);
  if (missing.length) {
    throw forbidden(`Você não pode conceder permissões que não possui: ${missing.join(', ')}`);
  }
}
