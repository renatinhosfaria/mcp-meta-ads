import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionRegistry } from '../src/session-registry.ts';

class FakeCloseable {
  closeCalls = 0;

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

function resources() {
  return {
    transport: new FakeCloseable(),
    server: new FakeCloseable(),
  };
}

test('touch refreshes a session idle deadline', async () => {
  let now = 0;
  const registry = new SessionRegistry({ idleTtlMs: 30, maxSessions: 10, now: () => now });
  const session = resources();

  await registry.add('session-a', session);
  now = 20;
  assert.equal(registry.touch('session-a'), true);
  now = 49;
  assert.equal(await registry.sweepExpired(), 0);
  now = 51;
  assert.equal(await registry.sweepExpired(), 1);

  assert.equal(registry.size, 0);
  assert.equal(session.transport.closeCalls, 1);
  assert.equal(session.server.closeCalls, 1);
  assert.equal(registry.stats.expired, 1);
});

test('adding over capacity evicts the least recently active session', async () => {
  let now = 0;
  const registry = new SessionRegistry({ idleTtlMs: 1_000, maxSessions: 2, now: () => now });
  const first = resources();
  const second = resources();
  const third = resources();

  await registry.add('first', first);
  now = 1;
  await registry.add('second', second);
  now = 2;
  registry.touch('first');
  now = 3;
  await registry.add('third', third);

  assert.equal(registry.has('first'), true);
  assert.equal(registry.has('second'), false);
  assert.equal(registry.has('third'), true);
  assert.equal(second.transport.closeCalls, 1);
  assert.equal(second.server.closeCalls, 1);
  assert.equal(registry.stats.evicted, 1);
});

test('closing a session is idempotent', async () => {
  const registry = new SessionRegistry({ idleTtlMs: 30, maxSessions: 10 });
  const session = resources();

  await registry.add('session-a', session);
  assert.equal(await registry.close('session-a', 'explicit'), true);
  assert.equal(await registry.close('session-a', 'explicit'), false);

  assert.equal(session.transport.closeCalls, 1);
  assert.equal(session.server.closeCalls, 1);
  assert.equal(registry.stats.closed, 1);
});

test('closeAll closes every active session', async () => {
  const registry = new SessionRegistry({ idleTtlMs: 30, maxSessions: 10 });
  const first = resources();
  const second = resources();

  await registry.add('first', first);
  await registry.add('second', second);
  assert.equal(await registry.closeAll('shutdown'), 2);

  assert.equal(registry.size, 0);
  assert.equal(first.transport.closeCalls, 1);
  assert.equal(first.server.closeCalls, 1);
  assert.equal(second.transport.closeCalls, 1);
  assert.equal(second.server.closeCalls, 1);
});
