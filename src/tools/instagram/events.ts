import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeRequest } from '../../client.js';
import { pollRecentActivity } from '../../events/api-poll.js';
import type { EventType } from '../../events/normalize.js';
import { getPageAccessToken, resolveIgUserId, resolvePageId } from '../../instagram/context.js';
import { igUserIdField, pageIdField, toolError, toolResult } from '../../instagram/tool-helpers.js';
import type { InstagramDeps } from './index.js';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const idempotentWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

const EVENT_TYPES = ['comment', 'live_comment', 'mention', 'story_insights', 'message', 'message_echo',
  'message_reaction', 'message_read', 'postback', 'referral', 'unknown'] as const;
const typesField = z.array(z.enum(EVENT_TYPES)).optional();

const SECRET_WARNING = 'Guarde este segredo agora: ele não será mostrado de novo.';

type SubscribedApp = { id?: string; subscribed_fields?: string[] };

async function pageContext(pageId?: string) {
  const page = resolvePageId(pageId);
  return { page, options: { accessToken: await getPageAccessToken(page) } };
}

/**
 * O POST em {page}/subscribed_apps altera a inscrição do app dono do token, então o "antes" precisa ser
 * lido desse mesmo app (GET app), e não de um id vindo do ambiente.
 */
async function currentFields(page: string, options: { accessToken: string }): Promise<string[]> {
  const tokenApp = await makeRequest<{ id?: string }>('app', 'GET', { fields: 'id,name' }, undefined, options);
  if (!tokenApp.id) throw new Error('Não foi possível identificar o app do token da Página.');
  const envAppId = process.env.META_APP_ID;
  if (envAppId && envAppId !== tokenApp.id) {
    throw new Error(`META_APP_ID (${envAppId}) não corresponde ao app do token (${tokenApp.id}). Corrija o .env antes de inscrever a Página.`);
  }
  const res = await makeRequest<{ data?: SubscribedApp[] }>(`${page}/subscribed_apps`, 'GET', {}, undefined, options);
  const mine = (res.data ?? []).find((a) => a.id === tokenApp.id);
  return mine?.subscribed_fields ?? [];
}

