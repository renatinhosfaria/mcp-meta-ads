import assert from 'node:assert/strict';
import test from 'node:test';
import { captureTools, withGraphMock } from './helpers/graph-mock.ts';
import type { GraphCall } from './helpers/graph-mock.ts';
import { createTestDeps } from './helpers/instagram-deps.ts';
import { registerInstagramPublishingTools } from '../src/tools/instagram/publishing.ts';

const fakeSleep = async () => undefined;
const setup = () => {
  const { deps } = createTestDeps();
  const withSleep = { ...deps, sleep: fakeSleep };
  return { deps: withSleep, tools: captureTools((s) => registerInstagramPublishingTools(s as never, withSleep)) };
};
type Res = { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> };

function responder(status: (n: number) => Record<string, unknown>, opts: { ids?: string[] } = {}) {
  let polls = 0;
  const ids = [...(opts.ids ?? ['c1'])];
  return (c: GraphCall) => {
    if (c.method === 'POST' && c.url.endsWith('/ig-1/media')) return { id: ids.shift() ?? 'cx', uri: 'https://rupload.test/up' };
    if (c.method === 'POST' && c.url.endsWith('/media_publish')) return { id: 'm1' };
    if (c.method === 'POST') return {};
    if (c.url.endsWith('/m1')) return { id: 'm1', permalink: 'https://instagram.com/p/x' };
    return status(++polls);
  };
}

test('registers publishing tools', () => {
  const names = [...setup().tools.keys()];
  for (const n of ['meta_ig_publish_photo', 'meta_ig_publish_carousel', 'meta_ig_publish_reel', 'meta_ig_publish_story',
    'meta_ig_get_container_status', 'meta_ig_publish_container']) assert.ok(names.includes(n), n);
});

test('publish_photo by url runs create, status, publish, permalink in order', async () => {
  const { tools } = setup();
  await withGraphMock(responder(() => ({ status_code: 'FINISHED' })), async (calls) => {
    const res = (await tools.get('meta_ig_publish_photo')!.handler({
      media: { url: 'https://img.test/a.jpg' }, caption: 'oi',
    })) as Res;
    assert.equal(res.isError, undefined);
    assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET', 'POST', 'GET']);
    assert.ok(calls[0].url.endsWith('/ig-1/media'));
    assert.deepEqual(calls[0].data, { image_url: 'https://img.test/a.jpg', caption: 'oi' });
    assert.ok(calls[1].url.endsWith('/c1'));
    assert.equal(calls[1].params.fields, 'status_code,status');
    assert.ok(calls[2].url.endsWith('/ig-1/media_publish'));
    assert.deepEqual(calls[2].data, { creation_id: 'c1' });
    assert.ok(calls[3].url.endsWith('/m1'));
    assert.equal(res.structuredContent?.status, 'PUBLISHED');
    assert.equal(res.structuredContent?.permalink, 'https://instagram.com/p/x');
  });
});

test('publish_photo by upload_id removes the upload after PUBLISHED', async () => {
  const { tools, deps } = setup();
  const up = await deps.uploads.saveBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'image/jpeg');
  await withGraphMock(responder(() => ({ status_code: 'FINISHED' })), async (calls) => {
    const res = (await tools.get('meta_ig_publish_photo')!.handler({ media: { upload_id: up.id } })) as Res;
    assert.equal(res.structuredContent?.status, 'PUBLISHED');
    assert.match(String((calls[0].data as Record<string, unknown>).image_url), /^https:\/\/example\.test\//);
  });
  assert.equal(deps.uploads.get(up.id), undefined);
});

test('still IN_PROGRESS at the limit returns IN_PROGRESS and keeps the upload', async () => {
  const { tools, deps } = setup();
  const up = await deps.uploads.saveBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'image/jpeg');
  await withGraphMock(responder(() => ({ status_code: 'IN_PROGRESS' })), async (calls) => {
    const res = (await tools.get('meta_ig_publish_photo')!.handler({ media: { upload_id: up.id }, wait_seconds: 3 })) as Res;
    assert.equal(res.structuredContent?.status, 'IN_PROGRESS');
    assert.equal(res.structuredContent?.container_id, 'c1');
    assert.ok(!calls.some((c) => c.url.endsWith('/media_publish')));
  });
  assert.ok(deps.uploads.get(up.id));
});

