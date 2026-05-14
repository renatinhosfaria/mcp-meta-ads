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

export function registerAccountExtrasTools(server: McpServer): void {
  server.registerTool(
    'meta_list_instagram_accounts',
    {
      title: 'Listar Contas do Instagram',
      description:
        'Lista as contas do Instagram conectadas a uma conta de anúncio. ' +
        'Necessário para criar anúncios no Instagram com uma conta específica ' +
        'ou para verificar quais contas do Instagram estão disponíveis para uso em criativos.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Número máximo de contas (padrão: 10).'),
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
        const accountId = resolveAccountId(ad_account_id);
        const accounts = await paginate<Record<string, unknown>>(
          `${accountId}/instagram_accounts`,
          { fields: 'id,username,name,profile_pic,followers_count,media_count,biography,website' },
          limit
        );
        const result = { total: accounts.length, ad_account_id: accountId, instagram_accounts: accounts };
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
    'meta_list_saved_audiences',
    {
      title: 'Listar Públicos Salvos',
      description:
        'Lista os públicos salvos (Saved Audiences) de uma conta de anúncio. ' +
        'Públicos salvos são configurações de targeting (localização, idade, interesses, etc.) ' +
        'salvas para reutilização rápida em múltiplos ad sets.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Número máximo de públicos salvos (padrão: 25).'),
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
        const accountId = resolveAccountId(ad_account_id);
        const audiences = await paginate<Record<string, unknown>>(
          `${accountId}/saved_audiences`,
          { fields: 'id,name,description,targeting,run_status,time_created,time_updated,sentence_lines' },
          limit
        );
        const result = { total: audiences.length, ad_account_id: accountId, saved_audiences: audiences };
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
    'meta_list_ad_labels',
    {
      title: 'Listar Labels de Anúncios',
      description:
        'Lista os labels (etiquetas) criados na conta de anúncio. ' +
        'Labels permitem organizar e filtrar campanhas, ad sets e anúncios por tema, ' +
        'produto ou qualquer categoria personalizada. Use meta_create_ad_label para criar novos.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Número máximo de labels (padrão: 25).'),
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
        const accountId = resolveAccountId(ad_account_id);
        const labels = await paginate<Record<string, unknown>>(
          `${accountId}/adlabels`,
          { fields: 'id,name,created_time,updated_time' },
          limit
        );
        const result = { total: labels.length, ad_account_id: accountId, ad_labels: labels };
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
    'meta_create_ad_label',
    {
      title: 'Criar Label de Anúncio',
      description:
        'Cria um novo label (etiqueta) na conta de anúncio para organizar campanhas e anúncios. ' +
        'Após criar, aplique o label a campanhas, ad sets ou anúncios usando o campo adlabels ' +
        'nas operações de criação ou atualização.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        name: z
          .string()
          .min(1)
          .max(100)
          .describe('Nome do label (ex: "Produto: Apartamento", "Região: SP", "Fase: Awareness").'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, name }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const response = await makeRequest<{ id: string }>(
          `${accountId}/adlabels`,
          'POST',
          {},
          { name }
        );
        const result = {
          success: true,
          label_id: response.id,
          name,
          message: `Label "${name}" criado. ID: ${response.id}`,
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
    'meta_get_entities_by_label',
    {
      title: 'Buscar Entidades por Label',
      description:
        'Lista campanhas, ad sets ou anúncios que possuem um label específico aplicado. ' +
        'Útil para filtrar e gerenciar entidades por tema ou categoria sem precisar conhecer os IDs individualmente.',
      inputSchema: z.object({
        label_id: z
          .string()
          .describe('ID do label (obtido via meta_list_ad_labels).'),
        entity_type: z
          .enum(['campaigns', 'adsets', 'ads'])
          .describe('Tipo de entidade a buscar: campaigns, adsets ou ads.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Número máximo de entidades (padrão: 50).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ label_id, entity_type, limit }) => {
      try {
        const fields: Record<string, string> = {
          campaigns: 'id,name,status,effective_status,objective',
          adsets: 'id,name,status,effective_status,campaign_id',
          ads: 'id,name,status,effective_status,adset_id,campaign_id',
        };
        const entities = await paginate<Record<string, unknown>>(
          `${label_id}/${entity_type}`,
          { fields: fields[entity_type] },
          limit
        );
        const result = { total: entities.length, label_id, entity_type, entities };
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
    'meta_get_account_activities',
    {
      title: 'Log de Atividades da Conta',
      description:
        'Retorna o histórico de mudanças feitas na conta de anúncio: criação, edição e exclusão ' +
        'de campanhas, ad sets, anúncios, criativos e configurações de conta. ' +
        'Use para auditar quem fez o quê e quando na conta.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        since: z
          .number()
          .int()
          .optional()
          .describe('Timestamp Unix de início do período (padrão: últimas 24h).'),
        until: z
          .number()
          .int()
          .optional()
          .describe('Timestamp Unix de fim do período.'),
        category: z
          .enum(['ACCOUNT', 'CAMPAIGN', 'AD_SET', 'AD', 'AD_CREATIVE', 'AD_IMAGE'])
          .optional()
          .describe('Filtrar por categoria de mudança.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Número máximo de eventos (padrão: 25).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, since, until, category, limit }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const now = Math.floor(Date.now() / 1000);
        const params: Record<string, unknown> = {
          fields: 'event_time,event_type,object_id,object_type,actor_name,actor_id,old_value,new_value,extra_data',
          since: since ?? now - 86400,
          until: until ?? now,
        };
        if (category) params.category = category;

        const activities = await paginate<Record<string, unknown>>(
          `${accountId}/activities`,
          params,
          limit
        );
        const result = { total: activities.length, ad_account_id: accountId, activities };
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
    'meta_get_delivery_estimate',
    {
      title: 'Estimativa de Entrega do Ad Set',
      description:
        'Estima o alcance diário, impressões e custo para um ad set com base no targeting e orçamento. ' +
        'Use antes de criar um ad set para verificar se o orçamento é suficiente para o público-alvo. ' +
        'Retorna estimates de: daily_outcomes_curve, daily_budget_spend_estimate, reach_estimate.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        targeting_spec: z
          .string()
          .describe('JSON do targeting spec do ad set.'),
        optimization_goal: z
          .string()
          .describe('Objetivo de otimização (ex: REACH, LINK_CLICKS, LEAD_GENERATION, OFFSITE_CONVERSIONS).'),
        promoted_object: z
          .string()
          .optional()
          .describe('JSON do objeto promovido (ex: \'{"pixel_id":"123456","custom_event_type":"LEAD"}\').'),
        daily_budget: z
          .number()
          .int()
          .optional()
          .describe('Orçamento diário em centavos para estimar o custo (ex: 5000 = R$50,00).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, targeting_spec, optimization_goal, promoted_object, daily_budget }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const params: Record<string, unknown> = {
          targeting_spec,
          optimization_goal,
        };
        if (promoted_object) params.promoted_object = promoted_object;
        if (daily_budget) params.daily_budget = daily_budget;

        type DeliveryEstimateResponse = {
          data: Array<{
            daily_outcomes_curve?: unknown[];
            estimate_ready?: boolean;
            estimate_dau?: number;
            estimate_mau_lower_bound?: number;
            estimate_mau_upper_bound?: number;
          }>;
        };

        const response = await makeRequest<DeliveryEstimateResponse>(
          `${accountId}/delivery_estimate`,
          'GET',
          params
        );

        const estimate = response.data?.[0] ?? {};
        const result = {
          ad_account_id: accountId,
          optimization_goal,
          estimate,
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
    'meta_get_minimum_budgets',
    {
      title: 'Orçamentos Mínimos por Objetivo',
      description:
        'Retorna os valores mínimos de orçamento diário e total para cada objetivo de campanha ' +
        'e objetivo de otimização em uma conta de anúncio. ' +
        'Use para saber o mínimo que pode definir antes de criar uma campanha ou ad set.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        type MinBudgetResponse = {
          data: Array<{
            currency?: string;
            min_daily_budget_high_freq?: string;
            min_daily_budget_imp?: string;
            min_daily_budget_low_freq?: string;
            min_daily_budget_video_views?: string;
          }>;
        };
        const response = await makeRequest<MinBudgetResponse>(
          `${accountId}/minimum_budgets`,
          'GET',
          { fields: 'currency,min_daily_budget_high_freq,min_daily_budget_imp,min_daily_budget_low_freq,min_daily_budget_video_views' }
        );

        const data = response.data?.[0] ?? {};
        const currency = (data.currency as string) || 'BRL';
        const toCurrency = (v?: string) => v ? `${(parseInt(v) / 100).toFixed(2)} ${currency}` : null;

        const result = {
          ad_account_id: accountId,
          currency,
          min_daily_budget_high_freq: toCurrency(data.min_daily_budget_high_freq),
          min_daily_budget_impressions: toCurrency(data.min_daily_budget_imp),
          min_daily_budget_low_freq: toCurrency(data.min_daily_budget_low_freq),
          min_daily_budget_video_views: toCurrency(data.min_daily_budget_video_views),
          note: 'Valores em centavos divididos por 100. Use o menor aplicável ao seu objetivo.',
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
