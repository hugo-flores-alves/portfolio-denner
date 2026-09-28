import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Package, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { AdjustStockModal } from '../components/AdjustStockModal';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { centsToInput, formatCents, reaisToCents } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import type { Paginated, Product } from '../lib/types';

function ProductModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    name: product?.name ?? '',
    category: product?.category ?? '',
    brand: product?.brand ?? '',
    compatibleModels: product?.compatibleModels ?? '',
    description: product?.description ?? '',
    cost: product ? centsToInput(product.costCents) : '',
    price: product ? centsToInput(product.priceCents) : '',
    minStock: String(product?.minStock ?? 0),
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        sku: form.sku,
        barcode: form.barcode || null,
        name: form.name,
        category: form.category || null,
        brand: form.brand || null,
        compatibleModels: form.compatibleModels || null,
        description: form.description || null,
        costCents: reaisToCents(form.cost || '0'),
        priceCents: reaisToCents(form.price || '0'),
        minStock: Number(form.minStock) || 0,
      };
      return product ? api(`/products/${product.id}`, { method: 'PATCH', body }) : api('/products', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast(product ? 'Produto atualizado' : 'Produto cadastrado');
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={product ? `Editar ${product.sku}` : 'Novo produto'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><ErrorBox message={error} /></div>}
        <Field label="SKU" required hint="Único na rede; normalizado em maiúsculas">
          {(id) => <Input id={id} value={form.sku} onChange={set('sku')} />}
        </Field>
        <Field label="Código de barras (EAN)">
          {(id) => <Input id={id} value={form.barcode} onChange={set('barcode')} />}
        </Field>
        <Field label="Nome" required className="sm:col-span-2">
          {(id) => <Input id={id} value={form.name} onChange={set('name')} />}
        </Field>
        <Field label="Categoria">
          {(id) => <Input id={id} value={form.category} onChange={set('category')} placeholder="Telas, Baterias..." />}
        </Field>
        <Field label="Marca">
          {(id) => <Input id={id} value={form.brand} onChange={set('brand')} />}
        </Field>
        <Field label="Modelos compatíveis" className="sm:col-span-2">
          {(id) => <Input id={id} value={form.compatibleModels} onChange={set('compatibleModels')} placeholder="iPhone 11, iPhone 11 Pro" />}
        </Field>
        <Field label="Preço de custo (R$)">
          {(id) => <Input id={id} inputMode="decimal" value={form.cost} onChange={set('cost')} />}
        </Field>
        <Field label="Preço de venda (R$)">
          {(id) => <Input id={id} inputMode="decimal" value={form.price} onChange={set('price')} />}
        </Field>
        <Field label="Estoque mínimo por loja" hint="Gera alerta de reposição">
          {(id) => <Input id={id} type="number" min={0} value={form.minStock} onChange={set('minStock')} />}
        </Field>
        <Field label="Descrição" className="sm:col-span-2">
          {(id) => <Textarea id={id} value={form.description} onChange={set('description')} />}
        </Field>
        {!product && <p className="text-xs text-muted sm:col-span-2">O saldo inicial é lançado por loja via ajuste de estoque ou importação.</p>}
      </div>
    </Modal>
  );
}

export function ProductsPage() {
  const { storeId, stores, can, storeById } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const lowStock = params.get('lowStock') === '1';
  const debounced = useDebounced(search);

  const { data: categories = [] } = useQuery({ queryKey: ['products', 'categories'], queryFn: () => api<string[]>('/products/categories') });
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ['products', storeId, debounced, category, lowStock, page],
    queryFn: () => api<Paginated<Product>>('/products', { query: { storeId, search: debounced, category, lowStock, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });

  const isLow = (p: Product) =>
    p.minStock > 0 &&
    (storeId ? p.quantity <= p.minStock : stores.some((s) => (p.stockByStore[s.id] ?? 0) <= p.minStock));

  return (
    <div>
      <PageHeader
        title="Produtos e peças"
        subtitle={`Catálogo da rede · saldo ${storeId ? `da ${storeById(storeId)?.code}` : 'somado das lojas'}`}
        actions={
          <>
            {can('stock.adjust') && (
              <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setAdjusting({} as Product)}>
                Ajustar estoque
              </Button>
            )}
            {can('products.create') && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                Novo produto
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted" aria-hidden />
          <Input className="pl-9" placeholder="Nome, SKU, código de barras, modelo..." value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} aria-label="Buscar produtos" />
        </div>
        <Select className="w-48" value={category} onChange={(e) => (setCategory(e.target.value), setPage(1))} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Checkbox
          label="Somente abaixo do mínimo"
          checked={lowStock}
          onChange={(e) => {
            setPage(1);
            setParams(e.target.checked ? { lowStock: '1' } : {});
          }}
        />
      </div>

      {error && <ErrorBox message={errorMessage(error)} />}
      <Card className={cx('transition-opacity', isFetching && !isLoading && 'opacity-70')}>
        {isLoading ? (
          <Spinner />
        ) : !data?.data.length ? (
          <EmptyState icon={<Package className="size-8" />} title="Nenhum produto encontrado">
            Cadastre produtos manualmente ou importe sua planilha em Estoque › Importação.
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th>Categoria</Th>
                  <Th className="text-right">Custo</Th>
                  <Th className="text-right">Venda</Th>
                  <Th className="text-right">Estoque</Th>
                  <Th className="text-right">Mín.</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p.id} className={cx(!p.isActive && 'opacity-50')}>
                    <Td>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted">
                        {p.sku}
                        {p.barcode && ` · ${p.barcode}`}
                      </div>
                    </Td>
                    <Td className="text-ink-2">{p.category ?? '—'}</Td>
                    <Td className="tabular text-right text-ink-2">{formatCents(p.costCents)}</Td>
                    <Td className="tabular text-right">{formatCents(p.priceCents)}</Td>
                    <Td className="text-right">
                      <div className="tabular font-medium">{p.quantity}</div>
                      {!storeId && stores.length > 1 && (
                        <div className="tabular text-xs whitespace-nowrap text-muted">
                          {stores.map((s) => `${s.code} ${p.stockByStore[s.id] ?? 0}`).join(' · ')}
                        </div>
                      )}
                    </Td>
                    <Td className="text-right">
                      {isLow(p) ? (
                        <Badge tone="critical" icon={<AlertTriangle className="size-3" aria-hidden />}>
                          Repor · {p.minStock}
                        </Badge>
                      ) : (
                        <span className="tabular text-ink-2">{p.minStock}</span>
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {can('stock.adjust') && (
                        <Button size="sm" variant="ghost" onClick={() => setAdjusting(p)}>
                          Ajustar
                        </Button>
                      )}
                      {can('products.edit') && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          Editar
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {editing && <ProductModal product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {adjusting && <AdjustStockModal product={adjusting.id ? adjusting : undefined} onClose={() => setAdjusting(null)} />}
    </div>
  );
}
