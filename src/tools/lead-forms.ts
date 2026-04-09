import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  handleApiError,
  makeRequest,
  paginate,
  toJson,
} from '../client.js';
import { LEAD_FIELDS, LEAD_FORM_FIELDS } from '../constants.js';
import type { Lead, LeadgenForm, MetaApiResponse } from '../types.js';

function flattenLeadFields(lead: Lead) {
  const fields = Object.fromEntries(
    (lead.field_data || []).map((field) => [field.name || 'unknown', field.values || []])
  );

  return {
    id: lead.id,
    created_time: lead.created_time || null,
    ad_id: lead.ad_id || null,
    form_id: lead.form_id || null,
    platform: lead.platform || null,
    is_organic: lead.is_organic ?? null,
    field_data: lead.field_data || [],
    fields,
  };
}

type LeadDownloadLoader = (
  endpoint: string,
  params: Record<string, unknown>,
  maxItems: number,
  options?: { accessToken?: string }
) => Promise<Lead[]>;

export async function loadLeadsForDownload(
  loader: LeadDownloadLoader,
  input: {
    form_id: string;
    page_access_token?: string;
    limit: number;
  }
): Promise<Lead[]> {
  return loader(
    `${input.form_id}/leads`,
    { fields: LEAD_FIELDS },
    input.limit,
    { accessToken: input.page_access_token }
  );
}

export function registerLeadFormTools(server: McpServer): void {
  server.registerTool(
    'meta_list_lead_forms',
    {
      title: 'Listar Lead Forms',
      description:
        'Lista formulários de leads nativos de uma página. ' +
        'Quando exigido pela Meta, informe page_access_token.',
      inputSchema: z.object({
        page_id: z.string().describe('ID da página que possui os formulários.'),
        page_access_token: z.string().optional().describe('Page Access Token quando necessário para a listagem.'),
        limit: z.number().int().min(1).max(500).default(50).describe('Número máximo de formulários.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ page_id, page_access_token, limit }) => {
      try {
        const forms = await paginate<LeadgenForm>(
          `${page_id}/leadgen_forms`,
          { fields: LEAD_FORM_FIELDS },
          limit,
          { accessToken: page_access_token }
        );

        const result = {
          total: forms.length,
          forms: forms.map(formatLeadForm),
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
    'meta_get_lead_form',
    {
      title: 'Detalhes do Lead Form',
      description: 'Retorna os detalhes completos de um formulário de leads.',
      inputSchema: z.object({
        form_id: z.string().describe('ID do formulário.'),
        page_access_token: z.string().optional().describe('Token opcional quando a operação exigir contexto de página.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ form_id, page_access_token }) => {
      try {
        const form = await makeRequest<LeadgenForm>(
          form_id,
          'GET',
          { fields: LEAD_FORM_FIELDS },
          undefined,
          { accessToken: page_access_token }
        );
        const result = formatLeadForm(form);

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
    'meta_list_form_leads',
    {
      title: 'Listar Leads do Formulário',
      description: 'Lista leads capturados por um formulário nativo da Meta.',
      inputSchema: z.object({
        form_id: z.string().describe('ID do formulário.'),
        page_access_token: z.string().optional().describe('Token opcional quando o ativo exigir contexto de página.'),
        limit: z.number().int().min(1).max(500).default(50).describe('Quantidade máxima de leads.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ form_id, page_access_token, limit }) => {
      try {
        const leads = await paginate<Lead>(
          `${form_id}/leads`,
          { fields: LEAD_FIELDS },
          limit,
          { accessToken: page_access_token }
        );

        const result = {
          total: leads.length,
          leads: leads.map(flattenLeadFields),
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
    'meta_get_lead',
    {
      title: 'Detalhes do Lead',
      description: 'Retorna um lead individual pelo seu ID.',
      inputSchema: z.object({
        lead_id: z.string().describe('ID do lead.'),
        page_access_token: z.string().optional().describe('Token opcional quando necessário.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ lead_id, page_access_token }) => {
      try {
        const lead = await makeRequest<Lead>(
          lead_id,
          'GET',
          { fields: LEAD_FIELDS },
          undefined,
          { accessToken: page_access_token }
        );

        const result = flattenLeadFields(lead);
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
    'meta_download_form_leads',
    {
      title: 'Baixar Leads do Formulário',
      description: 'Baixa leads do formulário em formato estruturado e CSV simples.',
      inputSchema: z.object({
        form_id: z.string().describe('ID do formulário.'),
        page_access_token: z.string().optional().describe('Token opcional quando necessário.'),
        limit: z.number().int().min(1).max(500).default(200).describe('Quantidade máxima de leads a baixar.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ form_id, page_access_token, limit }) => {
      try {
        const paginatedLeads = await loadLeadsForDownload(paginate, {
          form_id,
          page_access_token,
          limit,
        });
        const leads = paginatedLeads.map(flattenLeadFields);
        const csv = buildLeadCsv(leads);
        const result = {
          total: leads.length,
          leads,
          csv,
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

function formatLeadForm(form: LeadgenForm) {
  return {
    id: form.id,
    name: form.name || null,
    status: form.status || null,
    locale: form.locale || null,
    follow_up_action_url: form.follow_up_action_url || null,
    questions: form.questions || [],
    tracking_parameters: form.tracking_parameters || [],
    context_card: form.context_card || null,
  };
}

function buildLeadCsv(leads: Array<ReturnType<typeof flattenLeadFields>>) {
  const dynamicFields = new Set<string>();
  for (const lead of leads) {
    for (const key of Object.keys(lead.fields)) {
      dynamicFields.add(key);
    }
  }

  const headers = ['id', 'created_time', 'ad_id', 'form_id', 'platform', 'is_organic', ...dynamicFields];
  const rows = leads.map((lead) =>
    headers.map((header) => {
      const value = header in lead.fields ? lead.fields[header].join(' | ') : (lead as Record<string, unknown>)[header];
      const serialized = value === undefined || value === null ? '' : String(value);
      return `"${serialized.replaceAll('"', '""')}"`;
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}
