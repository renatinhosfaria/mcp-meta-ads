import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { get } from 'node:http';
import { once } from 'node:events';
import { createConfiguredHttpServer, shutdownHttpServer } from '../src/http-server.ts';

test('configured HTTP server keeps backend connections longer than Traefik', () => {
  const server = createConfiguredHttpServer(express(), {
    keepAliveTimeoutMs: 95_000,
    headersTimeoutMs: 100_000,
  });

  assert.equal(server.keepAliveTimeout, 95_000);
  assert.equal(server.headersTimeout, 100_000);
});

test('shutdown closes MCP sessions and force-closes lingering HTTP connections after grace', async () => {
  const app = express();
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  app.get('/slow', (_req, _res) => requestStarted());
  const server = createConfiguredHttpServer(app, {
    keepAliveTimeoutMs: 95_000,
    headersTimeoutMs: 100_000,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const request = get(`http://127.0.0.1:${address.port}/slow`);
  request.on('error', () => {});
  await started;
  let runtimeCloseCalls = 0;

  await shutdownHttpServer(server, {
    close: async () => {
      runtimeCloseCalls += 1;
    },
  }, 10);

  assert.equal(runtimeCloseCalls, 1);
  assert.equal(server.listening, false);
  request.destroy();
});
