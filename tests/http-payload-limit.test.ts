import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const apiKey = 'payload-limit-test-key';
let server: ChildProcessWithoutNullStreams;
let baseUrl: string;
let serverOutput = '';

async function reservePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  listener.close();
  await once(listener, 'close');
  return port;
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Servidor encerrou antes do health check:\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // O processo ainda está inicializando.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Servidor não ficou saudável no prazo:\n${serverOutput}`);
}

async function postMcp(paddingSize: number): Promise<Response> {
  return fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { padding: 'x'.repeat(paddingSize) },
    }),
  });
}

before(async () => {
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const entrypoint = fileURLToPath(new URL('../src/index.ts', import.meta.url));

  server = spawn(process.execPath, ['--import', 'tsx', entrypoint], {
    env: {
      ...process.env,
      API_KEY: apiKey,
      PORT: String(port),
      RATE_LIMIT_RPM: '1000',
    },
  });

  server.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });

  await waitForHealth();
});

after(async () => {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
});

test('POST /mcp accepts a JSON body larger than the Express 100 KB default', async () => {
  const response = await postMcp(177_433);

  assert.equal(response.status, 400);
  assert.match(await response.text(), /Sessão inválida ou ausente/);
});

test('POST /mcp preserves 413 for a JSON body larger than 1 MB', async () => {
  const response = await postMcp(1_100_000);

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: 'Payload excede o limite permitido.',
  });
});
