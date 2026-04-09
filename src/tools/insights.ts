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
  INSIGHT_FIELDS,
  DATE_PRESETS,
  INSIGHT_BREAKDOWNS,
  INSIGHT_LEVELS,
} from '../constants.js';
import type { Insight, MetaApiResponse } from '../types.js';

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

const InsightBaseSchema = {
  fields: z
    .string()
    .optional()
    .describe(
      'Campos de métricas separados por vírgula. Padrão inclui: spend, impressions, reach, clicks, ctr, cpm, cpc, frequency, actions. ' +
      'Campos extras: cost_per_result, quality_score_organic, quality_score_ectr, quality_score_ecvr, website_purchase_roas, outbound_clicks, landing_page_view.'
    ),
  date_preset: z
    .enum(DATE_PRESETS)
    .optional()
    .describe(
      'Período pré-definido. Ex: last_7d (últimos 7 dias), last_30d (30 dias), this_month, last_month, yesterday, today.'
    ),
  since: z
    .string()
    .optional()
    .describe('Data de início personalizada (formato: YYYY-MM-DD). Use junto com until.'),
  until: z
    .string()
    .optional()
    .describe('Data de término personalizada (formato: YYYY-MM-DD). Use junto com since.'),
  breakdowns: z
    .array(z.enum(INSIGHT_BREAKDOWNS))
    .optional()
    .describe('Dimensões para segmentar os resultados. Ex: ["age","gender"] para ver por idade e gênero, ["country"] para por país.'),
  level: z
    .enum(INSIGHT_LEVELS)
    .optional()
    .describe('Nível de agregação: account, campaign, adset ou ad. Padrão depende do objeto consultado.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe('Número máximo de linhas de resultados (padrão: 100).'),
};

function buildInsightParams(params: {
  fields?: string;
  date_preset?: string;
  since?: string;
  until?: string;
  breakdowns?: string[];
  level?: string;
}): Record<string, unknown> {
  const p: Record<string, unknown> = {
    fields: params.fields || INSIGHT_FIELDS,
  };

  if (params.date_preset) {
    p.date_preset = params.date_preset;
  } else if (params.since && params.until) {
    p.time_range = JSON.stringify({ since: params.since, until: params.until });
  } else {
    p.date_preset = 'last_30d';
  }

  if (params.breakdowns && params.breakdowns.length > 0) {
    p.breakdowns = params.breakdowns.join(',');
  }

  if (params.level) {
    p.level = params.level;
  }

  return p;
}

function summarizeInsights(insights: Insight[]) {
  if (insights.length === 0) return null;

  const totals = {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
  };

  for (const row of insights) {
    if (row.spend) totals.spend += parseFloat(row.spend);
    if (row.impressions) totals.impressions += parseInt(row.impressions);
    if (row.reach) totals.reach += parseInt(row.reach);
    if (row.clicks) totals.clicks += parseInt(row.clicks);
  }

  const avgCtr = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : '0.00';
  const avgCpm = totals.impressions > 0 ? ((totals.spend / totals.impressions) * 1000).toFixed(2) : '0.00';
  const avgCpc = totals.clicks > 0 ? (totals.spend / totals.clicks).toFixed(2) : '0.00';

  return {
    spend: totals.spend.toFixed(2),
    impressions: totals.impressions.toLocaleString('pt-BR'),
    reach: totals.reach.toLocaleString('pt-BR'),
    clicks: totals.clicks.toLocaleString('pt-BR'),
    avg_ctr: `${avgCtr}%`,
    avg_cpm: avgCpm,
    avg_cpc: avgCpc,
  };
}

export function registerInsightTools(server: McpServer): void {
  server.registerTool(
    'meta_get_insights',
    {
      title: 'Buscar Métricas (Insights)',
      description:
        'Busca métricas de performance para qualquer objeto do Ads Manager: ' +
        'conta, campanha, ad set ou anúncio. ' +
        'Retorna: gastos, impressões, alcance, cliques, CTR, CPM, CPC, frequência e ações. ' +
        'Use breakdowns para segmentar por idade, gênero, país, plataforma ou dispositivo. ' +
        'Use level para agregar dados em nível de campanha ou ad set mesmo consultando uma conta.',
      inputSchema: z.object({
        object_id: z
          .string()
          .describe(
            'ID do objeto a consultar: conta (act_XXXX), campanha, ad set ou anúncio. ' +
            'Use act_XXXX para dados da conta completa.'
          ),
        ...InsightBaseSchema,
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ object_id, fields, date_preset, since, until, breakdowns, level, limit }) => {
      try {
        const endpoint = `${object_id}/insights`;
        const params = buildInsightParams({ fields, date_preset, since, until, breakdowns, level });

        const insights = await paginate<Insight>(endpoint, params, limit);

        const result = {
          object_id,
          period: date_preset || (since && until ? `${since} a ${until}` : 'last_30d'),
          total_rows: insights.length,
          summary: summarizeInsights(insights),
          data: insights,
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
    'meta_get_account_insights',
    {
      title: 'Resumo de Performance da Conta',
      description:
        'Retorna um resumo rápido de performance da conta de anúncio: ' +
        'total gasto, impressões, alcance, cliques, CTR médio, CPM e CPC. ' +
        'Pode agregar por campanha (level=campaign) para ver quais campanhas gastaram mais. ' +
        'Ideal para uma visão geral rápida do desempenho.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta. Usa META_AD_ACCOUNT_ID se omitido.'),
        ...InsightBaseSchema,
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, fields, date_preset, since, until, breakdowns, level, limit }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const params = buildInsightParams({
          fields,
          date_preset: date_preset || 'last_30d',
          since,
          until,
          breakdowns,
          level: level || 'account',
        });

        const insights = await paginate<Insight>(`${accountId}/insights`, params, limit);

        const result = {
          ad_account_id: accountId,
          period: date_preset || (since && until ? `${since} a ${until}` : 'last_30d'),
          level: level || 'account',
          total_rows: insights.length,
          summary: summarizeInsights(insights),
          data: insights,
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
    'meta_get_campaign_insights',
    {
      title: 'Métricas por Campanha',
      description:
        'Retorna métricas de performance de campanhas específicas ou de todas as campanhas de uma conta. ' +
        'Sempre agrega no nível de campanha. ' +
        'Útil para comparar performance entre campanhas e identificar as mais rentáveis.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta. Usa META_AD_ACCOUNT_ID se omitido.'),
        campaign_ids: z
          .array(z.string())
          .optional()
          .describe('IDs específicos de campanhas. Se omitido, retorna todas as campanhas da conta.'),
        ...InsightBaseSchema,
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, campaign_ids, fields, date_preset, since, until, breakdowns, level, limit }) => {
      try {
        const params = buildInsightParams({
          fields,
          date_preset: date_preset || 'last_30d',
          since,
          until,
          breakdowns,
          level: 'campaign',
        });

        let insights: Insight[];

        if (campaign_ids && campaign_ids.length > 0) {
          const allInsights: Insight[] = [];
          for (const campId of campaign_ids) {
            const data = await paginate<Insight>(`${campId}/insights`, { ...params, level: undefined }, Math.ceil(limit / campaign_ids.length));
            allInsights.push(...data);
          }
          insights = allInsights;
        } else {
          const accountId = resolveAccountId(ad_account_id);
          insights = await paginate<Insight>(`${accountId}/insights`, params, limit);
        }

        const result = {
          period: date_preset || (since && until ? `${since} a ${until}` : 'last_30d'),
          total_campaigns: insights.length,
          summary: summarizeInsights(insights),
          campaigns: insights
            .sort((a, b) => parseFloat(b.spend || '0') - parseFloat(a.spend || '0'))
            .map((i) => ({
              campaign_id: i.campaign_id,
              campaign_name: i.campaign_name,
              spend: i.spend ? parseFloat(i.spend).toFixed(2) : '0.00',
              impressions: i.impressions || '0',
              reach: i.reach || '0',
              clicks: i.clicks || '0',
              ctr: i.ctr ? `${parseFloat(i.ctr).toFixed(2)}%` : '0%',
              cpm: i.cpm ? parseFloat(i.cpm).toFixed(2) : '0.00',
              cpc: i.cpc ? parseFloat(i.cpc).toFixed(2) : '0.00',
              frequency: i.frequency ? parseFloat(i.frequency).toFixed(2) : '0',
              actions: i.actions || [],
              date_start: i.date_start,
              date_stop: i.date_stop,
            })),
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
