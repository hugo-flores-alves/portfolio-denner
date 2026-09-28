import { Router } from 'express';
import { idParamsSchema } from '../../lib/validation';
import { getAuth, requirePermission } from '../../middleware/auth';
import {
  cancelSale,
  cancelSaleSchema,
  createSale,
  createSaleSchema,
  getSale,
  listSales,
  listSalesSchema,
} from './sales.service';

export const salesRouter = Router();

salesRouter.get('/', requirePermission('sales.view'), async (req, res) => {
  res.json(await listSales(getAuth(req), listSalesSchema.parse(req.query)));
});

salesRouter.get('/:id', requirePermission('sales.view'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  res.json(await getSale(getAuth(req), id));
});

salesRouter.post('/', requirePermission('sales.create'), async (req, res) => {
  res.status(201).json(await createSale(getAuth(req), createSaleSchema.parse(req.body)));
});

salesRouter.post('/:id/cancel', requirePermission('sales.cancel'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  res.json(await cancelSale(getAuth(req), id, cancelSaleSchema.parse(req.body)));
});
