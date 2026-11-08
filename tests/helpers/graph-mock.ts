import axios, { AxiosError, AxiosHeaders } from 'axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { clearPageTokenCache } from '../../src/instagram/context.ts';

export type ToolRegistration = {
  config: Record<string, unknown>;
  handler: (input: unknown) => Promise<unknown>;
};

export function captureTools(
  register: (server: { registerTool: (name: string, config: unknown, handler: (input: unknown) => Promise<unknown>) => void }) => void
): Map<string, ToolRegistration> {
  const tools = new Map<string, ToolRegistration>();
  register({
    registerTool(name, config, handler) {
      tools.set(name, { config: config as Record<string, unknown>, handler });
    },
  });
  return tools;
}

export type GraphCall = {
  method: string;
  url: string;
  params: Record<string, unknown>;
  data: unknown;
  headers: Record<string, string>;
};

export function metaError(code: number, subcode: number | undefined, message: string): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  const response = {
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config,
    data: { error: { code, error_subcode: subcode, message, type: 'OAuthException' } },
  } as AxiosResponse;
  return new AxiosError(message, 'ERR_BAD_REQUEST', config, {}, response);
}

const ENV_KEYS = ['META_ACCESS_TOKEN', 'META_IG_USER_ID', 'META_PAGE_ID'] as const;

export async function withGraphMock(
  responder: (call: GraphCall) => unknown,
  fn: (calls: GraphCall[]) => Promise<void>
): Promise<void> {
  const originalAdapter = axios.defaults.adapter;
  const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const calls: GraphCall[] = [];

  clearPageTokenCache();
  process.env.META_ACCESS_TOKEN = 'test-token';
  process.env.META_IG_USER_ID = 'ig-1';
  process.env.META_PAGE_ID = 'page-1';

  axios.defaults.adapter = async (config) => {
    const call: GraphCall = {
      method: String(config.method ?? 'get').toUpperCase(),
      url: String(config.url ?? ''),
      params: (config.params ?? {}) as Record<string, unknown>,
      data: typeof config.data === 'string' ? safeParse(config.data) : config.data,
      headers: Object.fromEntries(
        Object.entries(config.headers?.toJSON?.() ?? config.headers ?? {}).map(([k, v]) => [k, String(v)])
      ),
    };
    calls.push(call);
    const data = responder(call);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };

  try {
    await fn(calls);
  } finally {
    axios.defaults.adapter = originalAdapter;
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
    clearPageTokenCache();
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
