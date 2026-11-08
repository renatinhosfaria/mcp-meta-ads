import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeRequest } from '../../client.js';
import { resolveIgUserId, resolvePageId } from '../../instagram/context.js';
import { graphId, igUserIdField, pageIdField, toolError, toolResult } from '../../instagram/tool-helpers.js';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

type IgAccount = { id: string; username?: string };

export function registerInstagramAccountTools(server: McpServer): void {
  server.registerTool(
    'meta_ig_get_profile',
    {
      title: 'Perfil do Instagram',
      description:
        'Obtém o perfil da conta profissional do Instagram: usuário, nome, biografia, site, foto, seguidores, seguindo e total de publicações.',
      inputSchema: z.object({ ig_user_id: igUserIdField }).strict(),
      annotations: readOnly,
    },
    async ({ ig_user_id }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const profile = await makeRequest<Record<string, unknown>>(ig, 'GET', {
          fields: 'id,username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count',
        });
        return toolResult(profile);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_list_accounts',
    {
      title: 'Listar Contas do Instagram',
      description:
        'Lista as contas do Instagram acessíveis: as contas da Business Manager (META_BUSINESS_ID) e a conta ligada à Página do Facebook, sem repetições.',
      inputSchema: z
        .object({
          business_id: graphId('ID da Business Manager. Padrão: META_BUSINESS_ID.').optional(),
          page_id: pageIdField,
        })
        .strict(),
      annotations: readOnly,
    },
    async ({ business_id, page_id }) => {
      try {
        const accounts = new Map<string, IgAccount>();
        const add = (a?: IgAccount) => {
          if (a?.id && !accounts.has(a.id)) accounts.set(a.id, a);
        };
        const business = business_id || process.env.META_BUSINESS_ID;
        if (business) {
          const res = await makeRequest<{ data?: IgAccount[] }>(`${business}/owned_instagram_accounts`, 'GET', {
            fields: 'id,username',
          });
          (res.data ?? []).forEach(add);
        }
        const page = page_id || process.env.META_PAGE_ID;
        if (page) {
          const res = await makeRequest<{ instagram_business_account?: IgAccount }>(resolvePageId(page), 'GET', {
            fields: 'instagram_business_account{id,username}',
          });
          add(res.instagram_business_account);
        }
        if (!business && !page) {
          throw new Error('Informe business_id/page_id ou configure META_BUSINESS_ID/META_PAGE_ID no ambiente.');
        }
        return toolResult({ total: accounts.size, accounts: [...accounts.values()] });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_publishing_limit',
    {
      title: 'Limite de Publicações do Instagram',
      description: 'Mostra o limite de publicações via API e quanto já foi usado nas últimas 24 horas.',
      inputSchema: z.object({ ig_user_id: igUserIdField }).strict(),
      annotations: readOnly,
    },
    async ({ ig_user_id }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const res = await makeRequest<Record<string, unknown>>(`${ig}/content_publishing_limit`, 'GET', {
          fields: 'config,quota_usage',
        });
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
