import type { DatabaseSync } from 'node:sqlite';
import type { DestinationStore } from './destinations.js';
import type { EventStore } from './event-store.js';
import type { NormalizedEvent } from './normalize.js';
import { signPayload } from './signature.js';

export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000, 10_800_000, 21_600_000, 43_200_000];

export type Sender = (url: string, init: { headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<{ status: number }>;

const BATCH_SIZE = 50;
const TIMEOUT_MS = 10_000;

const defaultSender: Sender = async (url, init) => {
  const res = await fetch(url, {
    method: 'POST', headers: init.headers, body: init.body, redirect: 'manual',
    signal: AbortSignal.timeout(init.timeoutMs),
  });
  return { status: res.status };
};

function buildRequest(secret: string, event: NormalizedEvent, attempt: number, nowMs: number) {
  const body = JSON.stringify({ version: 1, attempt, event });
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Meta-MCP-Event-Id': event.id,
      'X-Meta-MCP-Timestamp': timestamp,
      'X-Meta-MCP-Signature': signPayload(secret, timestamp, body),
    },
  };
}

type Due = { event_id: string; destination_id: string; attempts: number };

export class DeliveryWorker {
  private readonly db: DatabaseSync;
  private readonly destinations: DestinationStore;
  private readonly events: EventStore;
  private readonly send: Sender;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(opts: { db: DatabaseSync; destinations: DestinationStore; events: EventStore; send?: Sender; now?: () => number; log?: (line: string) => void }) {
    this.db = opts.db;
    this.destinations = opts.destinations;
    this.events = opts.events;
    this.send = opts.send ?? defaultSender;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  enqueue(event: NormalizedEvent): number {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO deliveries (event_id, destination_id, status, attempts, next_attempt_at) VALUES (?, ?, 'pending', 0, ?)`,
    );
    let n = 0;
    for (const d of this.destinations.activeFor(event.type)) n += Number(stmt.run(event.id, d.id, this.now()).changes);
    return n;
  }

  async tick(): Promise<{ delivered: number; retried: number; failed: number }> {
    const result = { delivered: 0, retried: 0, failed: 0 };
    if (this.running) return result;
    this.running = true;
    try {
      const due = this.db.prepare(
        `SELECT event_id, destination_id, attempts FROM deliveries
         WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?`,
      ).all(this.now(), BATCH_SIZE) as Due[];
      for (const row of due) {
        const outcome = await this.deliverOne(row);
        result[outcome]++;
      }
    } finally {
      this.running = false;
    }
    return result;
  }

  private async deliverOne(row: Due): Promise<'delivered' | 'retried' | 'failed'> {
    const key = [row.event_id, row.destination_id];
    const dest = this.destinations.getWithSecret(row.destination_id);
    const event = this.events.get(row.event_id);
    if (!dest || !event) {
      this.db.prepare(`UPDATE deliveries SET status = 'failed', last_error = ? WHERE event_id = ? AND destination_id = ?`)
        .run(!dest ? 'destino removido' : 'evento removido', ...key);
      return 'failed';
    }
    const attempts = row.attempts + 1;
    let error: string;
    try {
      const req = buildRequest(dest.secret, event, attempts, this.now());
      const { status } = await this.send(dest.url, { headers: req.headers, body: req.body, timeoutMs: TIMEOUT_MS });
      if (status >= 200 && status < 300) {
        this.db.prepare(`UPDATE deliveries SET status = 'delivered', attempts = ?, last_error = NULL WHERE event_id = ? AND destination_id = ?`)
          .run(attempts, ...key);
        return 'delivered';
      }
      error = `HTTP ${status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const delay = RETRY_DELAYS_MS[attempts - 1];
    if (delay === undefined) {
      this.db.prepare(`UPDATE deliveries SET status = 'failed', attempts = ?, last_error = ? WHERE event_id = ? AND destination_id = ?`)
        .run(attempts, error, ...key);
      this.log(`entrega ${row.event_id} -> ${row.destination_id} falhou definitivamente: ${error}`);
      return 'failed';
    }
    this.db.prepare(`UPDATE deliveries SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE event_id = ? AND destination_id = ?`)
      .run(attempts, this.now() + delay, error, ...key);
    return 'retried';
  }

  async sendTest(destinationId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
    const dest = this.destinations.getWithSecret(destinationId);
    if (!dest) return { ok: false, error: 'Destino não encontrado.' };
    const nowIso = new Date(this.now()).toISOString();
    const event: NormalizedEvent = {
      id: `test:${nowIso}`, version: 1, type: 'unknown', ig_user_id: '', occurred_at: nowIso,
      received_at: nowIso, summary: { test: true }, raw: null,
    };
    try {
      const req = buildRequest(dest.secret, event, 1, this.now());
      const { status } = await this.send(dest.url, { headers: req.headers, body: req.body, timeoutMs: TIMEOUT_MS });
      return status >= 200 && status < 300 ? { ok: true, status } : { ok: false, status, error: `HTTP ${status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch((e) => this.log(`erro no tick: ${e instanceof Error ? e.message : String(e)}`)); }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
