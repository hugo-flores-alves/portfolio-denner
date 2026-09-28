/**
 * Gráficos SVG leves (sem biblioteca), seguindo as regras de visualização:
 * marcas finas (≤ 24px), topo arredondado de 4px e base reta, 2px de "gap"
 * na cor da superfície entre segmentos, grade em hairline sólida, texto em
 * tokens de texto (nunca na cor da série), tooltip por marca (hover e foco).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Passo "redondo" para eixos: 1, 2, 2.5, 5 × 10^n */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/** Coluna com topo arredondado e base reta. */
function columnPath(x: number, y: number, w: number, h: number, round: boolean) {
  const r = round ? Math.min(4, h, w / 2) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Barra horizontal com ponta direita arredondada e base (esquerda) reta. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w, h / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

export interface Series {
  key: string;
  label: string;
  color: string; // var(--series-n)
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

function Tooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left: state.x, top: state.y - 8 }}
    >
      {state.content}
    </div>
  );
}

export function TooltipRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5 text-ink-2">
        {color && <span className="inline-block h-0.5 w-3 rounded" style={{ background: color }} aria-hidden />}
        {label}
      </span>
      <strong className="tabular font-semibold text-ink">{value}</strong>
    </div>
  );
}

// ─── Colunas empilhadas (série temporal diária) ───────────────────────────────

export function StackedColumns<T>({
  data,
  series,
  getX,
  getValue,
  formatX,
  formatValue,
  formatAxis,
  height = 240,
  tooltipTitle,
}: {
  data: T[];
  series: Series[];
  getX: (d: T) => string;
  getValue: (d: T, key: string) => number;
  formatX: (x: string) => string;
  formatValue: (v: number) => string;
  formatAxis: (v: number) => string;
  height?: number;
  tooltipTitle: (d: T) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const margin = { top: 12, right: 8, bottom: 26, left: 64 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;
  const totals = data.map((d) => series.reduce((acc, s) => acc + getValue(d, s.key), 0));
  const ticks = niceTicks(Math.max(...totals, 1));
  const max = ticks[ticks.length - 1]!;
  const band = data.length ? innerW / data.length : 0;
  const colW = Math.min(24, Math.max(2, band * 0.62));
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 56))));
  const y = (v: number) => innerH - (v / max) * innerH;

  const show = (i: number, clientX?: number) => {
    const d = data[i]!;
    const rect = ref.current?.getBoundingClientRect();
    const cx0 = margin.left + band * i + band / 2;
    setHover(i);
    setTip({
      x: clientX && rect ? clientX - rect.left : cx0,
      y: margin.top + y(totals[i]!),
      content: (
        <>
          <div className="mb-1 font-medium text-ink">{tooltipTitle(d)}</div>
          <TooltipRow label="Total" value={formatValue(totals[i]!)} />
          {[...series].reverse().map((s) => (
            <TooltipRow key={s.key} color={s.color} label={s.label} value={formatValue(getValue(d, s.key))} />
          ))}
        </>
      ),
    });
  };
  const hide = () => {
    setHover(null);
    setTip(null);
  };

  return (
    <div ref={ref} className="relative w-full" onMouseLeave={hide}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Gráfico de colunas empilhadas">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--baseline)' : 'var(--grid)'} strokeWidth={1} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-muted text-[11px]">
                  {formatAxis(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = band * i + (band - colW) / 2;
              let acc = 0;
              const visible = series.filter((s) => getValue(d, s.key) > 0);
              return (
                <g
                  key={getX(d)}
                  tabIndex={0}
                  role="img"
                  aria-label={`${tooltipTitle(d)}: ${series.map((s) => `${s.label} ${formatValue(getValue(d, s.key))}`).join(', ')}`}
                  onMouseMove={(e) => show(i, e.clientX)}
                  onFocus={() => show(i)}
                  onBlur={hide}
                  className="outline-none"
                >
                  {/* Área de acerto maior que a marca: a faixa inteira */}
                  <rect x={band * i} y={0} width={band} height={innerH} fill="transparent" />
                  {hover === i && <rect x={band * i} y={0} width={band} height={innerH} fill="var(--surface-2)" opacity={0.6} />}
                  {visible.map((s, si) => {
                    const v = getValue(d, s.key);
                    const h = (v / max) * innerH;
                    const top = innerH - acc - h;
                    acc += h;
                    // 2px de gap na cor da superfície entre segmentos empilhados
                    const gap = si > 0 ? 2 : 0;
                    return (
                      <path
                        key={s.key}
                        d={columnPath(x, top, colW, Math.max(0, h - gap), si === visible.length - 1)}
                        fill={s.color}
                      />
                    );
                  })}
                </g>
              );
            })}
            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={getX(d)} x={band * i + band / 2} y={innerH + 18} textAnchor="middle" className="tabular fill-muted text-[11px]">
                  {formatX(getX(d))}
                </text>
              ) : null,
            )}
          </g>
        </svg>
      )}
      <Tooltip state={tip} />
    </div>
  );
}

