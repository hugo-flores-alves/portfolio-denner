/** Cliente HTTP da API: injeta o token, normaliza erros e trata sessão expirada. */
const TOKEN_KEY = 'erp.token';

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* armazenamento indisponível: sessão vale só nesta aba */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* noop */
    }
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

export async function api<T>(path: string, { method = 'GET', body, query, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}${buildQuery(query)}`, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    signal,
  });

  if (res.status === 401 && path !== '/auth/login') {
    tokenStore.clear();
    window.dispatchEvent(new Event('erp:unauthorized'));
  }
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    throw new ApiError(err?.message ?? `Erro ${res.status}`, res.status, err?.code, err?.details, data);
  }
  return data as T;
}

/** Baixa um arquivo autenticado (ex.: modelo de planilha). */
export async function download(path: string, fallbackName: string): Promise<void> {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError('Falha no download', res.status);
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  saveBlob(blob, name);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
      return (err.details as { path: string; message: string }[])
        .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message))
        .join(' · ');
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro inesperado';
}
