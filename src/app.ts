import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import helmet from 'helmet';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { errorHandler } from './middleware/error-handler.js';
import { loggerMiddleware } from './middleware/logger.js';
import { SessionRegistry } from './session-registry.js';

export interface ManagedTransport {
  sessionId?: string;
  onclose?: () => void;
  handleRequest(req: unknown, res: unknown, parsedBody?: unknown): Promise<void>;
  close(): void | Promise<void>;
}

export interface ManagedServer {
  connect(transport: any): Promise<void>;
  close(): void | Promise<void>;
}

type CreateMetaAdsAppOptions<TTransport extends ManagedTransport, TServer extends ManagedServer> = {
  registry: SessionRegistry<TTransport, TServer>;
  createTransport(onSessionInitialized: (id: string) => void): TTransport;
  createServer(): TServer;
  authMiddleware: RequestHandler;
  rateLimiter: RequestHandler;
  sweepIntervalMs?: number;
  sessionAlertThreshold?: number;
  heapAlertBytes?: number;
  getProcessDiagnostics?: () => ProcessDiagnostics;
};

type ProcessDiagnostics = {
  uptimeSeconds: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
};

export type MetaAdsAppRuntime = {
  app: express.Express;
  close(): Promise<void>;
};

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export function createMetaAdsApp<TTransport extends ManagedTransport, TServer extends ManagedServer>(
  options: CreateMetaAdsAppOptions<TTransport, TServer>,
): MetaAdsAppRuntime {
  const app = express();
  const sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
  const sessionAlertThreshold = options.sessionAlertThreshold ?? 150;
  const heapAlertBytes = options.heapAlertBytes ?? 300 * 1024 * 1024;
  const getProcessDiagnostics = options.getProcessDiagnostics ?? (() => {
    const memory = process.memoryUsage();
    return {
      uptimeSeconds: process.uptime(),
      memory: {
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        rss: memory.rss,
      },
    };
  });
  let closing: Promise<void> | undefined;

  app.use(helmet());
  app.use(loggerMiddleware);

  app.get('/health', (_req, res) => {
    const diagnostics = getProcessDiagnostics();
    const stats = options.registry.stats;
    const degraded = options.registry.size >= sessionAlertThreshold
      || diagnostics.memory.heapUsed >= heapAlertBytes;

    res.status(200).json({
      status: degraded ? 'degraded' : 'healthy',
      service: 'meta-ads-mcp-server',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(diagnostics.uptimeSeconds),
      memory: {
        heap_used_bytes: diagnostics.memory.heapUsed,
        heap_total_bytes: diagnostics.memory.heapTotal,
        rss_bytes: diagnostics.memory.rss,
        alert_threshold_bytes: heapAlertBytes,
      },
      sessions: {
        active: options.registry.size,
        capacity: options.registry.capacity,
        alert_threshold: sessionAlertThreshold,
        ...stats,
      },
    });
  });

  app.use(options.rateLimiter);
  app.use(options.authMiddleware);

  app.post('/mcp', express.json({ limit: '1mb' }), asyncHandler(async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId) {
      const session = options.registry.get(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session ID inválido ou expirado' });
        return;
      }

      options.registry.touch(sessionId);
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (isInitializeRequest(req.body)) {
      let registration: Promise<void> | undefined;
      let transport!: TTransport;
      const server = options.createServer();

      transport = options.createTransport((id) => {
        registration = options.registry.add(id, { transport, server });
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          void options.registry.close(transport.sessionId, 'transport');
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      await registration;
      return;
    }

    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Sessão inválida ou ausente. Envie um initialize request primeiro.' },
      id: null,
    });
  }));

  app.get('/mcp', asyncHandler(async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const session = sessionId ? options.registry.get(sessionId) : undefined;
    if (!session || !sessionId) {
      res.status(sessionId ? 404 : 400).json({ error: 'Session ID inválido ou ausente' });
      return;
    }

    options.registry.touch(sessionId);
    await session.transport.handleRequest(req, res);
  }));

  app.delete('/mcp', asyncHandler(async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const session = sessionId ? options.registry.get(sessionId) : undefined;
    if (!session || !sessionId) {
      res.status(sessionId ? 404 : 400).json({ error: 'Session ID inválido ou ausente' });
      return;
    }

    options.registry.touch(sessionId);
    await session.transport.handleRequest(req, res);
    await options.registry.close(sessionId, 'explicit');
  }));

  app.use(errorHandler);

  const sweepTimer = sweepIntervalMs > 0
    ? setInterval(() => void options.registry.sweepExpired(), sweepIntervalMs)
    : undefined;
  sweepTimer?.unref();

  return {
    app,
    close() {
      if (!closing) {
        closing = (async () => {
          if (sweepTimer) clearInterval(sweepTimer);
          await options.registry.closeAll('shutdown');
        })();
      }
      return closing;
    },
  };
}
