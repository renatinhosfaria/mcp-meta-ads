import assert from 'node:assert/strict';
import test from 'node:test';
import { captureTools, withGraphMock } from './helpers/graph-mock.ts';
import { registerInstagramAccountTools } from '../src/tools/instagram/account.ts';
import { registerInstagramMediaTools, MEDIA_FIELDS } from '../src/tools/instagram/media.ts';

function tools() {
  return captureTools((s) => {
    registerInstagramAccountTools(s as never);
    registerInstagramMediaTools(s as never);
  });
}

test('registers all account and media tools', () => {
  const names = [...tools().keys()];
  for (const n of [
    'meta_ig_get_profile', 'meta_ig_list_accounts', 'meta_ig_get_publishing_limit', 'meta_ig_list_media',
    'meta_ig_get_media', 'meta_ig_list_stories', 'meta_ig_list_tagged_media', 'meta_ig_set_comments_enabled',
    'meta_ig_delete_media',
  ]) assert.ok(names.includes(n), n);
});

test('get_profile uses default and overridden ig user', async () => {
  const t = tools().get('meta_ig_get_profile')!;
  await withGraphMock(() => ({ id: 'x' }), async (calls) => {
    await t.handler({});
    await t.handler({ ig_user_id: 'ig-2' });
    assert.ok(calls[0].url.endsWith('/ig-1'));
    assert.match(String(calls[0].params.fields), /biography/);
    assert.ok(calls[1].url.endsWith('/ig-2'));
  });
});

test('set_comments_enabled posts comment_enabled body', async () => {
  const t = tools().get('meta_ig_set_comments_enabled')!;
  await withGraphMock(() => ({ success: true }), async (calls) => {
    await t.handler({ media_id: 'm1', enabled: false });
    assert.equal(calls[0].method, 'POST');
    assert.ok(calls[0].url.endsWith('/m1'));
    assert.deepEqual(calls[0].data, { comment_enabled: false });
  });
});

test('list_media respects limit and converts dates', async () => {
  const t = tools().get('meta_ig_list_media')!;
  const data = Array.from({ length: 5 }, (_, i) => ({ id: String(i) }));
  await withGraphMock(() => ({ data }), async (calls) => {
    const res = (await t.handler({ limit: 3, since: '2026-01-01T00:00:00Z' })) as { structuredContent: { media: unknown[] } };
    assert.equal(res.structuredContent.media.length, 3);
    assert.equal(calls[0].params.since, 1767225600);
    assert.equal(calls[0].params.fields, MEDIA_FIELDS);
  });
});

test('delete_media sends DELETE', async () => {
  const t = tools().get('meta_ig_delete_media')!;
  await withGraphMock(() => ({ success: true }), async (calls) => {
    await t.handler({ media_id: 'm9' });
    assert.equal(calls[0].method, 'DELETE');
    assert.ok(calls[0].url.endsWith('/m9'));
  });
});

test('list_accounts merges business and page accounts without duplicates', async () => {
  const t = tools().get('meta_ig_list_accounts')!;
  const prev = process.env.META_BUSINESS_ID;
  process.env.META_BUSINESS_ID = 'biz-1';
  try {
    await withGraphMock(
      (c) => c.url.endsWith('/owned_instagram_accounts')
        ? { data: [{ id: 'a', username: 'A' }, { id: 'b', username: 'B' }] }
        : { instagram_business_account: { id: 'b', username: 'B' } },
      async () => {
        const res = (await t.handler({})) as { structuredContent: { total: number } };
        assert.equal(res.structuredContent.total, 2);
      }
    );
  } finally {
    if (prev === undefined) delete process.env.META_BUSINESS_ID;
    else process.env.META_BUSINESS_ID = prev;
  }
});
