export const PAYMENT_METHODS = ['CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Dinheiro',
  PIX: 'Pix',
  DEBIT_CARD: 'Cartão de débito',
  CREDIT_CARD: 'Cartão de crédito',
  OTHER: 'Outro',
};

export const SALE_STATUSES = ['COMPLETED', 'CANCELLED'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];
export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};

export const TRANSFER_STATUSES = ['IN_TRANSIT', 'RECEIVED', 'CANCELLED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  IN_TRANSIT: 'Em trânsito',
  RECEIVED: 'Recebida',
  CANCELLED: 'Cancelada',
};

export const STOCK_MOVEMENT_TYPES = [
  'IMPORT',
  'ADJUSTMENT',
  'SALE',
  'SALE_CANCEL',
  'SERVICE_ORDER',
  'SERVICE_ORDER_REVERSAL',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'TRANSFER_RETURN',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  IMPORT: 'Importação',
  ADJUSTMENT: 'Ajuste manual',
  SALE: 'Venda (PDV)',
  SALE_CANCEL: 'Cancelamento de venda',
  SERVICE_ORDER: 'Baixa por OS',
  SERVICE_ORDER_REVERSAL: 'Estorno de OS',
  TRANSFER_OUT: 'Transferência (saída)',
  TRANSFER_IN: 'Transferência (entrada)',
  TRANSFER_RETURN: 'Transferência cancelada (retorno)',
};

export const IMPORT_MODES = ['CREATE_ONLY', 'UPSERT'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];
export const IMPORT_MODE_LABELS: Record<ImportMode, string> = {
  CREATE_ONLY: 'Somente novos (SKUs existentes são ignorados)',
  UPSERT: 'Criar novos e atualizar existentes',
};

/**
 * Como aplicar a quantidade da planilha em produtos que JÁ têm saldo na loja:
 *  - SET: a planilha é a contagem oficial (define o saldo) — reimportar é idempotente
 *  - ADD: a planilha é uma entrada de mercadoria (soma ao saldo)
 */
export const IMPORT_STOCK_MODES = ['SET', 'ADD'] as const;
export type ImportStockMode = (typeof IMPORT_STOCK_MODES)[number];
export const IMPORT_STOCK_MODE_LABELS: Record<ImportStockMode, string> = {
  SET: 'Definir saldo (contagem de inventário)',
  ADD: 'Somar ao saldo (entrada de mercadoria)',
};
