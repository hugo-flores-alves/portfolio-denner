/** Valores monetários trafegam e são persistidos em centavos (inteiros). */
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

/**
 * Converte texto monetário em centavos, priorizando o padrão brasileiro.
 *
 *   "1.234,56" → 123456   "1234,56" → 123456   "R$ 12,50" → 1250
 *   "1234.56"  → 123456   "1.500"   → 150000   "12"       → 1200
 *
 * Retorna null quando o texto não representa um valor.
 */
export function parseMoneyToCents(input: unknown): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^R\$/i, '').replace(/\s/g, '');
  if (s === '') return null;
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;
  if (lastComma > -1 && lastDot > -1) {
    // Ambos presentes: o que aparece por último é o separador decimal
    normalized =
      lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // Só vírgula: decimal no padrão BR ("12,5"); várias vírgulas => milhar
    normalized = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot > -1) {
    const parts = s.split('.');
    const isThousands = parts.length > 2 || parts[1]?.length === 3;
    normalized = isThousands ? s.replace(/\./g, '') : s;
  } else {
    normalized = s;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}
