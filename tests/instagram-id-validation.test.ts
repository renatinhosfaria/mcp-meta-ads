import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { captureTools, withGraphMock } from './helpers/graph-mock.ts';
import { createTestDeps } from './helpers/instagram-deps.ts';
import { registerInstagramTools } from '../src/tools/instagram/index.ts';
import { toolResult } from '../src/instagram/tool-helpers.ts';
import { createMcpServer } from '../src/server.ts';

type Issue = { path: (string | number)[] };
type Schema = {
  shape: Record<string, unknown>;
  safeParse: (v: unknown) => { success: true } | { success: false; error: { issues: Issue[] } };
};

const CRAFTED = ['1?fields=access_token&x=', 'a/b', 'a#b', 'a b', '1.2', '%2F', ''];
// Campos *_id que não são IDs da Graph (não entram em URL da Meta).
const NOT_GRAPH_IDS = new Set(['destination_id']);

function igTools() {
  const { deps } = createTestDeps();
  return captureTools((s) => registerInstagramTools(s as never, deps));
}

const schemaOf = (tools: ReturnType<typeof igTools>, name: string) => tools.get(name)!.config.inputSchema as Schema;

function issuesAt(schema: Schema, input: Record<string, unknown>, key: string): number {
  const res = schema.safeParse(input);
  return res.success ? 0 : res.error.issues.filter((i) => i.path[0] === key).length;
}

test('IDs forjados são recusados nos schemas das ferramentas representativas; fixtures continuam válidas', () => {
  const tools = igTools();
  const cases: Array<[tool: string, key: string, base: Record<string, unknown>, valid: string]> = [
    ['meta_ig_get_account_insights', 'ig_user_id', {}, 'ig-1'],
    ['meta_ig_get_page_subscription', 'page_id', {}, 'page-1'],
    ['meta_ig_list_comments', 'media_id', {}, 'm1'],
    ['meta_ig_reply_comment', 'comment_id', { message: 'oi' }, 'c1'],
    ['meta_ig_get_conversation_messages', 'conversation_id', {}, 'aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE0='],
    ['meta_ig_get_message', 'message_id', {}, 'aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQx-_'],
    ['meta_ig_get_user_profile', 'igsid', {}, '1234567890'],
    ['meta_ig_get_media', 'media_id', {}, 'm1'],
    ['meta_ig_delete_media', 'media_id', {}, 'm1'],
    ['meta_ig_get_container_status', 'container_id', {}, 'c1'],
    ['meta_ig_list_accounts', 'business_id', {}, '123456'],
    ['meta_ig_get_hashtag_media', 'hashtag_id', {}, '123'],
    ['meta_ig_list_events', 'page_id', {}, 'page-1'],
  ];
  for (const [name, key, base, valid] of cases) {
    const schema = schemaOf(tools, name);
    for (const bad of CRAFTED) {
      assert.ok(issuesAt(schema, { ...base, [key]: bad }, key) > 0, `${name}.${key} aceitou ${JSON.stringify(bad)}`);
    }
    assert.equal(schema.safeParse({ ...base, [key]: valid }).success, true, `${name}.${key} recusou ${valid}`);
  }
});

test('todo campo *_id (e igsid) de toda ferramenta meta_ig_* recusa IDs forjados', () => {
  const tools = igTools();
  let checked = 0;
  for (const [name, reg] of tools) {
    const schema = reg.config.inputSchema as Schema;
    for (const key of Object.keys(schema.shape)) {
      if (!(key.endsWith('_id') || key === 'igsid') || NOT_GRAPH_IDS.has(key)) continue;
      for (const bad of CRAFTED) {
        assert.ok(issuesAt(schema, { [key]: bad }, key) > 0, `${name}.${key} aceitou ${JSON.stringify(bad)}`);
      }
      checked++;
    }
  }
  assert.ok(checked >= 40, `poucos campos verificados: ${checked}`);
});

test('pelo MCP, ID forjado vira erro de validação e nada chega à Graph', async () => {
  const { deps } = createTestDeps();
  const server = createMcpServer({ toolsets: ['instagram'], instagram: deps });
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'id-test', version: '1' });
  await Promise.all([server.connect(s), client.connect(c)]);
  try {
    await withGraphMock(() => ({ access_token: 'page-secret-token', data: [] }), async (calls) => {
      const probes: Array<[string, Record<string, unknown>]> = [
        ['meta_ig_get_account_insights', { ig_user_id: 'page-1?fields=access_token&x=' }],
        ['meta_ig_get_page_subscription', { page_id: 'page-1?fields=access_token&x=' }],
      ];
      for (const [name, args] of probes) {
        const out = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
        assert.equal(out.isError, true, name);
        assert.ok(!JSON.stringify(out).includes('page-secret-token'), name);
      }
      assert.equal(calls.length, 0);
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test('toolResult remove access_token em qualquer nível (texto e structuredContent)', () => {
  const res = toolResult({ a: 1, access_token: 'x', nested: { access_token: 'y', keep: 2 }, list: [{ access_token: 'z', id: 'k' }] });
  assert.ok(!res.content[0].text.includes('access_token'));
  assert.ok(!JSON.stringify(res.structuredContent).includes('access_token'));
  assert.deepEqual(res.structuredContent, { a: 1, nested: { keep: 2 }, list: [{ id: 'k' }] });
  const arr = toolResult([{ access_token: 'x', id: '1' }]);
  assert.deepEqual(arr.structuredContent, { items: [{ id: '1' }] });
  assert.ok(!arr.content[0].text.includes('access_token'));
});
