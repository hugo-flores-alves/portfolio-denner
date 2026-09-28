import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

interface PgError {
  code: string;
  constraint?: string;
  detail?: string;
}

/** Erro original + causas (o Drizzle embrulha o erro do driver; o Node agrega falhas IPv4/IPv6). */
function errorChain(err: unknown): Array<{ code?: unknown; constraint?: string; detail?: string }> {
  const chain: Array<{ code?: unknown; constraint?: string }> = [];
  let current: unknown = err;
  for (let depth = 0; current && typeof current === 'object' && depth < 6; depth++) {
    chain.push(current as { code?: unknown });
    const { cause, errors } = current as { cause?: unknown; errors?: unknown[] };
    current = cause ?? errors?.[0];
  }
  return chain;
}

function findPgError(err: unknown): PgError | null {
  const found = errorChain(err).find((e) => typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code));
  return (found as PgError | undefined) ?? null;
}

const DB_HINT = 'confira o DATABASE_URL em apps/api/.env';
/** Problemas típicos de instalação: respondem 503 com a ação a tomar, não "erro interno". */
const SETUP_ERRORS: Record<string, string> = {
  ECONNREFUSED: `Não foi possível conectar ao banco de dados. Verifique se o PostgreSQL está rodando (docker compose up -d) e ${DB_HINT}.`,
  ENOTFOUND: `Servidor do banco de dados não encontrado — ${DB_HINT}.`,
  ETIMEDOUT: `Tempo esgotado ao conectar no banco de dados — ${DB_HINT}.`,
  '28P01': `Usuário ou senha do banco de dados inválidos — ${DB_HINT}.`,
  '3D000': `O banco informado no DATABASE_URL não existe — crie-o ou rode docker compose up -d.`,
  '42P01': 'Tabelas do sistema não encontradas — rode npm run db:migrate e depois npm run db:seed.',
};

function findSetupError(err: unknown): string | null {
  const code = errorChain(err)
    .map((e) => e.code)
    .find((c): c is string => typeof c === 'string' && c in SETUP_ERRORS);
  return code ?? null;
}

const UNIQUE_MESSAGES: Record<string, string> = {
  users_email_unique: 'Já existe um usuário com este e-mail',
  products_sku_unique: 'Já existe um produto com este SKU',
  products_barcode_uq: 'Já existe um produto com este código de barras',
  stores_code_unique: 'Já existe uma loja com este código',
  roles_name_unique: 'Já existe um cargo com este nome',
  customers_document_uq: 'Já existe um cliente com este CPF/CNPJ',
};

function send(res: Parameters<ErrorRequestHandler>[2], status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

export const notFoundHandler: RequestHandler = (req, res) => {
  send(res, 404, 'ROUTE_NOT_FOUND', `Rota não encontrada: ${req.method} ${req.path}`);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return send(res, err.status, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) {
    return send(
      res,
      400,
      'VALIDATION_ERROR',
      'Dados inválidos',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo excede o tamanho máximo permitido' : err.message;
    return send(res, status, err.code, message);
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return send(res, 400, 'INVALID_JSON', 'JSON malformado no corpo da requisição');
  }

  const setup = findSetupError(err);
  if (setup) {
    logger.error({ code: setup, path: req.path }, SETUP_ERRORS[setup]);
    return send(res, 503, 'SERVICE_UNAVAILABLE', SETUP_ERRORS[setup]!);
  }

  const pg = findPgError(err);
  if (pg) {
    switch (pg.code) {
      case '23505':
        return send(res, 409, 'DUPLICATE', UNIQUE_MESSAGES[pg.constraint ?? ''] ?? 'Registro duplicado', {
          constraint: pg.constraint,
        });
      case '23503':
        return send(res, 409, 'FOREIGN_KEY', 'Registro relacionado inexistente ou em uso por outros registros', {
          constraint: pg.constraint,
        });
      case '23514':
        if (pg.constraint === 'stock_levels_quantity_non_negative') {
          return send(res, 409, 'INSUFFICIENT_STOCK', 'Estoque insuficiente para concluir a operação');
        }
        return send(res, 422, 'CHECK_VIOLATION', 'Valores fora das regras permitidas', { constraint: pg.constraint });
      case '22P02':
        return send(res, 400, 'INVALID_INPUT', 'Formato de dado inválido');
    }
  }

  logger.error({ err, path: req.path, method: req.method }, 'Erro não tratado');
  return send(res, 500, 'INTERNAL_ERROR', 'Erro interno do servidor');
};
