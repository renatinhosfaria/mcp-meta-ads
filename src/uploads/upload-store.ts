import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DatabaseSync } from 'node:sqlite';

export const UPLOAD_LIMITS: Record<string, { kind: 'image' | 'video'; ext: 'jpg' | 'mp4' | 'mov'; maxBytes: number }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg', maxBytes: 8 * 1024 * 1024 },
  'video/mp4': { kind: 'video', ext: 'mp4', maxBytes: 300 * 1024 * 1024 },
  'video/quicktime': { kind: 'video', ext: 'mov', maxBytes: 300 * 1024 * 1024 },
};
export const UPLOAD_TTL_MS = 48 * 60 * 60 * 1000;

export type UploadRecord = {
  id: string;
  fileName: string;
  path: string;
  mimeType: string;
  kind: 'image' | 'video';
  sizeBytes: number;
  createdAt: number;
  expiresAt: number;
};

export class UnsupportedMediaTypeError extends Error {}
export class UploadTooLargeError extends Error {}

type Row = { id: string; file_name: string; mime_type: string; kind: 'image' | 'video'; size_bytes: number; created_at: number; expires_at: number };

export class UploadStore {
  private readonly db: DatabaseSync;
  private readonly dir: string;
  private readonly publicBaseUrl: string;
  private readonly now: () => number;
  private readonly limits: typeof UPLOAD_LIMITS;

  constructor(opts: { db: DatabaseSync; dataDir: string; publicBaseUrl: string; now?: () => number; limits?: typeof UPLOAD_LIMITS }) {
    this.db = opts.db;
    this.dir = join(opts.dataDir, 'uploads');
    this.publicBaseUrl = opts.publicBaseUrl.replace(/\/+$/, '');
    this.now = opts.now ?? Date.now;
    this.limits = opts.limits ?? UPLOAD_LIMITS;
  }

  limitFor(mimeType: string): { kind: 'image' | 'video'; ext: 'jpg' | 'mp4' | 'mov'; maxBytes: number } {
    const limit = Object.hasOwn(this.limits, mimeType) ? this.limits[mimeType] : undefined;
    if (!limit) {
      throw new UnsupportedMediaTypeError(
        `Tipo não suportado: ${mimeType}. A Meta só publica fotos em JPEG; converta antes de enviar. Vídeos: MP4 ou MOV.`,
      );
    }
    return limit;
  }

  async saveStream(source: Readable, mimeType: string): Promise<UploadRecord> {
    const limit = this.limitFor(mimeType);
    const { id, fileName, path } = this.allocate(limit.ext);
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > limit.maxBytes) {
          cb(new UploadTooLargeError(`Arquivo maior que o limite de ${limit.maxBytes} bytes para ${mimeType}.`));
        } else {
          cb(null, chunk);
        }
      },
    });
    try {
      await pipeline(source, counter, createWriteStream(path, { flags: 'wx' }));
      return this.insert(id, fileName, path, mimeType, limit.kind, size);
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  async saveBuffer(buffer: Buffer, mimeType: string): Promise<UploadRecord> {
    const limit = this.limitFor(mimeType);
    if (buffer.length > limit.maxBytes) {
      throw new UploadTooLargeError(`Arquivo maior que o limite de ${limit.maxBytes} bytes para ${mimeType}.`);
    }
    const { id, fileName, path } = this.allocate(limit.ext);
    try {
      await writeFile(path, buffer, { flag: 'wx' });
      return this.insert(id, fileName, path, mimeType, limit.kind, buffer.length);
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  get(id: string): UploadRecord | undefined {
    const row = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as Row | undefined;
    if (!row || row.expires_at <= this.now()) return undefined;
    return this.toRecord(row);
  }

  getByFileName(fileName: string): UploadRecord | undefined {
    const row = this.db.prepare('SELECT * FROM uploads WHERE file_name = ?').get(fileName) as Row | undefined;
    return row ? this.get(row.id) : undefined;
  }

  publicUrl(record: UploadRecord): string {
    return `${this.publicBaseUrl}/media/${record.fileName}`;
  }

  async remove(id: string): Promise<void> {
    const row = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as Row | undefined;
    if (!row) return;
    this.db.prepare('DELETE FROM uploads WHERE id = ?').run(id);
    await unlink(join(this.dir, row.file_name)).catch(() => undefined);
  }

  async purgeExpired(): Promise<number> {
    const rows = this.db.prepare('SELECT * FROM uploads WHERE expires_at <= ?').all(this.now()) as Row[];
    for (const row of rows) await this.remove(row.id);
    return rows.length;
  }

  private allocate(ext: string) {
    mkdirSync(this.dir, { recursive: true });
    const id = randomBytes(24).toString('base64url');
    const fileName = `${id}.${ext}`;
    return { id, fileName, path: join(this.dir, fileName) };
  }

  private insert(id: string, fileName: string, path: string, mimeType: string, kind: 'image' | 'video', sizeBytes: number): UploadRecord {
    const createdAt = this.now();
    const expiresAt = createdAt + UPLOAD_TTL_MS;
    this.db
      .prepare('INSERT INTO uploads (id, file_name, mime_type, kind, size_bytes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, fileName, mimeType, kind, sizeBytes, createdAt, expiresAt);
    return { id, fileName, path, mimeType, kind, sizeBytes, createdAt, expiresAt };
  }

  private toRecord(row: Row): UploadRecord {
    return {
      id: row.id,
      fileName: row.file_name,
      path: join(this.dir, row.file_name),
      mimeType: row.mime_type,
      kind: row.kind,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }
}
