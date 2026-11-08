import assert from 'node:assert/strict';
import test from 'node:test';
import { captureTools, withGraphMock } from './helpers/graph-mock.ts';
import { createTestDeps } from './helpers/instagram-deps.ts';
import { DeliveryWorker, RETRY_DELAYS_MS, type Sender } from '../src/events/delivery.ts';
import { signPayload } from '../src/events/signature.ts';
import { registerInstagramEventTools } from '../src/tools/instagram/events.ts';
import type { NormalizedEvent } from '../src/events/normalize.ts';

const ev = (id: string, type: NormalizedEvent['type'] = 'comment'): NormalizedEvent => ({
  id, version: 1, type, ig_user_id: 'ig-1', occurred_at: '2026-01-01T00:00:00.000Z',
  received_at: '2026-01-01T00:00:00.000Z', summary: { text: 'oi' }, raw: { a: 1 },
});
type Res = { isError?: boolean; content: { text: string }[] };
const parse = (r: unknown) => JSON.parse((r as Res).content[0].text);
const rows = (db: import('node:sqlite').DatabaseSync) =>
  db.prepare('SELECT * FROM deliveries ORDER BY destination_id').all() as Array<{ status: string; attempts: number; next_attempt_at: number; last_error: string | null; destination_id: string }>;

