import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_V1 = `
CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
  ig_user_id TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL, seen_at TEXT,
  summary_json TEXT NOT NULL, raw_json TEXT NOT NULL);
CREATE INDEX events_unseen ON events(seen_at, seq);
CREATE TABLE destinations (id TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT NOT NULL,
  event_types_json TEXT, description TEXT, created_at TEXT NOT NULL);
CREATE TABLE deliveries (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','delivered','failed')), attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL, last_error TEXT, PRIMARY KEY (event_id, destination_id));
CREATE INDEX deliveries_due ON deliveries(status, next_attempt_at);
CREATE TABLE uploads (id TEXT PRIMARY KEY, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
`;

export function openDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'mcp.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');

  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version < 1) {
    db.exec('BEGIN');
    try {
      db.exec(SCHEMA_V1);
      db.exec('PRAGMA user_version = 1');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return db;
}
