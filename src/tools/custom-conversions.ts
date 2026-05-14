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

const CUSTOM_CONVERSION_FIELDS = [
  'id', 'name', 'description', 'rule', 'pixel',
  'event_source_type', 'custom_event_type', 'retention_days',
  'creation_time', 'last_fired_time', 'stats',
].join(',');

const CUSTOM_EVENT_TYPES = [
  'ADD_PAYMENT_INFO', 'ADD_TO_CART', 'ADD_TO_WISHLIST',
  'COMPLETE_REGISTRATION', 'CONTACT', 'CUSTOMIZE_PRODUCT',
  'DONATE', 'FIND_LOCATION', 'INITIATE_CHECKOUT',
  'LEAD', 'PURCHASE', 'SCHEDULE', 'SEARCH',
  'START_TRIAL', 'SUBMIT_APPLICATION', 'SUBSCRIBE',
  'VIEW_CONTENT', 'OTHER',
] as const;

export function registerCustomConversionTools(server: McpServer): void {
  server.registerTool(
    'meta_list_custom_conversions',
    {
      title: 'Listar Conversões Personalizadas',
      description:
        'Lista todas as conversões personalizadas (Custom Conversions) de uma conta de anúncio. ' +
        'Conversões personalizadas são eventos de pixel com regras de URL ou de parâmetro específicas, ' +
        'usadas para medir ações mais granulares que os eventos padrão do pixel.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Número máximo de conversões (padrão: 25).'),
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
        const conversions = await paginate<Record<string, unknown>>(
          `${accountId}/customconversions`,
          { fields: CUSTOM_CONVERSION_FIELDS },
          limit
        );
        const result = { total: conversions.length, ad_account_id: accountId, custom_conversions: conversions };
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
    'meta_create_custom_conversion',
    {
      title: 'Criar Conversão Personalizada',
      description:
        'Cria uma conversão personalizada baseada em uma regra de URL ou parâmetro de evento do pixel. ' +
        'Exemplo: disparar "Lead Qualificado" quando o usuário visita /obrigado e o valor > R$100. ' +
        'custom_event_type define o tipo padrão mais próximo (LEAD, PURCHASE, etc.).',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        name: z
          .string()
          .min(1)
          .max(200)
          .describe('Nome da conversão (ex: "Lead Qualificado - Imóveis Acima 500k").'),
        pixel_id: z
          .string()
          .describe('ID do Pixel do Meta associado a esta conversão.'),
        rule: z
          .string()
          .describe(
            'JSON com a regra de disparo. Exemplo por URL: ' +
            '\'{"and":[{"operator":"i_contains","property":"url","value":"/obrigado"}]}\'. ' +
            'Por evento: \'{"and":[{"operator":"eq","property":"event","value":"Purchase"},{"operator":"gt","property":"value","value":500}]}\'.'
          ),
        custom_event_type: z
          .enum(CUSTOM_EVENT_TYPES)
          .default('LEAD')
          .describe('Tipo de evento padrão mais próximo (define como o Meta categoriza a conversão).'),
        description: z
          .string()
          .optional()
          .describe('Descrição opcional da conversão.'),
        retention_days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .default(30)
          .describe('Janela de atribuição em dias (padrão: 30).'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, name, pixel_id, rule, custom_event_type, description, retention_days }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const data: Record<string, unknown> = {
          name,
          pixel: pixel_id,
          rule,
          custom_event_type,
          retention_days,
        };
        if (description) data.description = description;

        const response = await makeRequest<{ id: string }>(
          `${accountId}/customconversions`,
          'POST',
          {},
          data
        );

        const result = {
          success: true,
          custom_conversion_id: response.id,
          message: `Conversão personalizada "${name}" criada. ID: ${response.id}`,
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
