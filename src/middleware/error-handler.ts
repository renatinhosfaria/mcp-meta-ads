import type { Request, Response, NextFunction } from 'express';

type HttpError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

export function errorHandler(err: HttpError, _req: Request, res: Response, _next: NextFunction): void {
  const status = err.statusCode ?? err.status ?? 500;

  console.error(`[ERROR] ${err.message}`, err.stack);

  res.status(status).json({
    error: status === 413
      ? 'Payload excede o limite permitido.'
      : 'Internal server error',
  });
}
