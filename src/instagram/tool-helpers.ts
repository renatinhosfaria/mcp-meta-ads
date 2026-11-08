import { z } from 'zod';
import { handleApiError, toJson } from '../client.js';

// Último filtro contra vazamento de token: nenhuma resposta de ferramenta leva access_token.
function stripAccessTokens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAccessTokens);
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key !== 'access_token') out[key] = stripAccessTokens(item);
    }
    return out;
  }
  return value;
}

export function toolResult(data: unknown) {
  const safe = stripAccessTokens(data);
  const structuredContent = (Array.isArray(safe) ? { items: safe } : safe) as Record<string, unknown>;
  return {
    content: [{ type: 'text' as const, text: toJson(safe) }],
    structuredContent,
  };
}

export function toolError(error: unknown) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: handleApiError(error) }],
  };
}

/**
 * IDs que entram no caminho da URL da Graph. Sem `/ ? # % .` nem espaços: um ID como
 * `123?fields=access_token&x=` mudaria a consulta e poderia devolver o token da Página.
 */
export const GRAPH_ID_RE = /^[A-Za-z0-9_=-]{1,512}$/;
export const graphIdSchema = z.string().regex(GRAPH_ID_RE, 'ID inválido');
export const graphId = (description: string) => graphIdSchema.describe(description);

export const igUserIdField = graphIdSchema
  .optional()
  .describe('ID da conta do Instagram. Padrão: META_IG_USER_ID.');

export const pageIdField = graphIdSchema
  .optional()
  .describe('ID da Página do Facebook. Padrão: META_PAGE_ID.');

export const limitField = (max: number, def: number) =>
  z.number().int().min(1).max(max).default(def).describe(`Máximo de itens (1-${max}, padrão ${def}).`);
