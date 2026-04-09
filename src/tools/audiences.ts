import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  handleApiError,
  makeRequest,
  normalizeAdAccountId,
  paginate,
  parseJsonString,
  toJson,
} from '../client.js';
import { AUDIENCE_FIELDS, MAX_PAGINATE_ITEMS } from '../constants.js';
import type { CustomAudience, MetaApiResponse } from '../types.js';

function resolveAccountId(ad_account_id?: string): string {
  const id = ad_account_id || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
  return normalizeAdAccountId(id);
}

type AudienceUsersPayloadInput = {
  schema: string[];
  users: Array<Array<string | number>>;
  operation: 'add' | 'remove' | 'replace';
  is_raw?: boolean;
  data_source?: string;
  session?: {
    session_id: string;
    estimated_num_total?: number;
    batch_seq?: number;
    last_batch_flag?: boolean;
  };
};

type AudienceUsersPayload = {
  payload: {
    schema: string[];
    data: Array<Array<string | number>>;
    data_source?: string;
  };
  is_raw: boolean;
  session?: {
    session_id: string;
    estimated_num_total?: number;
    batch_seq?: number;
    last_batch_flag?: boolean;
  };
  endpointSuffix: 'users' | 'usersreplace';
  method: 'POST' | 'DELETE';
};

export function buildAudienceUsersPayload(input: AudienceUsersPayloadInput): AudienceUsersPayload {
  const payload: AudienceUsersPayload['payload'] = {
    schema: input.schema,
    data: input.users,
  };

  if (input.data_source) {
    payload.data_source = input.data_source;
  }

  const request: Omit<AudienceUsersPayload, 'endpointSuffix' | 'method'> = {
    payload,
    is_raw: input.is_raw ?? true,
  };

  if (input.session) {
    request.session = {
      session_id: input.session.session_id,
      ...(input.session.estimated_num_total !== undefined ? { estimated_num_total: input.session.estimated_num_total } : {}),
      ...(input.session.batch_seq !== undefined ? { batch_seq: input.session.batch_seq } : {}),
      ...(input.session.last_batch_flag !== undefined ? { last_batch_flag: input.session.last_batch_flag } : {}),
    };
  }

  return {
    ...request,
    endpointSuffix: input.operation === 'replace' ? 'usersreplace' : 'users',
    method: (input.operation === 'remove' ? 'DELETE' : 'POST') as 'POST' | 'DELETE',
  };
}

export function getAudiencePaginationLimit(subtypeFilter: string[] | undefined, requestedLimit: number): number {
  return subtypeFilter?.length ? MAX_PAGINATE_ITEMS : requestedLimit;
}

