import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UploadStore } from '../../src/uploads/upload-store.ts';
import { openDatabase } from '../../src/storage/database.ts';
import type { InstagramDeps } from '../../src/tools/instagram/index.ts';

// Ampliado nas Tasks 10 e 11.
export function createTestDeps(): { deps: InstagramDeps; dataDir: string } {
  const dataDir = mkdtempSync(join(tmpdir(), 'mcp-ig-'));
  const db = openDatabase(dataDir);
  const uploads = new UploadStore({ db, dataDir, publicBaseUrl: 'https://example.test' });
  return { deps: { uploads }, dataDir };
}
