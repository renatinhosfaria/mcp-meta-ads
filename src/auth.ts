import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

export function authMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
