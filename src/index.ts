import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { authMiddleware } from './auth.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { createMcpServer } from './server.js';
import { createMetaAdsApp } from './app.js';
import { SessionRegistry } from './session-registry.js';

const registry = new SessionRegistry<StreamableHTTPServerTransport, ReturnType<typeof createMcpServer>>({
  idleTtlMs: 30 * 60 * 1000,
  maxSessions: 250,
});
const runtime = createMetaAdsApp({
  registry,
  authMiddleware,
  rateLimiter,
  createServer: createMcpServer,
  createTransport: (onSessionInitialized) => new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: onSessionInitialized,
  }),
});

const httpServer = runtime.app.listen(config.port, '0.0.0.0', () => {
  console.log(`[SERVER] Meta Ads MCP Server v1.0.0`);
  console.log(`[SERVER] Health: http://0.0.0.0:${config.port}/health`);
  console.log(`[SERVER] MCP:    http://0.0.0.0:${config.port}/mcp`);
});

async function shutdown(signal: string) {
  console.log(`[SERVER] ${signal} recebido, encerrando graciosamente...`);
  await runtime.close();
  httpServer.close(() => {
    console.log('[SERVER] HTTP server encerrado');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
