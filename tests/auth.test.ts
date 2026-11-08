import test from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';

type MockResponse = Pick<Response, 'status' | 'json' | 'setHeader'> & {
  statusCode?: number;
  body?: unknown;
  headers?: Record<string, string>;
  locals?: Record<string, unknown>;
};

function createResponse(): MockResponse {
  const response: MockResponse = {
    headers: {},
    locals: {},
    status(code: number) {
      response.statusCode = code;
      return response as Response;
    },
    json(body: unknown) {
      response.body = body;
      return response as Response;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      response.headers![name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
      return response as Response;
    },
  };

  return response;
}

test('authMiddleware rejects requests without a bearer token', async () => {
  process.env.API_KEY = 'expected-api-key';
  const { authMiddleware } = await import('../src/auth.ts');
  const response = createResponse();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  authMiddleware({ headers: {} } as Request, response as Response, next);

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: 'Missing or invalid Authorization header' });
});

test('authMiddleware rejects invalid bearer tokens', async () => {
  process.env.API_KEY = 'expected-api-key';
  const { authMiddleware } = await import('../src/auth.ts');
  const response = createResponse();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  authMiddleware({
    headers: { authorization: 'Bearer wrong-api-key' },
  } as Request, response as Response, next);

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: 'Invalid API key' });
});

test('authMiddleware accepts the configured bearer token', async () => {
  process.env.API_KEY = 'expected-api-key';
  const { authMiddleware } = await import('../src/auth.ts');
  const response = createResponse();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  authMiddleware({
    headers: { authorization: 'Bearer expected-api-key' },
  } as Request, response as Response, next);

  assert.equal(nextCalled, true);
  assert.equal(response.statusCode, undefined);
  assert.equal(response.body, undefined);
});

const auth0 = {
  issuer: 'https://tenant.auth0.com/',
  audience: 'https://mcp.example.test',
  resource: 'https://mcp.example.test',
  scopes: ['mcp:access'],
};

test('OAuth middleware accepts a valid Auth0 token while preserving the API key', async () => {
  const { createAuthMiddleware } = await import('../src/auth.ts');
  const middleware = createAuthMiddleware({
    apiKey: 'legacy-key',
    auth0,
    verifyOAuthToken: async (token) => {
      assert.equal(token, 'oauth-token');
      return { sub: 'auth0|renato', scope: 'mcp:access' };
    },
  });
  const response = createResponse();
  let nextCalled = false;
  middleware({ headers: { authorization: 'Bearer oauth-token' } } as Request, response as Response, () => { nextCalled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nextCalled, true);
  assert.equal(response.statusCode, undefined);
});

test('OAuth middleware accepts permissions claims and keeps API key compatibility', async () => {
  const { createAuthMiddleware } = await import('../src/auth.ts');
  const middleware = createAuthMiddleware({
    apiKey: 'legacy-key', auth0,
    verifyOAuthToken: async () => ({ sub: 'auth0|renato', permissions: ['mcp:access'] }),
  });
  const response = createResponse();
  let nextCalled = false;
  middleware({ headers: { authorization: 'Bearer legacy-key' } } as Request, response as Response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  const oauthResponse = createResponse();
  nextCalled = false;
  middleware({ headers: { authorization: 'Bearer oauth-token' } } as Request, oauthResponse as Response, () => { nextCalled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nextCalled, true);
});

test('OAuth middleware rejects invalid tokens and missing scopes with a protected-resource challenge', async () => {
  const { createAuthMiddleware } = await import('../src/auth.ts');
  const middleware = createAuthMiddleware({
    apiKey: 'legacy-key', auth0,
    verifyOAuthToken: async (token) => {
      if (token === 'missing-scope') return { sub: 'auth0|renato', scope: 'mcp:read' };
      throw new Error('invalid token');
    },
  });
  for (const token of ['invalid-token', 'missing-scope']) {
    const response = createResponse();
    middleware({ headers: { authorization: `Bearer ${token}` } } as Request, response as Response, () => undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(response.statusCode, 401);
    assert.match(response.headers?.['www-authenticate'] ?? '', /resource_metadata="https:\/\/mcp\.example\.test\/.well-known\/oauth-protected-resource"/);
    assert.match(response.headers?.['www-authenticate'] ?? '', /scope="mcp:access"/);
    assert.deepEqual(response.body, { error: 'Invalid or insufficient OAuth token' });
    assert.ok(!JSON.stringify(response.body).includes(token));
  }
});
