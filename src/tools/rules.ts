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

const RULE_FIELDS = 'id,name,status,created_time,updated_time,schedule_spec,evaluation_spec,execution_spec';

export function registerRuleTools(server: McpServer): void {
  server.registerTool(
    'meta_list_ad_rules',
    {
      title: 'Listar Regras Automáticas',
      description:
        'Lista todas as regras automáticas (Automated Rules) de uma conta de anúncio. ' +
        'Regras automáticas executam ações como pausar anúncios, ajustar orçamentos ou enviar notificações ' +
        'quando condições de performance são atingidas (ex: CPA acima de R$50, CTR abaixo de 1%).',
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
          .describe('Número máximo de regras (padrão: 25).'),
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
        const rules = await paginate<Record<string, unknown>>(
          `${accountId}/adrules_library`,
          { fields: RULE_FIELDS },
          limit
        );
        const result = { total: rules.length, ad_account_id: accountId, rules };
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
    'meta_create_ad_rule',
    {
      title: 'Criar Regra Automática',
      description:
        'Cria uma regra automática que monitora métricas e executa ações automaticamente. ' +
        'Exemplos: pausar anúncio se CPA > R$80, aumentar orçamento 20% se ROAS > 3x, ' +
        'enviar notificação se CTR < 0.5%. ' +
        'evaluation_spec define a condição; execution_spec define a ação.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        name: z
          .string()
          .min(1)
          .max(200)
          .describe('Nome da regra (ex: "Pausar se CPA > R$80").'),
        evaluation_spec: z
          .string()
          .describe(
            'JSON com a condição de avaliação. Exemplo: ' +
            '\'{"evaluation_type":"SCHEDULE","schedule_spec":{"schedule_type":"DAILY"},"filters":[{"field":"cost_per_result","value":80,"operator":"GREATER_THAN","data_type":"NUMERIC"}]}\''
          ),
        execution_spec: z
          .string()
          .describe(
            'JSON com a ação a executar. Exemplo para pausar: \'{"execution_type":"PAUSE"}\'. ' +
            'Para notificação: \'{"execution_type":"NOTIFICATION","execution_options":[{"field":"MESSAGE","value":"Atenção: CPA alto!"}]}\'. ' +
            'Para ajustar orçamento: \'{"execution_type":"ADJUST_BUDGET","execution_options":[{"field":"BUDGET","value":1.2,"operator":"MULTIPLY"}]}\'.'
          ),
        status: z
          .enum(['ENABLED', 'DISABLED', 'DELETED'])
          .default('ENABLED')
          .describe('Status inicial da regra.'),
        schedule_spec: z
          .string()
          .optional()
          .describe('JSON com agendamento. Ex: \'{"schedule_type":"SEMI_HOURLY"}\' ou \'{"schedule_type":"DAILY"}\'.'),
        entity_type: z
          .enum(['ALL_ACTIVE_AD_SETS', 'ALL_ACTIVE_ADS', 'ALL_ACTIVE_CAMPAIGNS', 'ALL_ACTIVE_OBJECTS'])
          .default('ALL_ACTIVE_ADS')
          .describe('Tipo de entidade que a regra monitora.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, name, evaluation_spec, execution_spec, status, schedule_spec, entity_type }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);

        const data: Record<string, unknown> = {
          name,
          evaluation_spec,
          execution_spec,
          status,
          entity_type,
        };
        if (schedule_spec) data.schedule_spec = schedule_spec;

        const response = await makeRequest<{ id: string }>(
          `${accountId}/adrules_library`,
          'POST',
          {},
          data
        );

        const result = {
          success: true,
          rule_id: response.id,
          message: `Regra "${name}" criada com sucesso. ID: ${response.id}`,
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
    'meta_list_ad_rules_history',
    {
      title: 'Histórico de Execuções de Regras',
      description:
        'Lista o histórico de execuções das regras automáticas: quando cada regra foi avaliada, ' +
        'se a condição foi satisfeita e qual ação foi tomada (pausar, notificar, ajustar orçamento). ' +
        'Use para auditar quais ações automáticas ocorreram na conta.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        rule_id: z
          .string()
          .optional()
          .describe('Filtrar histórico de uma regra específica (opcional).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Número máximo de eventos (padrão: 25).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, rule_id, limit }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const params: Record<string, unknown> = {
          fields: 'id,rule_id,evaluation_spec,execution_spec,schedule_id,results,has_recommendations,is_muted,error_code',
        };
        if (rule_id) params.rule_id = rule_id;

        const history = await paginate<Record<string, unknown>>(
          `${accountId}/adrules_history`,
          params,
          limit
        );
        const result = { total: history.length, ad_account_id: accountId, history };
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