test('publish_container later publishes and then removes the upload', async () => {
  const { tools, deps } = setup();
  const up = await deps.uploads.saveBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'image/jpeg');
  await withGraphMock(responder(() => ({ status_code: 'IN_PROGRESS' })), async () => {
    await tools.get('meta_ig_publish_photo')!.handler({ media: { upload_id: up.id }, wait_seconds: 3 });
  });
  assert.ok(deps.uploads.get(up.id));
  await withGraphMock(responder(() => ({ status_code: 'FINISHED' })), async () => {
    const res = (await tools.get('meta_ig_publish_container')!.handler({ container_id: 'c1' })) as Res;
    assert.equal(res.structuredContent?.status, 'PUBLISHED');
  });
  assert.equal(deps.uploads.get(up.id), undefined);
});

test('ERROR status is surfaced with Meta status text', async () => {
  const { tools, deps } = setup();
  const up = await deps.uploads.saveBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'image/jpeg');
  await withGraphMock(responder(() => ({ status_code: 'ERROR', status: 'Error: bad aspect ratio' })), async () => {
    const res = (await tools.get('meta_ig_publish_photo')!.handler({ media: { upload_id: up.id } })) as Res;
    assert.equal(res.structuredContent?.status, 'ERROR');
    assert.match(String(res.structuredContent?.detail), /bad aspect ratio/);
  });
  assert.ok(deps.uploads.get(up.id));
});

test('publish_carousel rejects 1 item and builds children then parent with 2', async () => {
  const { tools } = setup();
  const schema = tools.get('meta_ig_publish_carousel')!.config.inputSchema as { safeParse: (v: unknown) => { success: boolean } };
  const item = { media_type: 'image', media: { url: 'https://img.test/a.jpg' } };
  assert.equal(schema.safeParse({ items: [item] }).success, false);
  assert.equal(schema.safeParse({ items: [item, item] }).success, true);

  await withGraphMock(responder(() => ({ status_code: 'FINISHED' }), { ids: ['c1', 'c2', 'cp'] }), async (calls) => {
    const res = (await tools.get('meta_ig_publish_carousel')!.handler({
      items: [item, { media_type: 'video', media: { url: 'https://v.test/a.mp4' } }], caption: 'x',
    })) as Res;
    assert.equal(res.structuredContent?.status, 'PUBLISHED');
    const posts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/ig-1/media'));
    assert.deepEqual(posts[0].data, { is_carousel_item: true, image_url: 'https://img.test/a.jpg' });
    assert.deepEqual(posts[1].data, { is_carousel_item: true, media_type: 'VIDEO', video_url: 'https://v.test/a.mp4' });
    assert.deepEqual(posts[2].data, { media_type: 'CAROUSEL', children: 'c1,c2', caption: 'x' });
    const parentIdx = calls.indexOf(posts[2]);
    assert.ok(calls.slice(0, parentIdx).some((c) => c.method === 'GET' && c.url.endsWith('/c2')));
  });
});

test('publish_reel with upload_id uses resumable upload with offset and file_size headers', async () => {
  const { tools, deps } = setup();
  const up = await deps.uploads.saveBuffer(Buffer.from('00000018667479706d703432', 'hex'), 'video/mp4');
  await withGraphMock(responder(() => ({ status_code: 'FINISHED' })), async (calls) => {
    const res = (await tools.get('meta_ig_publish_reel')!.handler({ video: { upload_id: up.id }, caption: 'r' })) as Res;
    assert.equal(res.structuredContent?.status, 'PUBLISHED');
    assert.deepEqual(calls[0].data, { media_type: 'REELS', caption: 'r', share_to_feed: true, upload_type: 'resumable' });
    assert.equal(calls[1].url, 'https://rupload.test/up');
    assert.equal(calls[1].headers.offset, '0');
    assert.equal(calls[1].headers.file_size, String(up.sizeBytes));
    assert.equal(calls[1].headers.Authorization, 'OAuth test-token');
    assert.ok(!JSON.stringify(res).includes('test-token'));
  });
  assert.equal(deps.uploads.get(up.id), undefined);
});

test('publish_story by url video and get_container_status', async () => {
  const { tools } = setup();
  await withGraphMock(responder(() => ({ status_code: 'FINISHED' })), async (calls) => {
    await tools.get('meta_ig_publish_story')!.handler({ story_media_type: 'video', media: { url: 'https://v.test/a.mp4' } });
    assert.deepEqual(calls[0].data, { media_type: 'STORIES', video_url: 'https://v.test/a.mp4' });
    const st = (await tools.get('meta_ig_get_container_status')!.handler({ container_id: 'c9' })) as Res;
    assert.equal(st.structuredContent?.status_code, 'FINISHED');
  });
});
