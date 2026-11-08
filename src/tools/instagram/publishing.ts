import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createContainer,
  createResumableVideoContainer,
  defaultSleep,
  getContainerStatus,
  runPublish,
  uploadsForContainer,
  waitForContainer,
} from '../../instagram/container.js';
import { resolveIgUserId } from '../../instagram/context.js';
import { mediaInputSchema, resolveMediaSource } from '../../instagram/media-source.js';
import type { MediaInput } from '../../instagram/media-source.js';
import { igUserIdField, toolError, toolResult } from '../../instagram/tool-helpers.js';
import type { UploadRecord } from '../../uploads/upload-store.js';
import type { InstagramDeps } from './index.js';

const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const waitSecondsField = z
  .number()
  .int()
  .min(1)
  .max(120)
  .default(45)
  .describe('Segundos a esperar o processamento antes de devolver IN_PROGRESS (1-120, padrão 45).');
const captionField = z.string().optional().describe('Legenda.');
const locationField = z.string().optional().describe('ID do local (Página do Facebook).');
const userTagsField = z
  .array(z.object({ username: z.string(), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict())
  .optional()
  .describe('Marcações de usuários com posição x/y (0 a 1).');
const collaboratorsField = (max: number) =>
  z.array(z.string()).max(max).optional().describe(`Usernames dos colaboradores (até ${max}).`);

export function registerInstagramPublishingTools(server: McpServer, deps: InstagramDeps): void {
  const sleep = () => deps.sleep ?? defaultSleep;

  // Contêiner de vídeo: upload resumível para upload_id, video_url para url.
  async function videoContainer(igUserId: string, body: Record<string, unknown>, media: MediaInput) {
    const src = await resolveMediaSource(media, 'video', deps.uploads);
    const uploads: UploadRecord[] = src.upload ? [src.upload] : [];
    const id = src.upload
      ? await createResumableVideoContainer(igUserId, body, src.upload)
      : await createContainer(igUserId, { ...body, video_url: src.url });
    return { id, uploads };
  }

  async function imageUrl(media: MediaInput) {
    const src = await resolveMediaSource(media, 'image', deps.uploads);
    return { url: src.url, uploads: src.upload ? [src.upload] : [] };
  }

  const finish = (igUserId: string, containerId: string, waitSeconds: number | undefined, uploads: UploadRecord[]) =>
    runPublish({ igUserId, containerId, waitSeconds: waitSeconds ?? 45, uploads, uploadStore: deps.uploads, sleep: sleep() });

  server.registerTool(
    'meta_ig_publish_photo',
    {
      title: 'Publicar Foto',
      description: 'Publica uma foto no feed do Instagram (url, upload_id ou base64) e espera o processamento.',
      inputSchema: z
        .object({
          media: mediaInputSchema,
          caption: captionField,
          user_tags: userTagsField,
          location_id: locationField,
          alt_text: z.string().optional().describe('Texto alternativo da imagem.'),
          wait_seconds: waitSecondsField,
          ig_user_id: igUserIdField,
        })
        .strict(),
      annotations: write,
    },
    async ({ media, caption, user_tags, location_id, alt_text, wait_seconds, ig_user_id }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const img = await imageUrl(media);
        const id = await createContainer(ig, {
          image_url: img.url, caption, user_tags, location_id, alt_text,
        });
        return toolResult(await finish(ig, id, wait_seconds, img.uploads));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_publish_carousel',
    {
      title: 'Publicar Carrossel',
      description: 'Publica um carrossel de 2 a 10 itens (fotos e vídeos) no Instagram. Cada item é processado antes do carrossel.',
      inputSchema: z
        .object({
          items: z
            .array(z.object({ media_type: z.enum(['image', 'video']), media: mediaInputSchema }).strict())
            .min(2)
            .max(10)
            .describe('Itens do carrossel (2 a 10).'),
          caption: captionField,
          location_id: locationField,
          collaborators: collaboratorsField(3),
          wait_seconds: waitSecondsField,
          ig_user_id: igUserIdField,
        })
        .strict(),
      annotations: write,
    },
    async ({ items, caption, location_id, collaborators, wait_seconds, ig_user_id }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const uploads: UploadRecord[] = [];
        const childIds: string[] = [];
        for (const item of items) {
          let childId: string;
          if (item.media_type === 'image') {
            const img = await imageUrl(item.media);
            uploads.push(...img.uploads);
            childId = await createContainer(ig, { is_carousel_item: true, image_url: img.url });
          } else {
            const vid = await videoContainer(ig, { is_carousel_item: true, media_type: 'VIDEO' }, item.media);
            uploads.push(...vid.uploads);
            childId = vid.id;
          }
          const state = await waitForContainer(childId, { timeoutMs: 120_000, sleep: sleep() });
          if (state.status_code !== 'FINISHED') {
            throw new Error(
              `O item ${childIds.length + 1} do carrossel ficou em ${state.status_code}${state.status ? `: ${state.status}` : ''}. Nada foi publicado.`
            );
          }
          childIds.push(childId);
        }
        const parentId = await createContainer(ig, {
          media_type: 'CAROUSEL', children: childIds.join(','), caption, location_id, collaborators,
        });
        return toolResult(await finish(ig, parentId, wait_seconds, uploads));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_publish_reel',
    {
      title: 'Publicar Reel',
      description: 'Publica um Reel no Instagram. Com upload_id usa upload resumível; com url a Meta baixa o vídeo.',
      inputSchema: z
        .object({
          video: mediaInputSchema.describe('Vídeo (url ou upload_id).'),
          caption: captionField,
          cover: mediaInputSchema.optional().describe('Imagem de capa (opcional).'),
          thumb_offset: z.number().int().min(0).optional().describe('Milissegundos do vídeo usados como capa.'),
          share_to_feed: z.boolean().default(true).describe('Também mostra o Reel no feed (padrão true).'),
          collaborators: collaboratorsField(3),
          audio_name: z.string().optional().describe('Nome do áudio.'),
          location_id: locationField,
          user_tags: userTagsField,
          trial_params: z.record(z.string(), z.unknown()).optional().describe('Parâmetros de Reel de teste.'),
          wait_seconds: waitSecondsField,
          ig_user_id: igUserIdField,
        })
        .strict(),
      annotations: write,
    },
    async (input) => {
      try {
        const ig = resolveIgUserId(input.ig_user_id);
        const cover = input.cover ? await imageUrl(input.cover) : undefined;
        const vid = await videoContainer(
          ig,
          {
            media_type: 'REELS',
            caption: input.caption,
            cover_url: cover?.url,
            thumb_offset: input.thumb_offset,
            share_to_feed: input.share_to_feed ?? true,
            collaborators: input.collaborators,
            audio_name: input.audio_name,
            location_id: input.location_id,
            user_tags: input.user_tags,
            trial_params: input.trial_params,
          },
          input.video
        );
        return toolResult(await finish(ig, vid.id, input.wait_seconds, [...vid.uploads, ...(cover?.uploads ?? [])]));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_publish_story',
    {
      title: 'Publicar Story',
      description: 'Publica um Story (imagem ou vídeo) no Instagram.',
      inputSchema: z
        .object({
          story_media_type: z.enum(['image', 'video']).describe('Tipo da mídia do Story.'),
          media: mediaInputSchema,
          wait_seconds: waitSecondsField,
          ig_user_id: igUserIdField,
        })
        .strict(),
      annotations: write,
    },
    async ({ story_media_type, media, wait_seconds, ig_user_id }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        if (story_media_type === 'image') {
          const img = await imageUrl(media);
          const id = await createContainer(ig, { media_type: 'STORIES', image_url: img.url });
          return toolResult(await finish(ig, id, wait_seconds, img.uploads));
        }
        const vid = await videoContainer(ig, { media_type: 'STORIES' }, media);
        return toolResult(await finish(ig, vid.id, wait_seconds, vid.uploads));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_container_status',
    {
      title: 'Status do Contêiner',
      description: 'Consulta o status de processamento de um contêiner de mídia (IN_PROGRESS, FINISHED, ERROR, EXPIRED, PUBLISHED).',
      inputSchema: z.object({ container_id: z.string().min(1).describe('ID do contêiner.') }).strict(),
      annotations: readOnly,
    },
    async ({ container_id }) => {
      try {
        return toolResult(await getContainerStatus(container_id));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_publish_container',
    {
      title: 'Publicar Contêiner',
      description: 'Publica um contêiner já criado, esperando até 10 s pelo processamento. Use depois de um resultado IN_PROGRESS.',
      inputSchema: z
        .object({ container_id: z.string().min(1).describe('ID do contêiner.'), ig_user_id: igUserIdField })
        .strict(),
      annotations: write,
    },
    async ({ container_id, ig_user_id }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const uploads = uploadsForContainer(container_id)
          .map((id) => deps.uploads.get(id))
          .filter((u): u is UploadRecord => u !== undefined);
        return toolResult(await finish(ig, container_id, 10, uploads));
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
