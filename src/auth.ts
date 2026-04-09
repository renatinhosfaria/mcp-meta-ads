import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Authorization: Bearer <API_KEY>' });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== config.apiKey) {
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  next();
}
