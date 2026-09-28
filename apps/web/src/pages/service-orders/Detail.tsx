import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, Pencil, Printer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  EDITABLE_SERVICE_ORDER_STATUSES,
  isStockDeductedStatus,
  SERVICE_ORDER_STATUS_LABELS,
  SERVICE_ORDER_TRANSITION_LABELS,
  SERVICE_ORDER_TRANSITIONS,
  type ServiceOrderStatus,
} from '@erp/shared';
import { useAuth } from '../../auth/AuthContext';
import { OrderStatusBadge } from '../../components/domain';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorBox, Field, Modal, PageHeader, Spinner, Table, Td, Textarea, Th } from '../../components/ui';
import { api, ApiError, errorMessage } from '../../lib/api';
import { docNumber, formatCents, formatDate, formatDateTime, formatDocument, formatPhone } from '../../lib/format';
import type { ServiceOrder } from '../../lib/types';

interface Shortage {
  sku: string;
  name: string;
  available: number;
  requested: number;
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-ink">{value || '—'}</dd>
    </div>
  );
}

export function ServiceOrderDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [target, setTarget] = useState<ServiceOrderStatus | null>(null);
  const [note, setNote] = useState('');
  const [statusError, setStatusError] = useState<{ message: string; shortages?: Shortage[] } | null>(null);

  const { data: order, error, isLoading } = useQuery({
    queryKey: ['service-order', id],
    queryFn: () => api<ServiceOrder>(`/service-orders/${id}`),
  });

  const changeStatus = useMutation({
    mutationFn: () => api<ServiceOrder>(`/service-orders/${id}/status`, { method: 'POST', body: { status: target, note: note || null } }),
    onSuccess: (updated) => {
      qc.setQueryData(['service-order', id], updated);
      qc.invalidateQueries({ queryKey: ['service-orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(`Status alterado para "${SERVICE_ORDER_STATUS_LABELS[updated.status]}"`);
      setTarget(null);
      setNote('');
    },
    onError: (err) =>
      setStatusError({
        message: errorMessage(err),
        shortages: err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK' ? (err.details as Shortage[]) : undefined,
      }),
  });

  const remove = useMutation({
    mutationFn: () => api(`/service-orders/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-orders'] });
      toast('Orçamento excluído');
      navigate('/ordens-servico');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (isLoading) return <Spinner />;
  if (error || !order) return <ErrorBox message={errorMessage(error)} />;

  const number = docNumber(order.store.code, order.number);
  const transitions = SERVICE_ORDER_TRANSITIONS[order.status];
  const canEdit = can('service_orders.edit') && order.status !== 'DELIVERED' && order.status !== 'CANCELLED';
  const canDelete =
    can('service_orders.delete') && !order.stockDeducted && ['AWAITING_APPROVAL', 'REJECTED', 'CANCELLED'].includes(order.status);

  const willDeduct = target && isStockDeductedStatus(target) && !order.stockDeducted;
  const willRevert = target && !isStockDeductedStatus(target) && order.stockDeducted;

  return (
    <div className="print-area">
      <PageHeader
        title={`OS ${number}`}
        subtitle={`${order.store.name} · aberta em ${formatDateTime(order.createdAt)}`}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Link to="/ordens-servico">
              <Button variant="ghost" icon={<ArrowLeft className="size-4" />}>
                Voltar
              </Button>
            </Link>
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
              Imprimir
            </Button>
            {canEdit && (
              <Link to={`/ordens-servico/${order.id}/editar`}>
                <Button icon={<Pencil className="size-4" />}>Editar</Button>
              </Link>
            )}
            {canDelete && (
              <Button
                variant="danger"
                icon={<Trash2 className="size-4" />}
                loading={remove.isPending}
                onClick={() => window.confirm(`Excluir o orçamento ${number}?`) && remove.mutate()}
              >
                Excluir
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
        <OrderStatusBadge status={order.status} />
        <span className="text-sm text-ink-2">
          {order.stockDeducted ? 'Peças baixadas do estoque da loja' : 'Peças ainda não baixadas do estoque'}
        </span>
        {can('service_orders.change_status') && transitions.length > 0 && (
          <div className="no-print ml-auto flex flex-wrap gap-2">
            {transitions.map((to) => (
              <Button
                key={to}
                size="sm"
                variant={to === 'CANCELLED' || to === 'REJECTED' ? 'danger' : 'primary'}
                onClick={() => {
                  setStatusError(null);
                  setTarget(to);
                }}
              >
                {SERVICE_ORDER_TRANSITION_LABELS[order.status]?.[to] ?? SERVICE_ORDER_STATUS_LABELS[to]}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 md:grid-cols-2">
            <Card title="Cliente">
              <dl className="grid gap-3 p-4">
                <Info label="Nome" value={order.customer.name} />
                <Info label="Telefone" value={formatPhone(order.customer.phone)} />
                <Info label="CPF/CNPJ" value={formatDocument(order.customer.document)} />
              </dl>
            </Card>
            <Card title="Aparelho">
              <dl className="grid grid-cols-2 gap-3 p-4">
                <Info label="Marca / modelo" value={[order.deviceBrand, order.deviceModel].filter(Boolean).join(' ')} />
                <Info label="IMEI / série" value={order.deviceSerial} />
                <Info label="Acessórios" value={order.accessories} />
                <Info label="Estado" value={order.deviceCondition} />
              </dl>
            </Card>
          </div>
          <Card title="Defeito e diagnóstico">
            <dl className="grid gap-3 p-4">
              <Info label="Defeito relatado" value={order.reportedDefect} />
              <Info label="Diagnóstico técnico" value={order.diagnosis} />
              {order.notes && <Info label="Observações" value={order.notes} />}
            </dl>
          </Card>
          <Card title="Peças e serviços">
            <Table>
              <thead>
                <tr>
                  <Th>Descrição</Th>
                  <Th className="text-right">Qtd</Th>
                  <Th className="text-right">Unitário</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <Td>{i.description}</Td>
                    <Td className="tabular text-right">{i.quantity}</Td>
                    <Td className="tabular text-right">{formatCents(i.unitPriceCents)}</Td>
                    <Td className="tabular text-right">{formatCents(i.totalCents)}</Td>
                  </tr>
                ))}
                <tr>
                  <Td>Mão de obra</Td>
                  <Td />
                  <Td />
                  <Td className="tabular text-right">{formatCents(order.laborCents)}</Td>
                </tr>
                {order.discountCents > 0 && (
                  <tr>
                    <Td>Desconto</Td>
                    <Td />
                    <Td />
                    <Td className="tabular text-right">− {formatCents(order.discountCents)}</Td>
                  </tr>
                )}
                <tr>
                  <Td className="font-semibold">Total</Td>
                  <Td />
                  <Td />
                  <Td className="tabular text-right text-base font-semibold">{formatCents(order.totalCents)}</Td>
                </tr>
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Resumo">
            <dl className="grid gap-3 p-4">
              <Info label="Técnico" value={order.technicianName} />
              <Info label="Garantia" value={`${order.warrantyDays} dias`} />
              <Info label="Previsão de entrega" value={formatDate(order.estimatedAt)} />
              <Info label="Aprovado em" value={formatDateTime(order.approvedAt)} />
              <Info label="Concluído em" value={formatDateTime(order.completedAt)} />
              <Info label="Entregue em" value={formatDateTime(order.deliveredAt)} />
            </dl>
          </Card>
          <Card title="Histórico" className="no-print">
            <ol className="flex flex-col gap-3 p-4">
              {[...order.history].reverse().map((h) => (
                <li key={h.id} className="border-l-2 border-line pl-3">
                  <div className="text-sm text-ink">
                    {h.fromStatus ? `${SERVICE_ORDER_STATUS_LABELS[h.fromStatus]} → ` : ''}
                    <strong className="font-medium">{SERVICE_ORDER_STATUS_LABELS[h.toStatus]}</strong>
                  </div>
                  <div className="text-xs text-muted">
                    {formatDateTime(h.createdAt)} · {h.userName ?? 'sistema'}
                  </div>
                  {h.note && <div className="mt-1 text-xs text-ink-2">{h.note}</div>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title={target ? (SERVICE_ORDER_TRANSITION_LABELS[order.status]?.[target] ?? SERVICE_ORDER_STATUS_LABELS[target]) : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Voltar
            </Button>
            <Button variant="primary" loading={changeStatus.isPending} onClick={() => changeStatus.mutate()}>
              Confirmar
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">
            {target && (
              <>
                {SERVICE_ORDER_STATUS_LABELS[order.status]} → <strong className="text-ink">{SERVICE_ORDER_STATUS_LABELS[target]}</strong>
              </>
            )}
          </p>
          {willDeduct && order.items.length > 0 && (
            <div className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-ink">
              As {order.items.reduce((a, i) => a + i.quantity, 0)} peça(s) desta OS serão baixadas do estoque da {order.store.code}.
            </div>
          )}
          {willRevert && (
            <div className="rounded-lg bg-warning/18 px-3 py-2 text-sm text-warning-ink">
              As peças baixadas voltarão ao estoque da {order.store.code}.
            </div>
          )}
          {statusError && (
            <div role="alert" className="rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical-ink">
              <div className="flex items-center gap-1.5 font-medium">
                <CircleAlert className="size-4" aria-hidden />
                {statusError.shortages ? 'Estoque insuficiente — nada foi alterado' : statusError.message}
              </div>
              {statusError.shortages && (
                <ul className="mt-1.5 list-disc pl-5">
                  {statusError.shortages.map((s) => (
                    <li key={s.sku}>
                      {s.name} ({s.sku}): disponível {s.available}, necessário {s.requested}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Field label="Observação (opcional)" hint="Fica registrada no histórico da OS">
            {(fid) => <Textarea id={fid} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: cliente aprovou por WhatsApp" />}
          </Field>
          {target && !EDITABLE_SERVICE_ORDER_STATUSES.includes(target) && EDITABLE_SERVICE_ORDER_STATUSES.includes(order.status) && (
            <p className="text-xs text-muted">Depois disso, peças e valores ficam travados para edição.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
