import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, UserCog } from 'lucide-react';
import { useState } from 'react';
import { ROLE_SCOPE_LABELS } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { StoreSelect } from '../components/domain';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Th, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import type { Paginated, Role, User } from '../lib/types';

function UserModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { me, defaultOperationStoreId } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    roleId: user?.roleId ?? '',
    storeId: user?.storeId ?? (me?.hasGlobalAccess ? null : defaultOperationStoreId),
    isActive: user?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const role = roles.find((r) => r.id === form.roleId);
  const isSelf = user?.id === me?.id;

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name: form.name, email: form.email };
      if (form.password) body.password = form.password;
      if (!isSelf) Object.assign(body, { roleId: form.roleId, storeId: form.storeId, ...(user && { isActive: form.isActive }) });
      return user ? api(`/users/${user.id}`, { method: 'PATCH', body }) : api('/users', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast(user ? 'Usuário atualizado' : 'Usuário criado');
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={user ? `Editar ${user.name}` : 'Novo usuário'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><ErrorBox message={error} /></div>}
        <Field label="Nome" required>
          {(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        </Field>
        <Field label="E-mail (login)" required>
          {(id) => <Input id={id} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label={user ? 'Nova senha' : 'Senha'} required={!user} hint={user ? 'Deixe em branco para manter' : 'Mínimo de 8 caracteres'}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <Field label="Cargo" required hint={role ? ROLE_SCOPE_LABELS[role.scope] : 'Só aparecem cargos que você pode atribuir'}>
          {(id) => (
            <Select id={id} disabled={isSelf} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="" disabled>
                Selecione
              </option>
              {roles
                .filter((r) => r.assignable || r.id === form.roleId)
                .map((r) => (
                  <option key={r.id} value={r.id} disabled={!r.assignable}>
                    {r.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Loja" required={role?.scope === 'STORE'} hint={role?.scope === 'GLOBAL' ? 'Opcional para cargos globais (loja padrão)' : undefined}>
          {(id) =>
            me?.hasGlobalAccess && role?.scope === 'GLOBAL' ? (
              <Select id={id} disabled={isSelf} value={form.storeId ?? ''} onChange={(e) => setForm({ ...form, storeId: e.target.value || null })}>
                <option value="">— nenhuma —</option>
                {/* cargo global: loja é só a padrão das operações */}
                <StoreOptions />
              </Select>
            ) : (
              <StoreSelect id={id} value={form.storeId} onChange={(v) => setForm({ ...form, storeId: v })} locked={isSelf || !me?.hasGlobalAccess} />
            )
          }
        </Field>
        {user && !isSelf && <Checkbox label="Usuário ativo" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />}
      </div>
    </Modal>
  );
}

function StoreOptions() {
  const { stores } = useAuth();
  return (
    <>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.code} — {s.name}
        </option>
      ))}
    </>
  );
}

export function UsersPage() {
  const { storeId, can, me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<User | null | 'new'>(null);
  const debounced = useDebounced(search);

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ['users', storeId, debounced, includeInactive, page],
    queryFn: () => api<Paginated<User>>('/users', { query: { storeId, search: debounced, includeInactive, page } }),
    placeholderData: keepPreviousData,
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('Usuário desativado — o acesso foi bloqueado imediatamente');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  return (
    <div>
      <PageHeader
        title="Usuários"
        subtitle="Contas de acesso dos colaboradores"
        actions={
          can('users.create') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Novo usuário
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted" aria-hidden />
          <Input className="pl-9" placeholder="Nome ou e-mail" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} aria-label="Buscar usuários" />
        </div>
        <Checkbox label="Mostrar inativos" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
      </div>
      {error && <ErrorBox message={errorMessage(error)} />}
      <Card className={cx('transition-opacity', isFetching && !isLoading && 'opacity-70')}>
        {isLoading ? (
          <Spinner />
        ) : !data?.data.length ? (
          <EmptyState icon={<UserCog className="size-8" />} title="Nenhum usuário encontrado" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Cargo</Th>
                  <Th>Loja</Th>
                  <Th>Último acesso</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-muted">{u.email}</div>
                    </Td>
                    <Td>
                      <div>{u.roleName}</div>
                      <div className="text-xs text-muted">{ROLE_SCOPE_LABELS[u.roleScope]}</div>
                    </Td>
                    <Td className="text-ink-2">{u.storeCode ? `${u.storeCode} — ${u.storeName}` : '—'}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(u.lastLoginAt)}</Td>
                    <Td>{u.isActive ? <Badge tone="good">Ativo</Badge> : <Badge>Inativo</Badge>}</Td>
                    <Td className="text-right whitespace-nowrap">
                      {can('users.edit') && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                          Editar
                        </Button>
                      )}
                      {can('users.delete') && u.isActive && u.id !== me?.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-critical-ink"
                          onClick={() => window.confirm(`Desativar ${u.name}?`) && deactivate.mutate(u.id)}
                        >
                          Desativar
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {editing && <UserModal user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
