import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeRequest, paginate } from '../../client.js';
import { resolveIgUserId } from '../../instagram/context.js';
import { igUserIdField, limitField, toolError, toolResult } from '../../instagram/tool-helpers.js';

export const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,is_comment_enabled,shortcode';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function toUnix(value: string | undefined, name: string): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`${name} inválido: use data ISO 8601 (ex.: 2026-01-31T00:00:00Z).`);
  return Math.floor(ms / 1000);
}

export function registerInstagramMediaTools(server: McpServer): void {
  server.registerTool(
    'meta_ig_list_media',
    {
      title: 'Listar Publicações do Instagram',
      description: 'Lista as publicações (feed, reels, carrosséis) da conta, com filtro opcional de período (since/until em ISO 8601).',
      inputSchema: z
        .object({
          ig_user_id: igUserIdField,
          since: z.string().optional().describe('Data inicial ISO 8601.'),
          until: z.string().optional().describe('Data final ISO 8601.'),
          limit: limitField(100, 25),
        })
        .strict(),
      annotations: readOnly,
    },
    async ({ ig_user_id, since, until, limit }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const params: Record<string, unknown> = { fields: MEDIA_FIELDS };
        const s = toUnix(since, 'since');
        const u = toUnix(until, 'until');
        if (s !== undefined) params.since = s;
        if (u !== undefined) params.until = u;
        const items = await paginate<Record<string, unknown>>(`${ig}/media`, params, limit);
        return toolResult({ total: items.length, media: items });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_media',
    {
      title: 'Detalhes da Publicação',
      description: 'Obtém os detalhes de uma publicação do Instagram, incluindo os itens filhos de carrosséis.',
      inputSchema: z.object({ media_id: z.string().min(1).describe('ID da mídia.') }).strict(),
      annotations: readOnly,
    },
    async ({ media_id }) => {
      try {
        const media = await makeRequest<Record<string, unknown>>(media_id, 'GET', {
          fields: `${MEDIA_FIELDS},children{id,media_type,media_url,thumbnail_url}`,
        });
        return toolResult(media);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_list_stories',
    {
      title: 'Listar Stories',
      description: 'Lista os stories ativos (últimas 24 horas) da conta.',
      inputSchema: z.object({ ig_user_id: igUserIdField, limit: limitField(100, 25) }).strict(),
      annotations: readOnly,
    },
    async ({ ig_user_id, limit }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const items = await paginate<Record<string, unknown>>(`${ig}/stories`, { fields: MEDIA_FIELDS }, limit);
        return toolResult({ total: items.length, stories: items });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_list_tagged_media',
    {
      title: 'Publicações Marcadas',
      description: 'Lista as publicações de outras contas em que esta conta foi marcada.',
      inputSchema: z.object({ ig_user_id: igUserIdField, limit: limitField(100, 25) }).strict(),
      annotations: readOnly,
    },
    async ({ ig_user_id, limit }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const items = await paginate<Record<string, unknown>>(
          `${ig}/tags`,
          { fields: 'id,caption,media_type,permalink,timestamp,username' },
          limit
        );
        return toolResult({ total: items.length, media: items });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_set_comments_enabled',
    {
      title: 'Ativar/Desativar Comentários',
      description: 'Ativa ou desativa os comentários de uma publicação do Instagram.',
      inputSchema: z
        .object({
          media_id: z.string().min(1).describe('ID da mídia.'),
          enabled: z.boolean().describe('true para ativar, false para desativar os comentários.'),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ media_id, enabled }) => {
      try {
        const res = await makeRequest<Record<string, unknown>>(media_id, 'POST', {}, { comment_enabled: enabled });
        return toolResult({ media_id, comment_enabled: enabled, result: res });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_delete_media',
    {
      title: 'Excluir Publicação',
      description:
        'Exclui permanentemente uma publicação do Instagram (feed, reel, story ou carrossel inteiro; não funciona para anúncios nem para itens individuais de carrossel). Irreversível.',
      inputSchema: z.object({ media_id: z.string().min(1).describe('ID da mídia (no carrossel, o ID do contêiner).') }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ media_id }) => {
      try {
        const res = await makeRequest<Record<string, unknown>>(media_id, 'DELETE');
        return toolResult({ media_id, result: res });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
