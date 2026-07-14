import { createServer, type Server } from 'node:http';
import type { Express } from 'express';

export const DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS = 95_000;
export const DEFAULT_HTTP_HEADERS_TIMEOUT_MS = 100_000;
export const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

type HttpServerOptions = {
  keepAliveTimeoutMs?: number;
  headersTimeoutMs?: number;
};

type ClosableRuntime = {
  close(): Promise<void>;
};

export function createConfiguredHttpServer(app: Express, options: HttpServerOptions = {}): Server {
  const server = createServer(app);
  server.keepAliveTimeout = options.keepAliveTimeoutMs ?? DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = options.headersTimeoutMs ?? DEFAULT_HTTP_HEADERS_TIMEOUT_MS;
  return server;
}

export async function shutdownHttpServer(
  server: Server,
  runtime: ClosableRuntime,
  graceMs = DEFAULT_SHUTDOWN_GRACE_MS,
): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (error && code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
    });
  });
  let forceTimer: NodeJS.Timeout | undefined;
  const graceElapsed = new Promise<void>((resolve) => {
    forceTimer = setTimeout(() => {
      server.closeAllConnections();
      resolve();
    }, graceMs);
  });
  const cleanup = Promise.resolve().then(() => runtime.close());

  try {
    await Promise.race([
      Promise.all([cleanup, closed]).then(() => undefined),
      graceElapsed,
    ]);
  } finally {
    if (forceTimer) clearTimeout(forceTimer);
  }
}
