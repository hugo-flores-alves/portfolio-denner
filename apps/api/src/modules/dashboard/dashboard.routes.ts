import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../lib/errors';
import { uuidSchema } from '../../lib/validation';
import { getAuth, requirePermission } from '../../middleware/auth';
import { resolveReadScope } from '../auth/store-scope';
import { defaultRange, getDashboardSummary } from './dashboard.service';

export const dashboardRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD');

const querySchema = z.object({
  storeId: uuidSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

dashboardRouter.get('/summary', requirePermission('dashboard.view'), async (req, res) => {
  const q = querySchema.parse(req.query);
  const storeId = resolveReadScope(getAuth(req), q.storeId);
  const fallback = defaultRange();
  const range = { from: q.from ?? fallback.from, to: q.to ?? fallback.to };
  if (range.from > range.to) throw badRequest('Data inicial maior que a final');
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000;
  if (days > 366) throw badRequest('Período máximo de 1 ano');
  res.json(await getDashboardSummary(storeId, range));
});
