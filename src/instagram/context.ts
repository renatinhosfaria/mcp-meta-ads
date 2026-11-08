import { makeRequest } from '../client.js';

const PAGE_TOKEN_TTL_MS = 60 * 60 * 1000;
const pageTokenCache = new Map<string, { token: string; expiresAt: number }>();

export function resolveIgUserId(override?: string): string {
  const id = override || process.env.META_IG_USER_ID;
  if (!id) {
    throw new Error(
      'META_IG_USER_ID não configurado. ' +
      'Informe ig_user_id na chamada ou defina META_IG_USER_ID no ambiente (ID da conta profissional do Instagram).'
    );
  }
  return id;
}

export function resolvePageId(override?: string): string {
  const id = override || process.env.META_PAGE_ID;
  if (!id) {
    throw new Error(
      'META_PAGE_ID não configurado. ' +
      'Informe page_id na chamada ou defina META_PAGE_ID no ambiente (ID da Página do Facebook vinculada ao Instagram).'
    );
  }
  return id;
}

export async function getPageAccessToken(pageId: string): Promise<string> {
  const cached = pageTokenCache.get(pageId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const response = await makeRequest<{ access_token?: string }>(pageId, 'GET', { fields: 'access_token' });
  if (!response.access_token) {
    throw new Error(`Não foi possível obter o token da Página ${pageId}. Verifique se o token do sistema tem acesso a ela.`);
  }
  pageTokenCache.set(pageId, { token: response.access_token, expiresAt: Date.now() + PAGE_TOKEN_TTL_MS });
  return response.access_token;
}

export function clearPageTokenCache(): void {
  pageTokenCache.clear();
}
