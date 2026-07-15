import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { RequestHandler } from 'express';
import { createMetaAdsApp, type ManagedServer, type ManagedTransport } from '../src/app.ts';
import { SessionRegistry } from '../src/session-registry.ts';

const passThrough: RequestHandler = (_req, _res, next) => next();

class NoopServer implements ManagedServer {
  async connect(): Promise<void> {}
  async close(): Promise<void> {}
}

class NoopTransport implements ManagedTransport {
  sessionId?: string;
  onclose?: () => void;
  reject = false;

  async handleRequest(): Promise<void> {
    if (this.reject) throw new Error('observability failure');
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

async function startObservabilityHarness(options: {
  sessionAlertThreshold?: number;
  heapAlertBytes?: number;
} = {}) {
  const registry = new SessionRegistry<NoopTransport, NoopServer>({ idleTtlMs: 1_000, maxSessions: 3 });
  const runtime = createMetaAdsApp({
    registry,
    authMiddleware: passThrough,
    rateLimiter: passThrough,
    sweepIntervalMs: 0,
    sessionAlertThreshold: options.sessionAlertThreshold ?? 2,
    heapAlertBytes: options.heapAlertBytes ?? 300,
    getProcessDiagnostics: () => ({
      uptimeSeconds: 123,
      memory: { heapUsed: 200, heapTotal: 400, rss: 500 },
    }),
    deploymentMetadata: {
      version: '1.0.1',
      gitSha: '2664678-test',
      buildTime: '2026-07-15T12:00:00.000Z',
      deploymentId: 'deploy-contract-test',
    },
    createServer: () => new NoopServer(),
    createTransport: () => new NoopTransport(),
  });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    registry,
    runtime,
    request(path: string, init?: RequestInit) {
      return fetch(`http://127.0.0.1:${port}${path}`, init);
    },
    async close() {
      await runtime.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

test('request correlation preserves incoming IDs and generates missing IDs', async () => {
  const harness = await startObservabilityHarness();

  try {
    const preserved = await harness.request('/health', { headers: { 'x-request-id': 'request-existing' } });
    assert.equal(preserved.headers.get('x-request-id'), 'request-existing');

    const generated = await harness.request('/health');
    assert.match(generated.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
  } finally {
    await harness.close();
  }
});

test('health exposes session and memory diagnostics and reports degraded thresholds', async () => {
  const harness = await startObservabilityHarness({ sessionAlertThreshold: 1, heapAlertBytes: 300 });
  await harness.registry.add('active-session', {
    transport: new NoopTransport(),
    server: new NoopServer(),
  });

  try {
    const response = await harness.request('/health');
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(typeof body.timestamp, 'string');
    delete body.timestamp;
    assert.deepEqual(body, {
      status: 'degraded',
      service: 'meta-ads-mcp-server',
      version: '1.0.1',
      git_sha: '2664678-test',
      build_time: '2026-07-15T12:00:00.000Z',
      deployment_id: 'deploy-contract-test',
      uptime_seconds: 123,
      memory: {
        heap_used_bytes: 200,
        heap_total_bytes: 400,
        rss_bytes: 500,
        alert_threshold_bytes: 300,
      },
      sessions: {
        active: 1,
        capacity: 3,
        alert_threshold: 1,
        created: 1,
        closed: 0,
        expired: 0,
        evicted: 0,
      },
    });
  } finally {
    await harness.close();
  }
});

test('async errors log the correlation ID', async () => {
  const harness = await startObservabilityHarness();
  const transport = new NoopTransport();
  transport.reject = true;
  await harness.registry.add('failing-session', { transport, server: new NoopServer() });
  const originalError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => errors.push(args);

  try {
    const response = await harness.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': 'failing-session',
        'x-request-id': 'request-error',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });

    assert.equal(response.status, 500);
    assert.match(errors.flat().join(' '), /request-error/);
  } finally {
    console.error = originalError;
    await harness.close();
  }
});
