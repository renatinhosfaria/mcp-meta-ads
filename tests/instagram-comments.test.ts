import assert from 'node:assert/strict';
import test from 'node:test';
import { captureTools, withGraphMock } from './helpers/graph-mock.ts';
import { registerInstagramCommentTools } from '../src/tools/instagram/comments.ts';

const tools = () => captureTools((s) => registerInstagramCommentTools(s as never));

test('registers all comment and mention tools', () => {
  const names = [...tools().keys()];
  for (const n of [
    'meta_ig_list_comments', 'meta_ig_list_comment_replies', 'meta_ig_comment_on_media', 'meta_ig_reply_comment',
    'meta_ig_hide_comment', 'meta_ig_delete_comment', 'meta_ig_private_reply', 'meta_ig_get_mention', 'meta_ig_reply_mention',
  ]) assert.ok(names.includes(n), n);
});

test('list_comments paginates media comments', async () => {
  const t = tools().get('meta_ig_list_comments')!;
  await withGraphMock(() => ({ data: [{ id: 'c1' }] }), async (calls) => {
    const res = (await t.handler({ media_id: 'm1', limit: 5 })) as { structuredContent: { total: number } };
    assert.equal(res.structuredContent.total, 1);
    assert.ok(calls[0].url.endsWith('/m1/comments'));
    assert.match(String(calls[0].params.fields), /replies\{/);
  });
});

test('list_comment_replies paginates replies', async () => {
  const t = tools().get('meta_ig_list_comment_replies')!;
  await withGraphMock(() => ({ data: [] }), async (calls) => {
    await t.handler({ comment_id: 'c1', limit: 5 });
    assert.ok(calls[0].url.endsWith('/c1/replies'));
  });
});

test('comment_on_media and reply_comment post message', async () => {
  await withGraphMock(() => ({ id: 'new' }), async (calls) => {
    await tools().get('meta_ig_comment_on_media')!.handler({ media_id: 'm1', message: 'Olá' });
    await tools().get('meta_ig_reply_comment')!.handler({ comment_id: 'c1', message: 'Oi' });
    assert.equal(calls[0].method, 'POST');
    assert.ok(calls[0].url.endsWith('/m1/comments'));
    assert.deepEqual(calls[0].data, { message: 'Olá' });
    assert.ok(calls[1].url.endsWith('/c1/replies'));
    assert.deepEqual(calls[1].data, { message: 'Oi' });
  });
});

test('hide_comment sends hide boolean', async () => {
  await withGraphMock(() => ({ success: true }), async (calls) => {
    await tools().get('meta_ig_hide_comment')!.handler({ comment_id: 'c1', hide: true });
    assert.equal(calls[0].method, 'POST');
    assert.ok(calls[0].url.endsWith('/c1'));
    assert.deepEqual(calls[0].data, { hide: true });
  });
});

test('delete_comment uses DELETE', async () => {
  await withGraphMock(() => ({ success: true }), async (calls) => {
    await tools().get('meta_ig_delete_comment')!.handler({ comment_id: 'c1' });
    assert.equal(calls[0].method, 'DELETE');
    assert.ok(calls[0].url.endsWith('/c1'));
  });
});

test('private_reply uses the page token and never leaks it', async () => {
  await withGraphMock(
    (c) => (c.method === 'GET' ? { access_token: 'page-token' } : { recipient_id: 'r', message_id: 'mid' }),
    async (calls) => {
      const res = await tools().get('meta_ig_private_reply')!.handler({ comment_id: 'c1', message: 'Oi' });
      assert.equal(calls[0].method, 'GET');
      assert.ok(calls[0].url.endsWith('/page-1'));
      assert.equal(calls[1].method, 'POST');
      assert.ok(calls[1].url.endsWith('/page-1/messages'));
      assert.equal(calls[1].params.access_token, 'page-token');
      assert.deepEqual(calls[1].data, { recipient: { comment_id: 'c1' }, message: { text: 'Oi' } });
      assert.ok(!JSON.stringify(res).includes('page-token'));
    }
  );
});

test('get_mention builds media expansion and optional comment expansion', async () => {
  const t = tools().get('meta_ig_get_mention')!;
  await withGraphMock(() => ({ id: 'ig-1' }), async (calls) => {
    await t.handler({ media_id: '123' });
    await t.handler({ media_id: '123', comment_id: '456' });
    assert.ok(calls[0].url.endsWith('/ig-1'));
    assert.match(String(calls[0].params.fields), /mentioned_media\.media_id\(123\)\{/);
    assert.ok(!String(calls[0].params.fields).includes('mentioned_comment'));
    assert.match(String(calls[1].params.fields), /mentioned_comment\.comment_id\(456\)\{/);
  });
});

test('get_mention rejects non-numeric ids in the schema', () => {
  const schema = tools().get('meta_ig_get_mention')!.config.inputSchema as { safeParse: (v: unknown) => { success: boolean } };
  assert.equal(schema.safeParse({ media_id: '1){x}' }).success, false);
  assert.equal(schema.safeParse({ media_id: '1', comment_id: 'a' }).success, false);
  assert.equal(schema.safeParse({ media_id: '123' }).success, true);
});

test('reply_mention posts to ig mentions', async () => {
  await withGraphMock(() => ({ id: 'x' }), async (calls) => {
    await tools().get('meta_ig_reply_mention')!.handler({ media_id: '1', comment_id: '2', message: 'Valeu' });
    assert.ok(calls[0].url.endsWith('/ig-1/mentions'));
    assert.deepEqual(calls[0].data, { media_id: '1', comment_id: '2', message: 'Valeu' });
  });
});
