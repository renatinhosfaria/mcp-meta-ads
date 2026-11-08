import assert from 'node:assert/strict';
import test from 'node:test';
import { captureTools, withGraphMock } from './helpers/graph-mock.ts';
import { defaultMediaMetrics, registerInstagramInsightTools } from '../src/tools/instagram/insights.ts';
import { registerInstagramDiscoveryTools } from '../src/tools/instagram/discovery.ts';

const insights = () => captureTools((s) => registerInstagramInsightTools(s as never));
const discovery = () => captureTools((s) => registerInstagramDiscoveryTools(s as never));

type Err = { isError?: boolean; content: { text: string }[] };

test('registers insight and discovery tools', () => {
  const i = [...insights().keys()];
  for (const n of ['meta_ig_get_account_insights', 'meta_ig_get_follower_demographics', 'meta_ig_get_media_insights']) assert.ok(i.includes(n), n);
  const d = [...discovery().keys()];
  for (const n of ['meta_ig_search_hashtag', 'meta_ig_get_hashtag_media', 'meta_ig_business_discovery']) assert.ok(d.includes(n), n);
});

test('defaultMediaMetrics picks list by product type', () => {
  assert.ok(defaultMediaMetrics('REELS', 'VIDEO').includes('ig_reels_avg_watch_time'));
  assert.ok(defaultMediaMetrics('STORY', 'IMAGE').includes('navigation'));
  assert.ok(defaultMediaMetrics('FEED', 'IMAGE').includes('profile_visits'));
  const carousel = defaultMediaMetrics('FEED', 'CAROUSEL_ALBUM');
  assert.ok(!carousel.includes('profile_visits') && !carousel.includes('follows') && carousel.includes('reach'));
});

test('account insights sends metric, period, total_value and unix dates', async () => {
  const t = insights().get('meta_ig_get_account_insights')!;
  await withGraphMock(() => ({ data: [] }), async (calls) => {
    await t.handler({ since: '2026-01-01', until: '2026-01-08', breakdown: 'media_product_type' });
    assert.ok(calls[0].url.endsWith('/ig-1/insights'));
    assert.equal(calls[0].params.period, 'day');
    assert.equal(calls[0].params.metric_type, 'total_value');
    assert.equal(calls[0].params.since, Date.parse('2026-01-01') / 1000);
    assert.equal(calls[0].params.until, Date.parse('2026-01-09') / 1000);
    assert.equal(calls[0].params.breakdown, 'media_product_type');
    assert.match(String(calls[0].params.metric), /accounts_engaged/);
  });
});

test('account insights defaults to the last 7 days', async () => {
  const t = insights().get('meta_ig_get_account_insights')!;
  await withGraphMock(() => ({ data: [] }), async (calls) => {
    await t.handler({});
    const span = Number(calls[0].params.until) - Number(calls[0].params.since);
    assert.equal(span, 7 * 86400);
  });
});

test('account insights: date-only until is inclusive, ISO datetime is exact', async () => {
  const t = insights().get('meta_ig_get_account_insights')!;
  await withGraphMock(() => ({ data: [] }), async (calls) => {
    await t.handler({ since: '2026-01-01', until: '2026-01-30' });
    assert.equal(calls[0].params.until, Date.parse('2026-01-31') / 1000);
    await t.handler({ since: '2026-01-01T00:00:00Z', until: '2026-01-05T12:00:00Z' });
    assert.equal(calls[1].params.until, Date.parse('2026-01-05T12:00:00Z') / 1000);
  });
});

test('account insights rejects 31 inclusive days', async () => {
  const t = insights().get('meta_ig_get_account_insights')!;
  await withGraphMock(() => ({ data: [] }), async (calls) => {
    const res = (await t.handler({ since: '2026-01-01', until: '2026-01-31' })) as Err;
    assert.equal(res.isError, true);
    assert.equal(calls.length, 0);
  });
});

test('account insights rejects ranges over 30 days', async () => {
  const t = insights().get('meta_ig_get_account_insights')!;
  await withGraphMock(() => ({ data: [] }), async (calls) => {
    const res = (await t.handler({ since: '2026-01-01', until: '2026-02-01' })) as Err;
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /30 dias/);
    assert.equal(calls.length, 0);
  });
});

