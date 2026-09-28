import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Minus, Plus, ShoppingCart, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { CustomerPicker, ProductPicker, StoreSelect } from '../components/domain';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, cx } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { centsToInput, docNumber, formatCents, reaisToCents } from '../lib/format';
import type { Customer, Product, Sale } from '../lib/types';

interface CartItem {
  product: Product;
  quantity: number;
}

interface PaymentRow {
  method: PaymentMethod;
  amount: string;
}

export function PosPage() {
  const { me, defaultOperationStoreId, storeById } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState<string | null>(defaultOperationStoreId);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [discount, setDiscount] = useState('');
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: 'PIX', amount: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Sale | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const subtotal = cart.reduce((acc, i) => acc + i.product.priceCents * i.quantity, 0);
  const discountCents = reaisToCents(discount || '0');
  const total = Math.max(0, subtotal - discountCents);
  // Com uma única forma de pagamento em branco, assume o valor exato do total
  const paymentCents = payments.map((p, i) => (p.amount === '' && payments.length === 1 && i === 0 ? total : reaisToCents(p.amount)));
  const paid = paymentCents.reduce((a, b) => a + b, 0);
  const change = Math.max(0, paid - total);
  const missing = Math.max(0, total - paid);

  const add = (product: Product) => {
    setError(null);
    setCart((list) => {
      const found = list.find((i) => i.product.id === product.id);
      if (found) return list.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...list, { product, quantity: 1 }];
    });
  };

  const lookupBarcode = async (code: string) => {
    try {
      add(await api<Product>(`/products/lookup/${encodeURIComponent(code)}`, { query: { storeId } }));
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return false;
      throw err;
    }
  };

  const reset = () => {
    setCart([]);
    setCustomer(null);
    setDiscount('');
    setPayments([{ method: 'PIX', amount: '' }]);
    setError(null);
    setPickerKey((k) => k + 1);
  };

  const checkout = useMutation({
    mutationFn: () =>
      api<Sale>('/sales', {
        method: 'POST',
        body: {
          storeId,
          customerId: customer?.id ?? null,
          discountCents,
          items: cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
          payments: payments.map((p, i) => ({ method: p.method, amountCents: paymentCents[i] })).filter((p) => p.amountCents! > 0),
        },
      }),
    onSuccess: (sale) => {
      setDone(sale);
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['product-search'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const lowStockInCart = cart.filter((i) => i.quantity > i.product.quantity);
  const cashRow = payments.some((p) => p.method === 'CASH');

  return (
    <div>
      <PageHeader
        title="PDV — venda de balcão"
        subtitle="Capinhas, carregadores e peças avulsas sem abrir OS. Use o leitor de código de barras no campo de busca."
        actions={
          me?.hasGlobalAccess && (
            <div className="w-64">
              <StoreSelect
                value={storeId}
                onChange={(id) => {
                  setStoreId(id);
                  setCart([]);
                }}
              />
            </div>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <div className="border-b border-line p-4">
            <ProductPicker key={pickerKey} storeId={storeId} onSelect={add} onBarcode={lookupBarcode} autoFocus placeholder="Bipe o código de barras ou busque por nome/SKU..." />
          </div>
          {cart.length === 0 ? (
            <EmptyState icon={<ShoppingCart className="size-8" />} title="Carrinho vazio">
              Busque um produto ou use o leitor de código de barras.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {cart.map((item) => (
                <li key={item.product.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">{item.product.name}</div>
                    <div className={cx('text-xs', item.quantity > item.product.quantity ? 'text-critical-ink' : 'text-muted')}>
                      {item.product.sku} · {formatCents(item.product.priceCents)} un. · {item.product.quantity} em estoque
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Diminuir"
                      onClick={() =>
                        setCart((l) => l.map((i) => (i.product.id === item.product.id ? { ...i, quantity: Math.max(1, i.quantity - 1) } : i)))
                      }
                    >
                      <Minus className="size-4" />
                    </Button>
                    <span className="tabular w-8 text-center">{item.quantity}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Aumentar"
                      onClick={() => setCart((l) => l.map((i) => (i.product.id === item.product.id ? { ...i, quantity: i.quantity + 1 } : i)))}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  <div className="tabular w-24 text-right font-medium">{formatCents(item.product.priceCents * item.quantity)}</div>
                  <button
                    className="rounded p-1 text-muted hover:text-critical-ink"
                    aria-label={`Remover ${item.product.name}`}
                    onClick={() => setCart((l) => l.filter((i) => i.product.id !== item.product.id))}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Cliente (opcional)">
            <div className="p-4">
              {customer ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">{customer.name}</span>
                  <button className="text-muted hover:text-ink" onClick={() => setCustomer(null)} aria-label="Remover cliente">
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <CustomerPicker onSelect={setCustomer} />
              )}
            </div>
          </Card>

          <Card title="Pagamento">
            <div className="flex flex-col gap-3 p-4">
              <Field label="Desconto (R$)">
                {(fid) => <Input id={fid} inputMode="decimal" placeholder="0,00" value={discount} onChange={(e) => setDiscount(e.target.value)} />}
              </Field>
              {payments.map((p, idx) => (
                <div key={idx} className="flex items-end gap-2">
                  <Field label={idx === 0 ? 'Forma de pagamento' : `Pagamento ${idx + 1}`} className="flex-1">
                    {(fid) => (
                      <Select id={fid} value={p.method} onChange={(e) => setPayments((l) => l.map((x, i) => (i === idx ? { ...x, method: e.target.value as PaymentMethod } : x)))}>
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_METHOD_LABELS[m]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Valor (R$)" className="w-28">
                    {(fid) => (
                      <Input
                        id={fid}
                        inputMode="decimal"
                        placeholder={payments.length === 1 ? centsToInput(total) : '0,00'}
                        value={p.amount}
                        onChange={(e) => setPayments((l) => l.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))}
                      />
                    )}
                  </Field>
                  {payments.length > 1 && (
                    <Button size="sm" variant="ghost" className="mb-1" aria-label="Remover pagamento" onClick={() => setPayments((l) => l.filter((_, i) => i !== idx))}>
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                icon={<Plus className="size-4" />}
                onClick={() => setPayments((l) => [...l.map((x, i) => (i === 0 && x.amount === '' ? { ...x, amount: centsToInput(paymentCents[0]!) } : x)), { method: 'CASH', amount: centsToInput(missing) }])}
              >
                Dividir pagamento
              </Button>

              <dl className="flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
                <div className="flex justify-between text-ink-2">
                  <dt>Subtotal</dt>
                  <dd className="tabular">{formatCents(subtotal)}</dd>
                </div>
                {discountCents > 0 && (
                  <div className="flex justify-between text-ink-2">
                    <dt>Desconto</dt>
                    <dd className="tabular">− {formatCents(discountCents)}</dd>
                  </div>
                )}
                <div className="flex justify-between text-lg font-semibold text-ink">
                  <dt>Total</dt>
                  <dd className="tabular">{formatCents(total)}</dd>
                </div>
                {missing > 0 && cart.length > 0 && (
                  <div className="flex justify-between text-critical-ink">
                    <dt>Falta receber</dt>
                    <dd className="tabular">{formatCents(missing)}</dd>
                  </div>
                )}
                {change > 0 && (
                  <div className={cx('flex justify-between font-medium', cashRow ? 'text-good-ink' : 'text-critical-ink')}>
                    <dt>{cashRow ? 'Troco' : 'Troco só em dinheiro'}</dt>
                    <dd className="tabular">{formatCents(change)}</dd>
                  </div>
                )}
              </dl>
              {lowStockInCart.length > 0 && (
                <p className="text-xs text-critical-ink">Quantidade acima do saldo em estoque para {lowStockInCart.length} item(ns).</p>
              )}
              {error && <ErrorBox message={error} />}
              <Button
                variant="primary"
                className="h-12 text-base"
                disabled={!cart.length || !storeId || missing > 0 || (change > 0 && !cashRow)}
                loading={checkout.isPending}
                onClick={() => checkout.mutate()}
              >
                Finalizar venda
              </Button>
              {cart.length > 0 && (
                <Button variant="ghost" size="sm" onClick={reset}>
                  Cancelar e limpar
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={!!done}
        onClose={() => {
          setDone(null);
          reset();
        }}
        title="Venda concluída"
        size="sm"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setDone(null);
              reset();
              toast('Pronto para a próxima venda');
            }}
          >
            Nova venda
          </Button>
        }
      >
        {done && (
          <div className="flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="size-10 text-good" aria-hidden />
            <div className="text-sm text-ink-2">Venda {docNumber(storeById(done.storeId)?.code ?? done.storeCode, done.number)}</div>
            <div className="text-3xl font-semibold text-ink">{formatCents(done.totalCents)}</div>
            {done.changeCents > 0 && <div className="text-lg font-medium text-good-ink">Troco: {formatCents(done.changeCents)}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
