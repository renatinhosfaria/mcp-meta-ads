import { z } from 'zod';
import { handleApiError, toJson } from '../client.js';

export function toolResult(data: unknown) {
  const structuredContent = (Array.isArray(data) ? { items: data } : data) as Record<string, unknown>;
  return {
    content: [{ type: 'text' as const, text: toJson(data) }],
    structuredContent,
  };
}

export function toolError(error: unknown) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: handleApiError(error) }],
  };
}

export const igUserIdField = z
  .string()
  .optional()
  .describe('ID da conta do Instagram. Padrão: META_IG_USER_ID.');

export const pageIdField = z
  .string()
  .optional()
  .describe('ID da Página do Facebook. Padrão: META_PAGE_ID.');

export const limitField = (max: number, def: number) =>
  z.number().int().min(1).max(max).default(def).describe(`Máximo de itens (1-${max}, padrão ${def}).`);
