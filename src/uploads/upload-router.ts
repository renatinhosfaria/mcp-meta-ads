import { createReadStream } from 'node:fs';
import express from 'express';
import { UnsupportedMediaTypeError, UploadStore, UploadTooLargeError } from './upload-store.js';

const MEDIA_FILE_NAME = /^[A-Za-z0-9_-]{32}\.(jpg|mp4|mov)$/;

// Montar atrás da autenticação do MCP.
export function createUploadRouter(uploads: UploadStore, log: (message: string) => void = console.error): express.Router {
  const router = express.Router();
  router.post('/uploads', async (req, res) => {
    const mimeType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    try {
      const limit = UploadStore.limitFor(mimeType);
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > limit.maxBytes) {
        res.setHeader('Connection', 'close');
        res.status(413).json({ error: `Arquivo maior que o limite de ${limit.maxBytes} bytes para ${mimeType}.` });
        return;
      }
      const record = await uploads.saveStream(req, mimeType);
      const filename = String(req.headers['x-filename'] ?? '').replace(/[^\w.\- ]/g, '_').slice(0, 100);
      log(`[uploads] ${record.kind} ${record.sizeBytes}B${filename ? ` (${filename})` : ''}`);
      res.status(201).json({
        upload_id: record.id,
        kind: record.kind,
        size_bytes: record.sizeBytes,
        expires_at: new Date(record.expiresAt).toISOString(),
      });
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof UnsupportedMediaTypeError) {
        res.status(415).json({ error: error.message });
      } else if (error instanceof UploadTooLargeError) {
        res.setHeader('Connection', 'close');
        res.status(413).json({ error: error.message });
      } else {
        console.error('[uploads] falha ao gravar upload:', error instanceof Error ? error.message : error);
        res.status(500).json({ error: 'Falha ao gravar o upload.' });
      }
    }
  });
  return router;
}

// Público: o link é inadivinhável (id de 192 bits) e expira.
export function createMediaRouter(uploads: UploadStore): express.Router {
  const router = express.Router();
  router.get('/media/:fileName', (req, res) => {
    const { fileName } = req.params;
    const record = MEDIA_FILE_NAME.test(fileName) ? uploads.getByFileName(fileName) : undefined;
    if (!record) {
      res.status(404).json({ error: 'Não encontrado.' });
      return;
    }
    res.setHeader('Content-Type', record.mimeType);
    res.setHeader('Content-Length', String(record.sizeBytes));
    const stream = createReadStream(record.path);
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).json({ error: 'Não encontrado.' });
      else res.destroy();
    });
    stream.pipe(res);
  });
  return router;
}