test('follower demographics uses lifetime + timeframe + breakdown', async () => {
  const t = insights().get('meta_ig_get_follower_demographics')!;
  await withGraphMock(() => ({ data: [] }), async (calls) => {
    await t.handler({ breakdown: 'city' });
    await t.handler({ breakdown: 'age', audience: 'engaged', timeframe: 'last_30_days' });
    assert.equal(calls[0].params.metric, 'follower_demographics');
    assert.equal(calls[0].params.period, 'lifetime');
    assert.equal(calls[0].params.metric_type, 'total_value');
    assert.equal(calls[0].params.timeframe, 'this_month');
    assert.equal(calls[0].params.breakdown, 'city');
    assert.equal(calls[1].params.metric, 'engaged_audience_demographics');
    assert.equal(calls[1].params.timeframe, 'last_30_days');
  });
});

test('media insights fetches type then default metrics', async () => {
  const t = insights().get('meta_ig_get_media_insights')!;
  await withGraphMock(
    (c) => (c.url.endsWith('/m1') ? { media_type: 'VIDEO', media_product_type: 'REELS' } : { data: [] }),
    async (calls) => {
      await t.handler({ media_id: 'm1' });
      assert.equal(calls.length, 2);
      assert.equal(calls[0].params.fields, 'media_type,media_product_type');
      assert.ok(calls[1].url.endsWith('/m1/insights'));
      assert.equal(calls[1].params.metric, defaultMediaMetrics('REELS', 'VIDEO').join(','));
    }
  );
});

test('media insights on a carousel sends the carousel defaults', async () => {
  const t = insights().get('meta_ig_get_media_insights')!;
  await withGraphMock(
    (c) => (c.url.endsWith('/m2') ? { media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED' } : { data: [] }),
    async (calls) => {
      await t.handler({ media_id: 'm2' });
      assert.equal(calls[1].params.metric, defaultMediaMetrics('FEED', 'CAROUSEL_ALBUM').join(','));
      assert.ok(!String(calls[1].params.metric).includes('follows'));
    }
  );
});

test('media insights metrics param overrides defaults', async () => {
  const t = insights().get('meta_ig_get_media_insights')!;
  await withGraphMock(() => ({ data: [] }), async (calls) => {
    await t.handler({ media_id: 'm1', metrics: ['reach', 'views'] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.metric, 'reach,views');
  });
});

test('search_hashtag sends user_id and q', async () => {
  const t = discovery().get('meta_ig_search_hashtag')!;
  await withGraphMock(() => ({ data: [{ id: 'h1' }] }), async (calls) => {
    await t.handler({ query: 'viagem' });
    assert.ok(calls[0].url.endsWith('/ig_hashtag_search'));
    assert.equal(calls[0].params.user_id, 'ig-1');
    assert.equal(calls[0].params.q, 'viagem');
  });
});

test('hashtag_media uses top or recent edge and validates id', async () => {
  const t = discovery().get('meta_ig_get_hashtag_media')!;
  await withGraphMock(() => ({ data: [] }), async (calls) => {
    await t.handler({ hashtag_id: '123', edge: 'recent', limit: 5 });
    await t.handler({ hashtag_id: '123', edge: 'top', limit: 5 });
    assert.ok(calls[0].url.endsWith('/123/recent_media'));
    assert.ok(calls[1].url.endsWith('/123/top_media'));
    assert.equal(calls[0].params.user_id, 'ig-1');
    const bad = (await t.handler({ hashtag_id: '1/2', edge: 'top', limit: 5 })) as Err;
    assert.equal(bad.isError, true);
    assert.equal(calls.length, 2);
  });
});

test('business_discovery builds fields and rejects unsafe username', async () => {
  const t = discovery().get('meta_ig_business_discovery')!;
  await withGraphMock(() => ({ business_discovery: {} }), async (calls) => {
    await t.handler({ username: 'nasa', limit: 3 });
    assert.ok(calls[0].url.endsWith('/ig-1'));
    assert.match(String(calls[0].params.fields), /^business_discovery\.username\(nasa\)\{id,username/);
    assert.match(String(calls[0].params.fields), /media\.limit\(3\)\{/);
    const bad = (await t.handler({ username: 'a){x}', limit: 3 })) as Err;
    assert.equal(bad.isError, true);
    assert.equal(calls.length, 1);
  });
});
