import { Router } from 'express';
import { idParamsSchema } from '../../lib/validation';
import { getAuth, requirePermission } from '../../middleware/auth';
import {
  changeStatusSchema,
  createServiceOrderSchema,
  listServiceOrdersSchema,
  updateServiceOrderSchema,
} from './service-orders.schemas';
import {
  changeServiceOrderStatus,
  createServiceOrder,
  deleteServiceOrder,
  getServiceOrder,
  listServiceOrders,
  updateServiceOrder,
} from './service-orders.service';

export const serviceOrdersRouter = Router();

serviceOrdersRouter.get('/', requirePermission('service_orders.view'), async (req, res) => {
  res.json(await listServiceOrders(getAuth(req), listServiceOrdersSchema.parse(req.query)));
});

serviceOrdersRouter.get('/:id', requirePermission('service_orders.view'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  res.json(await getServiceOrder(getAuth(req), id));
});

serviceOrdersRouter.post('/', requirePermission('service_orders.create'), async (req, res) => {
  const order = await createServiceOrder(getAuth(req), createServiceOrderSchema.parse(req.body));
  res.status(201).json(order);
});

serviceOrdersRouter.patch('/:id', requirePermission('service_orders.edit'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  res.json(await updateServiceOrder(getAuth(req), id, updateServiceOrderSchema.parse(req.body)));
});

serviceOrdersRouter.post('/:id/status', requirePermission('service_orders.change_status'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  res.json(await changeServiceOrderStatus(getAuth(req), id, changeStatusSchema.parse(req.body)));
});

serviceOrdersRouter.delete('/:id', requirePermission('service_orders.delete'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  await deleteServiceOrder(getAuth(req), id);
  res.status(204).end();
});
