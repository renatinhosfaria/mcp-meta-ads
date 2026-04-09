import { basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  handleApiError,
  makeMultipartRequest,
  makeRequest,
  normalizeAdAccountId,
  paginate,
  toGraphArrayParam,
  toJson,
} from '../client.js';
import { AD_IMAGE_FIELDS, AD_VIDEO_FIELDS } from '../constants.js';
import type { AdImage, AdVideo, MetaApiResponse } from '../types.js';

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/mp4',
};

type UploadSourceInput = {
  file_path?: string;
  file_url?: string;
  base64_data?: string;
  filename?: string;
  mime_type?: string;
};

function decodeBase64Payload(value: string): Buffer {
  const normalized = value.replace(/\s+/g, '');
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error('O campo base64_data deve conter um payload base64 válido.');
  }

  return Buffer.from(normalized, 'base64');
}

export async function normalizeUploadSource(input: UploadSourceInput) {
  const sources = [input.file_path, input.file_url, input.base64_data].filter((value) => value !== undefined);
  if (sources.length !== 1) {
    throw new Error('Informe exatamente uma origem de upload: file_path, file_url ou base64_data.');
  }

  let buffer: Buffer;
  let filename = input.filename;
  let mimeType = input.mime_type;

  if (input.file_path) {
    buffer = await readFile(input.file_path);
    filename ||= basename(input.file_path);
  } else if (input.file_url) {
    const response = await fetch(input.file_url);
    if (!response.ok) {
      throw new Error(`Não foi possível baixar o arquivo remoto: ${response.status} ${response.statusText}`);
    }

    buffer = Buffer.from(await response.arrayBuffer());
    filename ||= basename(new URL(input.file_url).pathname) || 'upload.bin';
    mimeType ||= response.headers.get('content-type')?.split(';')[0] || undefined;
  } else {
    const match = input.base64_data?.match(/^data:(.*?);base64,(.*)$/);
    if (match) {
      mimeType ||= match[1];
      buffer = decodeBase64Payload(match[2]);
    } else {
      buffer = decodeBase64Payload(input.base64_data || '');
    }

    filename ||= 'upload.bin';
  }

  mimeType ||= MIME_TYPES[extname(filename).toLowerCase()] || 'application/octet-stream';

  return {
    filename,
    mimeType,
    blob: new Blob([buffer], { type: mimeType }),
    bytesBase64: buffer.toString('base64'),
  };
}

