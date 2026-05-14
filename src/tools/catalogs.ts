import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  makeRequest,
  paginate,
  handleApiError,
  toJson,
} from '../client.js';

const CATALOG_FIELDS = 'id,name,vertical,product_count,da_display_settings,default_image_url,business';
const PRODUCT_FIELDS = 'id,retailer_id,name,description,price,sale_price,currency,availability,condition,category,image_url,url,product_type,brand,additional_image_urls';
const FEED_FIELDS = 'id,name,schedule,created_time,product_count,latest_upload';
const PRODUCT_SET_FIELDS = 'id,name,filter,product_count,retailer_id';

function resolveBusinessId(business_id?: string): string {
  const id = business_id || process.env.META_BUSINESS_ID;
  if (!id) throw new Error('Informe business_id ou configure META_BUSINESS_ID no .env');
  return id;
}

export function registerCatalogTools(server: McpServer): void {
  server.registerTool(
    'meta_catalog_create',
    {
      title: 'Criar Catálogo de Produtos',
      description:
        'Cria um novo Catálogo de Produtos no Business Manager. ' +
        'O catálogo é o contêiner principal para produtos usados em anúncios de catálogo (DPA). ' +
        'Verticais disponíveis: commerce (padrão), vehicles, real_estate, flights, hotels, home_listings.',
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .max(200)
          .describe('Nome do catálogo (ex: "Catálogo Imóveis SP").'),
        vertical: z
          .enum(['commerce', 'vehicles', 'real_estate', 'flights', 'hotels', 'home_listings'])
          .default('commerce')
          .describe('Vertical do catálogo. Use "real_estate" para imóveis.'),
        business_id: z
          .string()
          .optional()
          .describe('ID do Business Manager. Usa META_BUSINESS_ID do .env se omitido.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, vertical, business_id }) => {
      try {
        const bid = resolveBusinessId(business_id);
        const response = await makeRequest<{ id: string }>(
          `${bid}/owned_product_catalogs`,
          'POST',
          {},
          { name, vertical }
        );
        const result = {
          success: true,
          catalog_id: response.id,
          message: `Catálogo "${name}" criado com sucesso. ID: ${response.id}`,
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
    'meta_catalog_get_catalogs',
    {
      title: 'Listar Catálogos de Produtos',
      description:
        'Lista todos os Catálogos de Produtos de um Business Manager. ' +
        'Retorna ID, nome, vertical, contagem de produtos e configurações de exibição. ' +
        'Use para descobrir os catálogos disponíveis antes de criar campanhas de catálogo (DPA).',
      inputSchema: z.object({
        business_id: z
          .string()
          .optional()
          .describe('ID do Business Manager. Usa META_BUSINESS_ID do .env se omitido.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Número máximo de catálogos (padrão: 20).'),
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
        const catalogs = await paginate<Record<string, unknown>>(
          `${bid}/owned_product_catalogs`,
          { fields: CATALOG_FIELDS },
          limit
        );
        const result = { total: catalogs.length, business_id: bid, catalogs };
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
    'meta_catalog_get_details',
    {
      title: 'Detalhes do Catálogo de Produtos',
      description:
        'Retorna detalhes completos de um Catálogo de Produtos: ' +
        'nome, vertical, contagem de produtos, configurações de exibição e business vinculado.',
      inputSchema: z.object({
        catalog_id: z
          .string()
          .describe('ID do catálogo de produtos.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ catalog_id }) => {
      try {
        const catalog = await makeRequest<Record<string, unknown>>(
          catalog_id,
          'GET',
          { fields: CATALOG_FIELDS }
        );
        return {
          content: [{ type: 'text' as const, text: toJson(catalog) }],
          structuredContent: catalog,
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    'meta_catalog_get_diagnostics',
    {
      title: 'Diagnóstico do Catálogo de Produtos',
      description:
        'Retorna erros e avisos de um Catálogo de Produtos: ' +
        'produtos rejeitados, campos obrigatórios ausentes, problemas de imagem e erros de feed. ' +
        'Use para identificar e corrigir problemas que impedem produtos de aparecer em anúncios.',
      inputSchema: z.object({
        catalog_id: z
          .string()
          .describe('ID do catálogo de produtos.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ catalog_id }) => {
      try {
        type DiagnosticsResponse = { data: unknown[] };
        const response = await makeRequest<DiagnosticsResponse>(
          `${catalog_id}/diagnostics`,
          'GET',
          { fields: 'affected_channels,affected_features,affected_entities,diagnostics' }
        );
        const result = { catalog_id, diagnostics: response.data || [] };
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
    'meta_catalog_get_feed_rules',
    {
      title: 'Regras do Feed de Produtos',
      description:
        'Retorna as regras de transformação de um feed de produtos de catálogo. ' +
        'Regras de feed permitem mapear, renomear e transformar campos ao importar produtos. ' +
        'Forneça o feed_id (obtido via meta_catalog_get_product_feed_details).',
      inputSchema: z.object({
        feed_id: z
          .string()
          .describe('ID do feed de produtos.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ feed_id }) => {
      try {
        type RulesResponse = { data: unknown[] };
        const response = await makeRequest<RulesResponse>(
          `${feed_id}/rules`,
          'GET',
          { fields: 'attribute,params,rule_type' }
        );
        const result = { feed_id, rules: response.data || [] };
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
    'meta_catalog_get_products',
    {
      title: 'Listar Produtos do Catálogo',
      description:
        'Lista produtos de um Catálogo de Produtos. ' +
        'Retorna ID, nome, preço, disponibilidade, categoria, URL da imagem e URL do produto. ' +
        'Use filter_by para filtrar por disponibilidade ou condição.',
      inputSchema: z.object({
        catalog_id: z
          .string()
          .describe('ID do catálogo de produtos.'),
        filter_by: z
          .string()
          .optional()
          .describe('Filtro em formato JSON (ex: \'{"availability":{"i_contains":"in stock"}}\').'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Número máximo de produtos (padrão: 50).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ catalog_id, filter_by, limit }) => {
      try {
        const params: Record<string, unknown> = { fields: PRODUCT_FIELDS };
        if (filter_by) params.filter_by = filter_by;

        const products = await paginate<Record<string, unknown>>(
          `${catalog_id}/products`,
          params,
          limit
        );
        const result = { total: products.length, catalog_id, products };
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
    'meta_catalog_get_product_details',
    {
      title: 'Detalhes de Produto do Catálogo',
      description:
        'Retorna todos os campos de um produto específico do catálogo: ' +
        'nome, descrição, preço, preço promocional, disponibilidade, condição, ' +
        'categoria, URLs de imagem e URL do produto.',
      inputSchema: z.object({
        product_id: z
          .string()
          .describe('ID do produto (product item ID).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ product_id }) => {
      try {
        const product = await makeRequest<Record<string, unknown>>(
          product_id,
          'GET',
          { fields: PRODUCT_FIELDS }
        );
        return {
          content: [{ type: 'text' as const, text: toJson(product) }],
          structuredContent: product,
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    'meta_catalog_get_product_feed_details',
    {
      title: 'Feeds de Produtos do Catálogo',
      description:
        'Lista os feeds de produtos de um catálogo: nome, agendamento de importação, ' +
        'data de criação e contagem de produtos. ' +
        'Use para verificar quando o feed foi atualizado e quantos produtos foram importados.',
      inputSchema: z.object({
        catalog_id: z
          .string()
          .describe('ID do catálogo de produtos.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Número máximo de feeds (padrão: 10).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ catalog_id, limit }) => {
      try {
        const feeds = await paginate<Record<string, unknown>>(
          `${catalog_id}/product_feeds`,
          { fields: FEED_FIELDS },
          limit
        );
        const result = { total: feeds.length, catalog_id, feeds };
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
    'meta_catalog_get_product_sets',
    {
      title: 'Conjuntos de Produtos do Catálogo',
      description:
        'Lista os conjuntos de produtos (Product Sets) de um catálogo. ' +
        'Product Sets são subconjuntos filtrados de produtos usados em ad sets de catálogo. ' +
        'Retorna ID, nome, filtro aplicado e contagem de produtos.',
      inputSchema: z.object({
        catalog_id: z
          .string()
          .describe('ID do catálogo de produtos.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Número máximo de conjuntos (padrão: 20).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ catalog_id, limit }) => {
      try {
        const sets = await paginate<Record<string, unknown>>(
          `${catalog_id}/product_sets`,
          { fields: PRODUCT_SET_FIELDS },
          limit
        );
        const result = { total: sets.length, catalog_id, product_sets: sets };
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
    'meta_catalog_get_product_set_products',
    {
      title: 'Produtos de um Conjunto de Produtos',
      description:
        'Lista os produtos de um Product Set específico de catálogo. ' +
        'Retorna ID, nome, preço, disponibilidade e URL da imagem dos produtos no conjunto.',
      inputSchema: z.object({
        product_set_id: z
          .string()
          .describe('ID do conjunto de produtos (Product Set).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Número máximo de produtos (padrão: 50).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ product_set_id, limit }) => {
      try {
        const products = await paginate<Record<string, unknown>>(
          `${product_set_id}/products`,
          { fields: PRODUCT_FIELDS },
          limit
        );
        const result = { total: products.length, product_set_id, products };
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
