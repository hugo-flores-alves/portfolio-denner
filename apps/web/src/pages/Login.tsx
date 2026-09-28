import { Smartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Button, ErrorBox, Field, Input } from '../components/ui';
import { errorMessage } from '../lib/api';

const DEMO_USERS = [
  { email: 'admin@erp.local', label: 'Administrador (todas as lojas)' },
  { email: 'supervisor@erp.local', label: 'Supervisor de rede (global)' },
  { email: 'gerente.centro@erp.local', label: 'Gerente — Loja Centro' },
  { email: 'tecnico.centro@erp.local', label: 'Técnico — Loja Centro' },
  { email: 'vendedor.shopping@erp.local', label: 'Vendedor — Loja Shopping' },
];

export function LoginPage() {
  const { me, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (me) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-white">
            <Smartphone className="size-5" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold text-ink">ERP Assistência Técnica</h1>
          <p className="text-sm text-ink-2">Entre com sua conta para continuar</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6">
          {error && <ErrorBox message={error} />}
          <Field label="E-mail" required>
            {(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}
          </Field>
          <Field label="Senha" required>
            {(id) => (
              <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={loading}>
            Entrar
          </Button>
        </form>
        <details className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm">
          <summary className="cursor-pointer font-medium text-ink-2">Contas de demonstração</summary>
          <p className="mt-2 text-xs text-muted">Senha de todas: Senha@123</p>
          <ul className="mt-2 flex flex-col gap-1">
            {DEMO_USERS.map((u) => (
              <li key={u.email}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                  onClick={() => {
                    setEmail(u.email);
                    setPassword('Senha@123');
                  }}
                >
                  <span className="text-ink">{u.label}</span>
                  <span className="block text-xs text-muted">{u.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
