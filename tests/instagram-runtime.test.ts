import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createInstagramRuntime } from '../src/instagram/runtime.ts';
import { createMcpServer } from '../src/server.ts';
import { createMetaAdsApp } from '../src/app.ts';
import { SessionRegistry } from '../src/session-registry.ts';
import { signPayload } from '../src/events/signature.ts';

const passThrough: RequestHandler = (_req, _res, next) => next();
const deny: RequestHandler = (_req, res) => { res.status(401).json({ error: 'unauthorized' }); };

async function listTools(server: ReturnType<typeof createMcpServer>): Promise<string[]> {
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'rt-test', version: '1.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  try {
    return (await client.listTools()).tools.map((t) => t.name);
  } finally {
    await client.close();
    await server.close();
  }
}

test('rotas públicas ficam antes da autenticação e as protegidas depois', async () => {
  const mk = (path: string): RequestHandler => (req, res, next) => (req.path === path ? void res.status(404).send('nf') : next());
  const registry = new SessionRegistry<any, any>({ idleTtlMs: 1000, maxSessions: 2 });
  const protectedHit: RequestHandler = (req, res, next) => (req.method === 'POST' && req.path === '/uploads' ? void res.status(201).end() : next());
  const rt = createMetaAdsApp({
    registry, authMiddleware: deny, rateLimiter: passThrough, sweepIntervalMs: 0,
    publicRoutes: [mk('/media/x')], protectedRoutes: [protectedHit],
    createServer: () => ({ connect: async () => {}, close: async () => {} }),
    createTransport: () => ({ handleRequest: async () => {}, close: () => {} }) as any,
  });
  const http = rt.app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => http.once('listening', r));
  const { port } = http.address() as AddressInfo;
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/media/x`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/uploads`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  } finally {
    await rt.close();
    await new Promise<void>((r, j) => http.close((e) => (e ? j(e) : r())));
  }
});

test('runtime: webhook assinado -> list_events -> entrega assinada ao destino', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mcp-rt-'));
  const runtime = createInstagramRuntime({
    dataDir, publicBaseUrl: 'https://example.test', appSecret: 'app-secret', verifyToken: 'vt',
  });
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
  const target = express();
  target.post('/hook', express.text({ type: '*/*' }), (req, res) => {
    received.push({ headers: req.headers, body: req.body });
    res.status(200).end();
  });
  const targetServer = target.listen(0, '127.0.0.1');
  await new Promise<void>((r) => targetServer.once('listening', r));
  const targetPort = (targetServer.address() as AddressInfo).port;

  const registry = new SessionRegistry<any, any>({ idleTtlMs: 1000, maxSessions: 2 });
  const rt = createMetaAdsApp({
    registry, authMiddleware: deny, rateLimiter: passThrough, sweepIntervalMs: 0,
    publicRoutes: runtime.publicRoutes, protectedRoutes: runtime.protectedRoutes,
    createServer: () => ({ connect: async () => {}, close: async () => {} }),
    createTransport: () => ({ handleRequest: async () => {}, close: () => {} }) as any,
  });
  const http = rt.app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => http.once('listening', r));
  const { port } = http.address() as AddressInfo;
  try {
    // destino http local só pode ser inserido direto (a ferramenta exige https)
    runtime.db.prepare('INSERT INTO destinations (id, url, secret, event_types_json, description, created_at) VALUES (?, ?, ?, NULL, NULL, ?)')
      .run('d1', `http://127.0.0.1:${targetPort}/hook`, 'dest-secret', new Date().toISOString());

    const challenge = await fetch(`http://127.0.0.1:${port}/webhooks/meta?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=abc`);
    assert.equal(await challenge.text(), 'abc');

    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: '178', time: 1731000000, changes: [{ field: 'comments', value: { id: 'c1', text: 'oi', from: { id: 'f', username: 'u' }, media: { id: 'm1' } } }] }],
    });
    const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
    const res = await fetch(`http://127.0.0.1:${port}/webhooks/meta`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body,
    });
    assert.equal(res.status, 200);

    const [c, s] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ toolsets: ['instagram'], instagram: runtime.deps });
    const client = new Client({ name: 'rt', version: '1' });
    await Promise.all([server.connect(s), client.connect(c)]);
    const out = await client.callTool({ name: 'meta_ig_list_events', arguments: {} }) as any;
    await client.close();
    await server.close();
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.events.length, 1);
    assert.equal(parsed.events[0].type, 'comment');

    const tick = await runtime.deps.delivery.tick();
    assert.equal(tick.delivered, 1);
    assert.equal(received.length, 1);
    const h = received[0].headers;
    const ts = String(h['x-meta-mcp-timestamp']);
    assert.equal(h['x-meta-mcp-signature'], signPayload('dest-secret', ts, received[0].body));
    assert.equal(h['x-meta-mcp-event-id'], parsed.events[0].id);
  } finally {
    await rt.close();
    await new Promise<void>((r, j) => http.close((e) => (e ? j(e) : r())));
    await new Promise<void>((r) => targetServer.close(() => r()));
    await runtime.stop();
  }
});

