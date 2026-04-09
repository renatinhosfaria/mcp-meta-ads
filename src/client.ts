import axios, { AxiosError } from 'axios';
import { META_BASE_URL, DEFAULT_PAGE_LIMIT, MAX_PAGINATE_ITEMS } from './constants.js';
import type { MetaApiError, MetaApiResponse } from './types.js';

export type RequestOptions = {
  accessToken?: string;
  headers?: Record<string, string>;
  timeout?: number;
};

export function getAccessToken(): string {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'META_ACCESS_TOKEN não configurado. ' +
      'Adicione seu token no arquivo .env ou passe como variável de ambiente. ' +
      'Gere um System User Token em: Meta Business Manager > Configurações > Usuários do Sistema.'
    );
  }
  return token;
}

export function resolveAccessToken(accessToken?: string): string {
  return accessToken || getAccessToken();
}

export function getDefaultAdAccountId(): string {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!accountId) {
    throw new Error(
      'META_AD_ACCOUNT_ID não configurado. ' +
      'Adicione o ID da conta no arquivo .env (formato: act_XXXXXXXXXX). ' +
      'Encontre em: Meta Business Manager > Configurações > Contas de Anúncio.'
    );
  }
  return accountId.startsWith('act_') ? accountId : `act_${accountId}`;
}

export function normalizeAdAccountId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}

export async function makeRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  params: Record<string, unknown> = {},
  data?: Record<string, unknown> | FormData,
  options: RequestOptions = {}
): Promise<T> {
  const accessToken = resolveAccessToken(options.accessToken);
  const url = `${META_BASE_URL}/${endpoint}`;
  const isMultipart = typeof FormData !== 'undefined' && data instanceof FormData;

  const response = await axios({
    method,
    url,
    params: {
      access_token: accessToken,
      ...params,
    },
    data: method !== 'GET' ? data : undefined,
    timeout: options.timeout ?? 30000,
    headers: isMultipart
      ? options.headers
      : {
          'Content-Type': 'application/json',
          ...options.headers,
        },
  });

  return response.data as T;
}

export async function makeMultipartRequest<T>(
  endpoint: string,
  formData: FormData,
  params: Record<string, unknown> = {},
  options: RequestOptions = {}
): Promise<T> {
  return makeRequest<T>(endpoint, 'POST', params, formData, options);
}

export function parseJsonString<T>(value: string | undefined, fieldName: string): T | undefined {
  if (value === undefined) return undefined;

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`O campo ${fieldName} deve ser um JSON válido.`);
  }
}

export function toGraphArrayParam(values: readonly unknown[]): string {
  return JSON.stringify(values);
}

export function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    const metaError = error.response?.data?.error as MetaApiError['error'] | undefined;

    if (metaError) {
      const code = metaError.code as number;
      const msg = metaError.message || 'Erro desconhecido';
      const subcode = metaError.error_subcode as number | undefined;
      const detail = metaError.error_user_msg || msg;

      if (/Page Access Token/i.test(msg)) {
        return (
          `Erro: Esta operação exige um Page Access Token. ` +
          `Informe page_access_token com acesso à Página ou ao formulário de leads. ` +
          `Detalhes: ${detail}`
        );
      }
      if (code === 190 || (code === 102 && subcode === 463)) {
        return (
          `Erro: Token de acesso inválido ou expirado. ` +
          `Gere um novo token em Meta Business Manager > Configurações > Usuários do Sistema. ` +
          `Detalhes: ${detail}`
        );
      }
      if (metaError.type === 'GraphMethodException' && /Unsupported post request/i.test(msg)) {
        return (
          `Erro: Operação não suportada para este objeto ou endpoint. ` +
          `Verifique se o ID está correto e se a operação é permitida pela Meta API. ` +
          `Detalhes: ${detail}`
        );
      }
      if (code === 100) {
        return (
          `Erro: Parâmetro inválido. ` +
          `Verifique os campos e IDs fornecidos. ` +
          `Detalhes: ${detail}`
        );
      }
      if (code === 200 || code === 10 || metaError.type === 'OAuthException') {
        return (
          `Erro: Permissão insuficiente. ` +
          `Verifique se o app/token possui acesso ao ativo e às permissões exigidas. ` +
          `Para Ads Archive / Ad Library, esta operação pode exigir aprovação adicional do app. ` +
          `Detalhes: ${detail}`
        );
      }
      if (code === 17 || code === 4 || code === 32 || code === 613) {
        return (
          `Erro: Rate limit atingido. ` +
          `Aguarde alguns segundos antes de tentar novamente. ` +
          `Detalhes: ${detail}`
        );
      }
      if (code === 2635) {
        return (
          `Erro: Conta de anúncio não encontrada ou sem permissão de acesso. ` +
          `Verifique o META_AD_ACCOUNT_ID e se o token tem acesso a essa conta. ` +
          `Detalhes: ${detail}`
        );
      }
      return `Erro Meta API [${code}]: ${detail}`;
    }

    if (error.response?.status === 404) {
      return `Erro: Recurso não encontrado. Verifique se o ID está correto e se você tem acesso.`;
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return `Erro: Timeout na requisição. Tente novamente.`;
    }
    if (error.response?.status === 403) {
      return `Erro: Acesso negado. Verifique as permissões do token.`;
    }
  }

  return `Erro: ${error instanceof Error ? error.message : String(error)}`;
}

export async function paginate<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
  maxItems = MAX_PAGINATE_ITEMS,
  options: RequestOptions = {}
): Promise<T[]> {
  const items: T[] = [];
  let after: string | undefined;

  do {
    const response = await makeRequest<MetaApiResponse<T>>(
      endpoint,
      'GET',
      {
        ...params,
        limit: DEFAULT_PAGE_LIMIT,
        ...(after ? { after } : {}),
      },
      undefined,
      options
    );

    const batch = response.data || [];
    items.push(...batch);
    after = response.paging?.cursors?.after;

    if (items.length >= maxItems || !response.paging?.next) {
      break;
    }
  } while (after);

  return items.slice(0, maxItems);
}

export function truncate(text: string, limit = 25000): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n... [truncado: ${text.length - limit} caracteres restantes]`;
}

export function toJson(data: unknown): string {
  return truncate(JSON.stringify(data, null, 2));
}
