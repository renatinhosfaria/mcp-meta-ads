import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { createAuthMiddleware } from './auth.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { createMcpServer } from './server.js';
import { createMetaAdsApp } from './app.js';
import { SessionRegistry } from './session-registry.js';
import { createConfiguredHttpServer, shutdownHttpServer } from './http-server.js';
import { createInstagramRuntime } from './instagram/runtime.js';
import { resolveDeploymentMetadata } from './deployment-metadata.js';
import { createProtectedResourceRouter } from './oauth/protected-resource.js';

const deploymentMetadata = resolveDeploymentMetadata();

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
const instagram = createInstagramRuntime({
  dataDir: config.dataDir,
  publicBaseUrl: config.publicBaseUrl,
  appSecret: config.metaAppSecret,
  verifyToken: config.webhookVerifyToken,
});
if (!config.metaAppSecret) console.warn('[SERVER] META_APP_SECRET ausente: POST /webhooks/meta responderá 503');
if (!config.webhookVerifyToken) console.warn('[SERVER] META_WEBHOOK_VERIFY_TOKEN ausente: GET /webhooks/meta responderá 503');
const runtime = createMetaAdsApp({
  registry,
  authMiddleware: createAuthMiddleware({ apiKey: config.apiKey, auth0: config.auth0 }),
  publicRoutes: [createProtectedResourceRouter(config.auth0), ...instagram.publicRoutes],
  protectedRoutes: instagram.protectedRoutes,
  rateLimiter,
  sessionAlertThreshold: config.sessionAlertThreshold,
  heapAlertBytes: config.heapAlertBytes,
  deploymentMetadata,
  sweepIntervalMs: Math.min(60_000, Math.max(1_000, Math.floor(config.sessionIdleTtlMs / 2))),
  createServer: ({ toolsets }) => createMcpServer({ toolsets, instagram: instagram.deps }),
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
  console.log(
    `[SERVER] Meta Ads MCP Server v${deploymentMetadata.version} `
    + `git_sha=${deploymentMetadata.gitSha} deployment_id=${deploymentMetadata.deploymentId}`,
  );
  console.log(`[SERVER] Health: http://0.0.0.0:${config.port}/health`);
  console.log(`[SERVER] MCP:    http://0.0.0.0:${config.port}/mcp`);
  instagram.start();
});

async function shutdown(signal: string) {
  console.log(`[SERVER] ${signal} recebido, encerrando graciosamente...`);
  await shutdownHttpServer(httpServer, runtime, config.shutdownGraceMs);
  console.log('[SERVER] HTTP server encerrado');
  await instagram.stop();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
