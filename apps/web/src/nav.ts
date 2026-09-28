import {
  ArrowLeftRight,
  FileSpreadsheet,
  LayoutDashboard,
  Package,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@erp/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Visível se o usuário tiver QUALQUER uma destas permissões. */
  anyOf: Permission[];
}

export const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: 'Visão geral', items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, anyOf: ['dashboard.view'] }] },
  {
    group: 'Atendimento',
    items: [
      { to: '/ordens-servico', label: 'Orçamentos / OS', icon: Wrench, anyOf: ['service_orders.view'] },
      { to: '/pdv', label: 'PDV (balcão)', icon: ShoppingCart, anyOf: ['sales.create'] },
      { to: '/vendas', label: 'Vendas', icon: Receipt, anyOf: ['sales.view'] },
      { to: '/clientes', label: 'Clientes', icon: Users, anyOf: ['customers.view'] },
    ],
  },
  {
    group: 'Estoque',
    items: [
      { to: '/produtos', label: 'Produtos e peças', icon: Package, anyOf: ['products.view', 'stock.view'] },
      { to: '/estoque', label: 'Movimentações', icon: ArrowLeftRight, anyOf: ['stock.view'] },
      { to: '/transferencias', label: 'Transferências', icon: Truck, anyOf: ['stock_transfers.view'] },
      { to: '/importacao', label: 'Importação', icon: FileSpreadsheet, anyOf: ['imports.view', 'imports.execute'] },
    ],
  },
  {
    group: 'Administração',
    items: [
      { to: '/usuarios', label: 'Usuários', icon: UserCog, anyOf: ['users.view'] },
      { to: '/cargos', label: 'Cargos e permissões', icon: ShieldCheck, anyOf: ['roles.view'] },
      { to: '/lojas', label: 'Lojas', icon: Store, anyOf: ['stores.view'] },
    ],
  },
];
