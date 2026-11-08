import express from 'express';
import rateLimit from 'express-rate-limit';
import { normalizeMetaWebhook, type NormalizedEvent } from '../events/normalize.js';
import type { EventStore } from '../events/event-store.js';
import { verifyMetaSignature } from '../events/signature.js';

export interface MetaWebhookDeps {
  verifyToken?: string;
  appSecret?: string;
  events: EventStore;
  onEventStored: (event: NormalizedEvent) => void;
  now?: () => Date;
  log?: (line: string) => void;
  /** Requisições por minuto e por IP (padrão 600). */
  rateLimitPerMinute?: number;
}

export function createMetaWebhookRouter(deps: MetaWebhookDeps): express.Router {
  const router = express.Router();
  const log = deps.log ?? ((line: string) => console.error(line));
  const limiter = rateLimit({
    windowMs: 60_000, max: deps.rateLimitPerMinute ?? 600, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests, try again later' },
    // Atrás do Nginx, req.ip é sempre 127.0.0.1; o IP real vem em X-Real-IP (o Nginx sobrescreve o valor do cliente).
    keyGenerator: (req) => req.header('x-real-ip') || req.ip || 'unknown',
  });
  const raw = express.raw({ type: '*/*', limit: '1mb' });

  router.get('/webhooks/meta', limiter, (req, res) => {
    if (!deps.verifyToken) { res.status(503).send('webhook not configured'); return; }
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === deps.verifyToken && typeof challenge === 'string') {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    res.status(403).send('forbidden');
  });

  router.post('/webhooks/meta', limiter, raw, (req, res) => {
    if (!deps.appSecret) { res.status(503).send('webhook not configured'); return; }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyMetaSignature(body, req.header('x-hub-signature-256'), deps.appSecret)) {
      res.status(401).send('invalid signature');
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      res.status(400).send('invalid json');
      return;
    }
    for (const event of normalizeMetaWebhook(payload, (deps.now ?? (() => new Date()))())) {
      if (deps.events.insert(event)) {
        try {
          deps.onEventStored(event);
        } catch (error) {
          // A entrega não pode derrubar o recebimento; o evento já está gravado.
          log(`[webhooks] falha ao enfileirar o evento ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  });

  return router;
}
