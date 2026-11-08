import assert from 'node:assert/strict';
import express, { type RequestHandler } from 'express';
import test from 'node:test';
import { createMetaAdsApp } from '../src/app.ts';
import { createAuthMiddleware } from '../src/auth.ts';
import type { Auth0Config } from '../src/config.ts';
import { SessionRegistry } from '../src/session-registry.ts';
import { createProtectedResourceRouter } from '../src/oauth/protected-resource.ts';

const auth0: Auth0Config = {
  issuer: 'https://tenant.auth0.com/',
  audience: 'https://mcp.example.test',
  resource: 'https://mcp.example.test',
  scopes: ['mcp:access'],
};

const passThrough: RequestHandler = (_req, _res, next) => next();

test('metadata and public routes precede auth while MCP and uploads remain protected', async () => {
  const registry = new SessionRegistry<any, any>({ idleTtlMs: 60_000, maxSessions: 10 });
  const publicStub = express.Router();
  publicStub.get('/webhooks/meta', (_req, res) => res.sendStatus(204));
  publicStub.get('/media/:id', (_req, res) => res.sendStatus(204));
  const protectedStub = express.Router();
  protectedStub.post('/uploads', (_req, res) => res.sendStatus(204));
  const runtime = createMetaAdsApp({
    registry,
    createTransport: () => ({ handleRequest: async () => undefined, close: () => undefined } as any),
    createServer: () => ({ connect: async () => undefined, close: () => undefined }),
    authMiddleware: createAuthMiddleware({
      apiKey: 'legacy-key', auth0,
      verifyOAuthToken: async () => ({ sub: 'auth0|renato', scope: 'mcp:access' }),
    }),
    publicRoutes: [createProtectedResourceRouter(auth0), publicStub],
    protectedRoutes: [protectedStub],
    rateLimiter: passThrough,
    sweepIntervalMs: 0,
  });
  const server = runtime.app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(`${base}/.well-known/oauth-protected-resource`)).status, 200);
    assert.equal((await fetch(`${base}/webhooks/meta`)).status, 204);
    assert.equal((await fetch(`${base}/media/example`)).status, 204);
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${base}/uploads`, { method: 'POST' })).status, 401);
  } finally {
    server.close();
    await runtime.close();
  }
});

test('Nginx snippet forwards OAuth protected-resource metadata before the fallback', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../deploy/nginx/mcp-facebook-ads.locations.conf', import.meta.url), 'utf8');
  const location = 'location = /.well-known/oauth-protected-resource';
  assert.ok(text.includes(location));
  assert.match(text, /proxy_pass http:\/\/127\.0\.0\.1:3200\/.well-known\/oauth-protected-resource/);
});