export function registerAssetTools(server: McpServer): void {
  server.registerTool(
    'meta_list_ad_images',
    {
      title: 'Listar Imagens',
      description: 'Lista imagens disponíveis na conta de anúncios.',
      inputSchema: z.object({
        ad_account_id: z.string().optional().describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        limit: z.number().int().min(1).max(500).default(50).describe('Número máximo de imagens.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, limit }) => {
      try {
        const images = await paginate<AdImage>(`${resolveAccountId(ad_account_id)}/adimages`, { fields: AD_IMAGE_FIELDS }, limit);
        const result = {
          total: images.length,
          images: images.map(formatImage),
        };

        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: handleApiError(error) }],
        };
      }
    }
  );

  server.registerTool(
    'meta_get_ad_image',
    {
      title: 'Detalhes da Imagem',
      description: 'Busca uma imagem por image_id ou hash na conta de anúncios.',
      inputSchema: z.object({
        ad_account_id: z.string().optional().describe('ID da conta de anúncio. Necessário quando usar hash.'),
        image_id: z.string().optional().describe('ID completo da imagem.'),
        hash: z.string().optional().describe('Hash da imagem.'),
      }).strict().refine((input) => Boolean(input.image_id || input.hash), {
        message: 'Informe image_id ou hash.',
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, image_id, hash }) => {
      try {
        let image: AdImage | undefined;

        if (image_id) {
          image = await makeRequest<AdImage>(image_id, 'GET', { fields: AD_IMAGE_FIELDS });
        } else {
          const response = await makeRequest<MetaApiResponse<AdImage>>(
            `${resolveAccountId(ad_account_id)}/adimages`,
            'GET',
            {
              fields: AD_IMAGE_FIELDS,
              hashes: toGraphArrayParam([hash]),
            }
          );
          image = response.data?.[0];
        }

        const result = formatImage(image || {});
        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: handleApiError(error) }],
        };
      }
    }
  );

  server.registerTool(
    'meta_upload_ad_image',
    {
      title: 'Upload de Imagem',
      description: 'Faz upload de uma imagem para a conta de anúncios via file_path, file_url ou base64.',
      inputSchema: z.object({
        ad_account_id: z.string().optional().describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        file_path: z.string().optional(),
        file_url: z.string().url().optional(),
        base64_data: z.string().optional(),
        filename: z.string().optional().describe('Nome opcional do arquivo/imagem.'),
        mime_type: z.string().optional().describe('Tipo MIME opcional para override.'),
        name: z.string().optional().describe('Nome interno da imagem na biblioteca.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, file_path, file_url, base64_data, filename, mime_type, name }) => {
      try {
        const source = await normalizeUploadSource({ file_path, file_url, base64_data, filename, mime_type });
        const response = await makeRequest<{ images?: Record<string, Partial<AdImage>> }>(
          `${resolveAccountId(ad_account_id)}/adimages`,
          'POST',
          {},
          {
            bytes: source.bytesBase64,
            ...(name ? { name } : {}),
          }
        );

        const uploadedImage = response.images ? Object.values(response.images)[0] : null;
        const result = {
          success: true,
          image: uploadedImage,
          filename: source.filename,
        };

        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: handleApiError(error) }],
        };
      }
    }
  );

  server.registerTool(
    'meta_list_ad_videos',
    {
      title: 'Listar Vídeos',
      description: 'Lista vídeos disponíveis na conta de anúncios.',
      inputSchema: z.object({
        ad_account_id: z.string().optional().describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        limit: z.number().int().min(1).max(500).default(50).describe('Número máximo de vídeos.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, limit }) => {
      try {
        const videos = await paginate<AdVideo>(`${resolveAccountId(ad_account_id)}/advideos`, { fields: AD_VIDEO_FIELDS }, limit);
        const result = {
          total: videos.length,
          videos: videos.map(formatVideo),
        };

        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: handleApiError(error) }],
        };
      }
    }
  );

  server.registerTool(
    'meta_get_ad_video',
    {
      title: 'Detalhes do Vídeo',
      description: 'Retorna os detalhes completos de um vídeo da biblioteca de anúncios.',
      inputSchema: z.object({
        video_id: z.string().describe('ID do vídeo.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ video_id }) => {
      try {
        const video = await makeRequest<AdVideo>(video_id, 'GET', { fields: AD_VIDEO_FIELDS });
        const result = formatVideo(video);

        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: handleApiError(error) }],
        };
      }
    }
  );

  server.registerTool(
    'meta_get_ad_video_status',
    {
      title: 'Status do Vídeo',
      description: 'Retorna somente o status de upload/processamento/publicação de um vídeo.',
      inputSchema: z.object({
        video_id: z.string().describe('ID do vídeo.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ video_id }) => {
      try {
        const video = await makeRequest<AdVideo>(video_id, 'GET', { fields: 'id,status,created_time,updated_time' });
        const result = {
          id: video.id,
          status: video.status || null,
          created_time: video.created_time || null,
          updated_time: video.updated_time || null,
        };

        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: handleApiError(error) }],
        };
      }
    }
  );

  server.registerTool(
    'meta_upload_ad_video',
    {
      title: 'Upload de Vídeo',
      description:
        'Faz upload de vídeo para a conta de anúncios. ' +
        'Aceita file_path, file_url ou base64_data.',
      inputSchema: z.object({
        ad_account_id: z.string().optional().describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        file_path: z.string().optional(),
        file_url: z.string().url().optional(),
        base64_data: z.string().optional(),
        filename: z.string().optional(),
        mime_type: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, file_path, file_url, base64_data, filename, mime_type, title, description }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        let response: Record<string, unknown>;

        if (file_url && !file_path && !base64_data) {
          response = await makeRequest<Record<string, unknown>>(
            `${accountId}/advideos`,
            'POST',
            {},
            {
              file_url,
              ...(title ? { title } : {}),
              ...(description ? { description } : {}),
            }
          );
        } else {
          const source = await normalizeUploadSource({ file_path, file_url, base64_data, filename, mime_type });
          const formData = new FormData();
          formData.append('source', source.blob, source.filename);
          if (title) formData.append('title', title);
          if (description) formData.append('description', description);

          response = await makeMultipartRequest<Record<string, unknown>>(
            `${accountId}/advideos`,
            formData,
            {},
            { timeout: 120000 }
          );
        }

        const result = {
          success: true,
          response,
        };

        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: handleApiError(error) }],
        };
      }
    }
  );
}

function formatImage(image: Partial<AdImage>) {
  return {
    id: image.id || null,
    hash: image.hash || null,
    name: image.name || null,
    permalink_url: image.permalink_url || null,
    url: image.url || null,
    width: image.width ?? null,
    height: image.height ?? null,
    created_time: image.created_time || null,
    status: image.status || null,
  };
}

function formatVideo(video: AdVideo) {
  return {
    id: video.id,
    title: video.title || null,
    description: video.description || null,
    status: video.status || null,
    created_time: video.created_time || null,
    updated_time: video.updated_time || null,
    source: video.source || null,
    thumbnails: video.thumbnails?.data || [],
  };
}
