export { formatCents } from '@erp/shared';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const intFmt = new Intl.NumberFormat('pt-BR');
const compactFmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export const formatDate = (v?: string | Date | null) => (v ? dateFmt.format(new Date(v)) : '—');
export const formatDateTime = (v?: string | Date | null) => (v ? dateTimeFmt.format(new Date(v)) : '—');
export const formatInt = (n: number) => intFmt.format(n);

/** R$ compacto para eixos e tiles: R$ 12,9 mil / R$ 1,2 mi */
export function formatCentsCompact(cents: number): string {
  const reais = cents / 100;
  return Math.abs(reais) < 10_000 ? `R$ ${intFmt.format(Math.round(reais))}` : `R$ ${compactFmt.format(reais)}`;
}

/** Número de documento por loja: LJ01-00042 */
export const docNumber = (storeCode: string | undefined, n: number) =>
  `${storeCode ?? ''}${storeCode ? '-' : ''}${String(n).padStart(5, '0')}`;

export function formatPhone(v?: string | null): string {
  if (!v) return '—';
  const d = v.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v;
}

export function formatDocument(v?: string | null): string {
  if (!v) return '—';
  if (v.length === 11) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (v.length === 14) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v;
}

/** "12,50" → 1250 (entrada de formulário) */
export function reaisToCents(input: string): number {
  const n = Number(input.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

export function todayISO(): string {
  return new Date().toLocaleDateString('en-CA');
}
