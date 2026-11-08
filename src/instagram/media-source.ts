import { z } from 'zod';
import { decodeBase64Payload } from '../tools/assets.js';
import type { UploadRecord, UploadStore } from '../uploads/upload-store.js';

export type MediaInput = { url?: string; upload_id?: string; base64?: string };

export const mediaInputSchema = z
  .object({
    url: z.string().url().optional().describe('URL pública da mídia'),
    upload_id: z.string().optional().describe('ID devolvido por POST /uploads'),
    base64: z.string().optional().describe('Imagem JPEG em base64 (só para fotos)'),
  })
  .strict()
  .refine((v) => [v.url, v.upload_id, v.base64].filter((x) => x !== undefined).length === 1, {
    message: 'Informe exatamente uma origem: url, upload_id ou base64.',
  });

export async function resolveMediaSource(
  input: MediaInput,
  expected: 'image' | 'video',
  uploads: UploadStore,
): Promise<{ url: string; upload?: UploadRecord }> {
  if (input.upload_id !== undefined) {
    const upload = uploads.get(input.upload_id);
    if (!upload) throw new Error(`Upload ${input.upload_id} não encontrado ou expirado.`);
    if (upload.kind !== expected) {
      throw new Error(`O upload ${upload.id} é ${upload.kind}, mas esta publicação precisa de ${expected}.`);
    }
    return { url: uploads.publicUrl(upload), upload };
  }
  if (input.base64 !== undefined) {
    if (expected !== 'image') throw new Error('base64 só é aceito para imagens; para vídeo use upload_id ou url.');
    const match = input.base64.match(/^data:(.*?);base64,(.*)$/s);
    const upload = await uploads.saveBuffer(decodeBase64Payload(match ? match[2] : input.base64), 'image/jpeg');
    return { url: uploads.publicUrl(upload), upload };
  }
  if (input.url !== undefined) return { url: input.url };
  throw new Error('Informe exatamente uma origem: url, upload_id ou base64.');
}
