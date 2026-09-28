import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { useState } from 'react';
import { PAYMENT_METHOD_LABELS, SALE_STATUS_LABELS, SALE_STATUSES, type SaleStatus } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { SaleStatusBadge } from '../components/domain';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { docNumber, formatCents, formatDateTime } from '../lib/format';
import type { Paginated, Sale, SaleListItem } from '../lib/types';

function SaleDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const { data: sale, isLoading } = useQuery({ queryKey: ['sale', id], queryFn: () => api<Sale>(`/sales/${id}`) });

  const cancel = useMutation({
    mutationFn: () => api<Sale>(`/sales/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: (s) => {
      qc.setQueryData(['sale', id], s);
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Venda cancelada e estoque estornado');
      setCancelling(false);
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={sale ? `Venda ${docNumber(sale.storeCode, sale.number)}` : 'Venda'}
      footer={
        sale?.status === 'COMPLETED' &&
        can('sales.cancel') &&
        (cancelling ? (
          <>
            <Button variant="ghost" onClick={() => setCancelling(false)}>
              Voltar
            </Button>
            <Button variant="danger" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Confirmar cancelamento
            </Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setCancelling(true)}>
            Cancelar venda
          </Button>
        ))
      }
    >
      {isLoading || !sale ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
            <SaleStatusBadge status={sale.status} />
            <span>{formatDateTime(sale.createdAt)}</span>
            <span>· {sale.storeName}</span>
            <span>· Vendedor: {sale.sellerName}</span>
            {sale.customerName && <span>· Cliente: {sale.customerName}</span>}
          </div>
          {sale.status === 'CANCELLED' && (
            <ErrorBox message={`Cancelada em ${formatDateTime(sale.cancelledAt)} por ${sale.cancelledByName ?? '—'}: ${sale.cancelReason}`} />
          )}
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th className="text-right">Qtd</Th>
                <Th className="text-right">Unitário</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.id}>
                  <Td>{i.description}</Td>
                  <Td className="tabular text-right">{i.quantity}</Td>
                  <Td className="tabular text-right">{formatCents(i.unitPriceCents)}</Td>
                  <Td className="tabular text-right">{formatCents(i.totalCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="grid gap-4 sm:grid-cols-2">
            <dl className="flex flex-col gap-1 text-sm">
              {sale.payments.map((p) => (
                <div key={p.id} className="flex justify-between text-ink-2">
                  <dt>{PAYMENT_METHOD_LABELS[p.method]}</dt>
                  <dd className="tabular">{formatCents(p.amountCents)}</dd>
                </div>
              ))}
              {sale.changeCents > 0 && (
                <div className="flex justify-between text-ink-2">
                  <dt>Troco</dt>
                  <dd className="tabular">{formatCents(sale.changeCents)}</dd>
                </div>
              )}
            </dl>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between text-ink-2">
                <dt>Subtotal</dt>
                <dd className="tabular">{formatCents(sale.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between text-ink-2">
                <dt>Desconto</dt>
                <dd className="tabular">− {formatCents(sale.discountCents)}</dd>
              </div>
              <div className="flex justify-between font-semibold text-ink">
                <dt>Total</dt>
                <dd className="tabular">{formatCents(sale.totalCents)}</dd>
              </div>
            </dl>
          </div>
          {cancelling && (
            <Field label="Motivo do cancelamento" required hint="Os itens voltam ao estoque da loja">
              {(fid) => <Textarea id={fid} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}

export function SalesPage() {
  const { storeId } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SaleStatus | ''>('');
  const [number, setNumber] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ['sales', storeId, status, number, page],
    queryFn: () => api<Paginated<SaleListItem>>('/sales', { query: { storeId, status, number: number || undefined, page } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader title="Vendas" subtitle="Histórico do PDV por loja" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="w-40" inputMode="numeric" placeholder="Nº da venda" value={number} onChange={(e) => (setNumber(e.target.value.replace(/\D/g, '')), setPage(1))} aria-label="Número da venda" />
        <Select className="w-44" value={status} onChange={(e) => (setStatus(e.target.value as SaleStatus | ''), setPage(1))} aria-label="Status">
          <option value="">Todos os status</option>
          {SALE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SALE_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      {error && <ErrorBox message={errorMessage(error)} />}
      <Card className={cx('transition-opacity', isFetching && !isLoading && 'opacity-70')}>
        {isLoading ? (
          <Spinner />
        ) : !data?.data.length ? (
          <EmptyState icon={<Receipt className="size-8" />} title="Nenhuma venda encontrada" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Nº</Th>
                  <Th>Data</Th>
                  <Th>Vendedor</Th>
                  <Th>Cliente</Th>
                  <Th className="text-right">Itens</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setSelected(s.id)}>
                    <Td className="font-medium whitespace-nowrap">{docNumber(s.storeCode, s.number)}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(s.createdAt)}</Td>
                    <Td>{s.sellerName}</Td>
                    <Td className="text-ink-2">{s.customerName ?? '—'}</Td>
                    <Td className="tabular text-right">{s.itemCount}</Td>
                    <Td className="tabular text-right">{formatCents(s.totalCents)}</Td>
                    <Td>
                      <SaleStatusBadge status={s.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {selected && <SaleDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
