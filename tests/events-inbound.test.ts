import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { normalizeMetaWebhook, toIsoTimestamp, type NormalizedEvent } from '../src/events/normalize.ts';
import { EventStore } from '../src/events/event-store.ts';
import { verifyMetaSignature, signPayload } from '../src/events/signature.ts';
import { createMetaWebhookRouter } from '../src/webhooks/meta-webhook-router.ts';
import { openDatabase } from '../src/storage/database.ts';
import { createTestDeps } from './helpers/instagram-deps.ts';

// Exemplo de comentário da documentação de webhooks do Instagram (campo `comments`):
// https://developers.facebook.com/docs/instagram-platform/webhooks
const commentPayload = {
  entry: [
    {
      id: '17841405793187218',
      time: 1731000000,
      changes: [
        {
          field: 'comments',
          value: {
            from: { id: '232323232', username: 'test' },
            media: { id: '18091890241049999', media_product_type: 'FEED' },
            id: '17865799348089039',
            parent_id: '17864559859097263',
            text: 'This is an example.',
          },
        },
      ],
    },
  ],
  object: 'instagram',
};

const echoPayload = {
  object: 'instagram',
  entry: [
    {
      id: '17841405793187218',
      time: 1731000000123,
      messaging: [
        {
          sender: { id: '17841405793187218' },
          recipient: { id: '1234' },
          timestamp: 1731000000123,
          message: { mid: 'mid.1', text: 'oi', is_echo: true, attachments: [{ type: 'image', payload: { url: 'https://x.test/a.jpg' } }] },
        },
      ],
    },
  ],
};

const now = new Date('2026-11-08T12:00:00Z');

function makeEvent(id: string, type: NormalizedEvent['type'] = 'comment'): NormalizedEvent {
  return { id, version: 1, type, ig_user_id: '1', occurred_at: now.toISOString(), received_at: now.toISOString(), summary: { a: 1 }, raw: { id } };
}

test('toIsoTimestamp trata segundos e milissegundos igual', () => {
  const fb = new Date(0);
  assert.equal(toIsoTimestamp(1731000000, fb), toIsoTimestamp(1731000000000, fb));
  assert.equal(toIsoTimestamp(1731000000, fb), '2024-11-07T17:20:00.000Z');
  assert.equal(toIsoTimestamp(undefined, fb), fb.toISOString());
});

test('comentário real vira um evento comment', () => {
  const events = normalizeMetaWebhook(commentPayload, now);
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.type, 'comment');
  assert.equal(e.version, 1);
  assert.equal(e.ig_user_id, '17841405793187218');
  assert.equal(e.occurred_at, '2024-11-07T17:20:00.000Z');
  assert.equal(e.received_at, now.toISOString());
  assert.equal(e.id.length, 32);
  assert.deepEqual(e.summary, {
    comment_id: '17865799348089039', text: 'This is an example.', from_id: '232323232',
    from_username: 'test', media_id: '18091890241049999', parent_id: '17864559859097263',
  });
  assert.deepEqual(normalizeMetaWebhook(commentPayload, now)[0].id, e.id);
});

test('mensagem com is_echo vira message_echo; occurred_at em ms correto', () => {
  const [e] = normalizeMetaWebhook(echoPayload, now);
  assert.equal(e.type, 'message_echo');
  assert.equal(e.occurred_at, '2024-11-07T17:20:00.123Z');
  assert.deepEqual(e.summary, {
    sender_id: '17841405793187218', recipient_id: '1234', mid: 'mid.1', text: 'oi',
    attachments: [{ type: 'image', url: 'https://x.test/a.jpg' }],
  });
  const noEcho = structuredClone(echoPayload);
  delete (noEcho.entry[0].messaging[0].message as { is_echo?: boolean }).is_echo;
  assert.equal(normalizeMetaWebhook(noEcho, now)[0].type, 'message');
});

