import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { handleApiError, makeRequest, parseJsonString, toJson } from '../client.js';
import type { CapiEvent, CapiEventResponse } from '../types.js';

type CapiPayloadInput = {
  data: Array<Record<string, unknown>>;
  test_event_code?: string;
  partner_agent?: string;
};

export function buildCapiPayload(input: CapiPayloadInput) {
  const events = input.data.map((event, index) => {
    if (!event.event_name) {
      throw new Error(`O evento na posição ${index} deve incluir event_name.`);
    }
    if (!event.event_time) {
      throw new Error(`O evento ${String(event.event_name)} deve incluir event_time.`);
    }

    return event as unknown as CapiEvent;
  });

  return {
    data: events,
    ...(input.test_event_code ? { test_event_code: input.test_event_code } : {}),
    ...(input.partner_agent ? { partner_agent: input.partner_agent } : {}),
  };
}

function buildSingleEventPayload(input: {
  event_name: string;
  event_time: number;
  action_source?: string;
  event_source_url?: string;
  event_id?: string;
  user_data?: string;
  custom_data?: string;
  data_processing_options?: string[];
  data_processing_options_country?: number;
  data_processing_options_state?: number;
  test_event_code?: string;
  partner_agent?: string;
}) {
  const event: Record<string, unknown> = {
    event_name: input.event_name,
    event_time: input.event_time,
  };

  if (input.action_source) event.action_source = input.action_source;
  if (input.event_source_url) event.event_source_url = input.event_source_url;
  if (input.event_id) event.event_id = input.event_id;
  if (input.user_data) event.user_data = parseJsonString<Record<string, unknown>>(input.user_data, 'user_data');
  if (input.custom_data) event.custom_data = parseJsonString<Record<string, unknown>>(input.custom_data, 'custom_data');
  if (input.data_processing_options) event.data_processing_options = input.data_processing_options;
  if (input.data_processing_options_country !== undefined) {
    event.data_processing_options_country = input.data_processing_options_country;
  }
  if (input.data_processing_options_state !== undefined) {
    event.data_processing_options_state = input.data_processing_options_state;
  }

  return buildCapiPayload({
    data: [event],
    test_event_code: input.test_event_code,
    partner_agent: input.partner_agent,
  });
}

export function registerConversionTools(server: McpServer): void {
  server.registerTool(
    'meta_send_conversion_event',
    {
      title: 'Enviar Evento CAPI',
      description: 'Envia um evento único para a Conversions API via pixel_id.',
      inputSchema: z.object({
        pixel_id: z.string().describe('ID do Pixel/Dataset para envio do evento.'),
        access_token: z.string().optional().describe('Access token opcional; usa META_ACCESS_TOKEN se omitido.'),
        event_name: z.string().min(1).describe('Nome do evento. Ex: Purchase, Lead, ViewContent.'),
        event_time: z.number().int().positive().describe('Timestamp unix do evento.'),
        action_source: z.string().optional().describe('Action source. Ex: website, system_generated.'),
        event_source_url: z.string().url().optional().describe('URL da origem do evento.'),
        event_id: z.string().optional().describe('Event ID para deduplicação.'),
        user_data: z.string().optional().describe('JSON de user_data.'),
        custom_data: z.string().optional().describe('JSON de custom_data.'),
        data_processing_options: z.array(z.string()).optional().describe('Opções de processamento de dados.'),
        data_processing_options_country: z.number().int().optional(),
        data_processing_options_state: z.number().int().optional(),
        test_event_code: z.string().optional().describe('Código de teste da Meta para validação do evento.'),
        partner_agent: z.string().optional().describe('Partner agent opcional.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ pixel_id, access_token, ...input }) => {
      try {
        const payload = buildSingleEventPayload(input);
        const response = await makeRequest<CapiEventResponse>(
          `${pixel_id}/events`,
          'POST',
          {},
          payload,
          { accessToken: access_token }
        );

        const result = {
          success: true,
          pixel_id,
          response,
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
    'meta_send_conversion_events_batch',
    {
      title: 'Enviar Batch de Eventos CAPI',
      description: 'Envia um batch de eventos para a Conversions API via pixel_id.',
      inputSchema: z.object({
        pixel_id: z.string().describe('ID do Pixel/Dataset.'),
        access_token: z.string().optional().describe('Access token opcional; usa META_ACCESS_TOKEN se omitido.'),
        events: z.string().describe('JSON array de eventos no formato da Conversions API.'),
        test_event_code: z.string().optional().describe('Código de teste da Meta.'),
        partner_agent: z.string().optional().describe('Partner agent opcional.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ pixel_id, access_token, events, test_event_code, partner_agent }) => {
      try {
        const payload = buildCapiPayload({
          data: parseJsonString<Array<Record<string, unknown>>>(events, 'events') || [],
          test_event_code,
          partner_agent,
        });

        const response = await makeRequest<CapiEventResponse>(
          `${pixel_id}/events`,
          'POST',
          {},
          payload,
          { accessToken: access_token }
        );

        const result = {
          success: true,
          pixel_id,
          events_sent: payload.data.length,
          response,
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
    'meta_validate_conversion_payload',
    {
      title: 'Validar Payload CAPI',
      description: 'Valida localmente o payload que seria enviado para a Conversions API.',
      inputSchema: z.object({
        events: z.string().describe('JSON array de eventos da Conversions API.'),
        test_event_code: z.string().optional().describe('Código de teste opcional.'),
        partner_agent: z.string().optional().describe('Partner agent opcional.'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ events, test_event_code, partner_agent }) => {
      try {
        const payload = buildCapiPayload({
          data: parseJsonString<Array<Record<string, unknown>>>(events, 'events') || [],
          test_event_code,
          partner_agent,
        });

        const result = {
          valid: true,
          events_count: payload.data.length,
          payload,
        };

        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        };
      }
    }
  );
}
