import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimitRpm,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
});
