import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import type { Auth0Config } from '../src/config.ts';

const auth0: Auth0Config = {
  issuer: 'https://tenant.auth0.com/',
  audience: 'https://mcp.example.test',
  resource: 'https://mcp.example.test',
  scopes: ['mcp:access'],
};

test('protected resource metadata exposes the Auth0 issuer, resource and scopes', async () => {
  const { createProtectedResourceRouter } = await import('../src/oauth/protected-resource.ts');
  const app = express();
  app.use(createProtectedResourceRouter(auth0));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/.well-known/oauth-protected-resource`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      resource: 'https://mcp.example.test',
      authorization_servers: ['https://tenant.auth0.com/'],
      scopes_supported: ['mcp:access'],
      resource_documentation: 'https://mcp.example.test/docs/auth0-setup',
    });
  } finally {
    server.close();
  }
});

test('protected resource metadata is 404 when OAuth is disabled', async () => {
  const { createProtectedResourceRouter } = await import('../src/oauth/protected-resource.ts');
  const app = express();
  app.use(createProtectedResourceRouter());
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/.well-known/oauth-protected-resource`);
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});
