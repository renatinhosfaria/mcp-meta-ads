import { createReadStream } from 'node:fs';
import axios from 'axios';
import { getAccessToken, makeRequest } from '../client.js';
import type { UploadRecord, UploadStore } from '../uploads/upload-store.js';

export type ContainerStatusCode = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createContainer(igUserId: string, body: Record<string, unknown>): Promise<string> {
  const res = await makeRequest<{ id: string }>(`${igUserId}/media`, 'POST', {}, body);
  return res.id;
}

export async function createResumableVideoContainer(
  igUserId: string,
  body: Record<string, unknown>,
  upload: UploadRecord,
): Promise<string> {
  const res = await makeRequest<{ id: string; uri: string }>(
    `${igUserId}/media`,
    'POST',
    {},
    { ...body, upload_type: 'resumable' },
  );
  // O token vai só no cabeçalho desta chamada; nunca é logado nem devolvido.
  const stream = createReadStream(upload.path);
  stream.on('error', () => undefined); // o erro real chega pela rejeição do axios.post
  try {
    await axios.post(res.uri, stream, {
      headers: { Authorization: `OAuth ${getAccessToken()}`, offset: '0', file_size: String(upload.sizeBytes) },
      maxBodyLength: Infinity,
    });
  } finally {
    stream.destroy();
  }
  return res.id;
}

export async function getContainerStatus(containerId: string): Promise<{ status_code: ContainerStatusCode; status?: string }> {
  return makeRequest(containerId, 'GET', { fields: 'status_code,status' });
}

export async function waitForContainer(
  containerId: string,
  opts: { timeoutMs: number; intervalMs?: number; sleep?: Sleep },
): Promise<{ status_code: ContainerStatusCode; status?: string }> {
  const intervalMs = opts.intervalMs ?? 3000;
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, Math.ceil(opts.timeoutMs / intervalMs));
  let last = await getContainerStatus(containerId);
  for (let attempt = 1; attempt < maxAttempts && last.status_code === 'IN_PROGRESS'; attempt++) {
    await sleep(intervalMs);
    last = await getContainerStatus(containerId);
  }
  return last;
}

export async function publishContainer(igUserId: string, containerId: string): Promise<string> {
  const res = await makeRequest<{ id: string }>(`${igUserId}/media_publish`, 'POST', {}, { creation_id: containerId });
  return res.id;
}

export type PublishOutcome =
  | { status: 'PUBLISHED'; media_id: string; permalink?: string }
  | { status: 'IN_PROGRESS'; container_id: string; message: string }
  | { status: 'ERROR'; container_id: string; detail: string };

// Vínculo contêiner -> uploads, para limpar depois de um publish tardio.
// Se o servidor reiniciar, os uploads expiram sozinhos em 48 h.
const pendingUploads = new Map<string, string[]>();

export function uploadsForContainer(containerId: string): string[] {
  return pendingUploads.get(containerId) ?? [];
}

export async function runPublish(opts: {
  igUserId: string;
  containerId: string;
  waitSeconds: number;
  uploads: UploadRecord[];
  uploadStore: UploadStore;
  sleep?: Sleep;
}): Promise<PublishOutcome> {
  const { igUserId, containerId, uploadStore } = opts;
  if (opts.uploads.length > 0) {
    const ids = new Set([...uploadsForContainer(containerId), ...opts.uploads.map((u) => u.id)]);
    pendingUploads.set(containerId, [...ids]);
  }
  const state = await waitForContainer(containerId, { timeoutMs: opts.waitSeconds * 1000, sleep: opts.sleep });
  if (state.status_code === 'IN_PROGRESS') {
    return {
      status: 'IN_PROGRESS',
      container_id: containerId,
      message: 'Ainda processando. Chame meta_ig_publish_container com este container_id em alguns instantes.',
    };
  }
  if (state.status_code !== 'FINISHED' && state.status_code !== 'PUBLISHED') {
    return {
      status: 'ERROR',
      container_id: containerId,
      detail: `${state.status_code}${state.status ? `: ${state.status}` : ''}`,
    };
  }
  const mediaId = await publishContainer(igUserId, containerId);
  let permalink: string | undefined;
  try {
    const media = await makeRequest<{ permalink?: string }>(mediaId, 'GET', { fields: 'permalink' });
    permalink = media.permalink;
  } catch {
    permalink = undefined;
  }
  for (const id of uploadsForContainer(containerId)) await uploadStore.remove(id);
  pendingUploads.delete(containerId);
  return { status: 'PUBLISHED', media_id: mediaId, permalink };
}
