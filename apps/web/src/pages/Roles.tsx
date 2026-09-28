import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PERMISSION_MODULES, ROLE_SCOPE_LABELS, type Permission, type PermissionModule, type RoleScope } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Spinner, Textarea, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import type { Role } from '../lib/types';

const STANDARD = ['view', 'create', 'edit', 'delete'] as const;
const STANDARD_LABELS = { view: 'Ver', create: 'Criar', edit: 'Editar', delete: 'Excluir' };
const MODULES = Object.entries(PERMISSION_MODULES) as Array<[PermissionModule, (typeof PERMISSION_MODULES)[PermissionModule]]>;

interface FormState {
  name: string;
  description: string;
  scope: RoleScope;
  permissions: Set<Permission>;
}

function toForm(role?: Role): FormState {
  return {
    name: role?.name ?? '',
    description: role?.description ?? '',
    scope: role?.scope ?? 'STORE',
    permissions: new Set(role?.permissions ?? []),
  };
}

export function RolesPage() {
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(toForm());
  const [error, setError] = useState<string | null>(null);

  const { data: roles, isLoading } = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const role = roles?.find((r) => r.id === selected);

  useEffect(() => {
    if (!selected && roles?.length) setSelected(roles.find((r) => !r.isSystem)?.id ?? roles[0]!.id);
  }, [roles, selected]);
  useEffect(() => {
    setForm(toForm(selected === 'new' ? undefined : role));
    setError(null);
  }, [selected, role]);

  const readOnly = role?.isSystem || (selected !== 'new' && !can('roles.edit')) || (role && !role.assignable);
  // Não é possível conceder o que não se possui (espelha a regra do backend)
  const grantable = useMemo(() => new Set(me?.permissions ?? []), [me]);
  const canGrant = (p: Permission) => !!me?.role.isSystem || grantable.has(p);

  const toggle = (p: Permission, on: boolean) =>
    setForm((f) => {
      const next = new Set(f.permissions);
      if (on) next.add(p);
      else next.delete(p);
      return { ...f, permissions: next };
    });

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, description: form.description || null, scope: form.scope, permissions: [...form.permissions] };
      return selected === 'new' ? api<Role>('/roles', { method: 'POST', body }) : api<Role>(`/roles/${selected}`, { method: 'PATCH', body });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setSelected(saved.id);
      toast('Cargo salvo — as permissões valem imediatamente para os usuários');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => api(`/roles/${selected}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setSelected(null);
      toast('Cargo excluído');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  if (isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Cargos e permissões"
        subtitle="Defina quais telas e ações cada cargo pode acessar e se ele enxerga todas as lojas ou só a própria"
        actions={
          can('roles.create') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setSelected('new')}>
              Novo cargo
            </Button>
          )
        }
      />
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Cargos">
          <ul className="flex flex-col gap-1">
            {roles?.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setSelected(r.id)}
                  className={cx(
                    'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                    selected === r.id ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-2',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{r.name}</span>
                    {r.isSystem && <Lock className="size-3.5 text-muted" aria-label="Cargo de sistema" />}
                  </div>
                  <div className="text-xs text-muted">
                    {ROLE_SCOPE_LABELS[r.scope]} · {r.userCount} usuário(s)
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {(role || selected === 'new') && (
          <Card>
            <div className="flex flex-col gap-4 p-4">
              {error && <ErrorBox message={error} />}
              {role?.isSystem && (
                <div className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-ink">
                  <ShieldCheck className="size-4" aria-hidden /> Cargo de sistema: acesso total a todas as lojas, inclusive a permissões futuras. Não pode ser alterado.
                </div>
              )}
              {role && !role.isSystem && !role.assignable && (
                <div className="rounded-lg bg-warning/18 px-3 py-2 text-sm text-warning-ink">
                  Este cargo tem permissões que você não possui — apenas visualização.
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome do cargo" required>
                  {(id) => <Input id={id} disabled={readOnly} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
                </Field>
                <fieldset disabled={readOnly} className="flex flex-col gap-1.5">
                  <legend className="mb-1.5 text-sm font-medium text-ink-2">Alcance</legend>
                  {(['STORE', 'GLOBAL'] as const).map((scope) => (
                    <label key={scope} className={cx('flex items-center gap-2 text-sm', scope === 'GLOBAL' && !me?.hasGlobalAccess && 'opacity-50')}>
                      <input
                        type="radio"
                        name="scope"
                        className="accent-[var(--accent)]"
                        checked={form.scope === scope}
                        disabled={scope === 'GLOBAL' && !me?.hasGlobalAccess}
                        onChange={() => setForm({ ...form, scope })}
                      />
                      {ROLE_SCOPE_LABELS[scope]}
                    </label>
                  ))}
                </fieldset>
                <Field label="Descrição" className="sm:col-span-2">
                  {(id) => <Textarea id={id} disabled={readOnly} className="min-h-12" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
                </Field>
              </div>

              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <caption className="sr-only">Matriz de permissões</caption>
                  <thead className="bg-surface-2">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase">Tela</th>
                      {STANDARD.map((a) => (
                        <th key={a} className="w-16 px-2 py-2 text-center text-xs font-medium text-muted uppercase">
                          {STANDARD_LABELS[a]}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase">Outras ações</th>
                      <th className="w-14 px-2 py-2 text-center text-xs font-medium text-muted uppercase">Tudo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map(([module, def]) => {
                      const actions = Object.entries(def.actions) as Array<[string, string]>;
                      const keys = actions.map(([a]) => `${module}.${a}` as Permission);
                      const allOn = keys.every((k) => form.permissions.has(k));
                      const box = (key: Permission, label: string) => (
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--accent)] disabled:opacity-40"
                          aria-label={`${def.label}: ${label}`}
                          title={!canGrant(key) ? 'Você não possui esta permissão para concedê-la' : label}
                          checked={form.permissions.has(key)}
                          disabled={readOnly || !canGrant(key)}
                          onChange={(e) => toggle(key, e.target.checked)}
                        />
                      );
                      return (
                        <tr key={module} className="border-t border-line">
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-ink">{def.label}</div>
                            <div className="text-xs text-muted">{def.description}</div>
                          </td>
                          {STANDARD.map((a) => {
                            const label = (def.actions as Record<string, string>)[a];
                            return (
                              <td key={a} className="px-2 py-2.5 text-center">
                                {label ? box(`${module}.${a}` as Permission, label) : <span className="text-muted" aria-hidden>·</span>}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {actions
                                .filter(([a]) => !(STANDARD as readonly string[]).includes(a))
                                .map(([a, label]) => (
                                  <label key={a} className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                                    {box(`${module}.${a}` as Permission, label)}
                                    {label}
                                  </label>
                                ))}
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-center">
                            <input
                              type="checkbox"
                              className="size-4 accent-[var(--accent)]"
                              aria-label={`Todas as ações de ${def.label}`}
                              checked={allOn}
                              disabled={readOnly || keys.some((k) => !canGrant(k))}
                              onChange={(e) => keys.forEach((k) => toggle(k, e.target.checked))}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!readOnly && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone="neutral">{form.permissions.size} permissão(ões) marcada(s)</Badge>
                  <div className="flex gap-2">
                    {selected !== 'new' && can('roles.delete') && (
                      <Button
                        variant="danger"
                        icon={<Trash2 className="size-4" />}
                        loading={remove.isPending}
                        onClick={() => window.confirm(`Excluir o cargo "${role?.name}"?`) && remove.mutate()}
                      >
                        Excluir
                      </Button>
                    )}
                    <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
                      {selected === 'new' ? 'Criar cargo' : 'Salvar alterações'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
