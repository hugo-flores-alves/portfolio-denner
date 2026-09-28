import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Input, Modal, PageHeader, Spinner, Table, Td, Th } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatDocument, formatPhone } from '../lib/format';
import type { Store } from '../lib/types';

function StoreModal({ store, onClose }: { store: Store | null; onClose: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    code: store?.code ?? '',
    name: store?.name ?? '',
    document: store?.document ?? '',
    phone: store?.phone ?? '',
    address: store?.address ?? '',
    isActive: store?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, document: form.document || null, phone: form.phone || null, address: form.address || null };
      return store ? api(`/stores/${store.id}`, { method: 'PATCH', body }) : api('/stores', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] });
      toast('Loja salva. Novas lojas aparecem para os usuários no próximo login.');
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={store ? `Editar ${store.code}` : 'Nova loja'}
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
        <Field label="Código" required hint="Usado na numeração (LJ01-00042) e na planilha (estoque_LJ01)">
          {(id) => <Input id={id} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />}
        </Field>
        <Field label="Nome" required>
          {(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        </Field>
        <Field label="CNPJ">
          {(id) => <Input id={id} value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />}
        </Field>
        <Field label="Telefone">
          {(id) => <Input id={id} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
        </Field>
        <Field label="Endereço" className="sm:col-span-2">
          {(id) => <Input id={id} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />}
        </Field>
        {store && me?.hasGlobalAccess && (
          <Checkbox label="Loja ativa (desativar bloqueia o acesso dos usuários da loja)" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
        )}
      </div>
    </Modal>
  );
}

export function StoresPage() {
  const { can, me } = useAuth();
  const [editing, setEditing] = useState<Store | null | 'new'>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['stores', 'admin'], queryFn: () => api<Store[]>('/stores') });

  return (
    <div>
      <PageHeader
        title="Lojas"
        subtitle="Filiais da rede"
        actions={
          can('stores.create') &&
          me?.hasGlobalAccess && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Nova loja
            </Button>
          )
        }
      />
      {error && <ErrorBox message={errorMessage(error)} />}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Código</Th>
                <Th>Nome</Th>
                <Th>CNPJ</Th>
                <Th>Telefone</Th>
                <Th>Endereço</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data?.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium">{s.code}</Td>
                  <Td>{s.name}</Td>
                  <Td className="text-ink-2">{formatDocument(s.document)}</Td>
                  <Td className="text-ink-2">{formatPhone(s.phone)}</Td>
                  <Td className="text-ink-2">{s.address ?? '—'}</Td>
                  <Td>{s.isActive ? <Badge tone="good">Ativa</Badge> : <Badge>Inativa</Badge>}</Td>
                  <Td className="text-right">
                    {can('stores.edit') && (me?.hasGlobalAccess || me?.storeId === s.id) && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        Editar
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <StoreModal store={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
