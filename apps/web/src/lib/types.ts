import type {
  ImportMode,
  ImportStockMode,
  PaymentMethod,
  Permission,
  RoleScope,
  SaleStatus,
  ServiceOrderStatus,
  StockMovementType,
  TransferStatus,
} from '@erp/shared';

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StoreRef {
  id: string;
  code: string;
  name: string;
}

export interface Store extends StoreRef {
  document?: string | null;
  phone?: string | null;
  address?: string | null;
  isActive: boolean;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: { id: string; name: string; scope: RoleScope; isSystem: boolean };
  storeId: string | null;
  hasGlobalAccess: boolean;
  permissions: Permission[];
  stores: StoreRef[];
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  scope: RoleScope;
  isSystem: boolean;
  userCount: number;
  permissions: Permission[];
  assignable: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  roleId: string;
  roleName: string;
  roleScope: RoleScope;
  roleIsSystem: boolean;
  storeId: string | null;
  storeCode: string | null;
  storeName: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  document: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  compatibleModels: string | null;
  costCents: number;
  priceCents: number;
  minStock: number;
  isActive: boolean;
  quantity: number;
  stockByStore: Record<string, number>;
}

export interface ServiceOrderListItem {
  id: string;
  number: number;
  status: ServiceOrderStatus;
  deviceBrand: string | null;
  deviceModel: string;
  reportedDefect: string;
  totalCents: number;
  createdAt: string;
  estimatedAt: string | null;
  storeId: string;
  storeCode: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  technicianName: string | null;
}

export interface ServiceOrder {
  id: string;
  number: number;
  storeId: string;
  status: ServiceOrderStatus;
  customerId: string;
  technicianId: string | null;
  technicianName: string | null;
  deviceBrand: string | null;
  deviceModel: string;
  deviceSerial: string | null;
  deviceCondition: string | null;
  accessories: string | null;
  reportedDefect: string;
  diagnosis: string | null;
  notes: string | null;
  laborCents: number;
  partsCents: number;
  discountCents: number;
  totalCents: number;
  warrantyDays: number;
  estimatedAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  deliveredAt: string | null;
  stockDeducted: boolean;
  createdAt: string;
  customer: Customer;
  store: StoreRef & { phone: string | null; address: string | null };
  items: Array<{
    id: string;
    productId: string;
    sku: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
  history: Array<{
    id: string;
    fromStatus: ServiceOrderStatus | null;
    toStatus: ServiceOrderStatus;
    note: string | null;
    createdAt: string;
    userName: string | null;
  }>;
}

export interface SaleListItem {
  id: string;
  number: number;
  status: SaleStatus;
  totalCents: number;
  discountCents: number;
  createdAt: string;
  storeId: string;
  storeCode: string;
  sellerName: string;
  customerName: string | null;
  itemCount: number;
}

export interface Sale extends SaleListItem {
  subtotalCents: number;
  paidCents: number;
  changeCents: number;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledByName: string | null;
  storeName: string;
  items: Array<{ id: string; sku: string; description: string; quantity: number; unitPriceCents: number; totalCents: number }>;
  payments: Array<{ id: string; method: PaymentMethod; amountCents: number }>;
}

export interface StockMovement {
  id: string;
  createdAt: string;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  storeCode: string;
  productId: string;
  productSku: string;
  productName: string;
  userName: string | null;
}

export interface Transfer {
  id: string;
  number: number;
  status: TransferStatus;
  notes: string | null;
  createdAt: string;
  receivedAt: string | null;
  cancelledAt: string | null;
  fromStoreId: string;
  fromStoreCode: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreCode: string;
  toStoreName: string;
  createdByName: string;
  receivedByName: string | null;
  itemCount: number;
  items?: Array<{ id: string; productId: string; sku: string; name: string; quantity: number }>;
}

export interface ImportIssue {
  row: number;
  field?: string;
  value?: string;
  message: string;
}

export interface ImportReport {
  jobId: string | null;
  dryRun: boolean;
  status: 'COMPLETED' | 'FAILED';
  fileName: string;
  fileType: 'csv' | 'xlsx';
  meta: Record<string, string>;
  mode: ImportMode;
  stockMode: ImportStockMode;
  columns: { mapped: Record<string, string>; stores: Array<{ header: string; storeCode: string }>; ignored: string[] };
  totalRows: number;
  validRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  stockEntries: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  errorsTruncated: boolean;
  warningsTruncated: boolean;
  preview: Array<{
    row: number;
    action: 'CREATE' | 'UPDATE' | 'SKIP';
    sku: string;
    name: string;
    priceCents?: number;
    stock: Record<string, number>;
  }>;
  durationMs: number;
}

export interface ImportJob {
  id: string;
  fileName: string;
  fileType: string;
  mode: ImportMode;
  stockMode: ImportStockMode;
  status: 'COMPLETED' | 'FAILED';
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  stockEntries: number;
  durationMs: number;
  createdAt: string;
  userName: string | null;
}

export interface DashboardSummary {
  range: { from: string; to: string };
  storeId: string | null;
  totals: {
    revenueCents: number;
    grossProfitCents: number;
    salesCents: number;
    salesCount: number;
    averageTicketCents: number;
    serviceOrdersCents: number;
    serviceOrdersCompleted: number;
  };
  serviceOrders: { open: Record<'AWAITING_APPROVAL' | 'IN_PROGRESS' | 'COMPLETED', number>; openTotal: number };
  inventory: { stockValueCents: number; units: number; lowStockCount: number; transfersInTransit: number };
  daily: Array<{ date: string; salesCents: number; serviceOrdersCents: number }>;
  topProducts: Array<{ productId: string; sku: string; name: string; quantity: number; revenueCents: number }>;
  paymentMethods: Array<{ method: PaymentMethod; amountCents: number }>;
  byStore: Array<{
    storeId: string;
    code: string;
    name: string;
    revenueCents: number;
    salesCents: number;
    salesCount: number;
    serviceOrdersCents: number;
    serviceOrdersCompleted: number;
    openServiceOrders: number;
    stockValueCents: number;
    lowStockCount: number;
  }> | null;
}