test('outros campos e objetos', () => {
  assert.deepEqual(normalizeMetaWebhook({ object: 'page' }, now), []);
  assert.deepEqual(normalizeMetaWebhook('lixo', now), []);
  const mixed = {
    object: 'instagram',
    entry: [{
      id: '9', time: 1731000000,
      changes: [
        { field: 'mentions', value: { media_id: 'm1', comment_id: 'c1' } },
        { field: 'story_insights', value: { media_id: 'm2', reach: 3 } },
        { field: 'live_comments', value: { id: 'lc', text: 't', from: { id: 'f' }, media: { id: 'm3' } } },
        { field: 'outro', value: {} },
      ],
      messaging: [
        { sender: { id: 's' }, recipient: { id: 'r' }, timestamp: 1731000000000, reaction: { mid: 'x', action: 'react' } },
        { sender: { id: 's' }, recipient: { id: 'r' }, timestamp: 1731000000000, read: { mid: 'y' } },
        { sender: { id: 's' }, recipient: { id: 'r' }, timestamp: 1731000000000, postback: { mid: 'z', payload: 'p' } },
        { sender: { id: 's' }, recipient: { id: 'r' }, timestamp: 1731000000000, referral: { ref: 'q' } },
      ],
    }],
  };
  const types = normalizeMetaWebhook(mixed, now).map((e) => e.type);
  assert.deepEqual(types, ['mention', 'story_insights', 'live_comment', 'unknown', 'message_reaction', 'message_read', 'postback', 'referral']);
  const ev = normalizeMetaWebhook(mixed, now);
  assert.deepEqual(ev[0].summary, { media_id: 'm1', comment_id: 'c1' });
  assert.deepEqual(ev[1].summary, { media_id: 'm2', reach: 3 });
  assert.equal(new Set(ev.map((e) => e.id)).size, ev.length);
});

function newStore(): EventStore {
  return new EventStore(openDatabase(mkdtempSync(join(tmpdir(), 'mcp-ev-'))));
}

test('store: insert idempotente, get, paginação, markSeen e purgeSeen', () => {
  const store = newStore();
  assert.equal(store.insert(makeEvent('a')), true);
  assert.equal(store.insert(makeEvent('a')), false);
  assert.deepEqual(store.get('a')?.summary, { a: 1 });
  assert.equal(store.get('nope'), undefined);
  store.insert(makeEvent('b', 'mention'));
  store.insert(makeEvent('c'));

  const p1 = store.listUnseen({ limit: 2 });
  assert.deepEqual(p1.events.map((e) => e.id), ['a', 'b']);
  assert.equal(p1.next_cursor, p1.events[1].seq);
  const p2 = store.listUnseen({ limit: 2, afterSeq: p1.next_cursor! });
  assert.deepEqual(p2.events.map((e) => e.id), ['c']);
  assert.equal(p2.next_cursor, null);
  assert.deepEqual(store.listUnseen({ limit: 5, types: ['mention'] }).events.map((e) => e.id), ['b']);

  assert.equal(store.markSeen(['a', 'zzz']), 1);
  assert.deepEqual(store.listUnseen({ limit: 5 }).events.map((e) => e.id), ['b', 'c']);
  assert.equal(store.markSeen(['a']), 0);

  const old = new Date(now.getTime() - 91 * 86400_000);
  store.markSeen(['b'], old);
  assert.equal(store.purgeSeen(90, now), 1);
  assert.equal(store.get('b'), undefined);
  assert.ok(store.get('c'));
});

test('signature helpers', () => {
  const body = Buffer.from('{"a":1}');
  const good = 'sha256=' + createHmac('sha256', 's3').update(body).digest('hex');
  assert.equal(verifyMetaSignature(body, good, 's3'), true);
  assert.equal(verifyMetaSignature(body, good, 'outro'), false);
  assert.equal(verifyMetaSignature(body, undefined, 's3'), false);
  assert.equal(verifyMetaSignature(body, 'sha256=abc', 's3'), false);
  assert.equal(signPayload('k', '123', 'body'), 'sha256=' + createHmac('sha256', 'k').update('123.body').digest('hex'));
});

