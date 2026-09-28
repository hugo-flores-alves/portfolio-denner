import { Router } from 'express';
import { idParamsSchema } from '../../lib/validation';
import { getAuth, requirePermission } from '../../middleware/auth';
import {
  cancelTransfer,
  cancelTransferSchema,
  createTransfer,
  createTransferSchema,
  getTransfer,
  listTransfers,
  listTransfersSchema,
  receiveTransfer,
} from './transfers.service';

export const transfersRouter = Router();

transfersRouter.get('/', requirePermission('stock_transfers.view'), async (req, res) => {
  res.json(await listTransfers(getAuth(req), listTransfersSchema.parse(req.query)));
});

transfersRouter.get('/:id', requirePermission('stock_transfers.view'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  res.json(await getTransfer(getAuth(req), id));
});

transfersRouter.post('/', requirePermission('stock_transfers.create'), async (req, res) => {
  res.status(201).json(await createTransfer(getAuth(req), createTransferSchema.parse(req.body)));
});

transfersRouter.post('/:id/receive', requirePermission('stock_transfers.receive'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  res.json(await receiveTransfer(getAuth(req), id));
});

transfersRouter.post('/:id/cancel', requirePermission('stock_transfers.cancel'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  res.json(await cancelTransfer(getAuth(req), id, cancelTransferSchema.parse(req.body ?? {})));
});
