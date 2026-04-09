import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { config } from './config.js';
import { authMiddleware } from './auth.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { loggerMiddleware } from './middleware/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { createMcpServer } from './server.js';

const app = express();

app.use(helmet());
app.use(loggerMiddleware);

// Health check — sem auth e sem rate limit
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'meta-ads-mcp-server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.use(rateLimiter);
app.use(authMiddleware);

// Gerenciamento de sessões MCP
const transports: Record<string, StreamableHTTPServerTransport> = {};

// POST /mcp — requisições principais
app.post('/mcp', express.json(), async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport;
        console.log(`[MCP] Sessão iniciada: ${id}`);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
        console.log(`[MCP] Sessão encerrada: ${transport.sessionId}`);
      }
    };

    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Sessão inválida ou ausente. Envie um initialize request primeiro.' },
    id: null,
  });
});

// GET /mcp — SSE stream para notificações
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res);
  } else {
    res.status(400).json({ error: 'Session ID inválido ou ausente' });
  }
});

// DELETE /mcp — encerrar sessão
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res);
  } else {
    res.status(400).json({ error: 'Session ID inválido ou ausente' });
  }
});

app.use(errorHandler);

const httpServer = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[SERVER] Meta Ads MCP Server v1.0.0`);
  console.log(`[SERVER] Health: http://0.0.0.0:${config.port}/health`);
  console.log(`[SERVER] MCP:    http://0.0.0.0:${config.port}/mcp`);
});

function shutdown(signal: string) {
  console.log(`[SERVER] ${signal} recebido, encerrando graciosamente...`);
  httpServer.close(() => {
    console.log('[SERVER] HTTP server encerrado');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
