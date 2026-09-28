import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { SERVICE_ORDER_STATUS_LABELS, SERVICE_ORDER_STATUSES, type ServiceOrderStatus } from '@erp/shared';
import { useAuth } from '../../auth/AuthContext';
import { OrderStatusBadge } from '../../components/domain';
import { Button, Card, cx, EmptyState, ErrorBox, Input, PageHeader, Pagination, Spinner, Table, Td, Th } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { docNumber, formatCents, formatDate, formatPhone } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import type { Paginated, ServiceOrderListItem } from '../../lib/types';

const OPEN = ['AWAITING_APPROVAL', 'IN_PROGRESS', 'COMPLETED'] as const;

export function ServiceOrdersPage() {
  const { storeId, can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState<ServiceOrderStatus[]>([...OPEN]);
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ['service-orders', storeId, debounced, statuses, page],
    queryFn: () =>
      api<Paginated<ServiceOrderListItem>>('/service-orders', {
        query: { storeId, search: debounced, status: statuses.join(','), page, pageSize: 20 },
      }),
    placeholderData: keepPreviousData,
  });

  const toggle = (s: ServiceOrderStatus) => {
    setPage(1);
    setStatuses((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));
  };
  const preset = (list: readonly ServiceOrderStatus[]) => {
    setPage(1);
    setStatuses([...list]);
  };

  return (
    <div>
      <PageHeader
        title="Orçamentos / Ordens de serviço"
        subtitle="Do orçamento à entrega — a baixa das peças acontece ao finalizar o serviço"
        actions={
          can('service_orders.create') && (
            <Link to="/ordens-servico/nova">
              <Button variant="primary" icon={<Plus className="size-4" />}>
                Novo orçamento
              </Button>
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Nº da OS, cliente, telefone, modelo ou IMEI"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Buscar ordens de serviço"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por status">
          <button className="rounded-full px-3 py-1 text-xs text-ink-2 hover:bg-surface-2" onClick={() => preset(OPEN)}>
            Em aberto
          </button>
          <button className="rounded-full px-3 py-1 text-xs text-ink-2 hover:bg-surface-2" onClick={() => preset([])}>
            Todas
          </button>
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          {SERVICE_ORDER_STATUSES.map((s) => (
            <button
              key={s}
              aria-pressed={statuses.includes(s)}
              onClick={() => toggle(s)}
              className={cx(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                statuses.includes(s) ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-ink-2 hover:bg-surface-2',
              )}
            >
              {SERVICE_ORDER_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBox message={errorMessage(error)} />}
      <Card className={cx('transition-opacity', isFetching && !isLoading && 'opacity-70')}>
        {isLoading ? (
          <Spinner />
        ) : !data?.data.length ? (
          <EmptyState icon={<Wrench className="size-8" />} title="Nenhuma ordem de serviço encontrada">
            Ajuste os filtros ou crie um novo orçamento.
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Nº</Th>
                  <Th>Cliente</Th>
                  <Th>Aparelho / defeito</Th>
                  <Th>Status</Th>
                  <Th>Técnico</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Entrada</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((o) => (
                  <tr
                    key={o.id}
                    className="cursor-pointer hover:bg-surface-2"
                    onClick={() => navigate(`/ordens-servico/${o.id}`)}
                  >
                    <Td className="font-medium whitespace-nowrap">
                      <Link to={`/ordens-servico/${o.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                        {docNumber(o.storeCode, o.number)}
                      </Link>
                    </Td>
                    <Td>
                      <div>{o.customerName}</div>
                      <div className="text-xs text-muted">{formatPhone(o.customerPhone)}</div>
                    </Td>
                    <Td className="max-w-72">
                      <div className="truncate">{[o.deviceBrand, o.deviceModel].filter(Boolean).join(' ')}</div>
                      <div className="truncate text-xs text-muted">{o.reportedDefect}</div>
                    </Td>
                    <Td>
                      <OrderStatusBadge status={o.status} />
                    </Td>
                    <Td className="text-ink-2">{o.technicianName ?? '—'}</Td>
                    <Td className="tabular text-right">{formatCents(o.totalCents)}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDate(o.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
