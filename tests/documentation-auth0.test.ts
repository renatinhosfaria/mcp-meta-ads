import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('environment example documents Auth0 without real credentials', async () => {
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  for (const name of ['AUTH0_ISSUER', 'AUTH0_AUDIENCE', 'AUTH0_RESOURCE', 'AUTH0_REQUIRED_SCOPES']) {
    assert.match(env, new RegExp(`^${name}=`, 'm'));
  }
  assert.ok(!env.includes('auth0.com/tenant-secret'));
});

test('Auth0 setup guide covers OAuth discovery, PKCE, scopes and legacy API key', async () => {
  const guide = await readFile(new URL('../docs/auth0-setup.md', import.meta.url), 'utf8');
  for (const text of [
    'AUTH0_ISSUER', 'AUTH0_AUDIENCE', '/.well-known/oauth-protected-resource', '/mcp',
    'PKCE', 'S256', 'mcp:access', 'API key', 'não cole', 'chatgpt.com/connector',
  ]) assert.match(guide, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.ok(!guide.includes('AUTH0_CLIENT_SECRET='));
});

test('main documentation points to Auth0 setup and does not suggest unauthenticated ChatGPT access', async () => {
  const docs = await readFile(new URL('../DOCUMENTATION.md', import.meta.url), 'utf8');
  assert.match(docs, /docs\/auth0-setup\.md/);
  assert.doesNotMatch(docs, /No authentication.*mcp-facebook-ads/i);
});

test('gateway OAuth guide points ChatGPT to the shared gateway and preserves backend namespacing', async () => {
  const guide = await readFile(new URL('../docs/gateway-oauth-setup.md', import.meta.url), 'utf8');
  assert.match(guide, /https:\/\/mcp-auth\.famachat\.com\.br\/mcp/);
  assert.match(guide, /meta-ads_meta_list_ad_accounts/);
  assert.match(guide, /META_ADS_AUTH_TOKEN/);
  assert.match(guide, /ai-memory/);
});
