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

const HELP_TOPICS: Record<string, { title: string; summary: string; tips: string[] }> = {
  pixel: {
    title: 'Pixel do Meta / CAPI',
    summary: 'O Pixel rastreia eventos no site. CAPI (Conversions API) envia eventos server-side.',
    tips: [
      'Use meta_get_dataset_quality para verificar qualidade dos eventos.',
      'Configure o EMQ (Event Match Quality) acima de 6.0 para melhores resultados.',
      'Priorize CAPI para contornar bloqueadores de cookies.',
    ],
  },
  budget: {
    title: 'Orçamentos de Campanha',
    summary: 'daily_budget define gasto diário; lifetime_budget define gasto total.',
    tips: [
      'Orçamentos são em centavos (R$50,00 = 5000).',
      'Não altere orçamentos mais de 20% em campanhas ativas sem perder aprendizado.',
      'CBO (Campaign Budget Optimization) distribui orçamento automaticamente entre ad sets.',
    ],
  },
  leads: {
    title: 'Formulários de Lead',
    summary: 'Lead Ads coletam dados sem sair do Facebook/Instagram.',
    tips: [
      'Use meta_list_lead_forms para ver formulários disponíveis.',
      'Use meta_download_form_leads para exportar leads.',
      'Formulários precisam de Page Access Token para acessar leads.',
    ],
  },
  audience: {
    title: 'Públicos Personalizados e Lookalike',
    summary: 'Custom Audiences targetam clientes existentes. Lookalike encontra pessoas similares.',
    tips: [
      'Use meta_create_custom_audience para criar públicos de lista de clientes.',
      'Lookalike funciona melhor com source audience de 1.000-50.000 pessoas.',
      'Públicos de website precisam de Pixel ativo com eventos suficientes.',
    ],
  },
  catalog: {
    title: 'Catálogo de Produtos (DPA)',
    summary: 'Dynamic Product Ads usam catálogos para mostrar produtos relevantes automaticamente.',
    tips: [
      'Use meta_catalog_get_diagnostics para verificar erros no catálogo.',
      'Mantenha imagens de produto com pelo menos 600x600px.',
      'Para imóveis, use vertical=real_estate.',
    ],
  },
};

export function registerRecommendationTools(server: McpServer): void {
  server.registerTool(
    'meta_get_errors',
    {
      title: 'Erros e Problemas de Anúncios',
      description:
        'Lista anúncios com problemas de entrega, rejeições de revisão ou issues de configuração. ' +
        'Retorna os anúncios com status WITH_ISSUES ou DISAPPROVED e o motivo de cada problema. ' +
        'Use para identificar e corrigir anúncios bloqueados.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .optional()
          .describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID do .env se omitido.'),
        include_campaigns: z
          .boolean()
          .default(false)
          .describe('Se true, inclui também campanhas com problemas além dos anúncios.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Número máximo de entidades com problemas (padrão: 25).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, include_campaigns, limit }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);

        const ads = await paginate<Record<string, unknown>>(
          `${accountId}/ads`,
          {
            fields: 'id,name,effective_status,issues_info,ad_review_feedback,adset_id,campaign_id',
            effective_status: JSON.stringify(['WITH_ISSUES', 'DISAPPROVED']),
          },
          limit
        );

        const result: Record<string, unknown> = {
          ad_account_id: accountId,
          total_ads_with_issues: ads.length,
          ads_with_issues: ads,
        };

        if (include_campaigns) {
          const campaigns = await paginate<Record<string, unknown>>(
            `${accountId}/campaigns`,
            {
              fields: 'id,name,effective_status,issues_info',
              effective_status: JSON.stringify(['WITH_ISSUES']),
            },
            limit
          );
          result.total_campaigns_with_issues = campaigns.length;
          result.campaigns_with_issues = campaigns;
        }

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
    'meta_get_help_article',
    {
      title: 'Artigo de Ajuda Meta Ads',
      description:
        'Retorna dicas e resumos sobre tópicos comuns do Meta Ads. ' +
        'Tópicos disponíveis: pixel, budget, leads, audience, catalog. ' +
        'Use para obter orientações rápidas sobre configuração e boas práticas.',
      inputSchema: z.object({
        topic: z
          .enum(['pixel', 'budget', 'leads', 'audience', 'catalog'])
          .describe('Tópico de ajuda: pixel, budget, leads, audience ou catalog.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ topic }) => {
      const article = HELP_TOPICS[topic];
      const result = {
        topic,
        title: article.title,
        summary: article.summary,
        tips: article.tips,
      };
      return {
        content: [{ type: 'text' as const, text: toJson(result) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    'meta_get_opportunity_score',
    {
      title: 'Score de Oportunidade / Recomendações',
      description:
        'Retorna recomendações automáticas da Meta para melhorar o desempenho de campanhas: ' +
        'aumentar orçamento, melhorar criativos, ajustar público, ativar otimizações, etc. ' +
        'Cada recomendação inclui o impacto estimado e as ações sugeridas.',
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
          .describe('Número máximo de recomendações (padrão: 10).'),
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

        const recommendations = await paginate<Record<string, unknown>>(
          `${accountId}/recommendations`,
          {
            fields: 'title,message,recommendation_type,importance,confidence,estimated_impact,schema',
          },
          limit
        );

        const result = {
          ad_account_id: accountId,
          total: recommendations.length,
          recommendations,
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
