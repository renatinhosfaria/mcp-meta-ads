import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { UploadStore } from '../../src/uploads/upload-store.ts';
import { openDatabase } from '../../src/storage/database.ts';
import { EventStore } from '../../src/events/event-store.ts';
import { DestinationStore } from '../../src/events/destinations.ts';
import { DeliveryWorker, type Sender } from '../../src/events/delivery.ts';
import type { InstagramDeps } from '../../src/tools/instagram/index.ts';

export function createTestDeps(opts: { send?: Sender; now?: () => number } = {}): { deps: InstagramDeps; dataDir: string; db: DatabaseSync } {
  const dataDir = mkdtempSync(join(tmpdir(), 'mcp-ig-'));
  const db = openDatabase(dataDir);
  const uploads = new UploadStore({ db, dataDir, publicBaseUrl: 'https://example.test' });
  const events = new EventStore(db);
  const destinations = new DestinationStore(db);
  const delivery = new DeliveryWorker({ db, destinations, events, send: opts.send, now: opts.now });
  return { deps: { uploads, events, destinations, delivery }, dataDir, db };
}
