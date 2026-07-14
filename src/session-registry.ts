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
    activeRequests: number;
  };

export type SessionRegistryStats = {
  created: number;
  closed: number;
  expired: number;
  evicted: number;
};

export type SessionRegistryEvent = {
  type: 'created' | 'closed';
  sessionId: string;
  activeSessions: number;
  reason?: SessionCloseReason;
};

type SessionRegistryOptions = {
  idleTtlMs: number;
  maxSessions: number;
  now?: () => number;
  onEvent?: (event: SessionRegistryEvent) => void;
};

export class SessionRegistry<TTransport extends Closeable = Closeable, TServer extends Closeable = Closeable> {
  private readonly sessions = new Map<string, SessionRecord<TTransport, TServer>>();
  private readonly idleTtlMs: number;
  private readonly maxSessions: number;
  private readonly now: () => number;
  private readonly onEvent?: (event: SessionRegistryEvent) => void;
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
    this.onEvent = options.onEvent;
  }

  get size(): number {
    return this.sessions.size;
  }

  get capacity(): number {
    return this.maxSessions;
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

  startActivity(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.activeRequests += 1;
    session.lastActivityAt = this.now();
    return true;
  }

  endActivity(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.activeRequests = Math.max(0, session.activeRequests - 1);
    session.lastActivityAt = this.now();
    return true;
  }

  async add(id: string, resources: SessionResources<TTransport, TServer>): Promise<void> {
    const detached: SessionRecord<TTransport, TServer>[] = [];
    if (this.sessions.has(id)) {
      const replaced = this.detach(id, 'explicit');
      if (replaced) detached.push(replaced);
    }

    while (this.sessions.size >= this.maxSessions) {
      const oldestId = this.findLeastRecentlyActiveId();
      if (!oldestId) break;
      const session = this.detach(oldestId, 'evicted');
      if (session) detached.push(session);
    }

    const timestamp = this.now();
    this.sessions.set(id, {
      ...resources,
      createdAt: timestamp,
      lastActivityAt: timestamp,
      activeRequests: 0,
    });
    this.counters.created += 1;
    this.onEvent?.({ type: 'created', sessionId: id, activeSessions: this.sessions.size });

    await Promise.all(detached.map((session) => this.closeResources(session)));
  }

  async sweepExpired(): Promise<number> {
    const deadline = this.now() - this.idleTtlMs;
    const expiredIds = [...this.sessions.entries()]
      .filter(([, session]) => session.activeRequests === 0 && session.lastActivityAt <= deadline)
      .map(([id]) => id);

    await Promise.all(expiredIds.map((id) => this.close(id, 'expired')));
    return expiredIds.length;
  }

  async close(id: string, reason: SessionCloseReason): Promise<boolean> {
    const session = this.detach(id, reason);
    if (!session) return false;

    if (reason !== 'transport') await this.closeResources(session);
    return true;
  }

  closeAfterTransport(id: string, reason: SessionCloseReason = 'transport'): boolean {
    return this.detach(id, reason) !== undefined;
  }

  async closeAll(reason: SessionCloseReason): Promise<number> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.close(id, reason)));
    return ids.length;
  }

  private findLeastRecentlyActiveId(): string | undefined {
    let oldestIdle: { id: string; lastActivityAt: number } | undefined;
    let oldestActive: { id: string; lastActivityAt: number } | undefined;

    for (const [id, session] of this.sessions) {
      const candidate = { id, lastActivityAt: session.lastActivityAt };
      if (session.activeRequests === 0) {
        if (!oldestIdle || session.lastActivityAt < oldestIdle.lastActivityAt) {
          oldestIdle = candidate;
        }
      } else if (!oldestActive || session.lastActivityAt < oldestActive.lastActivityAt) {
        oldestActive = candidate;
      }
    }

    // Preserve active streams whenever possible. If every session is active, retain
    // the hard capacity bound and evict the oldest stream to protect process memory.
    return oldestIdle?.id ?? oldestActive?.id;
  }

  private detach(
    id: string,
    reason: SessionCloseReason,
  ): SessionRecord<TTransport, TServer> | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    this.sessions.delete(id);
    this.counters.closed += 1;
    if (reason === 'expired') this.counters.expired += 1;
    if (reason === 'evicted') this.counters.evicted += 1;
    this.onEvent?.({
      type: 'closed',
      sessionId: id,
      activeSessions: this.sessions.size,
      reason,
    });
    return session;
  }

  private async closeResources(session: SessionRecord<TTransport, TServer>): Promise<void> {
    await Promise.allSettled([
      Promise.resolve().then(() => session.server.close()),
    ]);
  }
}
