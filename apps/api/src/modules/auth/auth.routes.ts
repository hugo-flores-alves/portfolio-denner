import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ALL_PERMISSIONS } from '@erp/shared';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { stores, users } from '../../db/schema';
import { badRequest, unauthorized } from '../../lib/errors';
import { signAccessToken } from '../../lib/jwt';
import { hashPassword, verifyPassword } from '../../lib/password';
import { authenticate, getAuth } from '../../middleware/auth';
import { effectivePermissions, hasGlobalAccess, loadAuthContext, type AuthContext } from './auth-context';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Muitas tentativas de login. Aguarde alguns minutos.' } },
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  password: z.string().min(1, 'Informe a senha'),
});

// Hash "fantasma" para equalizar o tempo de resposta quando o e-mail não existe
const dummyHashPromise = hashPassword('senha-inexistente-para-timing');

export async function buildMe(auth: AuthContext) {
  const accessibleStores = await db
    .select({ id: stores.id, code: stores.code, name: stores.name })
    .from(stores)
    .where(
      hasGlobalAccess(auth)
        ? eq(stores.isActive, true)
        : and(eq(stores.isActive, true), eq(stores.id, auth.storeId ?? '00000000-0000-0000-0000-000000000000')),
    )
    .orderBy(asc(stores.code));

  return {
    id: auth.userId,
    name: auth.name,
    email: auth.email,
    role: { id: auth.roleId, name: auth.roleName, scope: auth.scope, isSystem: auth.isSuperAdmin },
    storeId: auth.storeId,
    hasGlobalAccess: hasGlobalAccess(auth),
    permissions: effectivePermissions(auth, ALL_PERMISSIONS),
    stores: accessibleStores,
  };
}

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, isActive: users.isActive })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const valid = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, await dummyHashPromise).then(() => false);
  if (!user || !valid || !user.isActive) throw unauthorized('E-mail ou senha inválidos');

  const auth = await loadAuthContext(user.id);
  if (!auth) throw unauthorized('Usuário sem acesso ativo ao sistema');

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  res.json({ token: signAccessToken(user.id), user: await buildMe(auth) });
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json(await buildMe(getAuth(req)));
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'A nova senha deve ter ao menos 8 caracteres').max(128),
});

authRouter.post('/change-password', authenticate, async (req, res) => {
  const auth = getAuth(req);
  const body = changePasswordSchema.parse(req.body);
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, auth.userId));
  if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
    throw badRequest('Senha atual incorreta');
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(body.newPassword) })
    .where(eq(users.id, auth.userId));
  res.status(204).end();
});
