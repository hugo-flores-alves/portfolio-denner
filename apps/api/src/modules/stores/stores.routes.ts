import { Router } from 'express';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { stores } from '../../db/schema';
import { forbidden, notFound } from '../../lib/errors';
import { digitsOnly, idParamsSchema, optionalText } from '../../lib/validation';
import { getAuth, requirePermission } from '../../middleware/auth';
import { can, hasGlobalAccess } from '../auth/auth-context';

export const storesRouter = Router();

const storeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,12}$/, 'Código deve ter 2 a 12 caracteres (letras, números, - ou _)'),
  name: z.string().trim().min(2).max(120),
  document: digitsOnly(14),
  phone: digitsOnly(20),
  address: optionalText(500),
  isActive: z.boolean().optional(),
});

/**
 * Qualquer usuário autenticado recebe a lista básica de lojas ativas (necessária
 * para escolher destino de transferência, por exemplo). Detalhes completos e
 * lojas inativas exigem `stores.view`.
 */
storesRouter.get('/', async (req, res) => {
  const auth = getAuth(req);
  if (can(auth, 'stores.view')) {
    res.json(await db.select().from(stores).orderBy(asc(stores.code)));
    return;
  }
  res.json(
    await db
      .select({ id: stores.id, code: stores.code, name: stores.name, isActive: stores.isActive })
      .from(stores)
      .where(eq(stores.isActive, true))
      .orderBy(asc(stores.code)),
  );
});

storesRouter.post('/', requirePermission('stores.create'), async (req, res) => {
  const auth = getAuth(req);
  if (!hasGlobalAccess(auth)) throw forbidden('Somente usuários com acesso global podem criar lojas');
  const body = storeSchema.parse(req.body);
  const [store] = await db.insert(stores).values(body).returning();
  res.status(201).json(store);
});

storesRouter.patch('/:id', requirePermission('stores.edit'), async (req, res) => {
  const auth = getAuth(req);
  const { id } = idParamsSchema.parse(req.params);
  if (!hasGlobalAccess(auth) && auth.storeId !== id) throw notFound();
  const body = storeSchema.partial().parse(req.body);
  if (body.isActive === false && !hasGlobalAccess(auth)) {
    throw forbidden('Somente usuários com acesso global podem desativar lojas');
  }
  const [store] = await db.update(stores).set(body).where(eq(stores.id, id)).returning();
  if (!store) throw notFound('Loja não encontrada');
  res.json(store);
});
