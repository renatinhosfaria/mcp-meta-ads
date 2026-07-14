import 'dotenv/config';
import {
  DEFAULT_HTTP_HEADERS_TIMEOUT_MS,
  DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_GRACE_MS,
} from './http-server.js';

function positiveInteger(environment: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number.parseInt(environment[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function loadConfig(environment: NodeJS.ProcessEnv) {
  const apiKey = environment.API_KEY;
  if (!apiKey) throw new Error('API_KEY is required');

  const maxSessions = positiveInteger(environment, 'MCP_MAX_SESSIONS', 250);
  const sessionAlertThreshold = positiveInteger(environment, 'MCP_SESSION_ALERT_THRESHOLD', 150);
  const httpKeepAliveTimeoutMs = positiveInteger(
    environment,
    'HTTP_KEEP_ALIVE_TIMEOUT_MS',
    DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS,
  );
  const httpHeadersTimeoutMs = positiveInteger(
    environment,
    'HTTP_HEADERS_TIMEOUT_MS',
    DEFAULT_HTTP_HEADERS_TIMEOUT_MS,
  );

  if (sessionAlertThreshold > maxSessions) {
    throw new Error('MCP_SESSION_ALERT_THRESHOLD must not exceed MCP_MAX_SESSIONS');
  }
  if (httpHeadersTimeoutMs <= httpKeepAliveTimeoutMs) {
    throw new Error('HTTP_HEADERS_TIMEOUT_MS must be greater than HTTP_KEEP_ALIVE_TIMEOUT_MS');
  }

  return {
    port: positiveInteger(environment, 'PORT', 3200),
    apiKey,
    rateLimitRpm: positiveInteger(environment, 'RATE_LIMIT_RPM', 60),
    metaAccessToken: environment.META_ACCESS_TOKEN,
    metaAdAccountId: environment.META_AD_ACCOUNT_ID,
    metaApiVersion: environment.META_API_VERSION || 'v21.0',
    sessionIdleTtlMs: positiveInteger(environment, 'MCP_SESSION_IDLE_TTL_MS', 30 * 60 * 1000),
    maxSessions,
    sessionAlertThreshold,
    heapAlertBytes: positiveInteger(environment, 'MCP_HEAP_ALERT_BYTES', 300 * 1024 * 1024),
    httpKeepAliveTimeoutMs,
    httpHeadersTimeoutMs,
    shutdownGraceMs: positiveInteger(environment, 'SHUTDOWN_GRACE_MS', DEFAULT_SHUTDOWN_GRACE_MS),
  };
}

export const config = loadConfig(process.env);
