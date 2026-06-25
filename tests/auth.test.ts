import test from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';

type MockResponse = Pick<Response, 'status' | 'json'> & {
  statusCode?: number;
  body?: unknown;
};

function createResponse(): MockResponse {
  const response: MockResponse = {
    status(code: number) {
      response.statusCode = code;
      return response as Response;
    },
    json(body: unknown) {
      response.body = body;
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
