/**
 * Regras de isolamento multi-loja.
 *
 * Usuários com acesso global (Administrador ou cargo GLOBAL) podem consultar
 * todas as lojas somadas ou filtrar por uma loja. Usuários de escopo STORE
 * ficam presos à própria loja: qualquer tentativa de acessar outra loja é
 * negada, e registros de outras lojas respondem 404 (não revelam existência).
 */
import { and, eq } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { stores } from '../../db/schema';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { hasGlobalAccess, type AuthContext } from './auth-context';

/** Filtro de loja para leituras. `null` = todas as lojas. */
export function resolveReadScope(auth: AuthContext, requestedStoreId?: string | null): string | null {
  if (hasGlobalAccess(auth)) return requestedStoreId ?? null;
  if (!auth.storeId) throw forbidden('Usuário sem loja vinculada');
  if (requestedStoreId && requestedStoreId !== auth.storeId) {
    throw forbidden('Você não tem acesso aos dados desta loja');
  }
  return auth.storeId;
}

/** Loja-alvo para operações de escrita (OS, venda, ajuste...). */
export function resolveWriteStore(auth: AuthContext, requestedStoreId?: string | null): string {
  if (hasGlobalAccess(auth)) {
    const storeId = requestedStoreId ?? auth.storeId;
    if (!storeId) throw badRequest('Informe a loja da operação (storeId)');
    return storeId;
  }
  if (!auth.storeId) throw forbidden('Usuário sem loja vinculada');
  if (requestedStoreId && requestedStoreId !== auth.storeId) {
    throw forbidden('Você só pode operar na sua própria loja');
  }
  return auth.storeId;
}

/** Garante que o registro pertence a uma loja acessível ao usuário. */
export function assertStoreAccess(auth: AuthContext, storeId: string): void {
  if (!hasGlobalAccess(auth) && auth.storeId !== storeId) throw notFound();
}

export function canAccessStore(auth: AuthContext, storeId: string): boolean {
  return hasGlobalAccess(auth) || auth.storeId === storeId;
}

export async function assertActiveStore(tx: Executor, storeId: string): Promise<void> {
  const [store] = await tx
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.isActive, true)))
    .limit(1);
  if (!store) throw badRequest('Loja inexistente ou inativa');
}
