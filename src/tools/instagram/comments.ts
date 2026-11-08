import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeRequest, paginate } from '../../client.js';
import { getPageAccessToken, resolveIgUserId, resolvePageId } from '../../instagram/context.js';
import { igUserIdField, limitField, pageIdField, toolError, toolResult } from '../../instagram/tool-helpers.js';

const COMMENT_FIELDS =
  'id,text,username,timestamp,like_count,hidden,parent_id,from{id,username},replies{id,text,username,timestamp,hidden}';
const REPLY_FIELDS = 'id,text,username,timestamp,like_count,hidden,from{id,username}';
const MENTION_MEDIA_FIELDS = 'id,caption,media_type,media_url,permalink,timestamp,username,like_count,comments_count';
const MENTION_COMMENT_FIELDS = 'id,text,timestamp,like_count,media{id,permalink}';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const numericId = (desc: string) => z.string().regex(/^\d+$/, 'O ID deve conter apenas dígitos.').describe(desc);
const idField = (desc: string) => z.string().min(1).describe(desc);

export function registerInstagramCommentTools(server: McpServer): void {
  server.registerTool(
    'meta_ig_list_comments',
    {
      title: 'Listar Comentários',
      description: 'Lista os comentários de uma publicação do Instagram, com respostas aninhadas.',
      inputSchema: z.object({ media_id: idField('ID da mídia.'), limit: limitField(100, 25) }).strict(),
      annotations: readOnly,
    },
    async ({ media_id, limit }) => {
      try {
        const items = await paginate<Record<string, unknown>>(`${media_id}/comments`, { fields: COMMENT_FIELDS }, limit);
        return toolResult({ total: items.length, comments: items });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_list_comment_replies',
    {
      title: 'Listar Respostas de um Comentário',
      description: 'Lista as respostas de um comentário do Instagram.',
      inputSchema: z.object({ comment_id: idField('ID do comentário.'), limit: limitField(100, 25) }).strict(),
      annotations: readOnly,
    },
    async ({ comment_id, limit }) => {
      try {
        const items = await paginate<Record<string, unknown>>(`${comment_id}/replies`, { fields: REPLY_FIELDS }, limit);
        return toolResult({ total: items.length, replies: items });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_comment_on_media',
    {
      title: 'Comentar em Publicação',
      description: 'Publica um comentário em uma publicação do Instagram.',
      inputSchema: z.object({ media_id: idField('ID da mídia.'), message: z.string().min(1).describe('Texto do comentário.') }).strict(),
      annotations: write,
    },
    async ({ media_id, message }) => {
      try {
        const res = await makeRequest<Record<string, unknown>>(`${media_id}/comments`, 'POST', {}, { message });
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_reply_comment',
    {
      title: 'Responder Comentário',
      description: 'Responde publicamente a um comentário do Instagram.',
      inputSchema: z.object({ comment_id: idField('ID do comentário.'), message: z.string().min(1).describe('Texto da resposta.') }).strict(),
      annotations: write,
    },
    async ({ comment_id, message }) => {
      try {
        const res = await makeRequest<Record<string, unknown>>(`${comment_id}/replies`, 'POST', {}, { message });
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_hide_comment',
    {
      title: 'Ocultar/Exibir Comentário',
      description: 'Oculta (hide=true) ou volta a exibir (hide=false) um comentário do Instagram.',
      inputSchema: z
        .object({ comment_id: idField('ID do comentário.'), hide: z.boolean().describe('true para ocultar, false para exibir.') })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ comment_id, hide }) => {
      try {
        const res = await makeRequest<Record<string, unknown>>(comment_id, 'POST', {}, { hide });
        return toolResult({ comment_id, hide, result: res });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_delete_comment',
    {
      title: 'Excluir Comentário',
      description: 'Exclui permanentemente um comentário do Instagram. Irreversível.',
      inputSchema: z.object({ comment_id: idField('ID do comentário.') }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ comment_id }) => {
      try {
        const res = await makeRequest<Record<string, unknown>>(comment_id, 'DELETE');
        return toolResult({ comment_id, result: res });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_private_reply',
    {
      title: 'Resposta Privada a Comentário',
      description:
        'Envia uma mensagem privada (DM) ao autor de um comentário. Só é permitida uma resposta privada por comentário, em até 7 dias.',
      inputSchema: z
        .object({
          comment_id: idField('ID do comentário.'),
          message: z.string().min(1).describe('Texto da mensagem privada.'),
          page_id: pageIdField,
        })
        .strict(),
      annotations: write,
    },
    async ({ comment_id, message, page_id }) => {
      try {
        const page = resolvePageId(page_id);
        const accessToken = await getPageAccessToken(page);
        const res = await makeRequest<Record<string, unknown>>(
          `${page}/messages`,
          'POST',
          {},
          { recipient: { comment_id }, message: { text: message } },
          { accessToken }
        );
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_get_mention',
    {
      title: 'Detalhes de Menção',
      description: 'Obtém a publicação (e, opcionalmente, o comentário) em que a conta foi mencionada.',
      inputSchema: z
        .object({
          ig_user_id: igUserIdField,
          media_id: numericId('ID da mídia em que houve a menção.'),
          comment_id: numericId('ID do comentário da menção (opcional).').optional(),
        })
        .strict(),
      annotations: readOnly,
    },
    async ({ ig_user_id, media_id, comment_id }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        let fields = `mentioned_media.media_id(${media_id}){${MENTION_MEDIA_FIELDS}}`;
        if (comment_id) fields += `,mentioned_comment.comment_id(${comment_id}){${MENTION_COMMENT_FIELDS}}`;
        const res = await makeRequest<Record<string, unknown>>(ig, 'GET', { fields });
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'meta_ig_reply_mention',
    {
      title: 'Responder Menção',
      description: 'Comenta em uma publicação (ou responde a um comentário) em que a conta foi mencionada.',
      inputSchema: z
        .object({
          ig_user_id: igUserIdField,
          media_id: idField('ID da mídia da menção.'),
          comment_id: idField('ID do comentário da menção (opcional).').optional(),
          message: z.string().min(1).describe('Texto da resposta.'),
        })
        .strict(),
      annotations: write,
    },
    async ({ ig_user_id, media_id, comment_id, message }) => {
      try {
        const ig = resolveIgUserId(ig_user_id);
        const body: Record<string, unknown> = { media_id, message };
        if (comment_id) body.comment_id = comment_id;
        const res = await makeRequest<Record<string, unknown>>(`${ig}/mentions`, 'POST', {}, body);
        return toolResult(res);
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
