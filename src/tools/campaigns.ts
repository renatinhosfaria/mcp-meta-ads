import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  makeRequest,
  paginate,
  handleApiError,
  normalizeAdAccountId,
  toJson,
} from '../client.js';
import {
  CAMPAIGN_FIELDS,
  CAMPAIGN_OBJECTIVES,
  AD_STATUSES,
  LIST_EFFECTIVE_STATUSES,
} from '../constants.js';
import type { Campaign, MetaApiResponse } from '../types.js';

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

type BuildCreateCampaignPayloadInput = {
  name: string;
  objective: typeof CAMPAIGN_OBJECTIVES[number];
  status: 'ACTIVE' | 'PAUSED';
  special_ad_categories: Array<'NONE' | 'EMPLOYMENT' | 'HOUSING' | 'CREDIT' | 'ISSUES_ELECTIONS_POLITICS' | 'ONLINE_GAMBLING_AND_GAMING'>;
  is_adset_budget_sharing_enabled?: boolean;
  daily_budget?: number;
  lifetime_budget?: number;
  spend_cap?: number;
  start_time?: string;
  stop_time?: string;
  bid_strategy?: 'LOWEST_COST_WITHOUT_CAP' | 'LOWEST_COST_WITH_BID_CAP' | 'COST_CAP' | 'LOWEST_COST_WITH_MIN_ROAS';
};

export function buildCreateCampaignPayload({
  name,
  objective,
  status,
  special_ad_categories,
  is_adset_budget_sharing_enabled = false,
  daily_budget,
  lifetime_budget,
  spend_cap,
  start_time,
  stop_time,
  bid_strategy,
}: BuildCreateCampaignPayloadInput): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name,
    objective,
    status,
    special_ad_categories,
    is_adset_budget_sharing_enabled,
  };

  if (daily_budget !== undefined) data.daily_budget = daily_budget;
  if (lifetime_budget !== undefined) data.lifetime_budget = lifetime_budget;
  if (spend_cap !== undefined) data.spend_cap = spend_cap;
  if (start_time) data.start_time = start_time;
  if (stop_time) data.stop_time = stop_time;
  if (bid_strategy) data.bid_strategy = bid_strategy;

  return data;
}

