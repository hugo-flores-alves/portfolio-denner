import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { ServiceOrderStatus } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { OrderStatusBadge } from '../components/domain';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, Spinner, Table, Td, Textarea, Th, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { docNumber, formatCents, formatDate, formatDocument, formatPhone } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import type { Customer, Paginated } from '../lib/types';

type CustomerDetail = Customer & {
  serviceOrders: Array<{ id: string; number: number; status: ServiceOrderStatus; deviceModel: string; totalCents: number; createdAt: string; storeCode: string }>;
};

function CustomerModal({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    document: customer?.document ?? '',
    notes: customer?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const { data: detail } = useQuery({
    queryKey: ['customer', customer?.id],
    queryFn: () => api<CustomerDetail>(`/customers/${customer!.id}`),
    enabled: !!customer,
  });
  const editable = customer ? can('customers.edit') : can('customers.create');

  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || null]));
      return customer ? api(`/customers/${customer.id}`, { method: 'PATCH', body }) : api('/customers', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast('Cliente salvo');
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={customer ? customer.name : 'Novo cliente'}
      footer={
        editable && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Salvar
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {error && <ErrorBox message={error} />}
        <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" required>
            {(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label="Telefone / WhatsApp">
            {(id) => <Input id={id} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
          </Field>
          <Field label="E-mail">
            {(id) => <Input id={id} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
          </Field>
          <Field label="CPF/CNPJ">
            {(id) => <Input id={id} value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />}
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            {(id) => <Textarea id={id} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}
          </Field>
        </fieldset>
        {detail && detail.serviceOrders.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Ordens de serviço</h3>
            <Table>
              <tbody>
                {detail.serviceOrders.map((o) => (
                  <tr key={o.id}>
                    <Td className="font-medium">
                      <Link to={`/ordens-servico/${o.id}`} className="hover:underline">
                        {docNumber(o.storeCode, o.number)}
                      </Link>
                    </Td>
                    <Td>{o.deviceModel}</Td>
                    <Td>
                      <OrderStatusBadge status={o.status} />
                    </Td>
                    <Td className="tabular text-right">{formatCents(o.totalCents)}</Td>
                    <Td className="text-ink-2">{formatDate(o.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function CustomersPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | null | 'new'>(null);
  const debounced = useDebounced(search);

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ['customers', debounced, page],
    queryFn: () => api<Paginated<Customer>>('/customers', { query: { search: debounced, page } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Cadastro compartilhado entre as lojas da rede"
        actions={
          can('customers.create') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Novo cliente
            </Button>
          )
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted" aria-hidden />
        <Input className="pl-9" placeholder="Nome, telefone, e-mail ou CPF" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} aria-label="Buscar clientes" />
      </div>
      {error && <ErrorBox message={errorMessage(error)} />}
      <Card className={cx('transition-opacity', isFetching && !isLoading && 'opacity-70')}>
        {isLoading ? (
          <Spinner />
        ) : !data?.data.length ? (
          <EmptyState icon={<Users className="size-8" />} title="Nenhum cliente encontrado" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Telefone</Th>
                  <Th>E-mail</Th>
                  <Th>CPF/CNPJ</Th>
                  <Th>Cliente desde</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setEditing(c)}>
                    <Td className="font-medium">{c.name}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatPhone(c.phone)}</Td>
                    <Td className="text-ink-2">{c.email ?? '—'}</Td>
                    <Td className="text-ink-2">{formatDocument(c.document)}</Td>
                    <Td className="text-ink-2">{formatDate(c.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {editing && <CustomerModal customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
