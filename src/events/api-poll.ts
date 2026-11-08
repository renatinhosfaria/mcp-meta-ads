import { makeRequest } from '../client.js';
import { getPageAccessToken } from '../instagram/context.js';
import type { NormalizedEvent } from './normalize.js';

type Obj = Record<string, any>; // resposta da Graph, sem schema fixo

const COMMENT_SUBFIELDS = 'id,text,username,timestamp,parent_id';
const MESSAGE_SUBFIELDS = 'id,created_time,from,message';

function iso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** Leitura direta na API (fallback sem webhook). Os eventos não são gravados. */
export async function pollRecentActivity(opts: { igUserId: string; pageId: string; since: Date; mediaLimit?: number }): Promise<NormalizedEvent[]> {
  const { igUserId, pageId, since } = opts;
  const received_at = new Date().toISOString();
  const out: NormalizedEvent[] = [];

  const media = await makeRequest<{ data?: Obj[] }>(`${igUserId}/media`, 'GET', {
    fields: `id,timestamp,comments.limit(50){${COMMENT_SUBFIELDS}}`,
    limit: opts.mediaLimit ?? 10,
  });
  for (const m of media.data ?? []) {
    for (const c of m.comments?.data ?? []) {
      const occurred_at = iso(c.timestamp);
      if (!occurred_at || new Date(occurred_at) < since) continue;
      out.push({
        id: `api:${c.id}`, version: 1, type: 'comment', ig_user_id: igUserId, occurred_at, received_at,
        summary: { comment_id: c.id, text: c.text, from_username: c.username, media_id: m.id, parent_id: c.parent_id },
        raw: c,
      });
    }
  }

  const token = await getPageAccessToken(pageId);
  const convs = await makeRequest<{ data?: Obj[] }>(`${pageId}/conversations`, 'GET', {
    platform: 'instagram',
    fields: `id,updated_time,messages.limit(10){${MESSAGE_SUBFIELDS}}`,
  }, undefined, { accessToken: token });
  for (const conv of convs.data ?? []) {
    const updated = iso(conv.updated_time);
    if (!updated || new Date(updated) < since) continue;
    for (const msg of conv.messages?.data ?? []) {
      const occurred_at = iso(msg.created_time);
      if (!occurred_at || new Date(occurred_at) < since) continue;
      out.push({
        id: `api:${msg.id}`, version: 1, type: 'message', ig_user_id: igUserId, occurred_at, received_at,
        summary: { mid: msg.id, text: msg.message, sender_id: msg.from?.id, conversation_id: conv.id },
        raw: msg,
      });
    }
  }
  return out.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}