export function registerCampaignTools(server: McpServer): void {
  server.registerTool(
    'meta_list_campaigns',
    {
      title: 'Listar Campanhas',
      description:
        'Lista todas as campanhas de uma conta de anúncio. ' +
        'Retorna ID, nome, status, objetivo, orçamento diário/vitalício, datas e gastos. ' +
        'Filtre por status (ACTIVE, PAUSED, ARCHIVED) para ver apenas campanhas relevantes.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio (ex: act_123456789). Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        status_filter: z
          .array(z.enum(LIST_EFFECTIVE_STATUSES))
          .optional()
          .describe('Filtrar por status. Ex: ["ACTIVE", "PAUSED"]. Se omitido, retorna todas.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Número máximo de campanhas (padrão: 50).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, status_filter, limit }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const params: Record<string, unknown> = { fields: CAMPAIGN_FIELDS };
        if (status_filter && status_filter.length > 0) {
          params.effective_status = JSON.stringify(status_filter);
        }

        const campaigns = await paginate<Campaign>(
          `${accountId}/campaigns`,
          params,
          limit
        );

        const result = {
          total: campaigns.length,
          ad_account_id: accountId,
          campaigns: campaigns.map(formatCampaign),
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
    'meta_get_campaign',
    {
      title: 'Detalhes da Campanha',
      description:
        'Retorna detalhes completos de uma campanha específica: ' +
        'status, objetivo, orçamento, datas de início/fim, estratégia de lance e categorias especiais.',
      inputSchema: z.object({
        campaign_id: z
          .string()
          .describe('ID da campanha (ex: 120210000000000000).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ campaign_id }) => {
      try {
        const campaign = await makeRequest<Campaign>(campaign_id, 'GET', {
          fields: CAMPAIGN_FIELDS,
        });

        return {
          content: [{ type: 'text' as const, text: toJson(formatCampaign(campaign)) }],
          structuredContent: formatCampaign(campaign),
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
    'meta_create_campaign',
    {
      title: 'Criar Campanha',
      description:
        'Cria uma nova campanha no Ads Manager. ' +
        'Retorna o ID da campanha criada. ' +
        'Objetivos disponíveis: OUTCOME_AWARENESS, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, ' +
        'OUTCOME_SALES, OUTCOME_TRAFFIC, OUTCOME_APP_PROMOTION. ' +
        'Use validate_only: true para validar sem criar.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        name: z
          .string()
          .min(1)
          .max(400)
          .describe('Nome da campanha (ex: "Leads Imóveis SP - Março 2025").'),
        objective: z
          .enum(CAMPAIGN_OBJECTIVES)
          .describe('Objetivo da campanha. Use OUTCOME_LEADS para captação de leads, OUTCOME_TRAFFIC para tráfego.'),
        status: z
          .enum(['ACTIVE', 'PAUSED'])
          .default('PAUSED')
          .describe('Status inicial. Use PAUSED para criar sem ativar (recomendado).'),
        special_ad_categories: z
          .array(z.enum(['NONE', 'EMPLOYMENT', 'HOUSING', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS', 'ONLINE_GAMBLING_AND_GAMING']))
          .default(['NONE'])
          .describe('Categorias especiais de anúncio. Use ["NONE"] para campanhas normais. Use ["HOUSING"] para imóveis em algumas regiões.'),
        daily_budget: z
          .number()
          .int()
          .min(100)
          .optional()
          .describe('Orçamento diário em centavos (ex: 5000 = R$50,00). Mutuamente exclusivo com lifetime_budget.'),
        lifetime_budget: z
          .number()
          .int()
          .min(100)
          .optional()
          .describe('Orçamento total da campanha em centavos. Mutuamente exclusivo com daily_budget.'),
        spend_cap: z
          .number()
          .int()
          .optional()
          .describe('Limite máximo de gasto da campanha em centavos.'),
        start_time: z
          .string()
          .optional()
          .describe('Data/hora de início no formato ISO 8601 (ex: "2025-04-01T00:00:00-03:00").'),
        stop_time: z
          .string()
          .optional()
          .describe('Data/hora de término. Obrigatório se usar lifetime_budget.'),
        bid_strategy: z
          .enum(['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'LOWEST_COST_WITH_MIN_ROAS'])
          .optional()
          .describe('Estratégia de lance. LOWEST_COST_WITHOUT_CAP é o padrão.'),
        is_adset_budget_sharing_enabled: z
          .boolean()
          .default(false)
          .describe('Define explicitamente o budget sharing em nível de campanha. Use false por padrão para compatibilidade com a Meta API.'),
        validate_only: z
          .boolean()
          .default(false)
          .describe('Se true, valida os parâmetros sem criar a campanha.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, name, objective, status, special_ad_categories, daily_budget, lifetime_budget, spend_cap, start_time, stop_time, bid_strategy, is_adset_budget_sharing_enabled, validate_only }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const data = buildCreateCampaignPayload({
          name,
          objective,
          status,
          special_ad_categories,
          is_adset_budget_sharing_enabled,
          daily_budget,
          lifetime_budget,
          spend_cap,
          start_time,
          stop_time,
          bid_strategy,
        });

        const params: Record<string, unknown> = {};
        if (validate_only) params.validate_only = true;

        const response = await makeRequest<{ id: string; success?: boolean }>(
          `${accountId}/campaigns`,
          'POST',
          params,
          data
        );

        const result = validate_only
          ? { success: true, message: 'Validação bem-sucedida. Campanha não criada (validate_only=true).' }
          : {
              success: true,
              campaign_id: response.id,
              message: `Campanha "${name}" criada com sucesso. ID: ${response.id}`,
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
    'meta_update_campaign',
    {
      title: 'Atualizar Campanha',
      description:
        'Atualiza uma campanha existente: nome, status (pausar/ativar), ' +
        'orçamento, datas e limite de gasto. ' +
        'Forneça apenas os campos que deseja alterar.',
      inputSchema: z.object({
        campaign_id: z
          .string()
          .describe('ID da campanha a atualizar.'),
        name: z
          .string()
          .min(1)
          .max(400)
          .optional()
          .describe('Novo nome da campanha.'),
        status: z
          .enum(AD_STATUSES)
          .optional()
          .describe('Novo status: ACTIVE (ativar), PAUSED (pausar), ARCHIVED (arquivar).'),
        daily_budget: z
          .number()
          .int()
          .min(100)
          .optional()
          .describe('Novo orçamento diário em centavos.'),
        lifetime_budget: z
          .number()
          .int()
          .min(100)
          .optional()
          .describe('Novo orçamento total em centavos.'),
        spend_cap: z
          .number()
          .int()
          .optional()
          .describe('Novo limite máximo de gasto em centavos. Passe 0 para remover o limite.'),
        start_time: z
          .string()
          .optional()
          .describe('Nova data/hora de início (ISO 8601).'),
        stop_time: z
          .string()
          .optional()
          .describe('Nova data/hora de término (ISO 8601).'),
        bid_strategy: z
          .enum(['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'LOWEST_COST_WITH_MIN_ROAS'])
          .optional()
          .describe('Nova estratégia de lance.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ campaign_id, name, status, daily_budget, lifetime_budget, spend_cap, start_time, stop_time, bid_strategy }) => {
      try {
        const data: Record<string, unknown> = {};
        if (name !== undefined) data.name = name;
        if (status !== undefined) data.status = status;
        if (daily_budget !== undefined) data.daily_budget = daily_budget;
        if (lifetime_budget !== undefined) data.lifetime_budget = lifetime_budget;
        if (spend_cap !== undefined) data.spend_cap = spend_cap;
        if (start_time !== undefined) data.start_time = start_time;
        if (stop_time !== undefined) data.stop_time = stop_time;
        if (bid_strategy !== undefined) data.bid_strategy = bid_strategy;

        if (Object.keys(data).length === 0) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Erro: Nenhum campo para atualizar fornecido.' }],
          };
        }

        await makeRequest<{ success: boolean }>(campaign_id, 'POST', {}, data);

        const result = {
          success: true,
          campaign_id,
          updated_fields: Object.keys(data),
          message: `Campanha ${campaign_id} atualizada com sucesso.`,
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
    'meta_delete_campaign',
    {
      title: 'Deletar Campanha',
      description:
        'Deleta permanentemente uma campanha e todos os seus ad sets e anúncios. ' +
        'ATENÇÃO: Esta ação é irreversível. ' +
        'Considere usar meta_update_campaign com status ARCHIVED para arquivar em vez de deletar.',
      inputSchema: z.object({
        campaign_id: z
          .string()
          .describe('ID da campanha a deletar.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ campaign_id }) => {
      try {
        await makeRequest<{ success: boolean }>(campaign_id, 'DELETE');

        const result = {
          success: true,
          campaign_id,
          message: `Campanha ${campaign_id} deletada com sucesso.`,
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

function formatCampaign(c: Campaign) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    effective_status: c.effective_status,
    objective: c.objective,
    daily_budget: c.daily_budget ? `${(parseInt(c.daily_budget) / 100).toFixed(2)}` : null,
    lifetime_budget: c.lifetime_budget ? `${(parseInt(c.lifetime_budget) / 100).toFixed(2)}` : null,
    budget_remaining: c.budget_remaining ? `${(parseInt(c.budget_remaining) / 100).toFixed(2)}` : null,
    spend_cap: c.spend_cap ? `${(parseInt(c.spend_cap) / 100).toFixed(2)}` : null,
    bid_strategy: c.bid_strategy || null,
    buying_type: c.buying_type || null,
    start_time: c.start_time || null,
    stop_time: c.stop_time || null,
    special_ad_categories: c.special_ad_categories || [],
    created_time: c.created_time,
    updated_time: c.updated_time,
  };
}
