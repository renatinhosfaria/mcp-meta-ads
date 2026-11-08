import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeRequest, paginate } from '../../client.js';
import { resolveIgUserId } from '../../instagram/context.js';
import { graphIdSchema, igUserIdField, limitField, toolError, toolResult } from '../../instagram/tool-helpers.js';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const HASHTAG_MEDIA_FIELDS = 'id,caption,media_type,permalink,timestamp,like_count,comments_count';
const DISCOVERY_MEDIA_FIELDS = 'id,caption,media_type,permalink,timestamp,like_count,comments_count';
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

export function registerInstagramDiscoveryTools(server: McpServer): void {
  server.registerTool(
    'meta_ig_search_hashtag',
    {
      title: 'Buscar Hashtag',
      description:
        'Busca o ID de uma hashtag do Instagram. Atenção: a conta pode consultar no máximo 30 hashtags diferentes a cada 7 dias.',
      inputSchema: z.object({ ig_user_id: igUserIdField, query: z.string().min(1).describe('Hashtag, sem o #.') }).strict(),
      annotations: readOnly,
    },
    async ({ ig_user_id, query }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const res = await makeRequest<Record<string, unknown>>('ig_hashtag_search', 'GET', { user_id: ig, q: query });
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_hashtag_media',
    {
      title: 'Publicações de uma Hashtag',
      description: 'Lista as publicações mais populares (top) ou mais recentes (recent) de uma hashtag, a partir do ID obtido em meta_ig_search_hashtag.',
      inputSchema: z
        .object({
          ig_user_id: igUserIdField,
          hashtag_id: graphIdSchema.regex(/^\d+$/, 'hashtag_id inválido: use apenas dígitos.').describe('ID numérico da hashtag.'),
          edge: z.enum(['top', 'recent']).default('top').describe('top (padrão) ou recent.'),
          limit: limitField(50, 25),
        })
        .strict(),
      annotations: readOnly,
    },
    async ({ ig_user_id, hashtag_id, edge, limit }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const items = await paginate<Record<string, unknown>>(
          `${hashtag_id}/${edge === 'recent' ? 'recent_media' : 'top_media'}`,
          { user_id: ig, fields: HASHTAG_MEDIA_FIELDS },
          limit ?? 25
        );
        return toolResult({ total: items.length, media: items });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_business_discovery',
    {
      title: 'Descobrir Conta Comercial',
      description: 'Consulta dados públicos e publicações recentes de outra conta comercial/criador do Instagram pelo username.',
      inputSchema: z
        .object({
          ig_user_id: igUserIdField,
          username: z.string().describe('Username da conta alvo (sem @).'),
          limit: z.number().int().min(1).max(50).default(10).describe('Quantidade de publicações (1-50, padrão 10).'),
        })
        .strict(),
      annotations: readOnly,
    },
    async ({ ig_user_id, username, limit }) => {
      try {
        if (!USERNAME_RE.test(username)) throw new Error('username inválido: use apenas letras, números, ponto e sublinhado (até 30 caracteres).');
        const ig = resolveIgUserId(ig_user_id);
        const n = Math.min(Math.max(Math.trunc(limit ?? 10), 1), 50);
        const fields =
          `business_discovery.username(${username}){id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,` +
          `media.limit(${n}){${DISCOVERY_MEDIA_FIELDS}}}`;
        const res = await makeRequest<Record<string, unknown>>(ig, 'GET', { fields });
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
