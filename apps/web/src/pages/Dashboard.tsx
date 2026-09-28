import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, Coins, Package, Receipt, TrendingUp, Truck, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PAYMENT_METHOD_LABELS, SERVICE_ORDER_STATUS_LABELS } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { ChartCard, HorizontalBars, Legend, StackedColumns, TooltipRow, type Series } from '../components/charts';
import { Button, Card, ErrorBox, Input, PageHeader, Spinner, StatTile, Table, Td, Th, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatCents, formatCentsCompact, formatInt, todayISO } from '../lib/format';
import type { DashboardSummary } from '../lib/types';

type Preset = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom';

function rangeFor(preset: Preset): { from: string; to: string } {
  const today = new Date();
  const iso = (d: Date) => d.toLocaleDateString('en-CA');
  const minus = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return iso(d);
  };
  switch (preset) {
    case 'today':
      return { from: iso(today), to: iso(today) };
    case '7d':
      return { from: minus(6), to: iso(today) };
    case '30d':
      return { from: minus(29), to: iso(today) };
    case 'lastMonth': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: iso(first), to: iso(last) };
    }
    default:
      return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
  }
}

const PRESETS: Array<[Preset, string]> = [
  ['today', 'Hoje'],
  ['7d', '7 dias'],
  ['30d', '30 dias'],
  ['month', 'Este mês'],
  ['lastMonth', 'Mês anterior'],
];

const SERIES: Series[] = [
  { key: 'salesCents', label: 'Vendas (PDV)', color: 'var(--series-1)' },
  { key: 'serviceOrdersCents', label: 'Ordens de serviço', color: 'var(--series-2)' },
];

