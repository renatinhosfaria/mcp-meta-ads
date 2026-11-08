import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { RequestHandler } from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InvalidToolsetError, parseToolsets, type Toolset } from '../src/toolsets.ts';
import { createMcpServer } from '../src/server.ts';
import type { InstagramDeps } from '../src/tools/instagram/index.ts';
import { SessionRegistry } from '../src/session-registry.ts';
import { createMetaAdsApp, type ManagedServer, type ManagedTransport } from '../src/app.ts';

async function listToolNames(server: McpServer): Promise<string[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'toolsets-test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.listTools()).tools.map((tool) => tool.name);
  } catch (error) {
    // Sem nenhuma ferramenta registrada, o SDK nem expõe tools/list (MethodNotFound).
    if ((error as { code?: number }).code === -32601) return [];
    throw error;
  } finally {
    await client.close();
    await server.close();
  }
}

test('parseToolsets', () => {
  assert.equal(parseToolsets(undefined), undefined);
  assert.equal(parseToolsets(''), undefined);
  assert.deepEqual(parseToolsets(' Instagram , ads'), ['instagram', 'ads']);
  assert.throws(() => parseToolsets('ads,bogus'), InvalidToolsetError);
});

test('ads toolset keeps exactly the 101 existing tools', async () => {
  const names = await listToolNames(createMcpServer({ toolsets: ['ads'] }));
  assert.equal(names.length, 101);
  assert.ok(!names.some((n) => n.startsWith('meta_ig_')));
});

test('instagram toolset only registers meta_ig_ tools', async () => {
  const names = await listToolNames(createMcpServer({ toolsets: ['instagram'], instagram: {} as InstagramDeps }));
  assert.ok(!names.includes('meta_list_ad_accounts'));
  assert.ok(names.every((n) => n.startsWith('meta_ig_')));
});

const passThrough: RequestHandler = (_req, _res, next) => next();

class FakeServer implements ManagedServer {
  async connect(): Promise<void> {}
  async close(): Promise<void> {}
}

class FakeTransport implements ManagedTransport {
  sessionId?: string;
  onclose?: () => void;
  constructor(private readonly initialize: (id: string) => void) {}
  async handleRequest(_req: any, res: any, body?: any): Promise<void> {
    if (!this.sessionId && body?.method === 'initialize') {
      this.sessionId = 'session-test';
      this.initialize(this.sessionId);
    }
    res.status(200).json({ ok: true });
  }
  async close(): Promise<void> {
    this.onclose?.();
  }
}

test('initialize with ?toolsets=bogus returns 400; ?toolsets=instagram reaches createServer', async () => {
  const received: Array<Toolset[] | undefined> = [];
  const registry = new SessionRegistry<FakeTransport, FakeServer>({ idleTtlMs: 1000, maxSessions: 10 });
  const runtime = createMetaAdsApp({
    registry,
    authMiddleware: passThrough,
    rateLimiter: passThrough,
    sweepIntervalMs: 0,
    createServer: ({ toolsets }) => {
      received.push(toolsets);
      return new FakeServer();
    },
    createTransport: (initialize) => new FakeTransport(initialize),
  });
  const httpServer = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));
  const { port } = httpServer.address() as AddressInfo;
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    }),
  };
  try {
    const bad = await fetch(`http://127.0.0.1:${port}/mcp?toolsets=bogus`, init);
    assert.equal(bad.status, 400);
    const body = await bad.json() as any;
    assert.equal(body.error.code, -32602);
    assert.equal(body.error.message, 'toolsets inválido: bogus. Use: ads, instagram');
    assert.equal(received.length, 0);

    const ok = await fetch(`http://127.0.0.1:${port}/mcp?toolsets=instagram`, init);
    assert.equal(ok.status, 200);
    assert.deepEqual(received, [['instagram']]);
  } finally {
    await runtime.close();
    await new Promise<void>((resolve, reject) => httpServer.close((e) => (e ? reject(e) : resolve())));
  }
});
