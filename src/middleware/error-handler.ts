import type { Request, Response, NextFunction } from 'express';
import type { RequestWithId } from './logger.js';

type HttpError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

export function errorHandler(err: HttpError, req: Request, res: Response, _next: NextFunction): void {
  const status = err.statusCode ?? err.status ?? 500;
  const requestId = (req as RequestWithId).requestId ?? 'unknown';

  console.error(`[ERROR] request_id=${requestId} ${err.message}`, err.stack);

  res.status(status).json({
    error: status === 413
      ? 'Payload excede o limite permitido.'
      : 'Internal server error',
  });
}