async function withRouter(opts: { verifyToken?: string; appSecret?: string }, fn: (url: string, store: EventStore, stored: NormalizedEvent[]) => Promise<void>): Promise<void> {
  const store = newStore();
  const stored: NormalizedEvent[] = [];
  const app = express();
  app.use(createMetaWebhookRouter({ ...opts, events: store, onEventStored: (e) => stored.push(e), now: () => now }));
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/meta`, store, stored);
  } finally {
    server.close();
  }
}

test('router GET: desafio', async () => {
  await withRouter({ verifyToken: 'tok' }, async (url) => {
    const ok = await fetch(`${url}?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '12345');
    assert.equal((await fetch(`${url}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`)).status, 403);
    assert.equal((await fetch(`${url}?hub.mode=other&hub.verify_token=tok&hub.challenge=1`)).status, 403);
  });
  await withRouter({}, async (url) => {
    assert.equal((await fetch(`${url}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`)).status, 503);
  });
});

test('router POST: assinatura e idempotência', async () => {
  await withRouter({ appSecret: 'segredo' }, async (url, store, stored) => {
    const body = JSON.stringify(commentPayload);
    const sig = 'sha256=' + createHmac('sha256', 'segredo').update(body).digest('hex');
    const bad = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } });
    assert.equal(bad.status, 401);
    assert.equal((await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } })).status, 401);
    assert.equal(store.listUnseen({ limit: 10 }).events.length, 0);

    for (let i = 0; i < 2; i++) {
      const r = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });
      assert.equal(r.status, 200);
      assert.equal(await r.text(), 'EVENT_RECEIVED');
    }
    assert.equal(store.listUnseen({ limit: 10 }).events.length, 1);
    assert.equal(stored.length, 1);

    const junk = 'nao-json';
    const jsig = 'sha256=' + createHmac('sha256', 'segredo').update(junk).digest('hex');
    assert.equal((await fetch(url, { method: 'POST', body: junk, headers: { 'x-hub-signature-256': jsig } })).status, 400);
  });
  await withRouter({}, async (url) => {
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 503);
  });
});

async function withApp(router: express.Router, fn: (url: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(router);
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/meta`);
  } finally {
    server.close();
  }
}

test('router POST: falha em onEventStored é logada com id do evento e mensagem, sem o payload', async () => {
  const store = newStore();
  const lines: string[] = [];
  const router = createMetaWebhookRouter({
    appSecret: 'segredo', events: store, now: () => now, log: (line) => lines.push(line),
    onEventStored: () => { throw new Error('fila indisponível'); },
  });
  await withApp(router, async (url) => {
    const body = JSON.stringify(commentPayload);
    const sig = 'sha256=' + createHmac('sha256', 'segredo').update(body).digest('hex');
    const r = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });
    assert.equal(r.status, 200);
  });
  const [event] = store.listUnseen({ limit: 10 }).events;
  assert.ok(event);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(event.id), lines[0]);
  assert.ok(lines[0].includes('fila indisponível'), lines[0]);
  assert.ok(!lines[0].includes('This is an example.'), lines[0]);
  assert.ok(!lines[0].includes('segredo'), lines[0]);
});

test('router: o limite de taxa usa X-Real-IP e não gera avisos do express-rate-limit', async () => {
  const captured: unknown[][] = [];
  const original = { error: console.error, warn: console.warn };
  console.error = (...args: unknown[]) => { captured.push(args); };
  console.warn = (...args: unknown[]) => { captured.push(args); };
  try {
    const router = createMetaWebhookRouter({ verifyToken: 'tok', events: newStore(), onEventStored: () => undefined, rateLimitPerMinute: 2 });
    await withApp(router, async (url) => {
      const get = (ip: string) => fetch(`${url}?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=1`, {
        headers: { 'x-real-ip': ip, 'x-forwarded-for': `${ip}, 10.0.0.1` },
      });
      assert.equal((await get('203.0.113.1')).status, 200);
      assert.equal((await get('203.0.113.1')).status, 200);
      assert.equal((await get('203.0.113.1')).status, 429);
      assert.equal((await get('203.0.113.2')).status, 200);
    });
  } finally {
    console.error = original.error;
    console.warn = original.warn;
  }
  assert.deepEqual(captured, []);
});

test('createTestDeps expõe EventStore', () => {
  const { deps } = createTestDeps();
  assert.ok(deps.events instanceof EventStore);
});