test('destinos: http:// é recusado e list() não traz o segredo', () => {
  const { deps } = createTestDeps();
  assert.throws(() => deps.destinations.add({ url: 'http://x.test/hook' }), /https/);
  const { secret } = deps.destinations.add({ url: 'https://x.test/hook' });
  assert.match(secret, /^whsec_[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(deps.destinations.list()).includes(secret));
  assert.ok(!('secret' in deps.destinations.list()[0]));
});

test('enqueue cria uma linha por destino ativo para o tipo', () => {
  const { deps, db } = createTestDeps();
  deps.destinations.add({ url: 'https://a.test/h' });
  deps.destinations.add({ url: 'https://b.test/h', event_types: ['message'] });
  deps.events.insert(ev('e1'));
  assert.equal(deps.delivery.enqueue(ev('e1')), 1);
  assert.equal(rows(db).length, 1);
});

test('tick entrega com assinatura válida e cabeçalhos', async () => {
  const sent: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const send: Sender = async (url, init) => { sent.push({ url, ...init }); return { status: 204 }; };
  const { deps, db } = createTestDeps({ send, now: () => 1_000_000 });
  const { secret } = deps.destinations.add({ url: 'https://a.test/h' });
  deps.events.insert(ev('e1'));
  deps.delivery.enqueue(ev('e1'));
  assert.deepEqual(await deps.delivery.tick(), { delivered: 1, retried: 0, failed: 0 });
  assert.equal(rows(db)[0].status, 'delivered');
  const s = sent[0];
  assert.equal(s.headers['Content-Type'], 'application/json');
  assert.equal(s.headers['X-Meta-MCP-Event-Id'], 'e1');
  assert.equal(s.headers['X-Meta-MCP-Signature'], signPayload(secret, s.headers['X-Meta-MCP-Timestamp'], s.body));
  const body = JSON.parse(s.body);
  assert.equal(body.version, 1);
  assert.equal(body.attempt, 1);
  assert.equal(body.event.id, 'e1');
});

test('falha agenda a próxima tentativa em 30s', async () => {
  const send: Sender = async () => ({ status: 500 });
  const { deps, db } = createTestDeps({ send, now: () => 5_000 });
  deps.destinations.add({ url: 'https://a.test/h' });
  deps.events.insert(ev('e1'));
  deps.delivery.enqueue(ev('e1'));
  assert.deepEqual(await deps.delivery.tick(), { delivered: 0, retried: 1, failed: 0 });
  const r = rows(db)[0];
  assert.equal(r.attempts, 1);
  assert.equal(r.status, 'pending');
  assert.equal(r.next_attempt_at, 5_000 + 30_000);
});

test('destino fora por horas e reinício: retoma do banco, termina failed e o evento segue listado', async () => {
  let t = 0;
  const send: Sender = async () => { throw new Error('ECONNREFUSED'); };
  const { deps, db } = createTestDeps({ send, now: () => t });
  deps.destinations.add({ url: 'https://a.test/h' });
  deps.events.insert(ev('e1'));
  deps.delivery.enqueue(ev('e1'));
  await deps.delivery.tick();
  assert.equal(rows(db)[0].attempts, 1);
  // reinício: novo worker sobre o mesmo banco
  let worker = new DeliveryWorker({ db, destinations: deps.destinations, events: deps.events, send, now: () => t });
  for (let i = 1; i <= 8; i++) {
    t += RETRY_DELAYS_MS[i - 1];
    const res = await worker.tick();
    assert.equal(res.failed, i === 8 ? 1 : 0);
    if (i === 4) worker = new DeliveryWorker({ db, destinations: deps.destinations, events: deps.events, send, now: () => t });
  }
  const r = rows(db)[0];
  assert.equal(r.status, 'failed');
  assert.equal(r.attempts, 9);
  assert.match(r.last_error ?? '', /ECONNREFUSED/);
  assert.equal(deps.events.listUnseen({ limit: 10 }).events.length, 1);
});

test('worker novo entrega linha pending vencida', async () => {
  const { deps, db } = createTestDeps();
  deps.destinations.add({ url: 'https://a.test/h' });
  deps.events.insert(ev('e1'));
  deps.delivery.enqueue(ev('e1'));
  const send: Sender = async () => ({ status: 200 });
  const w = new DeliveryWorker({ db, destinations: deps.destinations, events: deps.events, send, now: () => Date.now() + 1000 });
  assert.equal((await w.tick()).delivered, 1);
});

test('tick não roda em paralelo; start duas vezes não cria dois timers', async () => {
  let inflight = 0; let max = 0;
  const send: Sender = async () => { inflight++; max = Math.max(max, inflight); await new Promise((r) => setTimeout(r, 20)); inflight--; return { status: 200 }; };
  const { deps, db } = createTestDeps({ send, now: () => Date.now() + 1000 });
  deps.destinations.add({ url: 'https://a.test/h' });
  deps.events.insert(ev('e1')); deps.events.insert(ev('e2'));
  deps.delivery.enqueue(ev('e1')); deps.delivery.enqueue(ev('e2'));
  await Promise.all([deps.delivery.tick(), deps.delivery.tick()]);
  assert.equal(max, 1);
  assert.equal(rows(db).filter((r) => r.status === 'delivered').length, 2);
  deps.delivery.start(1000); deps.delivery.start(1000); deps.delivery.stop();
});

test('subscribe_page une com os campos atuais e nunca perde leadgen', async () => {
  process.env.META_APP_ID = 'app-1';
  const { deps } = createTestDeps();
  const tools = captureTools((s) => registerInstagramEventTools(s as never, deps));
  const responder = (c: { method: string; url: string }) => {
    if (c.method === 'GET' && c.url.endsWith('/app')) return { id: 'app-1' };
    if (c.method === 'GET' && c.url.endsWith('/page-1')) return { access_token: 'page-token' };
    if (c.method === 'GET' && c.url.endsWith('/subscribed_apps')) {
      return { data: [{ id: 'other', subscribed_fields: ['x'] }, { id: 'app-1', subscribed_fields: ['leadgen'] }] };
    }
    return { success: true };
  };
  await withGraphMock(responder, async (calls) => {
    const res = parse(await tools.get('meta_ig_subscribe_page')!.handler({ fields: ['feed'] }));
    const post = calls.find((c) => c.method === 'POST')!;
    assert.equal(post.params.subscribed_fields, 'leadgen,feed');
    assert.deepEqual(res.antes, ['leadgen']);
    assert.deepEqual(res.depois, ['leadgen', 'feed']);
  });
  await withGraphMock(responder, async (calls) => {
    await tools.get('meta_ig_subscribe_page')!.handler({ fields: [] });
    for (const c of calls.filter((x) => x.method === 'POST')) assert.match(String(c.params.subscribed_fields), /leadgen/);
  });
  // sem META_APP_ID: usa o app do token
  delete process.env.META_APP_ID;
  await withGraphMock(responder, async (calls) => {
    const r = parse(await tools.get('meta_ig_subscribe_page')!.handler({ fields: ['feed'] }));
    assert.deepEqual(r.depois, ['leadgen', 'feed']);
    assert.equal(calls.find((c) => c.method === 'POST')!.params.subscribed_fields, 'leadgen,feed');
  });
});

test('subscribe_page recusa META_APP_ID diferente do app do token e não faz POST', async () => {
  process.env.META_APP_ID = 'wrong';
  const { deps } = createTestDeps();
  const tools = captureTools((s) => registerInstagramEventTools(s as never, deps));
  await withGraphMock((c) => {
    if (c.method === 'GET' && c.url.endsWith('/app')) return { id: 'famachat' };
    if (c.method === 'GET' && c.url.endsWith('/page-1')) return { access_token: 'page-token' };
    if (c.method === 'GET' && c.url.endsWith('/subscribed_apps')) return { data: [{ id: 'famachat', subscribed_fields: ['leadgen'] }] };
    return { success: true };
  }, async (calls) => {
    const r = (await tools.get('meta_ig_subscribe_page')!.handler({ fields: ['feed'] })) as Res;
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /META_APP_ID \(wrong\) não corresponde ao app do token \(famachat\)/);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  });
  delete process.env.META_APP_ID;
});

