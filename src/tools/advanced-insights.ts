import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  makeRequest,
  paginate,
  handleApiError,
  normalizeAdAccountId,
  toJson,
} from '../client.js';
import { DATE_PRESETS, INSIGHT_FIELDS } from '../constants.js';

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

function buildTimeRange(since?: string, until?: string, date_preset?: string) {
  if (date_preset) return { date_preset };
  if (since && until) return { time_range: JSON.stringify({ since, until }) };
  return { date_preset: 'last_30d' };
}

export function registerAdvancedInsightTools(server: McpServer): void {
  server.registerTool(
    'meta_insights_advertiser_context',
    {
      title: 'Contexto do Anunciante',
      description:
        'Retorna insights segmentados por plataforma (Facebook, Instagram, Audience Network) ' +
        'e dispositivo (mobile, desktop) para uma conta de anúncio. ' +
        'Útil para entender onde os seus anúncios estão performando melhor.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        date_preset: z
          .enum(DATE_PRESETS)
          .optional()
          .describe('Período pré-definido (ex: last_30d, last_7d, this_month).'),
        since: z
          .string()
          .optional()
          .describe('Data de início (YYYY-MM-DD). Use com until.'),
        until: z
          .string()
          .optional()
          .describe('Data de fim (YYYY-MM-DD). Use com since.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, date_preset, since, until }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const timeParams = buildTimeRange(since, until, date_preset);

        const params = {
          fields: [INSIGHT_FIELDS, 'publisher_platform', 'impression_device'].join(','),
          breakdowns: JSON.stringify(['publisher_platform', 'impression_device']),
          level: 'account',
          ...timeParams,
        };

        type InsightResponse = { data: unknown[] };
        const response = await makeRequest<InsightResponse>(`${accountId}/insights`, 'GET', params);

        const result = {
          ad_account_id: accountId,
          breakdowns: ['publisher_platform', 'impression_device'],
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

  server.registerTool(
    'meta_insights_anomaly_signal',
    {
      title: 'Sinais de Anomalia nos Anúncios',
      description:
        'Retorna anomalias detectadas na entrega dos anúncios de uma conta: ' +
        'quedas de desempenho, variações de CPM, CTR ou impressões fora do padrão histórico. ' +
        'Use para detectar rapidamente quando campanhas saem do comportamento esperado.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        date_preset: z
          .enum(DATE_PRESETS)
          .optional()
          .describe('Período de análise (ex: last_7d, last_14d). Padrão: last_7d.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, date_preset }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);

        // Delivery Insights API: anomaly signals via spend/impressions comparison
        type DeliveryInsightsResponse = { data: unknown[] };
        const response = await makeRequest<DeliveryInsightsResponse>(
          `${accountId}/delivery_insights`,
          'GET',
          {
            fields: 'time_period,breakdowns,metrics',
            date_preset: date_preset ?? 'last_7d',
          }
        );

        const result = {
          ad_account_id: accountId,
          anomalies: response.data || [],
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
    'meta_insights_auction_ranking_benchmarks',
    {
      title: 'Benchmarks de Ranking de Leilão',
      description:
        'Retorna dados de ranking no leilão de anúncios comparando sua conta com a concorrência: ' +
        'quality_ranking, engagement_rate_ranking e conversion_rate_ranking. ' +
        'Use para entender se seus anúncios estão perdendo leilões por qualidade ou lance.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        date_preset: z
          .enum(DATE_PRESETS)
          .optional()
          .describe('Período (ex: last_30d). Padrão: last_30d.'),
        since: z
          .string()
          .optional()
          .describe('Data de início (YYYY-MM-DD).'),
        until: z
          .string()
          .optional()
          .describe('Data de fim (YYYY-MM-DD).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, date_preset, since, until }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const timeParams = buildTimeRange(since, until, date_preset);

        const params = {
          fields: [
            INSIGHT_FIELDS,
            'quality_ranking',
            'engagement_rate_ranking',
            'conversion_rate_ranking',
          ].join(','),
          level: 'ad',
          ...timeParams,
        };

        type InsightResponse = { data: unknown[] };
        const response = await makeRequest<InsightResponse>(`${accountId}/insights`, 'GET', params);

        const result = {
          ad_account_id: accountId,
          description: 'Ranking relativo dos anúncios no leilão. Valores: ABOVE_AVERAGE, AVERAGE, BELOW_AVERAGE_10, BELOW_AVERAGE_20, BELOW_AVERAGE_35.',
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

  server.registerTool(
    'meta_insights_industry_benchmark',
    {
      title: 'Benchmarks da Indústria',
      description:
        'Compara o desempenho da conta com benchmarks médios da indústria (CTR, CPM, CPC). ' +
        'Retorna métricas da sua conta no período selecionado para comparação manual. ' +
        'Use para contextualizar se os resultados estão acima ou abaixo da média do setor.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        date_preset: z
          .enum(DATE_PRESETS)
          .optional()
          .describe('Período (ex: last_30d, last_90d). Padrão: last_30d.'),
        since: z
          .string()
          .optional()
          .describe('Data de início (YYYY-MM-DD).'),
        until: z
          .string()
          .optional()
          .describe('Data de fim (YYYY-MM-DD).'),
        objective: z
          .string()
          .optional()
          .describe('Filtrar por objetivo de campanha (ex: OUTCOME_LEADS, OUTCOME_TRAFFIC).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, date_preset, since, until, objective }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const timeParams = buildTimeRange(since, until, date_preset);

        const params: Record<string, unknown> = {
          fields: 'spend,impressions,reach,clicks,ctr,cpm,cpc,frequency,actions,cost_per_action_type',
          level: 'campaign',
          ...timeParams,
        };

        if (objective) {
          params.filtering = JSON.stringify([{ field: 'campaign.objective', operator: 'EQUAL', value: objective }]);
        }

        type InsightResponse = { data: unknown[] };
        const response = await makeRequest<InsightResponse>(`${accountId}/insights`, 'GET', params);

        const result = {
          ad_account_id: accountId,
          note: 'Compare estes resultados com benchmarks da sua indústria. Benchmarks típicos BR: CTR 0.9-1.5%, CPM R$8-25, CPC R$0.50-3.00 dependendo do segmento.',
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

  server.registerTool(
    'meta_insights_performance_trend',
    {
      title: 'Tendência de Performance',
      description:
        'Retorna métricas diárias ou semanais para visualizar a tendência de performance ao longo do tempo. ' +
        'Útil para detectar crescimento, queda ou sazonalidade nas campanhas. ' +
        'Agrupe por dia (time_increment=1) ou semana (time_increment=7).',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        date_preset: z
          .enum(DATE_PRESETS)
          .optional()
          .describe('Período (ex: last_30d, last_90d). Padrão: last_30d.'),
        since: z
          .string()
          .optional()
          .describe('Data de início (YYYY-MM-DD).'),
        until: z
          .string()
          .optional()
          .describe('Data de fim (YYYY-MM-DD).'),
        time_increment: z
          .number()
          .int()
          .min(1)
          .max(90)
          .default(1)
          .describe('Granularidade em dias: 1=diário, 7=semanal, 30=mensal.'),
        level: z
          .enum(['account', 'campaign', 'adset', 'ad'])
          .default('account')
          .describe('Nível de agregação dos dados.'),
        fields: z
          .string()
          .optional()
          .describe('Campos de métricas separados por vírgula. Padrão: spend,impressions,clicks,ctr,cpm,cpc,actions.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, date_preset, since, until, time_increment, level, fields }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const timeParams = buildTimeRange(since, until, date_preset);

        const params: Record<string, unknown> = {
          fields: fields ?? 'spend,impressions,reach,clicks,ctr,cpm,cpc,actions,date_start,date_stop',
          level,
          time_increment,
          ...timeParams,
        };

        type InsightResponse = { data: unknown[] };
        const response = await makeRequest<InsightResponse>(`${accountId}/insights`, 'GET', params);

        const result = {
          ad_account_id: accountId,
          level,
          time_increment,
          total_periods: (response.data || []).length,
          trend: response.data || [],
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
