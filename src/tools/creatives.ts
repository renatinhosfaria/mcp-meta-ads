import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  handleApiError,
  makeRequest,
  normalizeAdAccountId,
  paginate,
  parseJsonString,
  toJson,
} from '../client.js';
import { AD_CREATIVE_FIELDS } from '../constants.js';
import type { AdCreative } from '../types.js';

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

export function registerCreativeTools(server: McpServer): void {
  server.registerTool(
    'meta_list_ad_creatives',
    {
      title: 'Listar Criativos',
      description: 'Lista criativos da conta de anúncios.',
      inputSchema: z.object({
        ad_account_id: z.string().optional().describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        limit: z.number().int().min(1).max(500).default(50).describe('Número máximo de criativos.'),
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
        const creatives = await paginate<AdCreative>(`${resolveAccountId(ad_account_id)}/adcreatives`, { fields: AD_CREATIVE_FIELDS }, limit);
        const result = {
          total: creatives.length,
          creatives: creatives.map(formatCreative),
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
    'meta_get_ad_creative',
    {
      title: 'Detalhes do Criativo',
      description: 'Retorna detalhes completos de um criativo.',
      inputSchema: z.object({
        creative_id: z.string().describe('ID do criativo.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ creative_id }) => {
      try {
        const creative = await makeRequest<AdCreative>(creative_id, 'GET', { fields: AD_CREATIVE_FIELDS });
        const result = formatCreative(creative);

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
    'meta_create_ad_creative',
    {
      title: 'Criar Criativo',
      description:
        'Cria um novo criativo na conta de anúncios. ' +
        'Aceita campos tipados simples e também blocos JSON para estruturas avançadas.',
      inputSchema: z.object({
        ad_account_id: z.string().optional().describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        name: z.string().min(1).max(100).describe('Nome do criativo.'),
        page_id: z.string().optional().describe('Page ID para object_story_spec básico.'),
        instagram_user_id: z.string().optional().describe('Instagram user ID quando aplicável.'),
        title: z.string().optional().describe('Título do anúncio em criativo simples.'),
        body: z.string().optional().describe('Texto principal do criativo simples.'),
        link_url: z.string().url().optional().describe('URL de destino do criativo simples.'),
        call_to_action_type: z.string().optional().describe('Tipo de CTA, ex: LEARN_MORE.'),
        image_hash: z.string().optional().describe('Hash de imagem existente.'),
        image_url: z.string().url().optional().describe('URL de imagem, quando suportado pela Meta.'),
        video_id: z.string().optional().describe('ID de vídeo existente.'),
        url_tags: z.string().optional().describe('UTMs ou tags de URL do criativo.'),
        object_type: z.string().optional().describe('Object type do criativo.'),
        object_story_spec: z.string().optional().describe('JSON do object_story_spec completo.'),
        asset_feed_spec: z.string().optional().describe('JSON do asset_feed_spec para DCO ou variantes.'),
        degrees_of_freedom_spec: z.string().optional().describe('JSON do degrees_of_freedom_spec.'),
        creative_json: z.string().optional().describe('JSON avançado do criativo; será mesclado ao payload.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const accountId = resolveAccountId(input.ad_account_id);
        const payload = buildCreativePayload(input);
        const response = await makeRequest<{ id: string }>(`${accountId}/adcreatives`, 'POST', {}, payload);
        const result = {
          success: true,
          creative_id: response.id,
          message: `Criativo "${input.name}" criado com sucesso. ID: ${response.id}`,
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
    'meta_update_ad_creative',
    {
      title: 'Atualizar Criativo',
      description: 'Atualiza apenas campos mutáveis do criativo, como name.',
      inputSchema: z.object({
        creative_id: z.string().describe('ID do criativo.'),
        name: z.string().min(1).max(100).describe('Novo nome do criativo.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ creative_id, name }) => {
      try {
        const response = await makeRequest<{ success?: boolean }>(creative_id, 'POST', {}, { name });
        const result = {
          success: response.success !== false,
          creative_id,
          message: `Criativo ${creative_id} atualizado com sucesso.`,
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

function buildCreativePayload(input: {
  name: string;
  page_id?: string;
  instagram_user_id?: string;
  title?: string;
  body?: string;
  link_url?: string;
  call_to_action_type?: string;
  image_hash?: string;
  image_url?: string;
  video_id?: string;
  url_tags?: string;
  object_type?: string;
  object_story_spec?: string;
  asset_feed_spec?: string;
  degrees_of_freedom_spec?: string;
  creative_json?: string;
}) {
  const data = {
    ...(parseJsonString<Record<string, unknown>>(input.creative_json, 'creative_json') || {}),
    name: input.name,
  } as Record<string, unknown>;

  if (input.url_tags) data.url_tags = input.url_tags;
  if (input.object_type) data.object_type = input.object_type;
  if (input.asset_feed_spec) {
    data.asset_feed_spec = parseJsonString<Record<string, unknown>>(input.asset_feed_spec, 'asset_feed_spec');
  }
  if (input.degrees_of_freedom_spec) {
    data.degrees_of_freedom_spec = parseJsonString<Record<string, unknown>>(input.degrees_of_freedom_spec, 'degrees_of_freedom_spec');
  }

  if (input.object_story_spec) {
    data.object_story_spec = parseJsonString<Record<string, unknown>>(input.object_story_spec, 'object_story_spec');
    return data;
  }

  if (input.page_id && input.link_url) {
    const linkData: Record<string, unknown> = {
      link: input.link_url,
    };

    if (input.body) linkData.message = input.body;
    if (input.title) linkData.name = input.title;
    if (input.image_hash) linkData.image_hash = input.image_hash;
    if (input.image_url) linkData.image_url = input.image_url;
    if (input.call_to_action_type) {
      linkData.call_to_action = {
        type: input.call_to_action_type,
      };
    }

    data.object_story_spec = {
      page_id: input.page_id,
      ...(input.instagram_user_id ? { instagram_user_id: input.instagram_user_id } : {}),
      link_data: linkData,
    };
    return data;
  }

  if (input.page_id && input.video_id) {
    const videoData: Record<string, unknown> = {
      video_id: input.video_id,
    };

    if (input.body) videoData.message = input.body;
    if (input.title) videoData.title = input.title;
    if (input.call_to_action_type && input.link_url) {
      videoData.call_to_action = {
        type: input.call_to_action_type,
        value: {
          link: input.link_url,
        },
      };
    }

    data.object_story_spec = {
      page_id: input.page_id,
      ...(input.instagram_user_id ? { instagram_user_id: input.instagram_user_id } : {}),
      video_data: videoData,
    };
    return data;
  }

  if (input.image_hash) data.image_hash = input.image_hash;
  if (input.image_url) data.image_url = input.image_url;
  if (input.video_id) data.video_id = input.video_id;

  return data;
}

function formatCreative(creative: AdCreative) {
  return {
    id: creative.id || null,
    name: creative.name || null,
    object_story_spec: creative.object_story_spec || null,
    asset_feed_spec: creative.asset_feed_spec || null,
    effective_object_story_id: creative.effective_object_story_id || null,
    url_tags: creative.url_tags || null,
    image_hash: creative.image_hash || null,
    thumbnail_url: creative.thumbnail_url || null,
    object_type: creative.object_type || null,
    degrees_of_freedom_spec: creative.degrees_of_freedom_spec || null,
  };
}
