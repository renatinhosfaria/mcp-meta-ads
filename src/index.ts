import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { authMiddleware } from './auth.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { createMcpServer } from './server.js';
import { createMetaAdsApp } from './app.js';
import { SessionRegistry } from './session-registry.js';
import { createConfiguredHttpServer, shutdownHttpServer } from './http-server.js';

const registry = new SessionRegistry<StreamableHTTPServerTransport, ReturnType<typeof createMcpServer>>({
  idleTtlMs: config.sessionIdleTtlMs,
  maxSessions: config.maxSessions,
  onEvent: (event) => {
    console.log(
      `[MCP] session_event=${event.type} session_id=${event.sessionId} `
      + `active_sessions=${event.activeSessions}${event.reason ? ` reason=${event.reason}` : ''}`,
    );
  },
});
const runtime = createMetaAdsApp({
  registry,
  authMiddleware,
  rateLimiter,
  sessionAlertThreshold: config.sessionAlertThreshold,
  heapAlertBytes: config.heapAlertBytes,
  sweepIntervalMs: Math.min(60_000, Math.max(1_000, Math.floor(config.sessionIdleTtlMs / 2))),
  createServer: createMcpServer,
  createTransport: (onSessionInitialized) => new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: onSessionInitialized,
  }),
});

const httpServer = createConfiguredHttpServer(runtime.app, {
  keepAliveTimeoutMs: config.httpKeepAliveTimeoutMs,
  headersTimeoutMs: config.httpHeadersTimeoutMs,
});
httpServer.listen(config.port, '0.0.0.0', () => {
  console.log(`[SERVER] Meta Ads MCP Server v1.0.0`);
  console.log(`[SERVER] Health: http://0.0.0.0:${config.port}/health`);
  console.log(`[SERVER] MCP:    http://0.0.0.0:${config.port}/mcp`);
});

async function shutdown(signal: string) {
  console.log(`[SERVER] ${signal} recebido, encerrando graciosamente...`);
  await shutdownHttpServer(httpServer, runtime, config.shutdownGraceMs);
  console.log('[SERVER] HTTP server encerrado');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
