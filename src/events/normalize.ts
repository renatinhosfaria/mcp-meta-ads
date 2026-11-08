import { createHash } from 'node:crypto';

export type EventType = 'comment' | 'live_comment' | 'mention' | 'story_insights' | 'message' | 'message_echo'
  | 'message_reaction' | 'message_read' | 'postback' | 'referral' | 'unknown';

export type NormalizedEvent = {
  id: string; version: 1; type: EventType; ig_user_id: string; occurred_at: string;
  received_at: string; summary: Record<string, unknown>; raw: unknown;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);

/** Valor < 1e12 é tratado como segundos (`changes`); senão milissegundos (`messaging`). */
export function toIsoTimestamp(value: number | undefined, fallback: Date): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback.toISOString();
  const ms = value < 1e12 ? value * 1000 : value;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? fallback.toISOString() : d.toISOString();
}

function eventId(entryId: string, field: string, item: unknown): string {
  return createHash('sha256').update(entryId + '|' + field + '|' + JSON.stringify(item)).digest('hex').slice(0, 32);
}

function changeSummary(type: EventType, value: Obj): Record<string, unknown> {
  if (type === 'comment' || type === 'live_comment') {
    const from = isObj(value.from) ? value.from : {};
    const media = isObj(value.media) ? value.media : {};
    return {
      comment_id: str(value.id), text: str(value.text), from_id: str(from.id),
      from_username: str(from.username), media_id: str(media.id), parent_id: str(value.parent_id),
    };
  }
  if (type === 'mention') return { media_id: str(value.media_id), comment_id: str(value.comment_id) };
  return value;
}

const CHANGE_TYPES: Record<string, EventType> = {
  comments: 'comment', live_comments: 'live_comment', mentions: 'mention', story_insights: 'story_insights',
};

function messagingType(item: Obj): { type: EventType; body: Obj } {
  const message = isObj(item.message) ? item.message : undefined;
  if (message) return { type: message.is_echo ? 'message_echo' : 'message', body: message };
  for (const [key, type] of [['reaction', 'message_reaction'], ['read', 'message_read'], ['postback', 'postback'], ['referral', 'referral']] as const) {
    if (isObj(item[key])) return { type, body: item[key] as Obj };
  }
  return { type: 'unknown', body: {} };
}

function messagingSummary(item: Obj, body: Obj): Record<string, unknown> {
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.filter(isObj).map((a) => ({ type: str(a.type), url: isObj(a.payload) ? str(a.payload.url) : undefined }))
    : [];
  return {
    sender_id: isObj(item.sender) ? str(item.sender.id) : undefined,
    recipient_id: isObj(item.recipient) ? str(item.recipient.id) : undefined,
    mid: str(body.mid), text: str(body.text), attachments,
  };
}

export function normalizeMetaWebhook(payload: unknown, receivedAt: Date): NormalizedEvent[] {
  if (!isObj(payload) || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const out: NormalizedEvent[] = [];
  const received_at = receivedAt.toISOString();
  for (const entry of payload.entry) {
    if (!isObj(entry)) continue;
    const entryId = str(entry.id) ?? '';
    const entryTime = typeof entry.time === 'number' ? entry.time : undefined;
    if (Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        if (!isObj(change)) continue;
        const field = str(change.field) ?? '';
        const type = CHANGE_TYPES[field] ?? 'unknown';
        const value = isObj(change.value) ? change.value : {};
        out.push({
          id: eventId(entryId, field, change), version: 1, type, ig_user_id: entryId,
          occurred_at: toIsoTimestamp(entryTime, receivedAt), received_at,
          summary: changeSummary(type, value), raw: change,
        });
      }
    }
    if (Array.isArray(entry.messaging)) {
      for (const item of entry.messaging) {
        if (!isObj(item)) continue;
        const { type, body } = messagingType(item);
        out.push({
          id: eventId(entryId, 'messaging', item), version: 1, type, ig_user_id: entryId,
          occurred_at: toIsoTimestamp(typeof item.timestamp === 'number' ? item.timestamp : entryTime, receivedAt), received_at,
          summary: messagingSummary(item, body), raw: item,
        });
      }
    }
  }
  return out;
}
