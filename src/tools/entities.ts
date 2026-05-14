import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  makeRequest,
  paginate,
  handleApiError,
  normalizeAdAccountId,
  toJson,
} from '../client.js';
import { CAMPAIGN_FIELDS, ADSET_FIELDS, AD_FIELDS, AD_STATUSES, LIST_EFFECTIVE_STATUSES } from '../constants.js';

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

export function registerEntityTools(server: McpServer): void {
  server.registerTool(
    'meta_get_ad_entities',
    {
      title: 'Listar Entidades de Anúncio',
      description:
        'Lista campanhas, ad sets ou anúncios de uma conta de anúncio em uma única chamada. ' +
        'Use entity_type para selecionar o tipo: "campaign", "adset" ou "ad". ' +
        'Permite filtrar por status e limitar os resultados.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio (ex: act_123456789). Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        entity_type: z
          .enum(['campaign', 'adset', 'ad'])
          .describe('Tipo de entidade a listar: "campaign", "adset" ou "ad".'),
        status_filter: z
          .array(z.enum(LIST_EFFECTIVE_STATUSES))
          .optional()
          .describe('Filtrar por status efetivo. Ex: ["ACTIVE", "PAUSED"].'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Número máximo de entidades (padrão: 50).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, entity_type, status_filter, limit }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);

        const endpointMap = {
          campaign: { path: 'campaigns', fields: CAMPAIGN_FIELDS },
          adset: { path: 'adsets', fields: ADSET_FIELDS },
          ad: { path: 'ads', fields: AD_FIELDS },
        };

        const { path, fields } = endpointMap[entity_type];
        const params: Record<string, unknown> = { fields };
        if (status_filter && status_filter.length > 0) {
          params.effective_status = JSON.stringify(status_filter);
        }

        const entities = await paginate<Record<string, unknown>>(
          `${accountId}/${path}`,
          params,
          limit
        );

        const result = {
          total: entities.length,
          entity_type,
          ad_account_id: accountId,
          entities,
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
    'meta_activate_entity',
    {
      title: 'Ativar Entidade de Anúncio',
      description:
        'Ativa (define status como ACTIVE) uma campanha, ad set ou anúncio pelo seu ID. ' +
        'Equivalente a chamar meta_update_campaign/adset/ad com status=ACTIVE, ' +
        'mas funciona com qualquer tipo de entidade sem precisar especificá-lo.',
      inputSchema: z.object({
        entity_id: z
          .string()
          .describe('ID da entidade a ativar (campanha, ad set ou anúncio).'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ entity_id }) => {
      try {
        await makeRequest<{ success: boolean }>(entity_id, 'POST', {}, { status: 'ACTIVE' });
        const result = {
          success: true,
          entity_id,
          status: 'ACTIVE',
          message: `Entidade ${entity_id} ativada com sucesso.`,
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
    'meta_update_entity',
    {
      title: 'Atualizar Entidade de Anúncio',
      description:
        'Atualiza qualquer campo de uma campanha, ad set ou anúncio pelo seu ID. ' +
        'Use quando quiser alterar campos sem precisar saber o tipo da entidade. ' +
        'Campos comuns: status (ACTIVE/PAUSED/ARCHIVED), name, daily_budget (em centavos), ' +
        'lifetime_budget (em centavos), bid_amount (em centavos), start_time, stop_time.',
      inputSchema: z.object({
        entity_id: z
          .string()
          .describe('ID da entidade a atualizar (campanha, ad set ou anúncio).'),
        status: z
          .enum(AD_STATUSES)
          .optional()
          .describe('Novo status: ACTIVE (ativar), PAUSED (pausar), ARCHIVED (arquivar).'),
        name: z
          .string()
          .min(1)
          .max(400)
          .optional()
          .describe('Novo nome da entidade.'),
        daily_budget: z
          .number()
          .int()
          .min(100)
          .optional()
          .describe('Novo orçamento diário em centavos.'),
        lifetime_budget: z
          .number()
          .int()
          .min(100)
          .optional()
          .describe('Novo orçamento total em centavos.'),
        bid_amount: z
          .number()
          .int()
          .optional()
          .describe('Novo valor de lance em centavos.'),
        start_time: z
          .string()
          .optional()
          .describe('Nova data/hora de início (ISO 8601).'),
        stop_time: z
          .string()
          .optional()
          .describe('Nova data/hora de término (ISO 8601).'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ entity_id, status, name, daily_budget, lifetime_budget, bid_amount, start_time, stop_time }) => {
      try {
        const data: Record<string, unknown> = {};
        if (status !== undefined) data.status = status;
        if (name !== undefined) data.name = name;
        if (daily_budget !== undefined) data.daily_budget = daily_budget;
        if (lifetime_budget !== undefined) data.lifetime_budget = lifetime_budget;
        if (bid_amount !== undefined) data.bid_amount = bid_amount;
        if (start_time !== undefined) data.start_time = start_time;
        if (stop_time !== undefined) data.stop_time = stop_time;

        if (Object.keys(data).length === 0) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Erro: Nenhum campo para atualizar fornecido.' }],
          };
        }

        await makeRequest<{ success: boolean }>(entity_id, 'POST', {}, data);

        const result = {
          success: true,
          entity_id,
          updated_fields: Object.keys(data),
          message: `Entidade ${entity_id} atualizada com sucesso.`,
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
