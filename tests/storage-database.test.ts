import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { openDatabase } = await import('../src/storage/database.ts');

test('openDatabase creates schema v1 and reopens idempotently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-db-'));
  const db = openDatabase(dir);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
  for (const t of ['events', 'destinations', 'deliveries', 'uploads']) assert.ok(tables.includes(t));
  db.close();
  const again = openDatabase(dir);
  assert.equal((again.prepare('PRAGMA user_version').get() as any).user_version, 1);
  again.close();
});
