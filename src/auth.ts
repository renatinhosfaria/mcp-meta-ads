import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export function authMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  const authorization = _req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    _res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authorization.slice('Bearer '.length).trim();
  const expectedToken = config.apiKey;
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expectedToken);

  if (tokenBuffer.length !== expectedBuffer.length || !timingSafeEqual(tokenBuffer, expectedBuffer)) {
    _res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  next();
}