export function registerAudienceTools(server: McpServer): void {
  server.registerTool(
    'meta_list_audiences',
    {
      title: 'Listar Audiências',
      description: 'Lista custom audiences e lookalikes de uma conta de anúncios.',
      inputSchema: z.object({
        ad_account_id: z.string().optional().describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        subtype_filter: z.array(z.string()).optional().describe('Filtrar por subtype, ex: ["CUSTOM", "LOOKALIKE"].'),
        limit: z.number().int().min(1).max(500).default(50).describe('Número máximo de audiências.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, subtype_filter, limit }) => {
      try {
        const paginationLimit = getAudiencePaginationLimit(subtype_filter, limit);
        const audiences = await paginate<CustomAudience>(
          `${resolveAccountId(ad_account_id)}/customaudiences`,
          { fields: AUDIENCE_FIELDS },
          paginationLimit
        );

        const filtered = subtype_filter?.length
          ? audiences.filter((audience) => audience.subtype && subtype_filter.includes(audience.subtype))
          : audiences;
        const visibleAudiences = filtered.slice(0, limit);

        const result = {
          total: visibleAudiences.length,
          audiences: visibleAudiences.map(formatAudience),
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
    'meta_get_audience',
    {
      title: 'Detalhes da Audiência',
      description: 'Retorna detalhes completos de uma audiência da Meta.',
      inputSchema: z.object({
        audience_id: z.string().describe('ID da audiência.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ audience_id }) => {
      try {
        const audience = await makeRequest<CustomAudience>(audience_id, 'GET', { fields: AUDIENCE_FIELDS });
        const result = formatAudience(audience);

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
    'meta_create_custom_audience',
    {
      title: 'Criar Custom Audience',
      description:
        'Cria uma custom audience na conta de anúncios. ' +
        'Aceita remarketing por regra ou audiência baseada em CRM/data file.',
      inputSchema: z.object({
        ad_account_id: z.string().optional().describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        name: z.string().min(1).max(100).describe('Nome da audiência.'),
        subtype: z.string().default('CUSTOM').describe('Subtype da audiência, ex: CUSTOM, WEBSITE, ENGAGEMENT.'),
        description: z.string().optional().describe('Descrição interna da audiência.'),
        customer_file_source: z.enum(['USER_PROVIDED_ONLY', 'PARTNER_PROVIDED_ONLY', 'BOTH_USER_AND_PARTNER_PROVIDED']).optional(),
        retention_days: z.number().int().min(1).max(180).optional().describe('Janela de retenção quando aplicável.'),
        rule: z.string().optional().describe('JSON string da regra da audiência, usado em públicos de remarketing.'),
        prefill: z.boolean().optional().describe('Se true, preenche a audiência com histórico quando suportado.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, name, subtype, description, customer_file_source, retention_days, rule, prefill }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const data: Record<string, unknown> = {
          name,
          subtype,
        };

        if (description) data.description = description;
        if (customer_file_source) data.customer_file_source = customer_file_source;
        if (retention_days !== undefined) data.retention_days = retention_days;
        if (prefill !== undefined) data.prefill = prefill;
        if (rule) {
          data.rule = parseJsonString<Record<string, unknown>>(rule, 'rule');
        }

        const response = await makeRequest<{ id: string }>(`${accountId}/customaudiences`, 'POST', {}, data);
        const result = {
          success: true,
          audience_id: response.id,
          message: `Audiência "${name}" criada com sucesso. ID: ${response.id}`,
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
    'meta_create_lookalike_audience',
    {
      title: 'Criar Lookalike Audience',
      description: 'Cria uma audiência lookalike a partir de uma audiência seed existente.',
      inputSchema: z.object({
        ad_account_id: z.string().optional().describe('ID da conta de anúncio. Usa META_AD_ACCOUNT_ID se omitido.'),
        name: z.string().min(1).max(100).describe('Nome da lookalike audience.'),
        origin_audience_id: z.string().describe('ID da audiência seed/origem.'),
        country: z.string().min(2).max(2).describe('País da lookalike, ex: BR ou US.'),
        ratio: z.number().gt(0).lte(0.2).default(0.01).describe('Tamanho percentual da lookalike.'),
        lookalike_spec: z.string().optional().describe('JSON da lookalike_spec para cenários avançados.'),
        description: z.string().optional(),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id, name, origin_audience_id, country, ratio, lookalike_spec, description }) => {
      try {
        const accountId = resolveAccountId(ad_account_id);
        const data: Record<string, unknown> = {
          name,
          subtype: 'LOOKALIKE',
          origin_audience_id,
          lookalike_spec: lookalike_spec
            ? parseJsonString<Record<string, unknown>>(lookalike_spec, 'lookalike_spec')
            : {
                country,
                ratio,
              },
        };

        if (description) data.description = description;

        const response = await makeRequest<{ id: string }>(`${accountId}/customaudiences`, 'POST', {}, data);
        const result = {
          success: true,
          audience_id: response.id,
          message: `Lookalike "${name}" criada com sucesso. ID: ${response.id}`,
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
    'meta_update_audience',
    {
      title: 'Atualizar Audiência',
      description: 'Atualiza campos mutáveis de uma audiência existente.',
      inputSchema: z.object({
        audience_id: z.string().describe('ID da audiência.'),
        name: z.string().min(1).max(100).optional(),
        description: z.string().optional(),
        retention_days: z.number().int().min(1).max(180).optional(),
        rule: z.string().optional().describe('JSON da regra atualizado, quando suportado.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ audience_id, name, description, retention_days, rule }) => {
      try {
        const data: Record<string, unknown> = {};

        if (name !== undefined) data.name = name;
        if (description !== undefined) data.description = description;
        if (retention_days !== undefined) data.retention_days = retention_days;
        if (rule !== undefined) {
          data.rule = parseJsonString<Record<string, unknown>>(rule, 'rule');
        }

        const response = await makeRequest<{ success?: boolean }>(audience_id, 'POST', {}, data);
        const result = {
          success: response.success !== false,
          audience_id,
          message: `Audiência ${audience_id} atualizada com sucesso.`,
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
    'meta_delete_audience',
    {
      title: 'Excluir Audiência',
      description: 'Exclui uma audiência da Meta.',
      inputSchema: z.object({
        audience_id: z.string().describe('ID da audiência.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ audience_id }) => {
      try {
        const response = await makeRequest<{ success?: boolean }>(audience_id, 'DELETE');
        const result = {
          success: response.success !== false,
          audience_id,
          message: `Audiência ${audience_id} excluída com sucesso.`,
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

  const audienceUsersSchema = z.object({
    audience_id: z.string().describe('ID da audiência.'),
    schema: z.array(z.string()).min(1).describe('Schema de identificação da Meta, ex: ["EMAIL"].'),
    users: z.array(z.array(z.union([z.string(), z.number()]))).min(1).describe('Matriz de usuários já normalizados/hash quando aplicável.'),
    data_source: z.string().optional().describe('Origem dos dados enviada no payload.'),
    session_id: z.string().optional().describe('Session ID para upload em batches.'),
    estimated_num_total: z.number().int().positive().optional().describe('Total estimado de usuários da sessão.'),
    batch_seq: z.number().int().positive().optional().describe('Sequência do batch na sessão.'),
    last_batch_flag: z.boolean().optional().describe('Se true, marca este batch como o último da sessão.'),
  }).strict();

  server.registerTool(
    'meta_add_audience_users',
    {
      title: 'Adicionar Usuários à Audiência',
      description: 'Adiciona usuários a uma custom audience via payload da edge /users.',
      inputSchema: audienceUsersSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => handleAudienceUsersMutation(input, 'add')
  );

  server.registerTool(
    'meta_remove_audience_users',
    {
      title: 'Remover Usuários da Audiência',
      description: 'Remove usuários de uma custom audience via payload da edge /users.',
      inputSchema: audienceUsersSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => handleAudienceUsersMutation(input, 'remove')
  );

  server.registerTool(
    'meta_replace_audience_users',
    {
      title: 'Substituir Usuários da Audiência',
      description: 'Substitui membros de uma custom audience usando a edge /usersreplace.',
      inputSchema: audienceUsersSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => handleAudienceUsersMutation(input, 'replace')
  );
}

async function handleAudienceUsersMutation(
  input: {
    audience_id: string;
    schema: string[];
    users: Array<Array<string | number>>;
    data_source?: string;
    session_id?: string;
    estimated_num_total?: number;
    batch_seq?: number;
    last_batch_flag?: boolean;
  },
  operation: 'add' | 'remove' | 'replace'
) {
  try {
    const request = buildAudienceUsersPayload({
      schema: input.schema,
      users: input.users,
      operation,
      data_source: input.data_source,
      session: input.session_id
        ? {
            session_id: input.session_id,
            estimated_num_total: input.estimated_num_total,
            batch_seq: input.batch_seq,
            last_batch_flag: input.last_batch_flag,
          }
        : undefined,
    });

    const endpoint = `${input.audience_id}/${request.endpointSuffix}`;
    const response = await makeRequest<{ num_received?: number; num_invalid_entries?: number; invalid_entry_samples?: unknown[] }>(
      endpoint,
      request.method,
      {},
      {
        payload: JSON.stringify(request.payload),
        is_raw: request.is_raw,
        ...(request.session ? { session: request.session } : {}),
      }
    );

    const result = {
      success: true,
      audience_id: input.audience_id,
      operation,
      num_received: response.num_received ?? null,
      num_invalid_entries: response.num_invalid_entries ?? 0,
      invalid_entry_samples: response.invalid_entry_samples ?? [],
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

function formatAudience(audience: CustomAudience) {
  return {
    id: audience.id,
    name: audience.name,
    subtype: audience.subtype || null,
    description: audience.description || null,
    operation_status: audience.operation_status || null,
    time_created: audience.time_created || null,
    retention_days: audience.retention_days ?? null,
    customer_file_source: audience.customer_file_source || null,
    rule: audience.rule || null,
    lookalike_spec: audience.lookalike_spec || null,
    lookalike_audience_ids: audience.lookalike_audience_ids || [],
    approximate_count_lower_bound: audience.approximate_count_lower_bound ?? null,
    approximate_count_upper_bound: audience.approximate_count_upper_bound ?? null,
  };
}