export function registerInstagramEventTools(server: McpServer, deps: InstagramDeps): void {
  server.registerTool(
    'meta_ig_list_events',
    {
      title: 'Listar Eventos do Instagram',
      description:
        'Lista eventos recebidos do Instagram (comentários, mensagens, menções). source=store lê os eventos gravados ainda não vistos; ' +
        'source=api consulta a API diretamente (fallback sem webhook) e não grava nada.',
      inputSchema: z.object({
        source: z.enum(['store', 'api']).default('store'),
        types: typesField,
        cursor: z.number().int().min(0).optional().describe('Cursor devolvido por next_cursor (somente store).'),
        limit: z.number().int().min(1).max(200).default(50),
        since: z.string().optional().describe('Data ISO. Somente com source=api; padrão: 24 h atrás.'),
        ig_user_id: igUserIdField,
        page_id: pageIdField,
      }).strict(),
      annotations: readOnly,
    },
    async (input) => {
      try {
        const { source = 'store', types, cursor, since, ig_user_id, page_id } = input as {
          source?: 'store' | 'api'; types?: EventType[]; cursor?: number; limit?: number; since?: string; ig_user_id?: string; page_id?: string;
        };
        const limit = Math.min(200, Math.max(1, Math.floor((input as { limit?: number }).limit ?? 50)));
        if (source === 'api') {
          const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 3600_000);
          if (Number.isNaN(sinceDate.getTime())) throw new Error('since inválido: use uma data ISO.');
          let events = await pollRecentActivity({ igUserId: resolveIgUserId(ig_user_id), pageId: resolvePageId(page_id), since: sinceDate });
          if (types && types.length > 0) events = events.filter((e) => types.includes(e.type));
          return toolResult({ source: 'api', total: events.length, events: events.slice(0, limit) });
        }
        const { events, next_cursor } = deps.events.listUnseen({ types, afterSeq: cursor, limit });
        return toolResult({ source: 'store', total: events.length, events, next_cursor });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_mark_events_seen',
    {
      title: 'Marcar Eventos como Vistos',
      description: 'Marca eventos gravados como vistos para que não apareçam mais em meta_ig_list_events.',
      inputSchema: z.object({ event_ids: z.array(z.string().min(1)).min(1).max(500) }).strict(),
      annotations: idempotentWrite,
    },
    async (input) => {
      try {
        const { event_ids } = input as { event_ids: string[] };
        return toolResult({ marked: deps.events.markSeen(event_ids) });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_add_webhook_destination',
    {
      title: 'Adicionar Destino de Webhook',
      description:
        'Cadastra uma URL https que receberá os eventos do Instagram, assinados com HMAC. O segredo é mostrado apenas nesta resposta.',
      inputSchema: z.object({
        url: z.string().url().describe('URL https:// do destino.'),
        event_types: typesField.describe('Tipos de evento a entregar. Omitido: todos.'),
        description: z.string().max(200).optional(),
      }).strict(),
      annotations: write,
    },
    async (input) => {
      try {
        const { destination, secret } = deps.destinations.add(input as { url: string; event_types?: EventType[]; description?: string });
        return toolResult({ destination, secret, aviso: SECRET_WARNING });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_list_webhook_destinations',
    {
      title: 'Listar Destinos de Webhook',
      description: 'Lista os destinos de webhook (sem segredo) com a contagem de entregas pendentes e falhas.',
      inputSchema: z.object({}).strict(),
      annotations: readOnly,
    },
    async () => {
      try {
        const destinations = deps.destinations.list().map((d) => ({ ...d, ...deps.destinations.deliveryCounts(d.id) }));
        return toolResult({ total: destinations.length, destinations });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_remove_webhook_destination',
    {
      title: 'Remover Destino de Webhook',
      description: 'Remove um destino de webhook e suas entregas pendentes.',
      inputSchema: z.object({ destination_id: z.string().min(1) }).strict(),
      annotations: destructive,
    },
    async (input) => {
      try {
        return toolResult({ removed: deps.destinations.remove((input as { destination_id: string }).destination_id) });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_test_webhook_destination',
    {
      title: 'Testar Destino de Webhook',
      description: 'Envia um evento sintético (type unknown, summary.test=true) ao destino, sem gravar nada.',
      inputSchema: z.object({ destination_id: z.string().min(1) }).strict(),
      annotations: write,
    },
    async (input) => {
      try {
        return toolResult(await deps.delivery.sendTest((input as { destination_id: string }).destination_id));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_page_subscription',
    {
      title: 'Ver Inscrição da Página',
      description: 'Mostra os apps inscritos na Página e os campos de webhook de cada um.',
      inputSchema: z.object({ page_id: pageIdField }).strict(),
      annotations: readOnly,
    },
    async (input) => {
      try {
        const { page, options } = await pageContext((input as { page_id?: string }).page_id);
        return toolResult(await makeRequest(`${page}/subscribed_apps`, 'GET', {}, undefined, options));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_subscribe_page',
    {
      title: 'Inscrever Página no App',
      description:
        'Inscreve a Página nos campos de webhook informados. Sempre une com os campos já inscritos (o leadgen do CRM nunca é removido).',
      inputSchema: z.object({
        fields: z.array(z.string().min(1)).describe('Campos a acrescentar, ex.: comments, messages, mentions.'),
        page_id: pageIdField,
      }).strict(),
      annotations: idempotentWrite,
    },
    async (input) => {
      try {
        const { fields, page_id } = input as { fields: string[]; page_id?: string };
        const { page, options } = await pageContext(page_id);
        const before = await currentFields(page, options);
        const after = [...new Set([...before, ...fields])];
        if (after.length === 0) throw new Error('Nenhum campo para inscrever: informe ao menos um campo em fields.');
        await makeRequest(`${page}/subscribed_apps`, 'POST', { subscribed_fields: after.join(',') }, undefined, options);
        return toolResult({ antes: before, depois: after });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
