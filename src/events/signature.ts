import { createHmac, timingSafeEqual } from 'node:crypto';

/** Confere `X-Hub-Signature-256` sobre os bytes brutos do corpo. */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'), 'utf8');
  const received = Buffer.from(header.slice('sha256='.length), 'utf8');
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/** Assinatura dos webhooks de saída: 'sha256=' + HMAC hex de `${timestamp}.${body}`. */
export function signPayload(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
