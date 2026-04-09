import type { Request, Response, NextFunction } from 'express';

export function loggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method, path, ip } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    console.log(`[${new Date().toISOString()}] ${method} ${path} ${status} ${duration}ms - ${ip}`);
  });

  next();
}
