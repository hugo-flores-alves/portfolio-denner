import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Trash2, UserPlus, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { EDITABLE_SERVICE_ORDER_STATUSES } from '@erp/shared';
import { useAuth } from '../../auth/AuthContext';
import { CustomerPicker, ProductPicker, StoreSelect } from '../../components/domain';
import { useToast } from '../../components/Toast';
import { Button, Card, Checkbox, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th, cx } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { centsToInput, docNumber, formatCents, formatPhone, reaisToCents } from '../../lib/format';
import type { Customer, Paginated, Product, ServiceOrder, User } from '../../lib/types';

interface ItemRow {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  price: string;
  available?: number;
}

const emptyCustomer = { name: '', phone: '', document: '', email: '' };

export function ServiceOrderFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const { me, can, defaultOperationStoreId } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: existing, isLoading } = useQuery({
    queryKey: ['service-order', id],
    queryFn: () => api<ServiceOrder>(`/service-orders/${id}`),
    enabled: isEdit,
  });

  const [storeId, setStoreId] = useState<string | null>(defaultOperationStoreId);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerMode, setCustomerMode] = useState<'search' | 'new'>('search');
  const [newCustomer, setNewCustomer] = useState(emptyCustomer);
  const [device, setDevice] = useState({ deviceBrand: '', deviceModel: '', deviceSerial: '', deviceCondition: '', accessories: '' });
  const [reportedDefect, setReportedDefect] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [labor, setLabor] = useState('0,00');
  const [discount, setDiscount] = useState('0,00');
  const [warrantyDays, setWarrantyDays] = useState(90);
  const [estimatedAt, setEstimatedAt] = useState('');
  const [technicianId, setTechnicianId] = useState<string>('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Preenche o formulário na edição
  useEffect(() => {
    if (!existing) return;
    setStoreId(existing.storeId);
    setCustomer(existing.customer);
    setDevice({
      deviceBrand: existing.deviceBrand ?? '',
      deviceModel: existing.deviceModel,
      deviceSerial: existing.deviceSerial ?? '',
      deviceCondition: existing.deviceCondition ?? '',
      accessories: existing.accessories ?? '',
    });
    setReportedDefect(existing.reportedDefect);
    setDiagnosis(existing.diagnosis ?? '');
    setNotes(existing.notes ?? '');
    setLabor(centsToInput(existing.laborCents));
    setDiscount(centsToInput(existing.discountCents));
    setWarrantyDays(existing.warrantyDays);
    setEstimatedAt(existing.estimatedAt?.slice(0, 10) ?? '');
    setTechnicianId(existing.technicianId ?? '');
    setItems(
      existing.items.map((i) => ({
        productId: i.productId,
        sku: i.sku,
        name: i.description,
        quantity: i.quantity,
        price: centsToInput(i.unitPriceCents),
      })),
    );
  }, [existing]);

  const locked = isEdit && existing ? !EDITABLE_SERVICE_ORDER_STATUSES.includes(existing.status) : false;

  const { data: technicians } = useQuery({
    queryKey: ['users', 'technicians', storeId],
    queryFn: () => api<Paginated<User>>('/users', { query: { storeId, pageSize: 200 } }).then((r) => r.data),
    enabled: can('users.view') && !!storeId,
  });

  const partsCents = items.reduce((acc, i) => acc + reaisToCents(i.price) * i.quantity, 0);
  const laborCents = reaisToCents(labor);
  const discountCents = reaisToCents(discount);
  const totalCents = partsCents + laborCents - discountCents;

  const addProduct = (p: Product) => {
    setItems((list) => {
      const existingRow = list.find((i) => i.productId === p.id);
      if (existingRow) return list.map((i) => (i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...list, { productId: p.id, sku: p.sku, name: p.name, quantity: 1, price: centsToInput(p.priceCents), available: p.quantity }];
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const base = {
        technicianId: technicianId || null,
        diagnosis: diagnosis || null,
        notes: notes || null,
        estimatedAt: estimatedAt ? `${estimatedAt}T18:00:00` : null,
      };
      const full = {
        ...base,
        ...Object.fromEntries(Object.entries(device).map(([k, v]) => [k, v || null])),
        deviceModel: device.deviceModel,
        reportedDefect,
        laborCents,
        discountCents,
        warrantyDays,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPriceCents: reaisToCents(i.price) })),
      };
      if (isEdit) {
        return api<ServiceOrder>(`/service-orders/${id}`, {
          method: 'PATCH',
          body: locked ? base : { ...full, customerId: customer?.id },
        });
      }
      return api<ServiceOrder>('/service-orders', {
        method: 'POST',
        body: {
          ...full,
          storeId,
          ...(customerMode === 'search'
            ? { customerId: customer?.id }
            : { customer: Object.fromEntries(Object.entries(newCustomer).map(([k, v]) => [k, v || null])) }),
        },
      });
    },
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ['service-orders'] });
      qc.invalidateQueries({ queryKey: ['service-order', order.id] });
      toast(isEdit ? 'Orçamento atualizado' : `Orçamento ${docNumber(order.store.code, order.number)} criado`);
      navigate(`/ordens-servico/${order.id}`);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isEdit && customerMode === 'search' && !customer) return setError('Selecione um cliente ou cadastre um novo');
    if (!isEdit && customerMode === 'new' && newCustomer.name.trim().length < 2) return setError('Informe o nome do cliente');
    if (totalCents < 0) return setError('O desconto é maior que o total');
    save.mutate();
  };

  const technicianOptions = useMemo(() => (technicians ?? []).filter((u) => u.isActive), [technicians]);

  if (isEdit && isLoading) return <Spinner />;

  return (
    <form onSubmit={submit}>
      <PageHeader
        title={isEdit && existing ? `Editar ${docNumber(existing.store.code, existing.number)}` : 'Novo orçamento'}
        subtitle={locked ? 'Serviço concluído: apenas diagnóstico, observações e técnico podem ser alterados' : undefined}
        actions={
          <Link to={isEdit ? `/ordens-servico/${id}` : '/ordens-servico'}>
            <Button type="button" variant="ghost" icon={<ArrowLeft className="size-4" />}>
              Voltar
            </Button>
          </Link>
        }
      />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <Card title="Cliente">
            <div className="flex flex-col gap-3 p-4">
              {!isEdit && me?.hasGlobalAccess && (
                <Field label="Loja do atendimento" required>
                  {(fid) => <StoreSelect id={fid} value={storeId} onChange={setStoreId} />}
                </Field>
              )}
              {customer && (customerMode === 'search' || isEdit) ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <div>
                    <div className="font-medium text-ink">{customer.name}</div>
                    <div className="text-xs text-muted">{formatPhone(customer.phone)}</div>
                  </div>
                  {!locked && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setCustomer(null)}>
                      Trocar
                    </Button>
                  )}
                </div>
              ) : customerMode === 'search' ? (
                <>
                  <CustomerPicker onSelect={setCustomer} />
                  {!isEdit && (
                    <Button type="button" size="sm" variant="ghost" className="self-start" icon={<UserPlus className="size-4" />} onClick={() => setCustomerMode('new')}>
                      Cadastrar novo cliente
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Nome" required>
                      {(fid) => <Input id={fid} value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />}
                    </Field>
                    <Field label="Telefone / WhatsApp">
                      {(fid) => <Input id={fid} inputMode="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />}
                    </Field>
                    <Field label="CPF/CNPJ" hint="Se já cadastrado, o cliente existente é reaproveitado">
                      {(fid) => <Input id={fid} value={newCustomer.document} onChange={(e) => setNewCustomer({ ...newCustomer, document: e.target.value })} />}
                    </Field>
                    <Field label="E-mail">
                      {(fid) => <Input id={fid} type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />}
                    </Field>
                  </div>
                  <Button type="button" size="sm" variant="ghost" className="self-start" icon={<Users className="size-4" />} onClick={() => setCustomerMode('search')}>
                    Buscar cliente existente
                  </Button>
                </>
              )}
            </div>
          </Card>

          <Card title="Aparelho e defeito">
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Marca">
                {(fid) => <Input id={fid} disabled={locked} placeholder="Apple, Samsung..." value={device.deviceBrand} onChange={(e) => setDevice({ ...device, deviceBrand: e.target.value })} />}
              </Field>
              <Field label="Modelo" required>
                {(fid) => <Input id={fid} required disabled={locked} placeholder="iPhone 11" value={device.deviceModel} onChange={(e) => setDevice({ ...device, deviceModel: e.target.value })} />}
              </Field>
              <Field label="IMEI / nº de série">
                {(fid) => <Input id={fid} disabled={locked} value={device.deviceSerial} onChange={(e) => setDevice({ ...device, deviceSerial: e.target.value })} />}
              </Field>
              <Field label="Acessórios deixados">
                {(fid) => <Input id={fid} disabled={locked} placeholder="Capinha, chip..." value={device.accessories} onChange={(e) => setDevice({ ...device, accessories: e.target.value })} />}
              </Field>
              <Field label="Estado do aparelho" className="sm:col-span-2">
                {(fid) => <Input id={fid} disabled={locked} placeholder="Riscos na tampa, tela trincada..." value={device.deviceCondition} onChange={(e) => setDevice({ ...device, deviceCondition: e.target.value })} />}
              </Field>
              <Field label="Defeito relatado pelo cliente" required className="sm:col-span-2">
                {(fid) => <Textarea id={fid} required disabled={locked} value={reportedDefect} onChange={(e) => setReportedDefect(e.target.value)} />}
              </Field>
              <Field label="Diagnóstico técnico" className="sm:col-span-2">
                {(fid) => <Textarea id={fid} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />}
              </Field>
            </div>
          </Card>

          <Card title="Peças utilizadas">
            <div className="flex flex-col gap-3 p-4">
              {!locked && <ProductPicker storeId={storeId} onSelect={addProduct} />}
              {items.length > 0 ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>Peça</Th>
                      <Th className="w-24">Qtd</Th>
                      <Th className="w-32">Unitário (R$)</Th>
                      <Th className="text-right">Total</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={item.productId}>
                        <Td>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted">
                            {item.sku}
                            {item.available !== undefined && (
                              <span className={cx(item.available < item.quantity && 'font-medium text-critical-ink')}>
                                {' '}
                                · {item.available} na loja
                                {item.available < item.quantity && ' — saldo insuficiente para concluir'}
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td>
                          <Input
                            type="number"
                            min={1}
                            disabled={locked}
                            aria-label={`Quantidade de ${item.name}`}
                            value={item.quantity}
                            onChange={(e) =>
                              setItems((l) => l.map((x, i) => (i === idx ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))
                            }
                          />
                        </Td>
                        <Td>
                          <Input
                            inputMode="decimal"
                            disabled={locked}
                            aria-label={`Preço de ${item.name}`}
                            value={item.price}
                            onChange={(e) => setItems((l) => l.map((x, i) => (i === idx ? { ...x, price: e.target.value } : x)))}
                          />
                        </Td>
                        <Td className="tabular text-right">{formatCents(reaisToCents(item.price) * item.quantity)}</Td>
                        <Td>
                          {!locked && (
                            <button
                              type="button"
                              className="rounded p-1 text-muted hover:text-critical-ink"
                              aria-label={`Remover ${item.name}`}
                              onClick={() => setItems((l) => l.filter((_, i) => i !== idx))}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <p className="text-sm text-muted">Nenhuma peça adicionada. O estoque é baixado somente ao finalizar o serviço.</p>
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Valores">
            <div className="flex flex-col gap-3 p-4">
              <Field label="Mão de obra (R$)">
                {(fid) => <Input id={fid} inputMode="decimal" disabled={locked} value={labor} onChange={(e) => setLabor(e.target.value)} />}
              </Field>
              <Field label="Desconto (R$)">
                {(fid) => <Input id={fid} inputMode="decimal" disabled={locked} value={discount} onChange={(e) => setDiscount(e.target.value)} />}
              </Field>
              <dl className="mt-1 flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
                <div className="flex justify-between text-ink-2">
                  <dt>Peças</dt>
                  <dd className="tabular">{formatCents(partsCents)}</dd>
                </div>
                <div className="flex justify-between text-ink-2">
                  <dt>Mão de obra</dt>
                  <dd className="tabular">{formatCents(laborCents)}</dd>
                </div>
                <div className="flex justify-between text-ink-2">
                  <dt>Desconto</dt>
                  <dd className="tabular">− {formatCents(discountCents)}</dd>
                </div>
                <div className="flex justify-between text-base font-semibold text-ink">
                  <dt>Total</dt>
                  <dd className={cx('tabular', totalCents < 0 && 'text-critical-ink')}>{formatCents(totalCents)}</dd>
                </div>
              </dl>
            </div>
          </Card>
          <Card title="Serviço">
            <div className="flex flex-col gap-3 p-4">
              {can('users.view') ? (
                <Field label="Técnico responsável">
                  {(fid) => (
                    <Select id={fid} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
                      <option value="">— não atribuído —</option>
                      {technicianOptions.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.roleName})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <Checkbox
                  label="Sou o técnico responsável"
                  checked={technicianId === me?.id}
                  onChange={(e) => setTechnicianId(e.target.checked ? me!.id : '')}
                />
              )}
              <Field label="Garantia (dias)">
                {(fid) => <Input id={fid} type="number" min={0} disabled={locked} value={warrantyDays} onChange={(e) => setWarrantyDays(Number(e.target.value))} />}
              </Field>
              <Field label="Previsão de entrega">
                {(fid) => <Input id={fid} type="date" value={estimatedAt} onChange={(e) => setEstimatedAt(e.target.value)} />}
              </Field>
              <Field label="Observações internas">
                {(fid) => <Textarea id={fid} value={notes} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
            </div>
          </Card>
          <Button type="submit" variant="primary" loading={save.isPending} className="w-full">
            {isEdit ? 'Salvar alterações' : 'Criar orçamento'}
          </Button>
        </div>
      </div>
    </form>
  );
}
