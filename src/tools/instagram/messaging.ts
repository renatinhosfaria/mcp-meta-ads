import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeRequest } from '../../client.js';
import { getPageAccessToken, resolvePageId } from '../../instagram/context.js';
import { mediaInputSchema, resolveMediaSource } from '../../instagram/media-source.js';
import { graphId, limitField, pageIdField, toolError, toolResult } from '../../instagram/tool-helpers.js';
import type { InstagramDeps } from './index.js';

const MESSAGE_FIELDS = 'id,created_time,from,to,message,attachments,story,shares,reactions';
const CONVERSATION_FIELDS = 'id,updated_time,participants,messages.limit(1){id,created_time,from,message}';
const USER_PROFILE_FIELDS = 'name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const idempotentWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const idField = graphId;
const recipientField = idField('IGSID (ID do usuário no escopo da Página) do destinatário.');

const quickReplySchema = z.object({ title: z.string().min(1).max(20), payload: z.string().min(1).max(1000) }).strict();
const templateElementSchema = z
  .object({
    title: z.string().min(1).describe('Título do cartão.'),
    subtitle: z.string().optional(),
    image_url: z.string().url().optional(),
    default_action: z.object({ type: z.literal('web_url'), url: z.string().url() }).strict().optional(),
    buttons: z
      .array(
        z.union([
          z.object({ type: z.literal('web_url'), title: z.string().min(1), url: z.string().url() }).strict(),
          z.object({ type: z.literal('postback'), title: z.string().min(1), payload: z.string().min(1) }).strict(),
        ])
      )
      .max(3)
      .optional(),
  })
  .strict();

const sendMessageShape = {
  recipient_id: recipientField,
  text: z.string().min(1).optional().describe('Texto da mensagem.'),
  quick_replies: z.array(quickReplySchema).min(1).max(13).optional().describe('Respostas rápidas (até 13); exigem text.'),
  attachment: z
    .object({
      type: z.enum(['image', 'video', 'audio', 'file']),
      media: mediaInputSchema.describe('image/video: url ou upload_id (image também base64). audio/file: apenas url.'),
    })
    .strict()
    .optional(),
  like_heart: z.literal(true).optional().describe('Envia um coração.'),
  generic_template: z
    .object({ elements: z.array(templateElementSchema).min(1).max(10) })
    .strict()
    .optional()
    .describe('Carrossel de cartões (até 10).'),
  page_id: pageIdField,
};
const sendMessageSchema = z.object(sendMessageShape).strict();

const iceBreakersShape = {
  questions: z
    .array(z.object({ question: z.string().min(1), payload: z.string().min(1) }).strict())
    .min(1)
    .max(4),
  page_id: pageIdField,
};
const menuItemSchema = z.union([
  z.object({ type: z.literal('postback'), title: z.string().min(1), payload: z.string().min(1) }).strict(),
  z.object({ type: z.literal('web_url'), title: z.string().min(1), url: z.string().url() }).strict(),
]);
const menuShape = { items: z.array(menuItemSchema).min(1).max(20), page_id: pageIdField };

function validationError(message: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text: message }] };
}

function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): { ok: true; data: z.infer<T> } | { ok: false; error: ReturnType<typeof validationError> } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ');
  return { ok: false, error: validationError(`Parâmetros inválidos: ${msg}`) };
}

async function pageContext(pageId?: string) {
  const page = resolvePageId(pageId);
  const accessToken = await getPageAccessToken(page);
  return { page, options: { accessToken } };
}

