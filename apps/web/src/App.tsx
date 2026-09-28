import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { Permission } from '@erp/shared';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { EmptyState, Spinner } from './components/ui';
import { NAV } from './nav';
import { CustomersPage } from './pages/Customers';
import { DashboardPage } from './pages/Dashboard';
import { ImportPage } from './pages/Import';
import { LoginPage } from './pages/Login';
import { PosPage } from './pages/Pos';
import { ProductsPage } from './pages/Products';
import { RolesPage } from './pages/Roles';
import { SalesPage } from './pages/Sales';
import { ServiceOrderDetailPage } from './pages/service-orders/Detail';
import { ServiceOrderFormPage } from './pages/service-orders/Form';
import { ServiceOrdersPage } from './pages/service-orders/List';
import { StockPage } from './pages/Stock';
import { StoresPage } from './pages/Stores';
import { TransfersPage } from './pages/Transfers';
import { UsersPage } from './pages/Users';

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Carregando sessão..." />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function Guard({ anyOf, children }: { anyOf: Permission[]; children: ReactNode }) {
  const { canAny } = useAuth();
  if (!canAny(...anyOf)) {
    return (
      <EmptyState icon={<ShieldAlert className="size-8" />} title="Acesso negado">
        Seu cargo não tem permissão para esta tela. Fale com o gerente ou administrador.
      </EmptyState>
    );
  }
  return children;
}

/** Leva o usuário à primeira tela que ele pode acessar (técnico cai direto nas OS). */
function Home() {
  const { canAny } = useAuth();
  const first = NAV.flatMap((g) => g.items).find((i) => canAny(...i.anyOf));
  return first ? <Navigate to={first.to} replace /> : <EmptyState title="Nenhuma tela liberada para o seu cargo" />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="dashboard" element={<Guard anyOf={['dashboard.view']}><DashboardPage /></Guard>} />
        <Route path="ordens-servico" element={<Guard anyOf={['service_orders.view']}><ServiceOrdersPage /></Guard>} />
        <Route path="ordens-servico/nova" element={<Guard anyOf={['service_orders.create']}><ServiceOrderFormPage /></Guard>} />
        <Route path="ordens-servico/:id" element={<Guard anyOf={['service_orders.view']}><ServiceOrderDetailPage /></Guard>} />
        <Route path="ordens-servico/:id/editar" element={<Guard anyOf={['service_orders.edit']}><ServiceOrderFormPage /></Guard>} />
        <Route path="pdv" element={<Guard anyOf={['sales.create']}><PosPage /></Guard>} />
        <Route path="vendas" element={<Guard anyOf={['sales.view']}><SalesPage /></Guard>} />
        <Route path="clientes" element={<Guard anyOf={['customers.view']}><CustomersPage /></Guard>} />
        <Route path="produtos" element={<Guard anyOf={['products.view', 'stock.view']}><ProductsPage /></Guard>} />
        <Route path="estoque" element={<Guard anyOf={['stock.view']}><StockPage /></Guard>} />
        <Route path="transferencias" element={<Guard anyOf={['stock_transfers.view']}><TransfersPage /></Guard>} />
        <Route path="importacao" element={<Guard anyOf={['imports.view', 'imports.execute']}><ImportPage /></Guard>} />
        <Route path="usuarios" element={<Guard anyOf={['users.view']}><UsersPage /></Guard>} />
        <Route path="cargos" element={<Guard anyOf={['roles.view']}><RolesPage /></Guard>} />
        <Route path="lojas" element={<Guard anyOf={['stores.view']}><StoresPage /></Guard>} />
        <Route path="*" element={<EmptyState title="Página não encontrada" />} />
      </Route>
    </Routes>
  );
}
