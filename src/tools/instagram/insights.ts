import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeRequest } from '../../client.js';
import { resolveIgUserId } from '../../instagram/context.js';
import { igUserIdField, toolError, toolResult } from '../../instagram/tool-helpers.js';
import { toUnix } from './media.js';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const ACCOUNT_METRICS =
  'reach,views,accounts_engaged,total_interactions,likes,comments,shares,saves,replies,follows_and_unfollows,profile_links_taps';
const FEED_METRICS = 'reach,views,likes,comments,shares,saved,total_interactions,profile_visits,follows';
const REELS_METRICS =
  'reach,views,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time';
const STORY_METRICS = 'reach,views,replies,shares,total_interactions,navigation,follows,profile_visits';

const DAY = 86400;
const MAX_RANGE_DAYS = 30;

export function defaultMediaMetrics(mediaProductType: string, _mediaType: string): string[] {
  const product = mediaProductType.toUpperCase();
  if (product === 'REELS') return REELS_METRICS.split(',');
  if (product === 'STORY') return STORY_METRICS.split(',');
  return FEED_METRICS.split(',');
}

export function registerInstagramInsightTools(server: McpServer): void {
  server.registerTool(
    'meta_ig_get_account_insights',
    {
      title: 'Métricas da Conta do Instagram',
      description:
        'Obtém métricas agregadas da conta do Instagram (alcance, visualizações, interações etc.) em um período de até 30 dias. Padrão: últimos 7 dias. Datas no formato YYYY-MM-DD, em UTC; a data final é inclusiva.',
      inputSchema: z
        .object({
          ig_user_id: igUserIdField,
          metrics: z.array(z.string().min(1)).optional().describe('Métricas desejadas. Padrão: conjunto principal de métricas da conta.'),
          since: z.string().optional().describe('Data inicial YYYY-MM-DD.'),
          until: z.string().optional().describe('Data final YYYY-MM-DD.'),
          breakdown: z.string().optional().describe('Quebra opcional (ex.: media_product_type, follow_type).'),
        })
        .strict(),
      annotations: readOnly,
    },
    async ({ ig_user_id, metrics, since, until, breakdown }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const now = Math.floor(Date.now() / 1000);
        let u = toUnix(until, 'until') ?? now;
        // Data sem hora (YYYY-MM-DD) é inclusiva: vira 00:00 UTC do dia seguinte.
        if (until && /^\d{4}-\d{2}-\d{2}$/.test(until.trim())) u += DAY;
        const s = toUnix(since, 'since') ?? u - 7 * DAY;
        if (s >= u) throw new Error('Intervalo inválido: since deve ser anterior a until.');
        if (u - s > MAX_RANGE_DAYS * DAY) throw new Error('Intervalo inválido: o período máximo é de 30 dias.');
        const params: Record<string, unknown> = {
          metric: metrics?.length ? metrics.join(',') : ACCOUNT_METRICS,
          period: 'day',
          metric_type: 'total_value',
          since: s,
          until: u,
        };
        if (breakdown) params.breakdown = breakdown;
        const res = await makeRequest<Record<string, unknown>>(`${ig}/insights`, 'GET', params);
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_follower_demographics',
    {
      title: 'Demografia da Audiência',
      description:
        'Obtém a demografia dos seguidores (ou da audiência engajada, com audience=engaged) por idade, gênero, cidade ou país.',
      inputSchema: z
        .object({
          ig_user_id: igUserIdField,
          breakdown: z.enum(['age', 'gender', 'city', 'country']).describe('Dimensão da quebra.'),
          audience: z.enum(['followers', 'engaged']).optional().describe('followers (padrão) ou engaged.'),
          timeframe: z.string().optional().describe('Janela de tempo (padrão this_month; ex.: last_30_days, last_90_days).'),
        })
        .strict(),
      annotations: readOnly,
    },
    async ({ ig_user_id, breakdown, audience, timeframe }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const res = await makeRequest<Record<string, unknown>>(`${ig}/insights`, 'GET', {
          metric: audience === 'engaged' ? 'engaged_audience_demographics' : 'follower_demographics',
          period: 'lifetime',
          metric_type: 'total_value',
          timeframe: timeframe ?? 'this_month',
          breakdown,
        });
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_media_insights',
    {
      title: 'Métricas de uma Publicação',
      description:
        'Obtém métricas de uma publicação do Instagram. Sem "metrics", escolhe o conjunto padrão conforme o tipo (feed/carrossel, reels ou story).',
      inputSchema: z
        .object({
          media_id: z.string().regex(/^\d+$/, 'O ID da mídia deve conter apenas dígitos.').describe('ID da mídia.'),
          metrics: z.array(z.string().min(1)).optional().describe('Métricas desejadas; substitui o padrão.'),
        })
        .strict(),
      annotations: readOnly,
    },
    async ({ media_id, metrics }) => {
      try {
        let metric: string;
        if (metrics?.length) {
          metric = metrics.join(',');
        } else {
          const info = await makeRequest<{ media_type?: string; media_product_type?: string }>(media_id, 'GET', {
            fields: 'media_type,media_product_type',
          });
          metric = defaultMediaMetrics(info.media_product_type ?? 'FEED', info.media_type ?? '').join(',');
        }
        const res = await makeRequest<Record<string, unknown>>(`${media_id}/insights`, 'GET', { metric });
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
