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

/** O Drizzle embrulha erros do driver; procuramos o erro original do Postgres. */
function findPgError(err: unknown): PgError | null {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (
      typeof current === 'object' &&
      'code' in current &&
      typeof (current as PgError).code === 'string' &&
      /^[0-9A-Z]{5}$/.test((current as PgError).code)
    ) {
      return current as PgError;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
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
