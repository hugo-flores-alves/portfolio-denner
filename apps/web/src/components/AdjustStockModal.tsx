import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, errorMessage } from '../lib/api';
import type { Product } from '../lib/types';
import { ProductPicker, StoreSelect } from './domain';
import { useToast } from './Toast';
import { Button, ErrorBox, Field, Input, Modal, Select } from './ui';

/** Ajuste manual (inventário, entrada de mercadoria, avaria) com motivo obrigatório. */
export function AdjustStockModal({ product: initial, onClose }: { product?: Product; onClose: () => void }) {
  const { defaultOperationStoreId, me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState<string | null>(defaultOperationStoreId);
  const [product, setProduct] = useState<Product | undefined>(initial);
  const [mode, setMode] = useState<'SET' | 'ADD'>('ADD');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // stockByStore traz só lojas com saldo registrado; ausência = 0
  const current = product && storeId ? (product.stockByStore[storeId] ?? 0) : null;

  const save = useMutation({
    mutationFn: () =>
      api('/stock/adjustments', {
        method: 'POST',
        body: { storeId, reason, items: [{ productId: product!.id, mode, quantity: Number(quantity) }] },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Estoque ajustado');
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const valid = product && storeId && quantity !== '' && Number.isInteger(Number(quantity)) && reason.trim().length >= 3 && (mode === 'SET' ? Number(quantity) >= 0 : Number(quantity) !== 0);

  return (
    <Modal
      open
      onClose={onClose}
      title="Ajuste de estoque"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Registrar ajuste
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <ErrorBox message={error} />}
        {me?.hasGlobalAccess && (
          <Field label="Loja" required>
            {(id) => <StoreSelect id={id} value={storeId} onChange={setStoreId} />}
          </Field>
        )}
        {product ? (
          <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
            <div>
              <div className="font-medium text-ink">{product.name}</div>
              <div className="text-xs text-muted">
                {product.sku}
                {current !== null && ` · saldo atual nesta loja: ${current}`}
              </div>
            </div>
            {!initial && (
              <Button size="sm" variant="ghost" onClick={() => setProduct(undefined)}>
                Trocar
              </Button>
            )}
          </div>
        ) : (
          <Field label="Produto" required>
            {(id) => <ProductPicker id={id} storeId={storeId} onSelect={setProduct} />}
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo de ajuste">
            {(id) => (
              <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as 'SET' | 'ADD')}>
                <option value="ADD">Somar / subtrair (entrada, perda)</option>
                <option value="SET">Definir saldo (contagem)</option>
              </Select>
            )}
          </Field>
          <Field label={mode === 'SET' ? 'Novo saldo' : 'Quantidade (+/−)'} hint={mode === 'ADD' ? 'Use negativo para baixa (ex.: -2)' : undefined}>
            {(id) => <Input id={id} type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
          </Field>
        </div>
        <Field label="Motivo" required hint="Fica registrado no kardex">
          {(id) => <Input id={id} placeholder="Inventário mensal, avaria, compra NF 1234..." value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}
