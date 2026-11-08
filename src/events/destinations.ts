import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { EventType } from './normalize.js';

export type Destination = { id: string; url: string; event_types: EventType[] | null; description: string | null; created_at: string };

type Row = { id: string; url: string; secret: string; event_types_json: string | null; description: string | null; created_at: string };

function toDestination(r: Row): Destination {
  return {
    id: r.id, url: r.url, event_types: r.event_types_json ? (JSON.parse(r.event_types_json) as EventType[]) : null,
    description: r.description, created_at: r.created_at,
  };
}

export class DestinationStore {
  constructor(private readonly db: DatabaseSync) {}

  add(input: { url: string; event_types?: EventType[]; description?: string }): { destination: Destination; secret: string } {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw new Error('URL de destino inválida.');
    }
    if (parsed.protocol !== 'https:') throw new Error('O destino do webhook precisa usar https://.');
    const id = randomUUID();
    const secret = 'whsec_' + randomBytes(32).toString('base64url');
    const types = input.event_types && input.event_types.length > 0 ? JSON.stringify(input.event_types) : null;
    const created_at = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO destinations (id, url, secret, event_types_json, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, input.url, secret, types, input.description ?? null, created_at);
    return { destination: toDestination({ id, url: input.url, secret, event_types_json: types, description: input.description ?? null, created_at }), secret };
  }

  list(): Destination[] {
    const rows = this.db.prepare('SELECT * FROM destinations ORDER BY created_at, id').all() as Row[];
    return rows.map(toDestination);
  }

  remove(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM destinations WHERE id = ?').run(id).changes) > 0;
  }

  getWithSecret(id: string): (Destination & { secret: string }) | undefined {
    const r = this.db.prepare('SELECT * FROM destinations WHERE id = ?').get(id) as Row | undefined;
    return r ? { ...toDestination(r), secret: r.secret } : undefined;
  }

  activeFor(type: EventType): Array<Destination & { secret: string }> {
    const rows = this.db.prepare('SELECT * FROM destinations ORDER BY created_at, id').all() as Row[];
    return rows
      .map((r) => ({ ...toDestination(r), secret: r.secret }))
      .filter((d) => d.event_types === null || d.event_types.includes(type));
  }

  deliveryCounts(id: string): { pending: number; failed: number } {
    const rows = this.db.prepare(
      `SELECT status, COUNT(*) AS n FROM deliveries WHERE destination_id = ? AND status IN ('pending','failed') GROUP BY status`,
    ).all(id) as Array<{ status: string; n: number }>;
    const get = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
    return { pending: get('pending'), failed: get('failed') };
  }
}
