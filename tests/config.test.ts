import assert from 'node:assert/strict';
import test from 'node:test';

process.env.API_KEY = 'config-module-test-key';
const { loadConfig } = await import('../src/config.ts');

test('loadConfig supplies safe session and HTTP lifecycle defaults', () => {
  const config = loadConfig({ API_KEY: 'test-key' });

  assert.equal(config.sessionIdleTtlMs, 1_800_000);
  assert.equal(config.maxSessions, 250);
  assert.equal(config.sessionAlertThreshold, 150);
  assert.equal(config.heapAlertBytes, 300 * 1024 * 1024);
  assert.equal(config.httpKeepAliveTimeoutMs, 95_000);
  assert.equal(config.httpHeadersTimeoutMs, 100_000);
  assert.equal(config.shutdownGraceMs, 10_000);
});

test('loadConfig accepts explicit lifecycle limits', () => {
  const config = loadConfig({
    API_KEY: 'test-key',
    MCP_SESSION_IDLE_TTL_MS: '60000',
    MCP_MAX_SESSIONS: '25',
    MCP_SESSION_ALERT_THRESHOLD: '20',
    MCP_HEAP_ALERT_BYTES: '123456',
    HTTP_KEEP_ALIVE_TIMEOUT_MS: '70000',
    HTTP_HEADERS_TIMEOUT_MS: '75000',
    SHUTDOWN_GRACE_MS: '5000',
  });

  assert.equal(config.sessionIdleTtlMs, 60_000);
  assert.equal(config.maxSessions, 25);
  assert.equal(config.sessionAlertThreshold, 20);
  assert.equal(config.heapAlertBytes, 123_456);
  assert.equal(config.httpKeepAliveTimeoutMs, 70_000);
  assert.equal(config.httpHeadersTimeoutMs, 75_000);
  assert.equal(config.shutdownGraceMs, 5_000);
});

test('loadConfig rejects invalid timeout relationships', () => {
  assert.throws(() => loadConfig({
    API_KEY: 'test-key',
    HTTP_KEEP_ALIVE_TIMEOUT_MS: '95000',
    HTTP_HEADERS_TIMEOUT_MS: '90000',
  }), /HTTP_HEADERS_TIMEOUT_MS must be greater/);
});