const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function DashboardPage() {
  const { storeId, storeById } = useAuth();
  const [preset, setPreset] = useState<Preset>('month');
  const [range, setRange] = useState(rangeFor('month'));
  const [dailyAsTable, setDailyAsTable] = useState(false);

  const { data, error, isFetching, isLoading } = useQuery({
    queryKey: ['dashboard', storeId, range],
    queryFn: () => api<DashboardSummary>('/dashboard/summary', { query: { storeId, ...range } }),
    placeholderData: keepPreviousData,
  });

  const scopeLabel = storeId ? `${storeById(storeId)?.code} — ${storeById(storeId)?.name}` : 'Todas as lojas (consolidado)';

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={scopeLabel} />

      {/* Filtros: uma linha, acima de tudo que eles afetam */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Período">
          {PRESETS.map(([key, label]) => (
            <button
              key={key}
              className={cx(
                'rounded-md px-3 py-1.5 text-sm',
                preset === key ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:bg-surface-2',
              )}
              aria-pressed={preset === key}
              onClick={() => {
                setPreset(key);
                setRange(rangeFor(key));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-sm text-ink-2">
          <Input
            type="date"
            aria-label="Data inicial"
            className="h-9 w-auto"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              setPreset('custom');
              setRange((r) => ({ ...r, from: e.target.value }));
            }}
          />
          até
          <Input
            type="date"
            aria-label="Data final"
            className="h-9 w-auto"
            value={range.to}
            min={range.from}
            max={todayISO()}
            onChange={(e) => {
              setPreset('custom');
              setRange((r) => ({ ...r, to: e.target.value }));
            }}
          />
        </div>
      </div>

      {error && <ErrorBox message={errorMessage(error)} />}
      {isLoading && <Spinner />}
      {data && (
        <div className={cx('flex flex-col gap-5 transition-opacity', isFetching && 'opacity-60')}>
          {/* Número-herói + tiles */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
            <div className="rounded-xl border border-line bg-surface p-5">
              <div className="text-sm text-ink-2">Faturamento no período</div>
              <div className="mt-2 text-5xl font-semibold tracking-tight text-ink">{formatCents(data.totals.revenueCents)}</div>
              <div className="mt-4 flex flex-col gap-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-ink-2">
                    <span className="inline-block size-2.5 rounded-sm bg-series-1" aria-hidden /> Vendas (PDV)
                  </span>
                  <span className="tabular text-ink">{formatCents(data.totals.salesCents)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-ink-2">
                    <span className="inline-block size-2.5 rounded-sm bg-series-2" aria-hidden /> Ordens de serviço
                  </span>
                  <span className="tabular text-ink">{formatCents(data.totals.serviceOrdersCents)}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              <StatTile
                icon={<TrendingUp className="size-4" />}
                label="Lucro bruto estimado"
                value={formatCentsCompact(data.totals.grossProfitCents)}
                hint={
                  data.totals.revenueCents
                    ? `Margem ${Math.round((data.totals.grossProfitCents / data.totals.revenueCents) * 100)}% (sobre custo das peças)`
                    : 'Sem faturamento no período'
                }
              />
              <StatTile
                icon={<Receipt className="size-4" />}
                label="Vendas no balcão"
                value={formatInt(data.totals.salesCount)}
                hint={`Ticket médio ${formatCents(data.totals.averageTicketCents)}`}
              />
              <StatTile
                icon={<Wrench className="size-4" />}
                label="OS concluídas"
                value={formatInt(data.totals.serviceOrdersCompleted)}
                hint="Peças baixadas no período"
              />
              <StatTile
                icon={<ClipboardList className="size-4" />}
                label="OS em aberto"
                value={formatInt(data.serviceOrders.openTotal)}
                hint={(['AWAITING_APPROVAL', 'IN_PROGRESS', 'COMPLETED'] as const)
                  .map((s) => `${data.serviceOrders.open[s]} ${s === 'COMPLETED' ? 'p/ retirada' : SERVICE_ORDER_STATUS_LABELS[s].toLowerCase()}`)
                  .join(' · ')}
              />
              <StatTile
                icon={<Package className="size-4" />}
                label="Estoque (a custo)"
                value={formatCentsCompact(data.inventory.stockValueCents)}
                hint={`${formatInt(data.inventory.units)} unidades`}
              />
              <StatTile
                icon={<AlertTriangle className="size-4" />}
                label="Alertas de reposição"
                value={formatInt(data.inventory.lowStockCount)}
                hint={
                  <span className="flex flex-wrap gap-x-2">
                    <Link className="text-accent-ink hover:underline" to="/produtos?lowStock=1">
                      Ver itens
                    </Link>
                    {data.inventory.transfersInTransit > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Truck className="size-3" aria-hidden /> {data.inventory.transfersInTransit} em trânsito
                      </span>
                    )}
                  </span>
                }
              />
            </div>
          </div>

          <ChartCard
            title="Faturamento diário"
            subtitle="Vendas pela data da venda · OS pela data de conclusão"
            legend={<Legend series={SERIES} />}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setDailyAsTable((v) => !v)}>
                {dailyAsTable ? 'Ver gráfico' : 'Ver tabela'}
              </Button>
            }
          >
            {dailyAsTable ? (
              <Table className="max-h-80 overflow-y-auto">
                <thead>
                  <tr>
                    <Th>Dia</Th>
                    <Th className="text-right">Vendas</Th>
                    <Th className="text-right">OS</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={d.date}>
                      <Td>{shortDate(d.date)}</Td>
                      <Td className="tabular text-right">{formatCents(d.salesCents)}</Td>
                      <Td className="tabular text-right">{formatCents(d.serviceOrdersCents)}</Td>
                      <Td className="tabular text-right font-medium">{formatCents(d.salesCents + d.serviceOrdersCents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <StackedColumns
                data={data.daily}
                series={SERIES}
                getX={(d) => d.date}
                getValue={(d, key) => d[key as 'salesCents' | 'serviceOrdersCents']}
                formatX={shortDate}
                formatValue={formatCents}
                formatAxis={formatCentsCompact}
                tooltipTitle={(d) => new Date(`${d.date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
              />
            )}
          </ChartCard>

          <div className="grid gap-5 lg:grid-cols-2">
            {data.byStore && (
              <ChartCard title="Faturamento por loja" subtitle="Vendas + OS no período">
                <HorizontalBars
                  data={[...data.byStore].sort((a, b) => b.revenueCents - a.revenueCents)}
                  getLabel={(s) => s.code}
                  sublabel={(s) => s.name}
                  getValue={(s) => s.revenueCents}
                  formatValue={formatCentsCompact}
                  tooltip={(s) => (
                    <>
                      <div className="mb-1 font-medium text-ink">{s.name}</div>
                      <TooltipRow label="Faturamento" value={formatCents(s.revenueCents)} />
                      <TooltipRow color="var(--series-1)" label="Vendas" value={formatCents(s.salesCents)} />
                      <TooltipRow color="var(--series-2)" label="OS" value={formatCents(s.serviceOrdersCents)} />
                      <TooltipRow label="OS em aberto" value={String(s.openServiceOrders)} />
                    </>
                  )}
                />
              </ChartCard>
            )}
            <ChartCard title="Recebimentos por forma de pagamento" subtitle="Vendas do PDV · dinheiro líquido de troco">
              {data.paymentMethods.length ? (
                <HorizontalBars
                  data={data.paymentMethods}
                  getLabel={(p) => PAYMENT_METHOD_LABELS[p.method]}
                  getValue={(p) => p.amountCents}
                  formatValue={(v) => {
                    const total = data.paymentMethods.reduce((a, p) => a + p.amountCents, 0);
                    return `${formatCentsCompact(v)} · ${total ? Math.round((v / total) * 100) : 0}%`;
                  }}
                />
              ) : (
                <p className="py-6 text-center text-sm text-muted">Nenhuma venda no período</p>
              )}
            </ChartCard>
            {data.byStore && (
              <Card title="Comparativo entre lojas" className="lg:col-span-2">
                <Table>
                  <thead>
                    <tr>
                      <Th>Loja</Th>
                      <Th className="text-right">Faturamento</Th>
                      <Th className="text-right">Vendas</Th>
                      <Th className="text-right">OS concl.</Th>
                      <Th className="text-right">OS abertas</Th>
                      <Th className="text-right">Estoque</Th>
                      <Th className="text-right">Alertas repos.</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byStore.map((s) => (
                      <tr key={s.storeId}>
                        <Td className="font-medium whitespace-nowrap">
                          {s.code} <span className="font-normal text-ink-2">{s.name}</span>
                        </Td>
                        <Td className="tabular text-right whitespace-nowrap">{formatCents(s.revenueCents)}</Td>
                        <Td className="tabular text-right whitespace-nowrap">{s.salesCount}</Td>
                        <Td className="tabular text-right whitespace-nowrap">{s.serviceOrdersCompleted}</Td>
                        <Td className="tabular text-right whitespace-nowrap">{s.openServiceOrders}</Td>
                        <Td className="tabular text-right whitespace-nowrap">{formatCentsCompact(s.stockValueCents)}</Td>
                        <Td className="tabular text-right whitespace-nowrap">{s.lowStockCount}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}
            <Card title="Mais vendidos (PDV + OS)" className={cx(data.byStore && 'lg:col-span-2')}>
              {data.topProducts.length ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>Produto</Th>
                      <Th className="text-right">Qtd</Th>
                      <Th className="text-right">Receita</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.map((p) => (
                      <tr key={p.productId}>
                        <Td>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted">{p.sku}</div>
                        </Td>
                        <Td className="tabular text-right">{p.quantity}</Td>
                        <Td className="tabular text-right">{formatCents(p.revenueCents)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <p className="py-6 text-center text-sm text-muted">Nada vendido no período</p>
              )}
            </Card>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Coins className="size-3.5" aria-hidden /> Lucro bruto = faturamento − custo das peças/produtos no momento da venda (não inclui despesas).
          </p>
        </div>
      )}
    </div>
  );
}