// ─── Barras horizontais (uma série; categoria nominal) ────────────────────────

export function HorizontalBars<T>({
  data,
  getLabel,
  getValue,
  formatValue,
  tooltip,
  color = 'var(--series-1)',
  sublabel,
}: {
  data: T[];
  getLabel: (d: T) => string;
  getValue: (d: T) => number;
  formatValue: (v: number) => string;
  tooltip?: (d: T) => ReactNode;
  color?: string;
  sublabel?: (d: T) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const labelW = Math.min(150, width * 0.36);
  // Espaço reservado para o rótulo de valor na ponta da barra (nunca cortado)
  const valueW = 136;
  const barH = 20;
  const rowH = 40;
  const trackW = Math.max(0, width - labelW - valueW);
  const max = Math.max(...data.map(getValue), 1);

  return (
    <div ref={ref} className="relative w-full" onMouseLeave={() => (setTip(null), setHover(null))}>
      {width > 0 && (
        <svg width={width} height={data.length * rowH} role="img" aria-label="Gráfico de barras">
          {data.map((d, i) => {
            const v = getValue(d);
            const w = (v / max) * trackW;
            const yTop = i * rowH + (rowH - barH) / 2;
            const onShow = (clientX?: number) => {
              if (!tooltip) return;
              const rect = ref.current?.getBoundingClientRect();
              setHover(i);
              setTip({ x: clientX && rect ? clientX - rect.left : labelW + w / 2, y: yTop, content: tooltip(d) });
            };
            return (
              <g
                key={getLabel(d)}
                tabIndex={tooltip ? 0 : undefined}
                className="outline-none"
                aria-label={`${getLabel(d)}: ${formatValue(v)}`}
                onMouseMove={(e) => onShow(e.clientX)}
                onFocus={() => onShow()}
                onBlur={() => (setTip(null), setHover(null))}
              >
                <rect x={0} y={i * rowH} width={width} height={rowH} fill={hover === i ? 'var(--surface-2)' : 'transparent'} opacity={0.6} />
                <text x={0} y={yTop + barH / 2 - (sublabel ? 6 : 0)} dy="0.32em" className="fill-ink text-[12px] font-medium">
                  {getLabel(d)}
                </text>
                {sublabel && (
                  <text x={0} y={yTop + barH / 2 + 8} dy="0.32em" className="fill-muted text-[11px]">
                    {sublabel(d)}
                  </text>
                )}
                <line x1={labelW} x2={labelW} y1={i * rowH + 4} y2={(i + 1) * rowH - 4} stroke="var(--baseline)" />
                {w > 0 && <path d={barPath(labelW, yTop, w, barH)} fill={color} />}
                <text x={labelW + w + 8} y={yTop + barH / 2} dy="0.32em" className="tabular fill-ink-2 text-[12px]">
                  {formatValue(v)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip state={tip} />
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  legend,
  actions,
  children,
  className,
  dimmed,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  dimmed?: boolean;
}) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface p-4', className)}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {legend}
          {actions}
        </div>
      </header>
      <div className={cx('transition-opacity', dimmed && 'opacity-60')}>{children}</div>
    </section>
  );
}
