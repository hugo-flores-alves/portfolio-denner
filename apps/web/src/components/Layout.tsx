import { LogOut, Menu, Monitor, Moon, Smartphone, Store, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../lib/hooks';
import { NAV } from '../nav';
import { cx, Select } from './ui';

function StoreSwitcher() {
  const { me, stores, storeId, setStoreId, storeById } = useAuth();
  if (!me) return null;
  if (!me.hasGlobalAccess) {
    const store = storeById(me.storeId);
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2" title="Sua loja">
        <Store className="size-4 text-muted" aria-hidden />
        <span className="font-medium text-ink">{store?.code}</span>
        <span className="hidden sm:inline">{store?.name}</span>
      </div>
    );
  }
  return (
    <label className="flex items-center gap-2">
      <Store className="size-4 text-muted" aria-hidden />
      <span className="sr-only">Loja em exibição</span>
      <Select className="h-9 w-auto min-w-44" value={storeId ?? ''} onChange={(e) => setStoreId(e.target.value || null)}>
        <option value="">Todas as lojas</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} — {s.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon;
  const label = { system: 'Tema do sistema', light: 'Tema claro', dark: 'Tema escuro' }[theme];
  return (
    <button
      className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink"
      onClick={() => setTheme(next)}
      title={`${label} (clique para alternar)`}
      aria-label={label}
    >
      <Icon className="size-4" />
    </button>
  );
}

export function Layout() {
  const { me, canAny, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => canAny(...i.anyOf)) })).filter((g) => g.items.length);

  const sidebar = (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4" aria-label="Menu principal">
      <div className="flex items-center gap-2 px-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
          <Smartphone className="size-4" aria-hidden />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">ERP Assistência</div>
          <div className="text-xs text-muted">Rede multi-loja</div>
        </div>
      </div>
      {nav.map((group) => (
        <div key={group.group}>
          <div className="mb-1 px-2 text-xs font-medium tracking-wide text-muted uppercase">{group.group}</div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors',
                      isActive ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="no-print hidden w-60 shrink-0 border-r border-line bg-surface md:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-surface" onClick={(e) => e.stopPropagation()}>
            <button className="absolute top-3 right-3 p-1 text-muted" onClick={() => setMobileOpen(false)} aria-label="Fechar menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur">
          <button className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu className="size-5" />
          </button>
          <StoreSwitcher />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <div className="hidden px-2 text-right leading-tight sm:block">
              <div className="text-sm font-medium text-ink">{me?.name}</div>
              <div className="text-xs text-muted">{me?.role.name}</div>
            </div>
            <button className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink" onClick={logout} title="Sair" aria-label="Sair">
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
