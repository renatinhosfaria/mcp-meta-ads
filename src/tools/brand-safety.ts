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

export function registerBrandSafetyTools(server: McpServer): void {
  server.registerTool(
    'meta_list_publisher_block_lists',
    {
      title: 'Listar Block Lists de Publishers',
      description:
        'Lista as block lists de publishers (Brand Safety) da conta de anúncio. ' +
        'Block lists permitem impedir que seus anúncios apareçam em sites, canais ou apps específicos. ' +
        'Use para verificar quais publishers estão sendo bloqueados.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Número máximo de block lists (padrão: 10).'),
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
        const blockLists = await paginate<Record<string, unknown>>(
          `${accountId}/publisher_block_lists`,
          { fields: 'id,name,last_update_time,is_auto_blocking_on,owner_ad_account' },
          limit
        );
        const result = { total: blockLists.length, ad_account_id: accountId, publisher_block_lists: blockLists };
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
    'meta_create_publisher_block_list',
    {
      title: 'Criar Block List de Publishers',
      description:
        'Cria uma nova block list de publishers para Brand Safety. ' +
        'Após criar, associe a block list a um ad set via publisher_block_list_id no targeting. ' +
        'publishers_urls deve conter URLs de sites ou IDs de páginas/canais a bloquear.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        name: z
          .string()
          .min(1)
          .max(200)
          .describe('Nome da block list (ex: "Sites Impróprios - Imóveis").'),
        publishers_urls: z
          .array(z.string())
          .min(1)
          .describe('Lista de URLs de publishers a bloquear (ex: ["https://siteimpróprio.com"]).'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, name, publishers_urls }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const response = await makeRequest<{ id: string }>(
          `${accountId}/publisher_block_lists`,
          'POST',
          {},
          { name, publishers_urls }
        );
        const result = {
          success: true,
          block_list_id: response.id,
          message: `Block list "${name}" criada com ${publishers_urls.length} publisher(s). ID: ${response.id}`,
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
