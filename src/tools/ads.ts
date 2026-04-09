import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  makeRequest,
  paginate,
  handleApiError,
  normalizeAdAccountId,
  toJson,
} from '../client.js';
import { AD_FIELDS, AD_STATUSES, LIST_EFFECTIVE_STATUSES } from '../constants.js';
import type { Ad } from '../types.js';

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

export function registerAdTools(server: McpServer): void {
  server.registerTool(
    'meta_list_ads',
    {
      title: 'Listar Anúncios',
      description:
        'Lista anúncios de uma conta, campanha ou ad set específico. ' +
        'Retorna ID, nome, status, ad set pai, criativo e possíveis problemas de revisão. ' +
        'Filtre por campaign_id ou adset_id para ver anúncios de uma campanha/ad set específico.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        campaign_id: z
          .string()
          .optional()
          .describe('Filtrar por campanha específica.'),
        adset_id: z
          .string()
          .optional()
          .describe('Filtrar por ad set específico (tem precedência sobre campaign_id).'),
        status_filter: z
          .array(z.enum(LIST_EFFECTIVE_STATUSES))
          .optional()
          .describe('Filtrar por status. Ex: ["ACTIVE", "PAUSED"].'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Número máximo de anúncios (padrão: 50).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, campaign_id, adset_id, status_filter, limit }) => {
      try {
        let endpoint: string;
        if (adset_id) {
          endpoint = `${adset_id}/ads`;
        } else if (campaign_id) {
          endpoint = `${campaign_id}/ads`;
        } else {
          endpoint = `${resolveAccountId(ad_account_id)}/ads`;
        }

        const params: Record<string, unknown> = { fields: AD_FIELDS };
        if (status_filter && status_filter.length > 0) {
          params.effective_status = JSON.stringify(status_filter);
        }

        const ads = await paginate<Ad>(endpoint, params, limit);

        const result = {
          total: ads.length,
          ads: ads.map(formatAd),
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
    'meta_get_ad',
    {
      title: 'Detalhes do Anúncio',
      description:
        'Retorna detalhes completos de um anúncio: status, criativo, ad set pai, ' +
        'problemas de revisão e feedback. Útil para diagnosticar anúncios reprovados.',
      inputSchema: z.object({
        ad_id: z.string().describe('ID do anúncio.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_id }) => {
      try {
        const ad = await makeRequest<Ad>(ad_id, 'GET', { fields: AD_FIELDS });

        return {
          content: [{ type: 'text' as const, text: toJson(formatAd(ad)) }],
          structuredContent: formatAd(ad),
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
    'meta_create_ad',
    {
      title: 'Criar Anúncio',
      description:
        'Cria um novo anúncio dentro de um ad set. ' +
        'O campo creative aceita: {"creative_id": "ID_DO_CRIATIVO"} para usar um criativo existente, ' +
        'ou um objeto com object_story_spec para criativo inline. ' +
        'Para criar um criativo inline básico use: ' +
        '{"object_story_spec":{"page_id":"PAGE_ID","link_data":{"link":"URL","message":"Texto","name":"Título","description":"Descrição","call_to_action":{"type":"LEARN_MORE"}}}}',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        adset_id: z
          .string()
          .describe('ID do ad set pai onde o anúncio será criado.'),
        name: z
          .string()
          .min(1)
          .max(400)
          .describe('Nome do anúncio (ex: "Anúncio Link - Imóvel SP - v1").'),
        creative: z
          .string()
          .describe(
            'JSON do criativo. Use {"creative_id":"EXISTING_ID"} para reutilizar um criativo, ' +
            'ou forneça um objeto com object_story_spec para criar inline. ' +
            'Exemplo com criativo existente: {"creative_id":"120210000000000000"}'
          ),
        status: z
          .enum(['ACTIVE', 'PAUSED'])
          .default('PAUSED')
          .describe('Status inicial do anúncio.'),
        bid_amount: z
          .number()
          .int()
          .optional()
          .describe('Valor do lance em centavos (sobrescreve o lance do ad set).'),
        conversion_domain: z
          .string()
          .optional()
          .describe('Domínio de conversão (ex: "seusite.com.br").'),
        tracking_specs: z
          .string()
          .optional()
          .describe('JSON de especificações de rastreamento.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, adset_id, name, creative, status, bid_amount, conversion_domain, tracking_specs }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);

        let creativeObj: unknown;
        try {
          creativeObj = JSON.parse(creative);
        } catch {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Erro: O campo creative deve ser um JSON válido.' }],
          };
        }

        const data: Record<string, unknown> = {
          name,
          adset_id,
          creative: creativeObj,
          status,
        };

        if (bid_amount !== undefined) data.bid_amount = bid_amount;
        if (conversion_domain) data.conversion_domain = conversion_domain;
        if (tracking_specs) {
          try {
            data.tracking_specs = JSON.parse(tracking_specs);
          } catch {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: 'Erro: tracking_specs deve ser um JSON válido.' }],
            };
          }
        }

        const response = await makeRequest<{ id: string }>(
          `${accountId}/ads`,
          'POST',
          {},
          data
        );

        const result = {
          success: true,
          ad_id: response.id,
          message: `Anúncio "${name}" criado com sucesso. ID: ${response.id}`,
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
    'meta_update_ad',
    {
      title: 'Atualizar Anúncio',
      description:
        'Atualiza um anúncio existente: nome, status, criativo ou bid. ' +
        'Forneça apenas os campos que deseja alterar.',
      inputSchema: z.object({
        ad_id: z.string().describe('ID do anúncio a atualizar.'),
        name: z.string().min(1).max(400).optional().describe('Novo nome.'),
        status: z.enum(AD_STATUSES).optional().describe('Novo status.'),
        creative: z
          .string()
          .optional()
          .describe('Novo JSON do criativo. Use {"creative_id":"ID"} para mudar o criativo.'),
        bid_amount: z.number().int().optional().describe('Novo valor de lance em centavos.'),
        conversion_domain: z.string().optional().describe('Novo domínio de conversão.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_id, name, status, creative, bid_amount, conversion_domain }) => {
      try {
        const data: Record<string, unknown> = {};
        if (name !== undefined) data.name = name;
        if (status !== undefined) data.status = status;
        if (bid_amount !== undefined) data.bid_amount = bid_amount;
        if (conversion_domain !== undefined) data.conversion_domain = conversion_domain;

        if (creative !== undefined) {
          try {
            data.creative = JSON.parse(creative);
          } catch {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: 'Erro: creative deve ser um JSON válido.' }],
            };
          }
        }

        if (Object.keys(data).length === 0) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Erro: Nenhum campo para atualizar fornecido.' }],
          };
        }

        await makeRequest<{ success: boolean }>(ad_id, 'POST', {}, data);

        const result = {
          success: true,
          ad_id,
          updated_fields: Object.keys(data),
          message: `Anúncio ${ad_id} atualizado com sucesso.`,
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
    'meta_delete_ad',
    {
      title: 'Deletar Anúncio',
      description:
        'Deleta um anúncio permanentemente. ' +
        'ATENÇÃO: Ação irreversível. Considere usar status ARCHIVED em vez de deletar.',
      inputSchema: z.object({
        ad_id: z.string().describe('ID do anúncio a deletar.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_id }) => {
      try {
        await makeRequest<{ success: boolean }>(ad_id, 'DELETE');

        const result = {
          success: true,
          ad_id,
          message: `Anúncio ${ad_id} deletado com sucesso.`,
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

function formatAd(a: Ad) {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    effective_status: a.effective_status,
    adset_id: a.adset_id,
    campaign_id: a.campaign_id || null,
    creative: a.creative || null,
    bid_amount: a.bid_amount || null,
    conversion_domain: a.conversion_domain || null,
    issues: a.issues_info?.map((i) => ({
      level: i.level,
      code: i.error_code,
      summary: i.error_summary,
      message: i.error_message,
    })) || [],
    review_feedback: a.ad_review_feedback || null,
    created_time: a.created_time,
    updated_time: a.updated_time,
  };
}