export function registerInstagramMessagingTools(server: McpServer, deps: InstagramDeps): void {
  server.registerTool(
    'meta_ig_list_conversations',
    {
      title: 'Listar Conversas do Direct',
      description: 'Lista as conversas do Direct do Instagram, com a última mensagem de cada uma. Usa o token da Página.',
      inputSchema: z.object({ limit: limitField(100, 25), page_id: pageIdField }).strict(),
      annotations: readOnly,
    },
    async ({ limit, page_id }) => {
      try {
        const { page, options } = await pageContext(page_id);
        const res = await makeRequest<Record<string, unknown>>(
          `${page}/conversations`,
          'GET',
          { platform: 'instagram', fields: CONVERSATION_FIELDS, limit },
          undefined,
          options
        );
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_conversation_messages',
    {
      title: 'Mensagens de uma Conversa',
      description: 'Lista as mensagens de uma conversa do Direct do Instagram.',
      inputSchema: z.object({ conversation_id: idField('ID da conversa.'), limit: limitField(100, 25), page_id: pageIdField }).strict(),
      annotations: readOnly,
    },
    async ({ conversation_id, limit, page_id }) => {
      try {
        const { options } = await pageContext(page_id);
        const res = await makeRequest<Record<string, unknown>>(
          conversation_id,
          'GET',
          { fields: `messages.limit(${limit}){${MESSAGE_FIELDS}}` },
          undefined,
          options
        );
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_message',
    {
      title: 'Detalhes de uma Mensagem',
      description: 'Obtém os detalhes de uma mensagem do Direct do Instagram.',
      inputSchema: z.object({ message_id: idField('ID da mensagem.'), page_id: pageIdField }).strict(),
      annotations: readOnly,
    },
    async ({ message_id, page_id }) => {
      try {
        const { options } = await pageContext(page_id);
        const res = await makeRequest<Record<string, unknown>>(message_id, 'GET', { fields: MESSAGE_FIELDS }, undefined, options);
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_user_profile',
    {
      title: 'Perfil de Usuário do Direct',
      description: 'Obtém o perfil de um usuário que conversa com a conta (por IGSID).',
      inputSchema: z.object({ igsid: idField('IGSID do usuário.'), page_id: pageIdField }).strict(),
      annotations: readOnly,
    },
    async ({ igsid, page_id }) => {
      try {
        const { options } = await pageContext(page_id);
        const res = await makeRequest<Record<string, unknown>>(igsid, 'GET', { fields: USER_PROFILE_FIELDS }, undefined, options);
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_send_message',
    {
      title: 'Enviar Mensagem no Direct',
      description:
        'Envia uma mensagem no Direct do Instagram. Informe exatamente um conteúdo: text (com quick_replies opcionais, até 13), attachment (image/video via url ou upload_id; audio/file apenas via url), like_heart ou generic_template (até 10 cartões). Só é possível responder em até 24 horas após a última mensagem do usuário.',
      inputSchema: sendMessageSchema,
      annotations: write,
    },
    async (input) => {
      const parsed = parseInput(sendMessageSchema, input);
      if (!parsed.ok) return parsed.error;
      const { recipient_id, text, quick_replies, attachment, like_heart, generic_template, page_id } = parsed.data;
      try {
        const contents = [text, attachment, like_heart, generic_template].filter((v) => v !== undefined).length;
        if (contents !== 1) {
          return validationError('Informe exatamente um conteúdo: text, attachment, like_heart ou generic_template.');
        }
        if (quick_replies && text === undefined) return validationError('quick_replies exige o campo text.');
        if (attachment && (attachment.type === 'audio' || attachment.type === 'file')) {
          const m = attachment.media;
          if (m.url === undefined) {
            return validationError(`Anexos do tipo ${attachment.type} aceitam apenas media.url; upload_id e base64 não são suportados.`);
          }
        }

        let message: Record<string, unknown>;
        if (text !== undefined) {
          message = quick_replies ? { text, quick_replies } : { text };
        } else if (attachment) {
          const url =
            attachment.type === 'image' || attachment.type === 'video'
              ? (await resolveMediaSource(attachment.media, attachment.type, deps.uploads)).url
              : (attachment.media.url as string);
          message = { attachment: { type: attachment.type, payload: { url } } };
        } else if (like_heart) {
          message = { attachment: { type: 'like_heart' } };
        } else {
          message = {
            attachment: {
              type: 'template',
              payload: { template_type: 'generic', elements: generic_template!.elements },
            },
          };
        }

        const { page, options } = await pageContext(page_id);
        const res = await makeRequest<Record<string, unknown>>(
          `${page}/messages`,
          'POST',
          {},
          { recipient: { id: recipient_id }, message },
          options
        );
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_react_message',
    {
      title: 'Reagir a uma Mensagem',
      description: 'Adiciona (react) ou remove (unreact) a reação de coração em uma mensagem do Direct.',
      inputSchema: z
        .object({
          recipient_id: recipientField,
          message_id: idField('ID da mensagem.'),
          action: z.enum(['react', 'unreact']).default('react'),
          page_id: pageIdField,
        })
        .strict(),
      annotations: idempotentWrite,
    },
    async ({ recipient_id, message_id, action, page_id }) => {
      try {
        const { page, options } = await pageContext(page_id);
        const res = await makeRequest<Record<string, unknown>>(
          `${page}/messages`,
          'POST',
          {},
          { recipient: { id: recipient_id }, sender_action: action, payload: { message_id, reaction: 'love' } },
          options
        );
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_send_sender_action',
    {
      title: 'Enviar Ação no Direct',
      description: 'Marca como visto (mark_seen) ou mostra/oculta o indicador de digitação (typing_on/typing_off).',
      inputSchema: z
        .object({
          recipient_id: recipientField,
          action: z.enum(['mark_seen', 'typing_on', 'typing_off']),
          page_id: pageIdField,
        })
        .strict(),
      annotations: idempotentWrite,
    },
    async ({ recipient_id, action, page_id }) => {
      try {
        const { page, options } = await pageContext(page_id);
        const res = await makeRequest<Record<string, unknown>>(
          `${page}/messages`,
          'POST',
          {},
          { recipient: { id: recipient_id }, sender_action: action },
          options
        );
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_messaging_profile',
    {
      title: 'Perfil de Mensagens',
      description: 'Obtém os ice breakers e o menu persistente configurados para o Direct.',
      inputSchema: z.object({ page_id: pageIdField }).strict(),
      annotations: readOnly,
    },
    async ({ page_id }) => {
      try {
        const { page, options } = await pageContext(page_id);
        const res = await makeRequest<Record<string, unknown>>(
          `${page}/messenger_profile`,
          'GET',
          { platform: 'instagram', fields: 'ice_breakers,persistent_menu' },
          undefined,
          options
        );
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  const iceBreakersSchema = z.object(iceBreakersShape).strict();
  server.registerTool(
    'meta_ig_set_ice_breakers',
    {
      title: 'Definir Ice Breakers',
      description: 'Define as perguntas frequentes (ice breakers) do Direct, até 4. Substitui as atuais.',
      inputSchema: iceBreakersSchema,
      annotations: idempotentWrite,
    },
    async (input) => {
      const parsed = parseInput(iceBreakersSchema, input);
      if (!parsed.ok) return parsed.error;
      try {
        const { page, options } = await pageContext(parsed.data.page_id);
        const res = await makeRequest<Record<string, unknown>>(
          `${page}/messenger_profile`,
          'POST',
          { platform: 'instagram' },
          { ice_breakers: [{ locale: 'default', call_to_actions: parsed.data.questions }] },
          options
        );
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  const menuSchema = z.object(menuShape).strict();
  server.registerTool(
    'meta_ig_set_persistent_menu',
    {
      title: 'Definir Menu Persistente',
      description: 'Define o menu persistente do Direct. Itens postback (title, payload) ou web_url (title, url). Substitui o atual.',
      inputSchema: menuSchema,
      annotations: idempotentWrite,
    },
    async (input) => {
      const parsed = parseInput(menuSchema, input);
      if (!parsed.ok) return parsed.error;
      try {
        const { page, options } = await pageContext(parsed.data.page_id);
        const res = await makeRequest<Record<string, unknown>>(
          `${page}/messenger_profile`,
          'POST',
          { platform: 'instagram' },
          { persistent_menu: [{ locale: 'default', call_to_actions: parsed.data.items }] },
          options
        );
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_delete_messaging_profile_fields',
    {
      title: 'Remover Campos do Perfil de Mensagens',
      description: 'Remove ice_breakers e/ou persistent_menu do perfil de mensagens do Direct.',
      inputSchema: z
        .object({ fields: z.array(z.enum(['ice_breakers', 'persistent_menu'])).min(1), page_id: pageIdField })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ fields, page_id }) => {
      try {
        const { page, options } = await pageContext(page_id);
        const res = await makeRequest<Record<string, unknown>>(
          `${page}/messenger_profile`,
          'DELETE',
          { platform: 'instagram' },
          { fields },
          options
        );
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
