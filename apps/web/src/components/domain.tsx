import { useQuery } from '@tanstack/react-query';
import { Ban, CheckCircle2, Clock, PackageCheck, Search, Wrench, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  SALE_STATUS_LABELS,
  SERVICE_ORDER_STATUS_LABELS,
  TRANSFER_STATUS_LABELS,
  type SaleStatus,
  type ServiceOrderStatus,
  type TransferStatus,
} from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { formatCents, formatPhone } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import type { Customer, Paginated, Product } from '../lib/types';
import { Badge, cx, Input, Select } from './ui';

const OS_STATUS_STYLE: Record<ServiceOrderStatus, { tone: Parameters<typeof Badge>[0]['tone']; icon: typeof Clock }> = {
  AWAITING_APPROVAL: { tone: 'warning', icon: Clock },
  IN_PROGRESS: { tone: 'accent', icon: Wrench },
  COMPLETED: { tone: 'good', icon: CheckCircle2 },
  DELIVERED: { tone: 'neutral', icon: PackageCheck },
  REJECTED: { tone: 'critical', icon: XCircle },
  CANCELLED: { tone: 'neutral', icon: Ban },
};

export function OrderStatusBadge({ status }: { status: ServiceOrderStatus }) {
  const { tone, icon: Icon } = OS_STATUS_STYLE[status];
  return (
    <Badge tone={tone} icon={<Icon className="size-3" aria-hidden />}>
      {SERVICE_ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  return (
    <Badge tone={status === 'COMPLETED' ? 'good' : 'neutral'} icon={status === 'CANCELLED' ? <Ban className="size-3" /> : undefined}>
      {SALE_STATUS_LABELS[status]}
    </Badge>
  );
}

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const tone = status === 'IN_TRANSIT' ? 'warning' : status === 'RECEIVED' ? 'good' : 'neutral';
  return <Badge tone={tone}>{TRANSFER_STATUS_LABELS[status]}</Badge>;
}

/**
 * Seletor de loja para formulários de operação. Por padrão, só usuários com
 * acesso global escolhem; `locked={false}` libera (ex.: loja de destino).
 */
export function StoreSelect({
  value,
  onChange,
  id,
  exclude,
  locked,
}: {
  value: string | null;
  onChange: (id: string) => void;
  id?: string;
  exclude?: string | null;
  locked?: boolean;
}) {
  const { stores, me, allStores } = useAuth();
  const source = locked === false ? allStores : stores;
  const isLocked = locked ?? !me?.hasGlobalAccess;
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={isLocked}>
      <option value="" disabled>
        Selecione a loja
      </option>
      {source
        .filter((s) => s.id !== exclude)
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} — {s.name}
          </option>
        ))}
    </Select>
  );
}

/** Combobox de busca com lista de resultados (teclado: ↑ ↓ Enter Esc). */
function SearchCombobox<T>({
  placeholder,
  queryKey,
  fetcher,
  renderItem,
  onSelect,
  onEnterRaw,
  autoFocus,
  id,
}: {
  placeholder: string;
  queryKey: unknown[];
  fetcher: (term: string) => Promise<T[]>;
  renderItem: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
  /** Enter sem item destacado (ex.: leitor de código de barras). */
  onEnterRaw?: (term: string) => Promise<boolean> | boolean;
  autoFocus?: boolean;
  id?: string;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(term.trim(), 250);
  const wrapper = useRef<HTMLDivElement>(null);

  const { data: fetched, isFetching } = useQuery({
    queryKey: [...queryKey, debounced],
    queryFn: () => fetcher(debounced),
    enabled: debounced.length >= 2,
  });
  // Nunca exibir (nem permitir escolher) resultados de um termo anterior:
  // no balcão, digitação rápida + Enter selecionaria o item errado.
  const settled = debounced === term.trim();
  const data = settled ? (fetched ?? []) : [];
  const searching = !settled || isFetching;

  useEffect(() => {
    const close = (e: MouseEvent) => !wrapper.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => setActive(-1), [debounced]);

  const choose = (item: T) => {
    onSelect(item);
    setTerm('');
    setOpen(false);
  };

  return (
    <div ref={wrapper} className="relative">
      <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted" aria-hidden />
      <Input
        id={id}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="pl-9"
        placeholder={placeholder}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={async (e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, data.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (active >= 0 && data[active]) choose(data[active]);
            else if (onEnterRaw && term.trim() && (await onEnterRaw(term.trim()))) setTerm('');
            else if (data.length === 1) choose(data[0]!);
          }
        }}
      />
      {open && term.trim().length >= 2 && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-xl">
          {data.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">{searching ? 'Buscando...' : 'Nenhum resultado'}</li>
          )}
          {data.map((item, i) => (
            <li
              key={i}
              role="option"
              aria-selected={i === active}
              className={cx('cursor-pointer px-3 py-2 text-sm', i === active ? 'bg-accent-soft' : 'hover:bg-surface-2')}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {renderItem(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProductPicker({
  storeId,
  onSelect,
  onBarcode,
  autoFocus,
  placeholder = 'Buscar peça por nome, SKU, código de barras ou modelo...',
  id,
}: {
  storeId: string | null;
  onSelect: (p: Product) => void;
  onBarcode?: (code: string) => Promise<boolean>;
  autoFocus?: boolean;
  placeholder?: string;
  id?: string;
}) {
  return (
    <SearchCombobox<Product>
      id={id}
      autoFocus={autoFocus}
      placeholder={placeholder}
      queryKey={['product-search', storeId]}
      fetcher={(search) =>
        api<Paginated<Product>>('/products', { query: { search, storeId, pageSize: 15 } }).then((r) => r.data)
      }
      onSelect={onSelect}
      onEnterRaw={onBarcode}
      renderItem={(p) => (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{p.name}</div>
            <div className="text-xs text-muted">
              {p.sku}
              {p.barcode ? ` · ${p.barcode}` : ''}
            </div>
          </div>
          <div className="text-right">
            <div className="tabular text-ink">{formatCents(p.priceCents)}</div>
            <div className={cx('tabular text-xs', p.quantity > 0 ? 'text-ink-2' : 'text-critical-ink')}>
              {p.quantity > 0 ? `${p.quantity} em estoque` : 'sem estoque'}
            </div>
          </div>
        </div>
      )}
    />
  );
}

export function CustomerPicker({ onSelect, id }: { onSelect: (c: Customer) => void; id?: string }) {
  return (
    <SearchCombobox<Customer>
      id={id}
      placeholder="Nome, telefone ou CPF..."
      queryKey={['customer-search']}
      fetcher={(search) => api<Paginated<Customer>>('/customers', { query: { search, pageSize: 10 } }).then((r) => r.data)}
      onSelect={onSelect}
      renderItem={(c) => (
        <div>
          <div className="font-medium text-ink">{c.name}</div>
          <div className="text-xs text-muted">{[formatPhone(c.phone), c.email].filter((v) => v && v !== '—').join(' · ') || 'sem contato'}</div>
        </div>
      )}
    />
  );
}
