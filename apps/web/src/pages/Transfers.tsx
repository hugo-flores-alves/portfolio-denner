import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Trash2, Truck } from 'lucide-react';
import { useState } from 'react';
import { TRANSFER_STATUS_LABELS, TRANSFER_STATUSES, type TransferStatus } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { ProductPicker, StoreSelect, TransferStatusBadge } from '../components/domain';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { Paginated, Product, Transfer } from '../lib/types';

function NewTransferModal({ onClose }: { onClose: () => void }) {
  const { defaultOperationStoreId } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [fromStoreId, setFrom] = useState<string | null>(defaultOperationStoreId);
  const [toStoreId, setTo] = useState<string | null>(null);
  const [items, setItems] = useState<Array<{ product: Product; quantity: number }>>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api<Transfer>('/stock-transfers', {
        method: 'POST',
        body: { fromStoreId, toStoreId, notes: notes || null, items: items.map((i) => ({ productId: i.product.id, quantity: i.quantity })) },
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['transfers'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast(`Transferência #${t.number} enviada — aguardando recebimento em ${t.toStoreCode}`);
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Nova transferência entre lojas"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!fromStoreId || !toStoreId || !items.length} loading={save.isPending} onClick={() => save.mutate()}>
            Enviar mercadoria
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <ErrorBox message={error} />}
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <Field label="Origem (sai agora)">
            {(id) => (
              <StoreSelect
                id={id}
                value={fromStoreId}
                onChange={(v) => {
                  setFrom(v);
                  setItems([]);
                }}
              />
            )}
          </Field>
          <ArrowRight className="mb-3 hidden size-5 text-muted sm:block" aria-hidden />
          <Field label="Destino (entra ao receber)">
            {(id) => <StoreSelect id={id} value={toStoreId} onChange={setTo} exclude={fromStoreId} locked={false} />}
          </Field>
        </div>
        <Field label="Produtos" hint="Saldo exibido é o da loja de origem">
          {(id) => (
            <ProductPicker
              id={id}
              storeId={fromStoreId}
              onSelect={(product) =>
                setItems((l) =>
                  l.some((i) => i.product.id === product.id)
                    ? l.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i))
                    : [...l, { product, quantity: 1 }],
                )
              }
            />
          )}
        </Field>
        {items.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th className="text-right">Na origem</Th>
                <Th className="w-28">Enviar</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={i.product.id}>
                  <Td>
                    <div className="font-medium">{i.product.name}</div>
                    <div className="text-xs text-muted">{i.product.sku}</div>
                  </Td>
                  <Td className={cx('tabular text-right', i.quantity > i.product.quantity && 'text-critical-ink')}>{i.product.quantity}</Td>
                  <Td>
                    <Input
                      type="number"
                      min={1}
                      aria-label={`Quantidade de ${i.product.name}`}
                      value={i.quantity}
                      onChange={(e) => setItems((l) => l.map((x, j) => (j === idx ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))}
                    />
                  </Td>
                  <Td>
                    <button className="rounded p-1 text-muted hover:text-critical-ink" aria-label="Remover" onClick={() => setItems((l) => l.filter((_, j) => j !== idx))}>
                      <Trash2 className="size-4" />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Field label="Observações">
          {(id) => <Textarea id={id} placeholder="Ex.: enviado por motoboy às 14h" value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

function TransferDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: t, isLoading } = useQuery({ queryKey: ['transfer', id], queryFn: () => api<Transfer>(`/stock-transfers/${id}`) });
  const act = useMutation({
    mutationFn: (action: 'receive' | 'cancel') => api<Transfer>(`/stock-transfers/${id}/${action}`, { method: 'POST', body: {} }),
    onSuccess: (updated) => {
      qc.setQueryData(['transfer', id], updated);
      qc.invalidateQueries({ queryKey: ['transfers'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(updated.status === 'RECEIVED' ? 'Mercadoria recebida e estoque atualizado' : 'Transferência cancelada; estoque devolvido à origem');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const mine = (storeId: string) => me?.hasGlobalAccess || me?.storeId === storeId;

  return (
    <Modal
      open
      onClose={onClose}
      title={t ? `Transferência #${t.number}` : 'Transferência'}
      footer={
        t?.status === 'IN_TRANSIT' && (
          <>
            {can('stock_transfers.cancel') && mine(t.fromStoreId) && (
              <Button variant="danger" loading={act.isPending && act.variables === 'cancel'} onClick={() => window.confirm('Cancelar e devolver o estoque à origem?') && act.mutate('cancel')}>
                Cancelar envio
              </Button>
            )}
            {can('stock_transfers.receive') && mine(t.toStoreId) && (
              <Button variant="primary" loading={act.isPending && act.variables === 'receive'} onClick={() => act.mutate('receive')}>
                Confirmar recebimento
              </Button>
            )}
          </>
        )
      }
    >
      {isLoading || !t ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <TransferStatusBadge status={t.status} />
            <span className="font-medium">{t.fromStoreCode}</span>
            <ArrowRight className="size-4 text-muted" aria-hidden />
            <span className="font-medium">{t.toStoreCode}</span>
          </div>
          <div className="text-ink-2">
            Enviada em {formatDateTime(t.createdAt)} por {t.createdByName}
            {t.receivedAt && ` · recebida em ${formatDateTime(t.receivedAt)} por ${t.receivedByName}`}
            {t.cancelledAt && ` · cancelada em ${formatDateTime(t.cancelledAt)}`}
          </div>
          {t.notes && <p className="whitespace-pre-line text-ink-2">{t.notes}</p>}
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th className="text-right">Qtd</Th>
              </tr>
            </thead>
            <tbody>
              {t.items?.map((i) => (
                <tr key={i.id}>
                  <Td>
                    {i.name}
                    <div className="text-xs text-muted">{i.sku}</div>
                  </Td>
                  <Td className="tabular text-right">{i.quantity}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Modal>
  );
}

export function TransfersPage() {
  const { storeId, can } = useAuth();
  const [status, setStatus] = useState<TransferStatus | ''>('');
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ['transfers', storeId, status, direction, page],
    queryFn: () => api<Paginated<Transfer>>('/stock-transfers', { query: { storeId, status, direction: storeId ? direction : '', page } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Transferências entre lojas"
        subtitle="Envio retira da origem na hora; o destino recebe ao confirmar a chegada"
        actions={
          can('stock_transfers.create') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nova transferência
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="w-44" value={status} onChange={(e) => (setStatus(e.target.value as TransferStatus | ''), setPage(1))} aria-label="Status">
          <option value="">Todos os status</option>
          {TRANSFER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TRANSFER_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        {storeId && (
          <Select className="w-44" value={direction} onChange={(e) => (setDirection(e.target.value as '' | 'in' | 'out'), setPage(1))} aria-label="Direção">
            <option value="">Entradas e saídas</option>
            <option value="in">Recebimentos</option>
            <option value="out">Envios</option>
          </Select>
        )}
      </div>
      {error && <ErrorBox message={errorMessage(error)} />}
      <Card className={cx('transition-opacity', isFetching && !isLoading && 'opacity-70')}>
        {isLoading ? (
          <Spinner />
        ) : !data?.data.length ? (
          <EmptyState icon={<Truck className="size-8" />} title="Nenhuma transferência" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Nº</Th>
                  <Th>Rota</Th>
                  <Th className="text-right">Itens</Th>
                  <Th>Status</Th>
                  <Th>Enviada</Th>
                  <Th>Por</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setSelected(t.id)}>
                    <Td className="font-medium">#{t.number}</Td>
                    <Td className="whitespace-nowrap">
                      {t.fromStoreCode} <ArrowRight className="inline size-3.5 text-muted" aria-label="para" /> {t.toStoreCode}
                    </Td>
                    <Td className="tabular text-right">{t.itemCount}</Td>
                    <Td>
                      <TransferStatusBadge status={t.status} />
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(t.createdAt)}</Td>
                    <Td className="text-ink-2">{t.createdByName}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {creating && <NewTransferModal onClose={() => setCreating(false)} />}
      {selected && <TransferDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
