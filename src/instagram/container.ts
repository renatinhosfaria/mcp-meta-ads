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

export type ContainerState = { container_id: string; status_code: ContainerStatusCode; status?: string };

/**
 * Consulta vários contêineres juntos, dividindo um único prazo. Para quando nenhum está IN_PROGRESS
 * ou quando algum falhou (ERROR, EXPIRED...).
 */
export async function waitForContainers(
  containerIds: string[],
  opts: { timeoutMs: number; intervalMs?: number; sleep?: Sleep },
): Promise<ContainerState[]> {
  const intervalMs = opts.intervalMs ?? 3000;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRounds = Math.max(1, Math.ceil(opts.timeoutMs / intervalMs));
  const states = new Map<string, ContainerState>();
  const poll = (ids: string[]) =>
    Promise.all(
      ids.map(async (id) => {
        const { status_code, status } = await getContainerStatus(id);
        states.set(id, { container_id: id, status_code, ...(status ? { status } : {}) });
      }),
    );
  const pending = () => containerIds.filter((id) => states.get(id)?.status_code === 'IN_PROGRESS');
  const failed = () => containerIds.some((id) => !['IN_PROGRESS', 'FINISHED'].includes(states.get(id)!.status_code));

  await poll(containerIds);
  for (let round = 1; round < maxRounds && pending().length > 0 && !failed(); round++) {
    await sleep(intervalMs);
    await poll(pending());
  }
  return containerIds.map((id) => states.get(id)!);
}

export async function waitForContainer(
  containerId: string,
  opts: { timeoutMs: number; intervalMs?: number; sleep?: Sleep },
): Promise<{ status_code: ContainerStatusCode; status?: string }> {
  const [{ status_code, status }] = await waitForContainers([containerId], opts);
  return { status_code, status };
}

export async function publishContainer(igUserId: string, containerId: string): Promise<string> {
  const res = await makeRequest<{ id: string }>(`${igUserId}/media_publish`, 'POST', {}, { creation_id: containerId });
  return res.id;
}

export type PublishOutcome =
  | { status: 'PUBLISHED'; media_id: string; permalink?: string }
  | { status: 'PUBLISHED'; container_id: string; media_id?: string; message: string }
  | { status: 'IN_PROGRESS'; container_id: string; message: string }
  | { status: 'ERROR'; container_id: string; detail: string };

// Vínculo contêiner -> uploads, para limpar depois de um publish tardio.
// Se o servidor reiniciar, os uploads expiram sozinhos em 48 h.
const pendingUploads = new Map<string, string[]>();

// Contêineres publicados por este processo -> media_id, para responder a um publish repetido.
// A Graph não informa o media_id a partir do contêiner.
const PUBLISHED_MEMORY = 500;
const publishedMedia = new Map<string, string>();

function rememberPublished(containerId: string, mediaId: string): void {
  publishedMedia.set(containerId, mediaId);
  if (publishedMedia.size > PUBLISHED_MEMORY) publishedMedia.delete(publishedMedia.keys().next().value!);
}

export function uploadsForContainer(containerId: string): string[] {
  return pendingUploads.get(containerId) ?? [];
}

async function releaseUploads(containerId: string, uploadStore: UploadStore): Promise<void> {
  for (const id of uploadsForContainer(containerId)) await uploadStore.remove(id);
  pendingUploads.delete(containerId);
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
  if (state.status_code === 'PUBLISHED') {
    // Publicar de novo criaria um post duplicado.
    await releaseUploads(containerId, uploadStore);
    const mediaId = publishedMedia.get(containerId);
    return {
      status: 'PUBLISHED',
      container_id: containerId,
      ...(mediaId ? { media_id: mediaId } : {}),
      message: 'Este contêiner já foi publicado.',
    };
  }
  if (state.status_code !== 'FINISHED') {
    return {
      status: 'ERROR',
      container_id: containerId,
      detail: `${state.status_code}${state.status ? `: ${state.status}` : ''}`,
    };
  }
  const mediaId = await publishContainer(igUserId, containerId);
  rememberPublished(containerId, mediaId);
  let permalink: string | undefined;
  try {
    const media = await makeRequest<{ permalink?: string }>(mediaId, 'GET', { fields: 'permalink' });
    permalink = media.permalink;
  } catch {
    permalink = undefined;
  }
  await releaseUploads(containerId, uploadStore);
  return { status: 'PUBLISHED', media_id: mediaId, permalink };
}
