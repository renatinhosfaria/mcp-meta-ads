export type SessionCloseReason = 'explicit' | 'expired' | 'evicted' | 'shutdown' | 'transport';

export type Closeable = {
  close(): void | Promise<void>;
};

export type SessionResources<TTransport extends Closeable, TServer extends Closeable> = {
  transport: TTransport;
  server: TServer;
};

type SessionRecord<TTransport extends Closeable, TServer extends Closeable> =
  SessionResources<TTransport, TServer> & {
    createdAt: number;
    lastActivityAt: number;
  };

export type SessionRegistryStats = {
  created: number;
  closed: number;
  expired: number;
  evicted: number;
};

type SessionRegistryOptions = {
  idleTtlMs: number;
  maxSessions: number;
  now?: () => number;
};

export class SessionRegistry<TTransport extends Closeable = Closeable, TServer extends Closeable = Closeable> {
  private readonly sessions = new Map<string, SessionRecord<TTransport, TServer>>();
  private readonly idleTtlMs: number;
  private readonly maxSessions: number;
  private readonly now: () => number;
  private readonly counters: SessionRegistryStats = {
    created: 0,
    closed: 0,
    expired: 0,
    evicted: 0,
  };

  constructor(options: SessionRegistryOptions) {
    if (options.idleTtlMs <= 0) throw new Error('idleTtlMs must be greater than zero');
    if (options.maxSessions <= 0) throw new Error('maxSessions must be greater than zero');

    this.idleTtlMs = options.idleTtlMs;
    this.maxSessions = options.maxSessions;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.sessions.size;
  }

  get stats(): SessionRegistryStats {
    return { ...this.counters };
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  get(id: string): SessionResources<TTransport, TServer> | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    return { transport: session.transport, server: session.server };
  }

  touch(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.lastActivityAt = this.now();
    return true;
  }

  async add(id: string, resources: SessionResources<TTransport, TServer>): Promise<void> {
    if (this.sessions.has(id)) {
      await this.close(id, 'transport');
    }

    while (this.sessions.size >= this.maxSessions) {
      const oldestId = this.findLeastRecentlyActiveId();
      if (!oldestId) break;
      await this.close(oldestId, 'evicted');
    }

    const timestamp = this.now();
    this.sessions.set(id, {
      ...resources,
      createdAt: timestamp,
      lastActivityAt: timestamp,
    });
    this.counters.created += 1;
  }

  async sweepExpired(): Promise<number> {
    const deadline = this.now() - this.idleTtlMs;
    const expiredIds = [...this.sessions.entries()]
      .filter(([, session]) => session.lastActivityAt <= deadline)
      .map(([id]) => id);

    await Promise.all(expiredIds.map((id) => this.close(id, 'expired')));
    return expiredIds.length;
  }

  async close(id: string, reason: SessionCloseReason): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;

    this.sessions.delete(id);
    this.counters.closed += 1;
    if (reason === 'expired') this.counters.expired += 1;
    if (reason === 'evicted') this.counters.evicted += 1;

    await Promise.allSettled([
      Promise.resolve(session.transport.close()),
      Promise.resolve(session.server.close()),
    ]);
    return true;
  }

  async closeAll(reason: SessionCloseReason): Promise<number> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.close(id, reason)));
    return ids.length;
  }

  private findLeastRecentlyActiveId(): string | undefined {
    let oldest: { id: string; lastActivityAt: number } | undefined;

    for (const [id, session] of this.sessions) {
      if (!oldest || session.lastActivityAt < oldest.lastActivityAt) {
        oldest = { id, lastActivityAt: session.lastActivityAt };
      }
    }

    return oldest?.id;
  }
}
