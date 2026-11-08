import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import express from 'express';
import { UnsupportedMediaTypeError, UploadStore, UploadTooLargeError } from './upload-store.js';

const DRAIN_CAP_BYTES = 16 * 1024 * 1024;
const MEDIA_FILE_NAME = /^[A-Za-z0-9_-]{32}\.(jpg|mp4|mov)$/;

// Montar atrás da autenticação do MCP.
export function createUploadRouter(uploads: UploadStore, log: (message: string) => void = console.error): express.Router {
  const router = express.Router();
  router.post('/uploads', async (req, res) => {
    const mimeType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    try {
      const limit = uploads.limitFor(mimeType);
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > limit.maxBytes) {
        res.setHeader('Connection', 'close');
        res.status(413).json({ error: `Arquivo maior que o limite de ${limit.maxBytes} bytes para ${mimeType}.` });
        return;
      }
      // A cópia isola o pipeline: se ele falhar, `req` não é destruído e o 413 chega ao cliente.
      const body = new PassThrough();
      req.pipe(body);
      // pipe() não propaga abort/erro do cliente; sem isto o pipeline do store nunca termina.
      req.on('error', (err) => body.destroy(err));
      req.on('close', () => {
        if (!req.complete) body.destroy(new Error('Upload interrompido pelo cliente.'));
      });
      const record = await uploads.saveStream(body, mimeType);
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
        drain(req);
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
    res.sendFile(
      resolve(record.path),
      { dotfiles: 'allow', headers: { 'Content-Type': record.mimeType, 'X-Content-Type-Options': 'nosniff' } },
      (error) => {
        if (error && !res.headersSent) res.status(404).json({ error: 'Não encontrado.' });
      },
    );
  });
  return router;
}

// Descarta o resto do corpo (com teto) para o cliente conseguir terminar de enviar e ler o 413.
function drain(req: express.Request): void {
  let seen = 0;
  req.on('data', (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > DRAIN_CAP_BYTES) req.destroy();
  });
  req.on('error', () => undefined);
  req.resume();
}