test('subscribe_page recusa quando o app do token aparece sem subscribed_fields válido e não faz POST', async () => {
  const { deps } = createTestDeps();
  const tools = captureTools((s) => registerInstagramEventTools(s as never, deps));
  for (const entry of [{ id: 'app-1' }, { id: 'app-1', subscribed_fields: 'leadgen' }, { id: 'app-1', subscribed_fields: null }]) {
    await withGraphMock((c) => {
      if (c.method === 'GET' && c.url.endsWith('/app')) return { id: 'app-1' };
      if (c.method === 'GET' && c.url.endsWith('/page-1')) return { access_token: 'page-token' };
      if (c.method === 'GET' && c.url.endsWith('/subscribed_apps')) return { data: [entry] };
      return { success: true };
    }, async (calls) => {
      const r = (await tools.get('meta_ig_subscribe_page')!.handler({ fields: ['feed'] })) as Res;
      assert.equal(r.isError, true, JSON.stringify(entry));
      assert.match(r.content[0].text, /subscribed_fields/);
      assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    });
  }
});

test('subscribe_page confere depois do POST que nenhum campo anterior (leadgen) sumiu', async () => {
  const { deps } = createTestDeps();
  const tools = captureTools((s) => registerInstagramEventTools(s as never, deps));
  const run = (afterFields: string[] | undefined) => {
    let gets = 0;
    return withGraphMock((c) => {
      if (c.method === 'GET' && c.url.endsWith('/app')) return { id: 'app-1' };
      if (c.method === 'GET' && c.url.endsWith('/page-1')) return { access_token: 'page-token' };
      if (c.method === 'GET' && c.url.endsWith('/subscribed_apps')) {
        gets++;
        if (gets === 1) return { data: [{ id: 'app-1', subscribed_fields: ['leadgen', 'feed'] }] };
        return { data: afterFields ? [{ id: 'app-1', subscribed_fields: afterFields }] : [] };
      }
      return { success: true };
    }, async (calls) => {
      const r = (await tools.get('meta_ig_subscribe_page')!.handler({ fields: ['comments'] })) as Res;
      const subscribedAppsGets = calls.filter((c) => c.method === 'GET' && c.url.endsWith('/subscribed_apps')).length;
      assert.equal(subscribedAppsGets, 2);
      const postIdx = calls.findIndex((c) => c.method === 'POST');
      assert.ok(calls.slice(postIdx + 1).some((c) => c.method === 'GET' && c.url.endsWith('/subscribed_apps')));
      results.push(r);
    });
  };
  const results: Res[] = [];
  await run(['leadgen', 'feed', 'comments']);
  await run(['feed', 'comments']);
  await run(undefined);

  const [ok, lostLeadgen, lostAll] = results;
  assert.equal(ok.isError, undefined);
  const okBody = JSON.parse(ok.content[0].text);
  assert.deepEqual(okBody.depois, ['leadgen', 'feed', 'comments']);
  assert.deepEqual(okBody.confirmados, ['leadgen', 'feed', 'comments']);

  assert.equal(lostLeadgen.isError, true);
  assert.match(lostLeadgen.content[0].text, /ATENÇÃO/);
  assert.match(lostLeadgen.content[0].text, /leadgen/);
  assert.match(lostLeadgen.content[0].text, /Antes: leadgen, feed/);
  assert.match(lostLeadgen.content[0].text, /Depois: feed, comments/);

  assert.equal(lostAll.isError, true);
  assert.match(lostAll.content[0].text, /leadgen, feed/);
});

