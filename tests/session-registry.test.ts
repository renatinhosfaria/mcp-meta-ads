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
  const transport = new FakeCloseable();
  const server = new class extends FakeCloseable {
    override async close(): Promise<void> {
      await super.close();
      await transport.close();
    }
  }();

  return {
    transport,
    server,
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

test('does not expire a session while a stream is active', async () => {
  let now = 0;
  const registry = new SessionRegistry({ idleTtlMs: 30, maxSessions: 10, now: () => now });

  await registry.add('session-a', resources());
  assert.equal(registry.startActivity('session-a'), true);
  now = 31;
  assert.equal(await registry.sweepExpired(), 0);

  assert.equal(registry.endActivity('session-a'), true);
  now = 62;
  assert.equal(await registry.sweepExpired(), 1);
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

test('capacity eviction prefers an idle session over an older active stream', async () => {
  let now = 0;
  const registry = new SessionRegistry({ idleTtlMs: 1_000, maxSessions: 2, now: () => now });

  await registry.add('active-stream', resources());
  registry.startActivity('active-stream');
  now = 1;
  await registry.add('idle-session', resources());
  now = 2;
  await registry.add('new-session', resources());

  assert.equal(registry.has('active-stream'), true);
  assert.equal(registry.has('idle-session'), false);
  assert.equal(registry.has('new-session'), true);
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

test('emits lifecycle events with the close reason and active count', async () => {
  const events: unknown[] = [];
  const registry = new SessionRegistry({
    idleTtlMs: 30,
    maxSessions: 10,
    onEvent: (event) => events.push(event),
  });

  await registry.add('session-a', resources());
  await registry.close('session-a', 'explicit');

  assert.deepEqual(events, [
    { type: 'created', sessionId: 'session-a', activeSessions: 1 },
    { type: 'closed', sessionId: 'session-a', activeSessions: 0, reason: 'explicit' },
  ]);
});

test('closes an owned transport only once through its server', async () => {
  const registry = new SessionRegistry({ idleTtlMs: 30, maxSessions: 10 });
  const transport = new FakeCloseable();
  const server = {
    closeCalls: 0,
    async close() {
      this.closeCalls += 1;
      await transport.close();
    },
  };

  await registry.add('session-a', { transport, server });
  await registry.close('session-a', 'explicit');

  assert.equal(server.closeCalls, 1);
  assert.equal(transport.closeCalls, 1);
});

test('records an explicit transport close without closing its server again', async () => {
  const events: unknown[] = [];
  const registry = new SessionRegistry({
    idleTtlMs: 30,
    maxSessions: 10,
    onEvent: (event) => events.push(event),
  });
  const session = resources();

  await registry.add('session-a', session);
  assert.equal(registry.closeAfterTransport('session-a', 'explicit'), true);

  assert.equal(session.server.closeCalls, 0);
  assert.deepEqual(events.at(-1), {
    type: 'closed',
    sessionId: 'session-a',
    activeSessions: 0,
    reason: 'explicit',
  });
});

test('publishes a new session before waiting for an eviction close', async () => {
  let releaseClose!: () => void;
  const closeGate = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  const registry = new SessionRegistry({ idleTtlMs: 30, maxSessions: 1 });
  await registry.add('old', {
    transport: new FakeCloseable(),
    server: { close: () => closeGate },
  });

  const adding = registry.add('new', resources());
  await Promise.resolve();

  assert.equal(registry.has('new'), true);
  assert.equal(registry.has('old'), false);
  releaseClose();
  await adding;
});
