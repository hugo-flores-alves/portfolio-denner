import type { Request, RequestHandler } from 'express';
import type { Permission } from '@erp/shared';
import { forbidden, unauthorized } from '../lib/errors';
import { verifyAccessToken } from '../lib/jwt';
import { can, loadAuthContext, type AuthContext } from '../modules/auth/auth-context';

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const payload = verifyAccessToken(header.slice('Bearer '.length).trim());
  if (!payload) throw unauthorized('Sessão expirada ou inválida');
  const auth = await loadAuthContext(payload.sub);
  if (!auth) throw unauthorized('Usuário inativo ou sem acesso');
  req.auth = auth;
  next();
};

export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Exige TODAS as permissões informadas. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const auth = getAuth(req);
    if (!permissions.every((p) => can(auth, p))) throw forbidden();
    next();
  };
}

/** Exige AO MENOS UMA das permissões (ex.: busca de peças usada no PDV e na OS). */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const auth = getAuth(req);
    if (!permissions.some((p) => can(auth, p))) throw forbidden();
    next();
  };
}
