import { Router } from 'express';
import {
  PERMISSION_MODULES,
  ROLE_SCOPE_LABELS,
  SERVICE_ORDER_STATUS_LABELS,
  SERVICE_ORDER_TRANSITIONS,
} from '@erp/shared';

/** Metadados para clientes da API (o front-end usa o pacote @erp/shared diretamente). */
export const metaRouter = Router();

metaRouter.get('/permissions', (_req, res) => {
  res.json({
    modules: Object.entries(PERMISSION_MODULES).map(([key, def]) => ({
      key,
      label: def.label,
      description: def.description,
      actions: Object.entries(def.actions).map(([action, label]) => ({
        key: `${key}.${action}`,
        action,
        label,
      })),
    })),
    scopes: ROLE_SCOPE_LABELS,
  });
});

metaRouter.get('/service-order-statuses', (_req, res) => {
  res.json({ labels: SERVICE_ORDER_STATUS_LABELS, transitions: SERVICE_ORDER_TRANSITIONS });
});
