import type { DatabaseSync } from 'node:sqlite';
import type { EventType, NormalizedEvent } from './normalize.js';

type Row = {
  seq: number; id: string; type: string; ig_user_id: string; occurred_at: string;
  received_at: string; summary_json: string; raw_json: string;
};

function fromRow(r: Row): NormalizedEvent {
  return {
    id: r.id, version: 1, type: r.type as EventType, ig_user_id: r.ig_user_id, occurred_at: r.occurred_at,
    received_at: r.received_at, summary: JSON.parse(r.summary_json), raw: JSON.parse(r.raw_json),
  };
}

export class EventStore {
  constructor(private readonly db: DatabaseSync) {}

  /** false quando o id já existe. */
  insert(event: NormalizedEvent): boolean {
    const res = this.db.prepare(
      `INSERT OR IGNORE INTO events (id, type, ig_user_id, occurred_at, received_at, summary_json, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(event.id, event.type, event.ig_user_id, event.occurred_at, event.received_at,
      JSON.stringify(event.summary), JSON.stringify(event.raw ?? null));
    return Number(res.changes) > 0;
  }

  get(id: string): NormalizedEvent | undefined {
    const row = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }

  listUnseen(opts: { types?: EventType[]; afterSeq?: number; limit: number }):
    { events: Array<NormalizedEvent & { seq: number }>; next_cursor: number | null } {
    const params: Array<string | number> = [opts.afterSeq ?? 0];
    let typeClause = '';
    if (opts.types && opts.types.length > 0) {
      typeClause = ` AND type IN (${opts.types.map(() => '?').join(',')})`;
      params.push(...opts.types);
    }
    params.push(opts.limit + 1);
    const rows = this.db.prepare(
      `SELECT * FROM events WHERE seen_at IS NULL AND seq > ?${typeClause} ORDER BY seq LIMIT ?`,
    ).all(...params) as Row[];
    const page = rows.slice(0, opts.limit);
    const events = page.map((r) => ({ ...fromRow(r), seq: r.seq }));
    return { events, next_cursor: rows.length > opts.limit ? events[events.length - 1].seq : null };
  }

  markSeen(ids: string[], at: Date = new Date()): number {
    const stmt = this.db.prepare('UPDATE events SET seen_at = ? WHERE id = ? AND seen_at IS NULL');
    let n = 0;
    for (const id of ids) n += Number(stmt.run(at.toISOString(), id).changes);
    return n;
  }

  purgeSeen(olderThanDays: number, now: Date = new Date()): number {
    const cutoff = new Date(now.getTime() - olderThanDays * 86400_000).toISOString();
    return Number(this.db.prepare('DELETE FROM events WHERE seen_at IS NOT NULL AND seen_at < ?').run(cutoff).changes);
  }
}
