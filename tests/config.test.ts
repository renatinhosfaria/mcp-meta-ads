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

test('loadConfig applies Instagram defaults', () => {
  const c = loadConfig({ API_KEY: 'k' });
  assert.equal(c.dataDir, './data');
  assert.equal(c.publicBaseUrl, 'https://mcp-facebook-ads.famachat.com.br');
  assert.equal(c.metaAppSecret, undefined);
});

test('loadConfig strips trailing slash and rejects non-https PUBLIC_BASE_URL', () => {
  assert.equal(loadConfig({ API_KEY: 'k', PUBLIC_BASE_URL: 'https://x.test/' }).publicBaseUrl, 'https://x.test');
  assert.throws(() => loadConfig({ API_KEY: 'k', PUBLIC_BASE_URL: 'http://x.test' }), /PUBLIC_BASE_URL/);
});

test('loadConfig leaves Auth0 disabled by default', () => {
  assert.equal(loadConfig({ API_KEY: 'k' }).auth0, undefined);
});

test('loadConfig builds Auth0 resource configuration and defaults the scope', () => {
  assert.deepEqual(loadConfig({
    API_KEY: 'k',
    AUTH0_ISSUER: 'https://tenant.eu.auth0.com',
    AUTH0_AUDIENCE: 'https://mcp.example.test',
    PUBLIC_BASE_URL: 'https://mcp.example.test/',
  }).auth0, {
    issuer: 'https://tenant.eu.auth0.com/',
    audience: 'https://mcp.example.test',
    resource: 'https://mcp.example.test',
    scopes: ['mcp:access'],
  });
});

test('loadConfig accepts configured Auth0 scopes', () => {
  assert.deepEqual(loadConfig({
    API_KEY: 'k',
    AUTH0_ISSUER: 'https://tenant.auth0.com/',
    AUTH0_AUDIENCE: 'https://mcp.example.test',
    AUTH0_RESOURCE: 'https://resource.example.test/',
    AUTH0_REQUIRED_SCOPES: 'mcp:read mcp:write',
  }).auth0?.scopes, ['mcp:read', 'mcp:write']);
});

test('loadConfig rejects partial or non-https Auth0 configuration', () => {
  assert.throws(() => loadConfig({ API_KEY: 'k', AUTH0_ISSUER: 'https://tenant.auth0.com' }), /AUTH0_ISSUER.*AUTH0_AUDIENCE/);
  assert.throws(() => loadConfig({ API_KEY: 'k', AUTH0_AUDIENCE: 'https://mcp.example.test' }), /AUTH0_ISSUER.*AUTH0_AUDIENCE/);
  assert.throws(() => loadConfig({
    API_KEY: 'k', AUTH0_ISSUER: 'http://tenant.auth0.com', AUTH0_AUDIENCE: 'https://mcp.example.test',
  }), /AUTH0_ISSUER/);
  assert.throws(() => loadConfig({
    API_KEY: 'k', AUTH0_ISSUER: 'https://tenant.auth0.com', AUTH0_AUDIENCE: 'mcp-example',
  }), /AUTH0_AUDIENCE/);
  assert.throws(() => loadConfig({
    API_KEY: 'k', AUTH0_ISSUER: 'https://tenant.auth0.com', AUTH0_AUDIENCE: 'https://mcp.example.test',
    AUTH0_RESOURCE: 'http://mcp.example.test',
  }), /AUTH0_RESOURCE/);
});
