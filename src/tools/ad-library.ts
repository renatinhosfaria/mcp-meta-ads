import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { handleApiError, makeRequest, toGraphArrayParam, toJson } from '../client.js';
import { AD_LIBRARY_FIELDS } from '../constants.js';
import type { AdsArchiveResult, MetaApiResponse } from '../types.js';

export function registerAdLibraryTools(server: McpServer): void {
  const inputSchema = z.object({
    search_terms: z
      .string()
      .max(100)
      .default('')
      .describe('Termos de busca. Use vazio para combinar com page IDs ou outros filtros.'),
    ad_reached_countries: z
      .array(z.string().min(2).max(2))
      .min(1)
      .describe('Países de entrega do anúncio. Ex: ["BR"] ou ["US"].'),
    ad_type: z
      .enum(['ALL', 'EMPLOYMENT_ADS', 'FINANCIAL_PRODUCTS_AND_SERVICES_ADS', 'HOUSING_ADS', 'POLITICAL_AND_ISSUE_ADS'])
      .default('ALL')
      .describe('Tipo de anúncio a consultar na archive API.'),
    search_type: z
      .enum(['KEYWORD_UNORDERED', 'KEYWORD_EXACT_PHRASE'])
      .default('KEYWORD_UNORDERED')
      .describe('Tipo de busca para search_terms.'),
    media_type: z
      .enum(['ALL', 'IMAGE', 'MEME', 'VIDEO', 'NONE'])
      .optional()
      .describe('Filtrar por tipo de mídia do anúncio.'),
    publisher_platforms: z
      .array(z.enum(['FACEBOOK', 'INSTAGRAM', 'AUDIENCE_NETWORK', 'MESSENGER', 'WHATSAPP', 'OCULUS', 'THREADS']))
      .optional()
      .describe('Filtrar por plataformas de veiculação.'),
    search_page_ids: z
      .array(z.string().min(1))
      .max(10)
      .optional()
      .describe('IDs de páginas específicas para busca na biblioteca.'),
    languages: z
      .array(z.string().min(2))
      .optional()
      .describe('Filtrar por idiomas do anúncio.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe('Quantidade máxima de resultados.'),
  }).strict().refine(
    (input) => input.search_terms.trim().length > 0 || Boolean(input.search_page_ids?.length),
    {
      message: 'Informe search_terms ou search_page_ids.',
      path: ['search_terms'],
    }
  );

  server.registerTool(
    'meta_search_ad_library',
    {
      title: 'Pesquisar Ad Library',
      description:
        'Pesquisa anúncios na biblioteca pública da Meta via Ads Archive. ' +
        'Útil para espionar concorrentes e entender criativos, páginas e snapshots públicos.',
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ search_terms, ad_reached_countries, ad_type, search_type, media_type, publisher_platforms, search_page_ids, languages, limit }) => {
      try {
        const params: Record<string, unknown> = {
          search_terms,
          ad_reached_countries: toGraphArrayParam(ad_reached_countries),
          ad_type,
          search_type,
          limit,
          fields: AD_LIBRARY_FIELDS,
        };

        if (media_type) params.media_type = media_type;
        if (publisher_platforms?.length) {
          params.publisher_platforms = toGraphArrayParam(publisher_platforms);
        }
        if (search_page_ids?.length) {
          params.search_page_ids = toGraphArrayParam(search_page_ids);
        }
        if (languages?.length) {
          params.languages = toGraphArrayParam(languages);
        }

        const response = await makeRequest<MetaApiResponse<AdsArchiveResult>>(
          'ads_archive',
          'GET',
          params
        );

        const results = (response.data || []).map(formatArchiveResult);
        const result = {
          total: results.length,
          results,
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

function formatArchiveResult(item: AdsArchiveResult) {
  return {
    id: item.id || null,
    ad_creation_time: item.ad_creation_time || null,
    ad_delivery_start_time: item.ad_delivery_start_time || null,
    ad_delivery_stop_time: item.ad_delivery_stop_time || null,
    ad_snapshot_url: item.ad_snapshot_url || null,
    page_id: item.page_id || null,
    page_name: item.page_name || null,
    publisher_platforms: item.publisher_platforms || [],
  };
}
