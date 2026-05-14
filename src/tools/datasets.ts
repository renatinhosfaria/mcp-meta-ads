import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  makeRequest,
  paginate,
  handleApiError,
  normalizeAdAccountId,
  toJson,
} from '../client.js';

const PIXEL_FIELDS = [
  'id', 'name', 'creation_time', 'last_fired_time',
  'data_use_setting', 'description', 'owner_business',
  'owner_ad_account',
].join(',');

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

type Pixel = {
  id: string;
  name: string;
  creation_time?: string;
  last_fired_time?: string;
  data_use_setting?: string;
  description?: string;
  owner_business?: { id: string; name: string };
  owner_ad_account?: { id: string; name: string };
};

export function registerDatasetTools(server: McpServer): void {
  server.registerTool(
    'meta_get_dataset_details',
    {
      title: 'Detalhes do Dataset / Pixel',
      description:
        'Retorna detalhes completos de um Pixel do Meta (dataset CAPI): ' +
        'nome, data de criação, último disparo, configuração de uso de dados e conta vinculada. ' +
        'Se pixel_id não for informado, lista os pixels da conta de anúncio. ' +
        'Use para verificar se o pixel está ativo e corretamente configurado.',
      inputSchema: z.object({
        pixel_id: z
          .string()
          .optional()
          .describe('ID do Pixel/Dataset. Se omitido, retorna o primeiro pixel da conta de anúncio.'),
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usado para listar pixels quando pixel_id não é informado.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ pixel_id, ad_account_id }) => {
      try {
        if (pixel_id) {
          const pixel = await makeRequest<Pixel>(pixel_id, 'GET', { fields: PIXEL_FIELDS });
          const result = {
            id: pixel.id,
            name: pixel.name,
            creation_time: pixel.creation_time || null,
            last_fired_time: pixel.last_fired_time || null,
            data_use_setting: pixel.data_use_setting || null,
            description: pixel.description || null,
            owner_business: pixel.owner_business || null,
            owner_ad_account: pixel.owner_ad_account || null,
          };
          return {
            content: [{ type: 'text' as const, text: toJson(result) }],
            structuredContent: result,
          };
        }

        const accountId = resolveAccountId(ad_account_id);
        const pixels = await paginate<Pixel>(`${accountId}/adspixels`, { fields: PIXEL_FIELDS }, 10);
        const result = { total: pixels.length, ad_account_id: accountId, pixels };
        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    'meta_get_dataset_quality',
    {
      title: 'Qualidade do Dataset / Pixel',
      description:
        'Retorna métricas de qualidade dos eventos recebidos por um Pixel do Meta. ' +
        'Inclui: correspondência de eventos (EMQ), qualidade dos parâmetros por evento ' +
        '(purchase, lead, view_content, etc.) e status de cada evento. ' +
        'Use para diagnosticar problemas de rastreamento e CAPI.',
      inputSchema: z.object({
        pixel_id: z
          .string()
          .describe('ID do Pixel/Dataset.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ pixel_id }) => {
      try {
        type QualityEntry = {
          event_name: string;
          custom_event_type?: string;
          connected_assets_quality?: unknown[];
          event_match_quality?: {
            composite_score?: number;
            match_key_feedback?: unknown[];
          };
        };
        type QualityResponse = { data: QualityEntry[] };

        const response = await makeRequest<QualityResponse>(
          `${pixel_id}/data_quality`,
          'GET',
          { fields: 'event_name,custom_event_type,connected_assets_quality,event_match_quality' }
        );

        const result = {
          pixel_id,
          events: response.data || [],
        };
        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    'meta_get_dataset_stats',
    {
      title: 'Estatísticas do Dataset / Pixel',
      description:
        'Retorna estatísticas de volume de eventos de um Pixel do Meta em um período. ' +
        'Inclui contagem de eventos por tipo (PageView, Lead, Purchase, etc.) e por canal (browser, server). ' +
        'Use para monitorar o volume de eventos recebidos e detectar quedas.',
      inputSchema: z.object({
        pixel_id: z
          .string()
          .describe('ID do Pixel/Dataset.'),
        start_time: z
          .number()
          .int()
          .optional()
          .describe('Timestamp Unix de início do período (padrão: 7 dias atrás).'),
        end_time: z
          .number()
          .int()
          .optional()
          .describe('Timestamp Unix de fim do período (padrão: agora).'),
        aggregation: z
          .enum(['event', 'hour', 'day'])
          .default('day')
          .describe('Granularidade da agregação: por evento, hora ou dia.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ pixel_id, start_time, end_time, aggregation }) => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const params: Record<string, unknown> = {
          start_time: start_time ?? now - 7 * 24 * 3600,
          end_time: end_time ?? now,
          aggregation,
        };

        type StatsResponse = { data: unknown[] };
        const response = await makeRequest<StatsResponse>(`${pixel_id}/stats`, 'GET', params);

        const result = {
          pixel_id,
          aggregation,
          data: response.data || [],
        };
        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: handleApiError(error) }] };
      }
    }
  );
}
