import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

// ─── Botões ───────────────────────────────────────────────────────────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border-transparent',
  secondary: 'bg-surface text-ink border-line hover:bg-surface-2',
  ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-surface-2 hover:text-ink',
  danger: 'bg-surface text-critical-ink border-line hover:bg-critical-soft',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg border font-medium whitespace-nowrap transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ─── Campos ───────────────────────────────────────────────────────────────────
const fieldBase =
  'rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-2 focus:outline-accent/30 disabled:opacity-60';

/** Largura total por padrão, a menos que o chamador defina uma (w-40, w-auto...). */
const widthOf = (className?: string) => (/(^|\s)(w-|min-w-)/.test(className ?? '') ? null : 'w-full');

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cx(fieldBase, widthOf(className), 'h-10', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cx(fieldBase, widthOf(className), 'h-10 pr-8', className)} {...props}>
      {children}
    </select>
  );
});

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(fieldBase, widthOf(className), 'min-h-20 py-2', className)} {...props} />;
}

/** Rótulo + controle + dica/erro, com associação acessível. */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
        {label}
        {required && <span className="text-critical-ink"> *</span>}
      </label>
      {children(id)}
      {error ? <p className="text-xs text-critical-ink">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-sm text-ink', className)}>
      <input type="checkbox" className="size-4 rounded border-line accent-[var(--accent)]" {...props} />
      {label}
    </label>
  );
}

// ─── Superfícies ──────────────────────────────────────────────────────────────
export function Card({ className, children, title, actions }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'accent' | 'good' | 'warning' | 'critical' | 'serious';
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-accent-soft text-accent-ink',
  good: 'bg-good/12 text-good-ink',
  warning: 'bg-warning/18 text-warning-ink',
  serious: 'bg-serious/18 text-ink',
  critical: 'bg-critical-soft text-critical-ink',
};

export function Badge({ tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone])}>
      {icon}
      {children}
    </span>
  );
}

export function Spinner({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical-ink">
      {message}
    </div>
  );
}

// ─── Tabela ───────────────────────────────────────────────────────────────────
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={cx('border-b border-line px-4 py-2.5 text-xs font-medium tracking-wide text-muted uppercase', className)}>
    {children}
  </th>
);
export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cx('border-b border-line px-4 py-3 align-middle text-ink', className)}>
    {children}
  </td>
);

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="px-4 py-3 text-xs text-muted">{total} registro(s)</p> : null;
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
      <span className="text-xs text-muted">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="tabular px-2 text-xs text-ink-2">
          {page} / {pages}
        </span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cx('w-full rounded-xl border border-line bg-surface shadow-2xl', width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button data-close className="rounded p-1 text-muted hover:bg-surface-2 hover:text-ink" onClick={onClose} aria-label="Fechar">
            <X className="size-5" />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────────
export function StatTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-sm text-ink-2">
        {icon && <span className="text-muted">{icon}</span>}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
