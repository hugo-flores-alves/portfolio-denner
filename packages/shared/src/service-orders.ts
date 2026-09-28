/**
 * Máquina de estados de Orçamentos / Ordens de Serviço.
 *
 *   AWAITING_APPROVAL ──aprovar──▶ IN_PROGRESS ──finalizar──▶ COMPLETED ──▶ DELIVERED
 *        │   ▲                         │  │                        │
 *        │   └────── reorçar ──────────┘  │                        └─ reabrir ─▶ IN_PROGRESS
 *        ├──▶ REJECTED ──▶ (reavaliar) AWAITING_APPROVAL
 *        └──▶ CANCELLED ◀────────────────┘
 *
 * Invariante de estoque: as peças da OS estão baixadas do estoque da loja
 * se, e somente se, o status estiver em STOCK_DEDUCTED_STATUSES.
 * Entrar nesse conjunto dá baixa; sair dele (reabrir) estorna.
 */
export const SERVICE_ORDER_STATUSES = [
  'AWAITING_APPROVAL',
  'IN_PROGRESS',
  'COMPLETED',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
] as const;

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export const SERVICE_ORDER_STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  AWAITING_APPROVAL: 'Aguardando aprovação',
  IN_PROGRESS: 'Em manutenção',
  COMPLETED: 'Concluído',
  DELIVERED: 'Entregue',
  REJECTED: 'Reprovado',
  CANCELLED: 'Cancelado',
};

export const SERVICE_ORDER_TRANSITIONS: Record<ServiceOrderStatus, readonly ServiceOrderStatus[]> = {
  AWAITING_APPROVAL: ['IN_PROGRESS', 'REJECTED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'AWAITING_APPROVAL', 'CANCELLED'],
  COMPLETED: ['DELIVERED', 'IN_PROGRESS'],
  DELIVERED: [],
  REJECTED: ['AWAITING_APPROVAL', 'CANCELLED'],
  CANCELLED: [],
};

/** Rótulo da ação (botão) para cada transição de destino. */
export const SERVICE_ORDER_TRANSITION_LABELS: Partial<
  Record<ServiceOrderStatus, Partial<Record<ServiceOrderStatus, string>>>
> = {
  AWAITING_APPROVAL: {
    IN_PROGRESS: 'Aprovar orçamento',
    REJECTED: 'Reprovar orçamento',
    CANCELLED: 'Cancelar',
  },
  IN_PROGRESS: {
    COMPLETED: 'Finalizar serviço',
    AWAITING_APPROVAL: 'Voltar para aprovação',
    CANCELLED: 'Cancelar',
  },
  COMPLETED: { DELIVERED: 'Registrar entrega', IN_PROGRESS: 'Reabrir (estorna peças)' },
  REJECTED: { AWAITING_APPROVAL: 'Reavaliar orçamento', CANCELLED: 'Cancelar' },
};

/** Status em que as peças já foram baixadas do estoque. */
export const STOCK_DEDUCTED_STATUSES: readonly ServiceOrderStatus[] = ['COMPLETED', 'DELIVERED'];

/** Status em que peças, mão de obra e dados do aparelho ainda podem ser editados. */
export const EDITABLE_SERVICE_ORDER_STATUSES: readonly ServiceOrderStatus[] = [
  'AWAITING_APPROVAL',
  'IN_PROGRESS',
];

/** Status considerados "em aberto" (fila de trabalho da loja). */
export const OPEN_SERVICE_ORDER_STATUSES: readonly ServiceOrderStatus[] = [
  'AWAITING_APPROVAL',
  'IN_PROGRESS',
  'COMPLETED',
];

export function canTransition(from: ServiceOrderStatus, to: ServiceOrderStatus): boolean {
  return SERVICE_ORDER_TRANSITIONS[from].includes(to);
}

export function isStockDeductedStatus(status: ServiceOrderStatus): boolean {
  return STOCK_DEDUCTED_STATUSES.includes(status);
}
