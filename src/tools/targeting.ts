import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  makeRequest,
  paginate,
  handleApiError,
  normalizeAdAccountId,
  toJson,
} from '../client.js';

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

const TARGETING_CLASSES = ['interests', 'behaviors', 'demographics', 'life_events', 'industries', 'income', 'family_statuses', 'user_adclusters'] as const;

export function registerTargetingTools(server: McpServer): void {
  server.registerTool(
    'meta_targeting_browse',
    {
      title: 'Explorar Categorias de Segmentação',
      description:
        'Navega pelas categorias de segmentação disponíveis no Meta Ads: interesses, comportamentos, ' +
        'dados demográficos, eventos de vida e indústrias. ' +
        'Use para descobrir opções de targeting sem precisar saber a palavra-chave exata. ' +
        'Classes: interests, behaviors, demographics, life_events, industries, income, family_statuses.',
      inputSchema: z.object({
        targeting_class: z
          .enum(TARGETING_CLASSES)
          .default('interests')
          .describe('Classe de segmentação a explorar. Use "interests" para interesses, "behaviors" para comportamentos.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(100)
          .describe('Número máximo de categorias (padrão: 100).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ targeting_class, limit }) => {
      try {
        type TargetingItem = { id: string; name: string; path?: string[]; audience_size_lower_bound?: number; audience_size_upper_bound?: number };
        const items = await paginate<TargetingItem>(
          'search',
          { type: 'adTargetingCategory', class: targeting_class },
          limit
        );
        const result = {
          targeting_class,
          total: items.length,
          items: items.map(i => ({
            id: i.id,
            name: i.name,
            path: i.path || [],
            audience_size: i.audience_size_lower_bound && i.audience_size_upper_bound
              ? `${i.audience_size_lower_bound.toLocaleString('pt-BR')} – ${i.audience_size_upper_bound.toLocaleString('pt-BR')}`
              : null,
          })),
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
    'meta_targeting_search',
    {
      title: 'Buscar Opções de Segmentação',
      description:
        'Busca interesses, comportamentos ou dados demográficos por palavra-chave. ' +
        'Retorna ID, nome e tamanho estimado da audiência para cada opção encontrada. ' +
        'Use antes de criar um ad set para descobrir os IDs corretos das opções de segmentação.',
      inputSchema: z.object({
        q: z
          .string()
          .min(2)
          .describe('Palavra-chave para buscar (ex: "imóveis", "investimento", "automóvel").'),
        type: z
          .enum(['adinterest', 'adeducationschool', 'adeducationmajor', 'adworkemployer', 'adworkposition', 'adlocale', 'adgeolocation', 'adgeolocationmeta', 'adzipcode'])
          .default('adinterest')
          .describe('Tipo de segmentação a buscar. Use "adinterest" para interesses (padrão).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(20)
          .describe('Número máximo de resultados (padrão: 20).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ q, type, limit }) => {
      try {
        type SearchResult = { id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number; path?: string[]; description?: string; topic?: string };
        const items = await paginate<SearchResult>('search', { type, q }, limit);
        const result = {
          query: q,
          type,
          total: items.length,
          items: items.map(i => ({
            id: i.id,
            name: i.name,
            path: i.path || [],
            topic: i.topic || null,
            description: i.description || null,
            audience_size: i.audience_size_lower_bound && i.audience_size_upper_bound
              ? `${i.audience_size_lower_bound.toLocaleString('pt-BR')} – ${i.audience_size_upper_bound.toLocaleString('pt-BR')}`
              : null,
          })),
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
    'meta_targeting_suggestions',
    {
      title: 'Sugestões de Segmentação',
      description:
        'Retorna interesses similares e relacionados com base em uma lista de interesses existentes. ' +
        'Use para expandir o targeting descobrindo públicos semelhantes ao que você já segmenta. ' +
        'Forneça interest_list com os IDs ou nomes de interesses que você já usa.',
      inputSchema: z.object({
        interest_list: z
          .array(z.string())
          .min(1)
          .max(25)
          .describe('Lista de IDs ou nomes de interesses base (ex: ["6003107902433","Imóveis"]).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(25)
          .describe('Número máximo de sugestões (padrão: 25).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ interest_list, limit }) => {
      try {
        type SuggestionResult = { id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number };
        const items = await paginate<SuggestionResult>(
          'search',
          { type: 'adTargetingSuggestion', interest_list: JSON.stringify(interest_list) },
          limit
        );
        const result = {
          based_on: interest_list,
          total: items.length,
          suggestions: items.map(i => ({
            id: i.id,
            name: i.name,
            audience_size: i.audience_size_lower_bound && i.audience_size_upper_bound
              ? `${i.audience_size_lower_bound.toLocaleString('pt-BR')} – ${i.audience_size_upper_bound.toLocaleString('pt-BR')}`
              : null,
          })),
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
    'meta_targeting_sentence_lines',
    {
      title: 'Descrição Legível do Targeting',
      description:
        'Converte um targeting_spec técnico em frases legíveis em português/inglês. ' +
        'Útil para confirmar com o cliente o que o targeting realmente significa antes de criar o ad set. ' +
        'Passe o mesmo targeting_spec que usaria em create_adset.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        targeting_spec: z
          .string()
          .describe('JSON do targeting spec (ex: \'{"geo_locations":{"countries":["BR"]},"age_min":25,"age_max":45,"interests":[{"id":"6003107902433","name":"Imóveis"}]}\').'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, targeting_spec }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        type SentenceResponse = { targetingsentencelines: Array<{ content: string; children?: string[] }> };
        const response = await makeRequest<SentenceResponse>(
          `${accountId}/targetingsentencelines`,
          'GET',
          { targeting_spec }
        );
        const result = {
          ad_account_id: accountId,
          sentence_lines: response.targetingsentencelines || [],
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
    'meta_targeting_validate',
    {
      title: 'Validar Spec de Segmentação',
      description:
        'Valida um targeting_spec antes de criar um ad set, verificando se as opções são válidas ' +
        'e compatíveis entre si. Retorna warnings e erros sem criar nenhum objeto. ' +
        'Use para garantir que o targeting está correto antes de subir a campanha.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        targeting_spec: z
          .string()
          .describe('JSON do targeting spec a validar.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, targeting_spec }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        type ValidationResponse = { data: Array<{ targeting_spec?: unknown; warnings?: unknown[]; errors?: unknown[] }> };
        const response = await makeRequest<ValidationResponse>(
          `${accountId}/targeting_validation`,
          'GET',
          { targeting_spec }
        );
        const result = {
          ad_account_id: accountId,
          valid: !response.data?.some((d) => d.errors && Array.isArray(d.errors) && d.errors.length > 0),
          validation: response.data || [],
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
    'meta_list_targeting_categories',
    {
      title: 'Listar Categorias de Segmentação',
      description:
        'Lista todas as categorias de segmentação disponíveis agrupadas por classe. ' +
        'Inclui interesses, comportamentos, dados demográficos e mais. ' +
        'Use para ver o universo completo de opções disponíveis para targeting.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(200)
          .describe('Número máximo de categorias (padrão: 200).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ limit }) => {
      try {
        type CategoryItem = { id: string; name: string; type: string; path?: string[] };
        const items = await paginate<CategoryItem>(
          'search',
          { type: 'adTargetingCategory' },
          limit
        );
        const byType = items.reduce<Record<string, typeof items>>((acc, item) => {
          const key = item.type || 'other';
          if (!acc[key]) acc[key] = [];
          acc[key].push(item);
          return acc;
        }, {});
        const result = { total: items.length, by_type: byType };
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
