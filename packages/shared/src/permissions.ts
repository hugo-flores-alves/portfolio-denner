/**
 * Catálogo de permissões do sistema (fonte única de verdade).
 *
 * Cada módulo corresponde a uma tela/área do ERP e declara as ações possíveis.
 * Uma permissão é identificada pela chave `modulo.acao` (ex.: `service_orders.edit`).
 * O painel de cargos renderiza a matriz a partir deste catálogo e a API valida
 * qualquer permissão recebida contra ele.
 */
export const PERMISSION_MODULES = {
  dashboard: {
    label: 'Dashboard',
    description: 'Indicadores de vendas, OS e estoque',
    actions: { view: 'Visualizar' },
  },
  service_orders: {
    label: 'Orçamentos / OS',
    description: 'Orçamentos e ordens de serviço',
    actions: {
      view: 'Visualizar',
      create: 'Criar',
      edit: 'Editar',
      delete: 'Excluir',
      change_status: 'Alterar status',
    },
  },
  sales: {
    label: 'Vendas (PDV)',
    description: 'Frente de caixa e histórico de vendas',
    actions: { view: 'Visualizar', create: 'Vender', cancel: 'Cancelar venda' },
  },
  customers: {
    label: 'Clientes',
    description: 'Cadastro de clientes (compartilhado entre lojas)',
    actions: { view: 'Visualizar', create: 'Criar', edit: 'Editar', delete: 'Excluir' },
  },
  products: {
    label: 'Produtos / Peças',
    description: 'Catálogo de peças, acessórios e preços',
    actions: { view: 'Visualizar', create: 'Criar', edit: 'Editar', delete: 'Excluir' },
  },
  stock: {
    label: 'Estoque',
    description: 'Saldos por loja, movimentações e ajustes',
    actions: { view: 'Visualizar', adjust: 'Ajustar saldo' },
  },
  stock_transfers: {
    label: 'Transferências',
    description: 'Transferência de mercadoria entre lojas',
    actions: { view: 'Visualizar', create: 'Enviar', receive: 'Receber', cancel: 'Cancelar' },
  },
  imports: {
    label: 'Importação em massa',
    description: 'Importação de produtos via CSV/Excel',
    actions: { view: 'Visualizar histórico', execute: 'Executar importação' },
  },
  users: {
    label: 'Usuários',
    description: 'Contas de acesso dos colaboradores',
    actions: { view: 'Visualizar', create: 'Criar', edit: 'Editar', delete: 'Desativar' },
  },
  roles: {
    label: 'Cargos e permissões',
    description: 'Definição de cargos e suas permissões',
    actions: { view: 'Visualizar', create: 'Criar', edit: 'Editar', delete: 'Excluir' },
  },
  stores: {
    label: 'Lojas',
    description: 'Cadastro de filiais',
    actions: { view: 'Visualizar', create: 'Criar', edit: 'Editar' },
  },
} as const satisfies Record<
  string,
  { label: string; description: string; actions: Record<string, string> }
>;

type Modules = typeof PERMISSION_MODULES;
export type PermissionModule = keyof Modules;

export type Permission = {
  [M in PermissionModule]: `${M}.${Extract<keyof Modules[M]['actions'], string>}`;
}[PermissionModule];

export const ALL_PERMISSIONS: readonly Permission[] = Object.entries(PERMISSION_MODULES).flatMap(
  ([module, def]) => Object.keys(def.actions).map((action) => `${module}.${action}` as Permission),
);

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Escopo do cargo:
 *  - GLOBAL: enxerga e opera todas as lojas (ex.: dono, gerente regional)
 *  - STORE:  restrito à loja do usuário (ex.: gerente de loja, técnico, vendedor)
 */
export const ROLE_SCOPES = ['GLOBAL', 'STORE'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

export const ROLE_SCOPE_LABELS: Record<RoleScope, string> = {
  GLOBAL: 'Todas as lojas',
  STORE: 'Somente a própria loja',
};
