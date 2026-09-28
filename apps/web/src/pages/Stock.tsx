import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { STOCK_MOVEMENT_LABELS, STOCK_MOVEMENT_TYPES, type StockMovementType } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { AdjustStockModal } from '../components/AdjustStockModal';
import { ProductPicker } from '../components/domain';
import { Button, Card, EmptyState, ErrorBox, PageHeader, Pagination, Select, Spinner, Table, Td, Th, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { Paginated, Product, StockMovement } from '../lib/types';

export function StockPage() {
  const { storeId, can } = useAuth();
  const [type, setType] = useState<StockMovementType | ''>('');
  const [product, setProduct] = useState<Product | null>(null);
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState(false);

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ['stock-movements', storeId, type, product?.id, page],
    queryFn: () =>
      api<Paginated<StockMovement>>('/stock/movements', { query: { storeId, type, productId: product?.id, page, pageSize: 30 } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Movimentações de estoque"
        subtitle="Kardex: toda entrada e saída, com saldo resultante e origem"
        actions={
          can('stock.adjust') && (
            <Button variant="primary" icon={<SlidersHorizontal className="size-4" />} onClick={() => setAdjusting(true)}>
              Ajuste de estoque
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select className="w-60" value={type} onChange={(e) => (setType(e.target.value as StockMovementType | ''), setPage(1))} aria-label="Tipo de movimento">
          <option value="">Todos os tipos</option>
          {STOCK_MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {STOCK_MOVEMENT_LABELS[t]}
            </option>
          ))}
        </Select>
        <div className="w-full max-w-md">
          {product ? (
            <div className="flex h-10 items-center justify-between rounded-lg border border-line bg-surface px-3 text-sm">
              <span className="truncate">
                {product.sku} — {product.name}
              </span>
              <Button size="sm" variant="ghost" onClick={() => (setProduct(null), setPage(1))}>
                Limpar
              </Button>
            </div>
          ) : (
            <ProductPicker storeId={storeId} onSelect={(p) => (setProduct(p), setPage(1))} placeholder="Filtrar por produto..." />
          )}
        </div>
      </div>
      {error && <ErrorBox message={errorMessage(error)} />}
      <Card className={cx('transition-opacity', isFetching && !isLoading && 'opacity-70')}>
        {isLoading ? (
          <Spinner />
        ) : !data?.data.length ? (
          <EmptyState icon={<ArrowLeftRight className="size-8" />} title="Nenhuma movimentação" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Loja</Th>
                  <Th>Produto</Th>
                  <Th>Tipo</Th>
                  <Th className="text-right">Qtd</Th>
                  <Th className="text-right">Saldo</Th>
                  <Th>Usuário / observação</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((m) => (
                  <tr key={m.id}>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(m.createdAt)}</Td>
                    <Td className="font-medium">{m.storeCode}</Td>
                    <Td>
                      <div className="max-w-64 truncate">{m.productName}</div>
                      <div className="text-xs text-muted">{m.productSku}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{STOCK_MOVEMENT_LABELS[m.type]}</Td>
                    <Td className={cx('tabular text-right font-medium', m.quantity > 0 ? 'text-good-ink' : 'text-critical-ink')}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </Td>
                    <Td className="tabular text-right">{m.balanceAfter}</Td>
                    <Td>
                      <div className="text-ink-2">{m.userName ?? 'sistema'}</div>
                      {m.note && <div className="max-w-72 truncate text-xs text-muted">{m.note}</div>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {adjusting && <AdjustStockModal onClose={() => setAdjusting(false)} />}
    </div>
  );
}
