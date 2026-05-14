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

export function registerReachTools(server: McpServer): void {
  server.registerTool(
    'meta_reach_estimate',
    {
      title: 'Estimar Alcance de Audiência',
      description:
        'Estima o tamanho da audiência para um targeting_spec: número de usuários únicos atingíveis. ' +
        'Use antes de criar um ad set para verificar se o público é grande o suficiente (>50k recomendado). ' +
        'Passe o mesmo targeting_spec que usaria em meta_create_adset.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        targeting_spec: z
          .string()
          .describe('JSON do targeting spec (ex: \'{"geo_locations":{"countries":["BR"]},"age_min":25,"age_max":45}\').'),
        optimization_goal: z
          .string()
          .optional()
          .describe('Objetivo de otimização (ex: REACH, LINK_CLICKS, LEAD_GENERATION). Afeta a estimativa de alcance disponível.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, targeting_spec, optimization_goal }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const params: Record<string, unknown> = { targeting_spec };
        if (optimization_goal) params.optimization_goal = optimization_goal;

        type ReachEstimateResponse = {
          users_lower_bound?: number;
          users_upper_bound?: number;
          estimate_ready?: boolean;
          estimate_mau_lower_bound?: number;
          estimate_mau_upper_bound?: number;
        };

        const response = await makeRequest<ReachEstimateResponse>(
          `${accountId}/reachestimate`,
          'GET',
          params
        );

        const result = {
          ad_account_id: accountId,
          estimate_ready: response.estimate_ready ?? true,
          users_lower_bound: response.users_lower_bound ?? null,
          users_upper_bound: response.users_upper_bound ?? null,
          mau_lower_bound: response.estimate_mau_lower_bound ?? null,
          mau_upper_bound: response.estimate_mau_upper_bound ?? null,
          audience_size_formatted: response.users_lower_bound && response.users_upper_bound
            ? `${response.users_lower_bound.toLocaleString('pt-BR')} – ${response.users_upper_bound.toLocaleString('pt-BR')} usuários`
            : 'Estimativa não disponível',
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
    'meta_reach_frequency_prediction',
    {
      title: 'Predição de Alcance e Frequência',
      description:
        'Cria ou lista predições de Reach & Frequency para campanhas de alcance reservado (RESERVED buying type). ' +
        'Permite estimar quantas pessoas você vai atingir, com qual frequência e qual será o CPM. ' +
        'Use action=create para criar uma nova predição, action=list para ver predições existentes.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        action: z
          .enum(['create', 'list'])
          .default('list')
          .describe('Ação: "list" para listar predições existentes, "create" para criar nova predição.'),
        targeting_spec: z
          .string()
          .optional()
          .describe('[Obrigatório para create] JSON do targeting spec.'),
        start_time: z
          .number()
          .int()
          .optional()
          .describe('[Obrigatório para create] Timestamp Unix de início da campanha.'),
        end_time: z
          .number()
          .int()
          .optional()
          .describe('[Obrigatório para create] Timestamp Unix de fim da campanha.'),
        reach: z
          .number()
          .int()
          .optional()
          .describe('[Obrigatório para create] Número de pessoas únicas a atingir.'),
        frequency_cap: z
          .number()
          .int()
          .optional()
          .describe('[Opcional] Número máximo de vezes que cada pessoa verá o anúncio.'),
        budget: z
          .number()
          .int()
          .optional()
          .describe('[Opcional] Orçamento total em centavos.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Número máximo de predições a retornar (apenas para action=list).'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, action, targeting_spec, start_time, end_time, reach, frequency_cap, budget, limit }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);

        if (action === 'list') {
          const predictions = await paginate<Record<string, unknown>>(
            `${accountId}/reachfrequencypredictions`,
            { fields: 'id,reach,budget,frequency_cap,start_time,end_time,status,prediction_progress,external_reach,external_budget,external_impression_cap' },
            limit
          );
          const result = { ad_account_id: accountId, total: predictions.length, predictions };
          return {
            content: [{ type: 'text' as const, text: toJson(result) }],
            structuredContent: result,
          };
        }

        if (!targeting_spec || !start_time || !end_time || !reach) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Para action=create, forneça: targeting_spec, start_time, end_time, reach.' }],
          };
        }

        const data: Record<string, unknown> = {
          target_spec: targeting_spec,
          start_time,
          end_time,
          reach,
        };
        if (frequency_cap) data.frequency_cap = frequency_cap;
        if (budget) data.budget = budget;

        const response = await makeRequest<{ id: string }>(
          `${accountId}/reachfrequencypredictions`,
          'POST',
          {},
          data
        );

        const result = {
          success: true,
          prediction_id: response.id,
          message: `Predição criada. ID: ${response.id}. Use action=list para ver o status.`,
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
