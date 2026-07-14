import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { get } from 'node:http';
import { once } from 'node:events';
import type { RequestHandler } from 'express';
import { SessionRegistry } from '../src/session-registry.ts';
import { createMetaAdsApp, type ManagedServer, type ManagedTransport } from '../src/app.ts';

const passThrough: RequestHandler = (_req, _res, next) => next();

class FakeServer implements ManagedServer {
  closeCalls = 0;
  private transport?: ManagedTransport;

  async connect(transport: ManagedTransport): Promise<void> {
    this.transport = transport;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    await this.transport?.close();
  }
}

class FakeTransport implements ManagedTransport {
  sessionId?: string;
  onclose?: () => void;
  closeCalls = 0;
  rejectNext = false;

  constructor(private readonly initialize: (id: string) => void) {}

  async handleRequest(req: any, res: any, body?: any): Promise<void> {
    if (this.rejectNext) {
      this.rejectNext = false;
      throw new Error('transport failed');
    }

    if (!this.sessionId && body?.method === 'initialize') {
      this.sessionId = 'session-test';
      this.initialize(this.sessionId);
    }

    if (req.method === 'GET') {
      res.status(200).write('data: connected\n\n');
      return;
    }

    res.status(200).json({ ok: true });
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.onclose?.();
  }
}

async function startHarness(now: () => number = Date.now, rejectInitialize = false) {
  const events: unknown[] = [];
  const registry = new SessionRegistry<FakeTransport, FakeServer>({
    idleTtlMs: 30,
    maxSessions: 10,
    now,
    onEvent: (event) => events.push(event),
  });
  let transport: FakeTransport | undefined;
  const runtime = createMetaAdsApp({
    registry,
    authMiddleware: passThrough,
    rateLimiter: passThrough,
    sweepIntervalMs: 0,
    createServer: () => new FakeServer(),
    createTransport: (initialize) => {
      transport = new FakeTransport(initialize);
      transport.rejectNext = rejectInitialize;
      return transport;
    },
  });
  const httpServer = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));
  const { port } = httpServer.address() as AddressInfo;

  return {
    port,
    registry,
    events,
    runtime,
    get transport() {
      assert.ok(transport);
      return transport;
    },
    request(path: string, init?: RequestInit) {
      return fetch(`http://127.0.0.1:${port}${path}`, init);
    },
    async close() {
      await runtime.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function mcpRequest(method: string, sessionId?: string): RequestInit {
  const params = method === 'initialize'
    ? {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'session-test', version: '1.0.0' },
      }
    : {};

  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  };
}

test('initialize registers a managed session and a later request refreshes activity', async () => {
  let now = 0;
  const harness = await startHarness(() => now);

  try {
    const initialized = await harness.request('/mcp', mcpRequest('initialize'));
    assert.equal(initialized.status, 200);
    assert.equal(harness.registry.size, 1);

    now = 20;
    const response = await harness.request('/mcp', mcpRequest('tools/list', 'session-test'));
    assert.equal(response.status, 200);
    now = 49;
    assert.equal(await harness.registry.sweepExpired(), 0);
  } finally {
    await harness.close();
  }
});

test('DELETE closes and removes the managed session', async () => {
  const harness = await startHarness();

  try {
    await harness.request('/mcp', mcpRequest('initialize'));
    const response = await harness.request('/mcp', {
      method: 'DELETE',
      headers: { 'mcp-session-id': 'session-test' },
    });

    assert.equal(response.status, 200);
    assert.equal(harness.registry.size, 0);
    assert.equal(harness.transport.closeCalls, 1);
    assert.deepEqual(harness.events.at(-1), {
      type: 'closed',
      sessionId: 'session-test',
      activeSessions: 0,
      reason: 'explicit',
    });
  } finally {
    await harness.close();
  }
});

test('an open SSE response prevents idle expiration until the client disconnects', async () => {
  let now = 0;
  const harness = await startHarness(() => now);

  try {
    await harness.request('/mcp', mcpRequest('initialize'));
    const request = get(`http://127.0.0.1:${harness.port}/mcp`, {
      headers: { 'mcp-session-id': 'session-test' },
    });
    request.on('error', () => {});
    const [response] = await once(request, 'response');

    now = 31;
    assert.equal(await harness.registry.sweepExpired(), 0);
    const disconnected = once(response, 'close');
    response.destroy();
    await disconnected;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    now = 62;
    assert.equal(await harness.registry.sweepExpired(), 1);
  } finally {
    await harness.close();
  }
});

test('an expired session ID returns 404', async () => {
  let now = 0;
  const harness = await startHarness(() => now);

  try {
    await harness.request('/mcp', mcpRequest('initialize'));
    now = 31;
    await harness.registry.sweepExpired();

    const response = await harness.request('/mcp', mcpRequest('tools/list', 'session-test'));
    assert.equal(response.status, 404);
  } finally {
    await harness.close();
  }
});

test('async transport rejection reaches the error handler', async () => {
  const harness = await startHarness();

  try {
    await harness.request('/mcp', mcpRequest('initialize'));
    harness.transport.rejectNext = true;

    const response = await harness.request('/mcp', mcpRequest('tools/list', 'session-test'));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
  } finally {
    await harness.close();
  }
});

test('runtime close releases all active sessions', async () => {
  const harness = await startHarness();
  await harness.request('/mcp', mcpRequest('initialize'));

  await harness.runtime.close();

  assert.equal(harness.registry.size, 0);
  assert.equal(harness.transport.closeCalls, 1);
  await harness.close();
});

test('failed initialization closes resources that were never registered', async () => {
  const harness = await startHarness(Date.now, true);

  try {
    const response = await harness.request('/mcp', mcpRequest('initialize'));

    assert.equal(response.status, 500);
    assert.equal(harness.registry.size, 0);
    assert.equal(harness.transport.closeCalls, 1);
  } finally {
    await harness.close();
  }
});