test('list_events source=api devolve ids api:', async () => {
  const { deps } = createTestDeps();
  const tools = captureTools((s) => registerInstagramEventTools(s as never, deps));
  const now = new Date().toISOString();
  await withGraphMock((c) => {
    if (c.url.endsWith('/page-1')) return { access_token: 'page-token' };
    if (c.url.endsWith('/ig-1/media')) {
      return { data: [{ id: 'm1', comments: { data: [{ id: 'c1', text: 'oi', username: 'u', timestamp: now }, { id: 'c0', text: 'velho', timestamp: '2020-01-01T00:00:00+0000' }] } }] };
    }
    if (c.url.endsWith('/conversations')) {
      return { data: [{ id: 'conv1', updated_time: now, messages: { data: [{ id: 'mm1', created_time: now, from: { id: 'u' }, message: 'olá' }] } }] };
    }
    return {};
  }, async () => {
    const res = parse(await tools.get('meta_ig_list_events')!.handler({ source: 'api' }));
    const ids = res.events.map((e: { id: string }) => e.id);
    assert.deepEqual(ids.sort(), ['api:c1', 'api:mm1']);
  });
});

test('list_events/mark_seen no store; destinos via ferramentas', async () => {
  const send: Sender = async () => ({ status: 200 });
  const { deps } = createTestDeps({ send });
  const tools = captureTools((s) => registerInstagramEventTools(s as never, deps));
  deps.events.insert(ev('e1'));
  assert.equal(parse(await tools.get('meta_ig_list_events')!.handler({ limit: 0 })).events.length, 1);
  assert.deepEqual(parse(await tools.get('meta_ig_mark_events_seen')!.handler({ event_ids: ['e1'] })), { marked: 1 });
  assert.equal(parse(await tools.get('meta_ig_list_events')!.handler({})).events.length, 0);

  const added = parse(await tools.get('meta_ig_add_webhook_destination')!.handler({ url: 'https://a.test/h' }));
  assert.match(added.secret, /^whsec_/);
  assert.equal(added.aviso, 'Guarde este segredo agora: ele não será mostrado de novo.');
  const listed = JSON.stringify(parse(await tools.get('meta_ig_list_webhook_destinations')!.handler({})));
  assert.ok(!listed.includes(added.secret));
  assert.match(listed, /pending/);
  const test1 = parse(await tools.get('meta_ig_test_webhook_destination')!.handler({ destination_id: added.destination.id }));
  assert.equal(test1.ok, true);
  const bad = (await tools.get('meta_ig_add_webhook_destination')!.handler({ url: 'http://a.test/h' })) as Res;
  assert.equal(bad.isError, true);
  assert.deepEqual(parse(await tools.get('meta_ig_remove_webhook_destination')!.handler({ destination_id: added.destination.id })), { removed: true });
});
