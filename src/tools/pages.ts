import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  makeRequest,
  paginate,
  handleApiError,
  normalizeAdAccountId,
  toJson,
} from '../client.js';

const PAGE_FIELDS = 'id,name,category,fan_count,followers_count,verification_status,picture';

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

function resolveBusinessId(business_id?: string): string {
  const id = business_id || process.env.META_BUSINESS_ID;
  if (!id) throw new Error('Informe business_id ou configure META_BUSINESS_ID no .env');
  return id;
}

type Page = {
  id: string;
  name: string;
  category?: string;
  fan_count?: number;
  followers_count?: number;
  verification_status?: string;
  picture?: { data?: { url?: string } };
  access_token?: string;
};

function formatPage(p: Page) {
  return {
    id: p.id,
    name: p.name,
    category: p.category || null,
    fan_count: p.fan_count ?? null,
    followers_count: p.followers_count ?? null,
    verification_status: p.verification_status || null,
    picture_url: p.picture?.data?.url || null,
  };
}

export function registerPageTools(server: McpServer): void {
  server.registerTool(
    'meta_get_user_pages',
    {
      title: 'Páginas do Usuário',
      description:
        'Lista todas as Páginas do Facebook gerenciadas pelo usuário autenticado. ' +
        'Retorna ID, nome, categoria, fãs, seguidores e status de verificação. ' +
        'Use para descobrir quais páginas estão disponíveis para criar anúncios.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Número máximo de páginas a retornar (padrão: 50).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ limit }) => {
      try {
        const pages = await paginate<Page>('me/accounts', { fields: PAGE_FIELDS }, limit);
        const result = { total: pages.length, pages: pages.map(formatPage) };
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
    'meta_get_pages_for_business',
    {
      title: 'Páginas do Business Manager',
      description:
        'Lista todas as Páginas do Facebook pertencentes a um Business Manager. ' +
        'Retorna ID, nome, categoria, fãs e status de verificação. ' +
        'Útil para listar páginas disponíveis para vincular a campanhas de um negócio específico.',
      inputSchema: z.object({
        business_id: z
          .string()
          .optional()
          .describe('ID do Business Manager. Usa META_BUSINESS_ID do .env se omitido.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Número máximo de páginas (padrão: 50).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ business_id, limit }) => {
      try {
        const bid = resolveBusinessId(business_id);
        const pages = await paginate<Page>(`${bid}/owned_pages`, { fields: PAGE_FIELDS }, limit);
        const result = { total: pages.length, business_id: bid, pages: pages.map(formatPage) };
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
    'meta_get_ad_account_pages',
    {
      title: 'Páginas da Conta de Anúncio',
      description:
        'Lista as Páginas do Facebook associadas a uma conta de anúncio via seu Business Manager. ' +
        'Retorna as páginas disponíveis para uso em campanhas desta conta. ' +
        'A conta precisa estar vinculada a um Business Manager para retornar resultados.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio (ex: act_123456789). Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Número máximo de páginas (padrão: 50).'),
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

        // Resolve business linked to this ad account
        const account = await makeRequest<{ id: string; business?: { id: string; name: string } }>(
          accountId,
          'GET',
          { fields: 'id,business' }
        );

        if (!account.business?.id) {
          return {
            content: [{ type: 'text' as const, text: toJson({ total: 0, pages: [], note: 'Conta não vinculada a um Business Manager.' }) }],
            structuredContent: { total: 0, pages: [] },
          };
        }

        const bid = account.business.id;
        const pages = await paginate<Page>(`${bid}/owned_pages`, { fields: PAGE_FIELDS }, limit);
        const result = {
          total: pages.length,
          ad_account_id: accountId,
          business_id: bid,
          business_name: account.business.name,
          pages: pages.map(formatPage),
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
