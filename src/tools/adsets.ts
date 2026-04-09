import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  makeRequest,
  paginate,
  handleApiError,
  normalizeAdAccountId,
  toJson,
} from '../client.js';
import { ADSET_FIELDS, AD_STATUSES, LIST_EFFECTIVE_STATUSES } from '../constants.js';
import type { AdSet } from '../types.js';

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

export function registerAdSetTools(server: McpServer): void {
  server.registerTool(
    'meta_list_adsets',
    {
      title: 'Listar Conjuntos de Anúncios',
      description:
        'Lista ad sets (conjuntos de anúncios) de uma conta ou campanha específica. ' +
        'Retorna ID, nome, status, orçamento, objetivo de otimização e segmentação. ' +
        'Filtre por campaign_id para ver apenas os ad sets de uma campanha.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        campaign_id: z
          .string()
          .optional()
          .describe('ID da campanha para filtrar ad sets. Se omitido, lista todos da conta.'),
        status_filter: z
          .array(z.enum(LIST_EFFECTIVE_STATUSES))
          .optional()
          .describe('Filtrar por status. Ex: ["ACTIVE"].'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Número máximo de ad sets (padrão: 50).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, campaign_id, status_filter, limit }) => {
      try {
        const endpoint = campaign_id
          ? `${campaign_id}/adsets`
          : `${resolveAccountId(ad_account_id)}/adsets`;

        const params: Record<string, unknown> = { fields: ADSET_FIELDS };
        if (status_filter && status_filter.length > 0) {
          params.effective_status = JSON.stringify(status_filter);
        }

        const adsets = await paginate<AdSet>(endpoint, params, limit);

        const result = {
          total: adsets.length,
          adsets: adsets.map(formatAdSet),
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
    'meta_get_adset',
    {
      title: 'Detalhes do Conjunto de Anúncios',
      description:
        'Retorna detalhes completos de um ad set: status, orçamento, segmentação de público, ' +
        'objetivo de otimização, evento de cobrança e datas.',
      inputSchema: z.object({
        adset_id: z.string().describe('ID do conjunto de anúncios.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ adset_id }) => {
      try {
        const adset = await makeRequest<AdSet>(adset_id, 'GET', {
          fields: ADSET_FIELDS,
        });

        return {
          content: [{ type: 'text' as const, text: toJson(formatAdSet(adset)) }],
          structuredContent: formatAdSet(adset),
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
    'meta_create_adset',
    {
      title: 'Criar Conjunto de Anúncios',
      description:
        'Cria um novo ad set dentro de uma campanha. ' +
        'O targeting deve ser um objeto JSON com: age_min, age_max, genders, geo_locations (countries), ' +
        'interests, behaviors, device_platforms, publisher_platforms. ' +
        'Exemplos de optimization_goal: LINK_CLICKS, REACH, IMPRESSIONS, LEAD_GENERATION, ' +
        'OFFSITE_CONVERSIONS, APP_INSTALLS. ' +
        'Exemplos de billing_event: IMPRESSIONS, LINK_CLICKS.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        campaign_id: z
          .string()
          .describe('ID da campanha pai.'),
        name: z
          .string()
          .min(1)
          .max(400)
          .describe('Nome do ad set (ex: "Homens 30-50 SP - Interesses Imóveis").'),
        optimization_goal: z
          .string()
          .describe(
            'Objetivo de otimização. Exemplos: LINK_CLICKS, REACH, IMPRESSIONS, ' +
            'LEAD_GENERATION, OFFSITE_CONVERSIONS, APP_INSTALLS, VIDEO_VIEWS, ' +
            'LANDING_PAGE_VIEWS, QUALITY_LEAD.'
          ),
        billing_event: z
          .enum(['IMPRESSIONS', 'LINK_CLICKS', 'APP_INSTALLS', 'VIDEO_VIEWS', 'THRUPLAY'])
          .describe('Evento de cobrança. Use IMPRESSIONS para a maioria dos objetivos.'),
        daily_budget: z
          .number()
          .int()
          .min(100)
          .optional()
          .describe('Orçamento diário em centavos. Mutuamente exclusivo com lifetime_budget.'),
        lifetime_budget: z
          .number()
          .int()
          .min(100)
          .optional()
          .describe('Orçamento total em centavos. Mutuamente exclusivo com daily_budget.'),
        targeting: z
          .string()
          .describe(
            'JSON de segmentação de público. Exemplo mínimo: ' +
            '{"age_min":18,"age_max":65,"geo_locations":{"countries":["BR"]}}'
          ),
        status: z
          .enum(['ACTIVE', 'PAUSED'])
          .default('PAUSED')
          .describe('Status inicial do ad set.'),
        bid_amount: z
          .number()
          .int()
          .optional()
          .describe('Valor do lance em centavos (necessário para estratégias de lance manual).'),
        bid_strategy: z
          .enum(['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'])
          .optional()
          .describe('Estratégia de lance do ad set.'),
        start_time: z
          .string()
          .optional()
          .describe('Data/hora de início (ISO 8601).'),
        end_time: z
          .string()
          .optional()
          .describe('Data/hora de término (ISO 8601).'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, campaign_id, name, optimization_goal, billing_event, daily_budget, lifetime_budget, targeting, status, bid_amount, bid_strategy, start_time, end_time }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);

        let targetingObj: unknown;
        try {
          targetingObj = JSON.parse(targeting);
        } catch {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Erro: O campo targeting deve ser um JSON válido. Exemplo: {"age_min":18,"age_max":65,"geo_locations":{"countries":["BR"]}}' }],
          };
        }

        const data: Record<string, unknown> = {
          campaign_id,
          name,
          optimization_goal,
          billing_event,
          targeting: targetingObj,
          status,
        };

        if (daily_budget !== undefined) data.daily_budget = daily_budget;
        if (lifetime_budget !== undefined) data.lifetime_budget = lifetime_budget;
        if (bid_amount !== undefined) data.bid_amount = bid_amount;
        if (bid_strategy !== undefined) data.bid_strategy = bid_strategy;
        if (start_time) data.start_time = start_time;
        if (end_time) data.end_time = end_time;

        const response = await makeRequest<{ id: string }>(
          `${accountId}/adsets`,
          'POST',
          {},
          data
        );

        const result = {
          success: true,
          adset_id: response.id,
          message: `Ad Set "${name}" criado com sucesso. ID: ${response.id}`,
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
    'meta_update_adset',
    {
      title: 'Atualizar Conjunto de Anúncios',
      description:
        'Atualiza um ad set existente: nome, status, orçamento, segmentação e datas. ' +
        'Forneça apenas os campos que deseja alterar.',
      inputSchema: z.object({
        adset_id: z.string().describe('ID do ad set a atualizar.'),
        name: z.string().min(1).max(400).optional().describe('Novo nome.'),
        status: z.enum(AD_STATUSES).optional().describe('Novo status.'),
        daily_budget: z.number().int().min(100).optional().describe('Novo orçamento diário em centavos.'),
        lifetime_budget: z.number().int().min(100).optional().describe('Novo orçamento total em centavos.'),
        targeting: z.string().optional().describe('Novo JSON de segmentação.'),
        bid_amount: z.number().int().optional().describe('Novo valor de lance em centavos.'),
        bid_strategy: z
          .enum(['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'])
          .optional()
          .describe('Nova estratégia de lance.'),
        start_time: z.string().optional().describe('Nova data/hora de início.'),
        end_time: z.string().optional().describe('Nova data/hora de término.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ adset_id, name, status, daily_budget, lifetime_budget, targeting, bid_amount, bid_strategy, start_time, end_time }) => {
      try {
        const data: Record<string, unknown> = {};
        if (name !== undefined) data.name = name;
        if (status !== undefined) data.status = status;
        if (daily_budget !== undefined) data.daily_budget = daily_budget;
        if (lifetime_budget !== undefined) data.lifetime_budget = lifetime_budget;
        if (bid_amount !== undefined) data.bid_amount = bid_amount;
        if (bid_strategy !== undefined) data.bid_strategy = bid_strategy;
        if (start_time !== undefined) data.start_time = start_time;
        if (end_time !== undefined) data.end_time = end_time;

        if (targeting !== undefined) {
          try {
            data.targeting = JSON.parse(targeting);
          } catch {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: 'Erro: O campo targeting deve ser um JSON válido.' }],
            };
          }
        }

        if (Object.keys(data).length === 0) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Erro: Nenhum campo para atualizar fornecido.' }],
          };
        }

        await makeRequest<{ success: boolean }>(adset_id, 'POST', {}, data);

        const result = {
          success: true,
          adset_id,
          updated_fields: Object.keys(data),
          message: `Ad Set ${adset_id} atualizado com sucesso.`,
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
    'meta_delete_adset',
    {
      title: 'Deletar Conjunto de Anúncios',
      description:
        'Deleta um ad set e todos os seus anúncios. ' +
        'ATENÇÃO: Ação irreversível. Considere usar status ARCHIVED em vez de deletar.',
      inputSchema: z.object({
        adset_id: z.string().describe('ID do ad set a deletar.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ adset_id }) => {
      try {
        await makeRequest<{ success: boolean }>(adset_id, 'DELETE');

        const result = {
          success: true,
          adset_id,
          message: `Ad Set ${adset_id} deletado com sucesso.`,
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

function formatAdSet(a: AdSet) {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    effective_status: a.effective_status,
    campaign_id: a.campaign_id,
    daily_budget: a.daily_budget ? `${(parseInt(a.daily_budget) / 100).toFixed(2)}` : null,
    lifetime_budget: a.lifetime_budget ? `${(parseInt(a.lifetime_budget) / 100).toFixed(2)}` : null,
    budget_remaining: a.budget_remaining ? `${(parseInt(a.budget_remaining) / 100).toFixed(2)}` : null,
    optimization_goal: a.optimization_goal || null,
    billing_event: a.billing_event || null,
    bid_amount: a.bid_amount || null,
    bid_strategy: a.bid_strategy || null,
    targeting: a.targeting || null,
    start_time: a.start_time || null,
    end_time: a.end_time || null,
    created_time: a.created_time,
    updated_time: a.updated_time,
  };
}
