export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Não autenticado') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Você não tem permissão para esta ação') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Registro não encontrado') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: unknown, code = 'CONFLICT') =>
  new AppError(409, code, message, details);

export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, 'UNPROCESSABLE', message, details);
