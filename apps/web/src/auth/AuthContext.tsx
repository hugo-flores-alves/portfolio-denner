import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@erp/shared';
import { api, tokenStore } from '../lib/api';
import type { Me, Store, StoreRef } from '../lib/types';

const STORE_KEY = 'erp.store';

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (permission: Permission) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
  /** Loja selecionada no topo. null = "Todas as lojas" (só acesso global). */
  storeId: string | null;
  setStoreId: (id: string | null) => void;
  stores: StoreRef[];
  /** Todas as lojas ativas da rede (ex.: destino de transferência). */
  allStores: StoreRef[];
  storeById: (id: string | null | undefined) => StoreRef | undefined;
  /** Loja padrão para operações que exigem uma loja (PDV, nova OS...). */
  defaultOperationStoreId: string | null;
}

const AuthContext = createContext<AuthState | null>(null);

function readStoredStore(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());
  const [selectedStore, setSelectedStore] = useState<string | null>(readStoredStore);

  const { data: networkStores } = useQuery({
    queryKey: ['stores', 'network'],
    queryFn: () => api<Store[]>('/stores'),
    enabled: !!me,
    staleTime: 5 * 60_000,
  });

  const logout = useCallback(() => {
    tokenStore.clear();
    setMe(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api<Me>('/auth/me')
      .then(setMe)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setMe(null);
    window.addEventListener('erp:unauthorized', onUnauthorized);
    return () => window.removeEventListener('erp:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: Me }>('/auth/login', { method: 'POST', body: { email, password } });
    tokenStore.set(res.token);
    queryClient.clear();
    setMe(res.user);
  }, [queryClient]);

  const setStoreId = useCallback((id: string | null) => {
    setSelectedStore(id);
    try {
      if (id) localStorage.setItem(STORE_KEY, id);
      else localStorage.removeItem(STORE_KEY);
    } catch {
      /* noop */
    }
  }, []);

  const value = useMemo<AuthState>(() => {
    const permissions = new Set(me?.permissions ?? []);
    const stores = me?.stores ?? [];
    // Usuário de loja fica preso à sua loja; global escolhe (ou "todas")
    const storeId = !me
      ? null
      : me.hasGlobalAccess
        ? stores.some((s) => s.id === selectedStore)
          ? selectedStore
          : null
        : me.storeId;
    return {
      me,
      loading,
      login,
      logout,
      can: (p) => permissions.has(p),
      canAny: (...ps) => ps.some((p) => permissions.has(p)),
      storeId,
      setStoreId,
      stores,
      allStores: (networkStores ?? []).filter((s) => s.isActive),
      storeById: (id) => stores.find((s) => s.id === id) ?? networkStores?.find((s) => s.id === id),
      defaultOperationStoreId: storeId ?? me?.storeId ?? stores[0]?.id ?? null,
    };
  }, [me, loading, login, logout, selectedStore, setStoreId, networkStores]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