test('start/stop são seguros e stop fecha o banco', async () => {
  const runtime = createInstagramRuntime({ dataDir: mkdtempSync(join(tmpdir(), 'mcp-rt-')), publicBaseUrl: 'https://example.test' });
  runtime.start();
  await runtime.stop();
  assert.throws(() => runtime.db.prepare('SELECT 1').get());
  await runtime.stop();
});

test('tools/list completo: 101 de anúncios e todas as meta_ig_*', async () => {
  const runtime = createInstagramRuntime({ dataDir: mkdtempSync(join(tmpdir(), 'mcp-rt-')), publicBaseUrl: 'https://example.test' });
  try {
    const names = await listTools(createMcpServer({ instagram: runtime.deps }));
    assert.equal(names.filter((n) => !n.startsWith('meta_ig_')).length, 101);
    const expected = EXPECTED_IG;
    for (const n of expected) assert.ok(names.includes(n), `falta ${n}`);
    assert.equal(names.filter((n) => n.startsWith('meta_ig_')).length, expected.length);
  } finally {
    await runtime.stop();
  }
});

const EXPECTED_IG = [
  'meta_ig_add_webhook_destination', 'meta_ig_business_discovery', 'meta_ig_comment_on_media', 'meta_ig_delete_comment',
  'meta_ig_delete_media', 'meta_ig_delete_messaging_profile_fields', 'meta_ig_get_account_insights', 'meta_ig_get_container_status',
  'meta_ig_get_conversation_messages', 'meta_ig_get_follower_demographics', 'meta_ig_get_hashtag_media', 'meta_ig_get_media',
  'meta_ig_get_media_insights', 'meta_ig_get_mention', 'meta_ig_get_message', 'meta_ig_get_messaging_profile',
  'meta_ig_get_page_subscription', 'meta_ig_get_profile', 'meta_ig_get_publishing_limit', 'meta_ig_get_user_profile',
  'meta_ig_hide_comment', 'meta_ig_list_accounts', 'meta_ig_list_comment_replies', 'meta_ig_list_comments',
  'meta_ig_list_conversations', 'meta_ig_list_events', 'meta_ig_list_media', 'meta_ig_list_stories', 'meta_ig_list_tagged_media',
  'meta_ig_list_webhook_destinations', 'meta_ig_mark_events_seen', 'meta_ig_private_reply', 'meta_ig_publish_carousel',
  'meta_ig_publish_container', 'meta_ig_publish_photo', 'meta_ig_publish_reel', 'meta_ig_publish_story', 'meta_ig_react_message',
  'meta_ig_remove_webhook_destination', 'meta_ig_reply_comment', 'meta_ig_reply_mention', 'meta_ig_search_hashtag',
  'meta_ig_send_message', 'meta_ig_send_sender_action', 'meta_ig_set_comments_enabled', 'meta_ig_set_ice_breakers',
  'meta_ig_set_persistent_menu', 'meta_ig_subscribe_page', 'meta_ig_test_webhook_destination',
];
