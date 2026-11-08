import assert from 'node:assert/strict';
import test from 'node:test';
import { captureTools, metaError, withGraphMock } from './helpers/graph-mock.ts';
import { createTestDeps } from './helpers/instagram-deps.ts';
import { registerInstagramMessagingTools } from '../src/tools/instagram/messaging.ts';

const setup = () => {
  const { deps } = createTestDeps();
  return { deps, tools: captureTools((s) => registerInstagramMessagingTools(s as never, deps)) };
};
const graph = (c: { method: string; url: string }) =>
  c.method === 'GET' && c.url.endsWith('/page-1') ? { access_token: 'page-token' } : { ok: true, data: [] };

type Res = { isError?: boolean; content: { text: string }[] };

test('registers all messaging tools', () => {
  const names = [...setup().tools.keys()];
  for (const n of [
    'meta_ig_list_conversations', 'meta_ig_get_conversation_messages', 'meta_ig_get_message', 'meta_ig_get_user_profile',
    'meta_ig_send_message', 'meta_ig_react_message', 'meta_ig_send_sender_action', 'meta_ig_get_messaging_profile',
    'meta_ig_set_ice_breakers', 'meta_ig_set_persistent_menu', 'meta_ig_delete_messaging_profile_fields',
  ]) assert.ok(names.includes(n), n);
});

test('list_conversations uses page token and platform=instagram', async () => {
  const { tools } = setup();
  await withGraphMock(graph, async (calls) => {
    await tools.get('meta_ig_list_conversations')!.handler({ limit: 5 });
    const c = calls[1];
    assert.ok(c.url.endsWith('/page-1/conversations'));
    assert.equal(c.params.platform, 'instagram');
    assert.equal(c.params.access_token, 'page-token');
    assert.match(String(c.params.fields), /messages\.limit\(1\)\{id,created_time,from,message\}/);
  });
});

test('get_conversation_messages builds messages.limit(n) fields', async () => {
  const { tools } = setup();
  await withGraphMock(graph, async (calls) => {
    await tools.get('meta_ig_get_conversation_messages')!.handler({ conversation_id: 'conv1', limit: 10 });
    const c = calls[calls.length - 1];
    assert.ok(c.url.endsWith('/conv1'));
    assert.match(String(c.params.fields), /^messages\.limit\(10\)\{id,created_time,from,to,message,attachments,story,shares,reactions\}$/);
    assert.equal(c.params.access_token, 'page-token');
  });
});

test('get_message and get_user_profile', async () => {
  const { tools } = setup();
  await withGraphMock(graph, async (calls) => {
    await tools.get('meta_ig_get_message')!.handler({ message_id: 'm1' });
    await tools.get('meta_ig_get_user_profile')!.handler({ igsid: 'u1' });
    const m = calls.filter((c) => c.url.endsWith('/m1'))[0];
    assert.equal(m.params.fields, 'id,created_time,from,to,message,attachments,story,shares,reactions');
    const u = calls.filter((c) => c.url.endsWith('/u1'))[0];
    assert.equal(u.params.fields, 'name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user');
    assert.equal(u.params.access_token, 'page-token');
  });
});

test('send_message text posts with page token', async () => {
  const { tools } = setup();
  await withGraphMock(graph, async (calls) => {
    const res = await tools.get('meta_ig_send_message')!.handler({ recipient_id: 'u1', text: 'Olá' });
    const c = calls[1];
    assert.equal(c.method, 'POST');
    assert.ok(c.url.endsWith('/page-1/messages'));
    assert.equal(c.params.access_token, 'page-token');
    assert.deepEqual(c.data, { recipient: { id: 'u1' }, message: { text: 'Olá' } });
    assert.ok(!JSON.stringify(res).includes('page-token'));
  });
});

test('send_message with quick_replies', async () => {
  const { tools } = setup();
  await withGraphMock(graph, async (calls) => {
    await tools.get('meta_ig_send_message')!.handler({ recipient_id: 'u1', text: 'Escolha', quick_replies: [{ title: 'A', payload: 'a' }] });
    assert.deepEqual((calls[1].data as { message: unknown }).message, { text: 'Escolha', quick_replies: [{ title: 'A', payload: 'a' }] });
  });
});

test('send_message rejects text with like_heart, quick_replies without text, and no content', async () => {
  const { tools } = setup();
  const t = tools.get('meta_ig_send_message')!;
  await withGraphMock(graph, async (calls) => {
    for (const input of [
      { recipient_id: 'u1', text: 'a', like_heart: true },
      { recipient_id: 'u1', quick_replies: [{ title: 'A', payload: 'a' }], like_heart: true },
      { recipient_id: 'u1' },
    ]) {
      const res = (await t.handler(input)) as Res;
      assert.equal(res.isError, true);
    }
    assert.equal(calls.length, 0);
  });
});

test('send_message rejects more than 13 quick replies', async () => {
  const { tools } = setup();
  const qr = Array.from({ length: 14 }, (_, i) => ({ title: `t${i}`, payload: `p${i}` }));
  await withGraphMock(graph, async () => {
    const res = (await tools.get('meta_ig_send_message')!.handler({ recipient_id: 'u1', text: 'x', quick_replies: qr })) as Res;
    assert.equal(res.isError, true);
  });
});

test('send_message like_heart', async () => {
  const { tools } = setup();
  await withGraphMock(graph, async (calls) => {
    await tools.get('meta_ig_send_message')!.handler({ recipient_id: 'u1', like_heart: true });
    assert.deepEqual((calls[1].data as { message: unknown }).message, { attachment: { type: 'like_heart' } });
  });
});

test('send_message image attachment with upload_id uses the public URL', async () => {
  const { deps, tools } = setup();
  const upload = await deps.uploads.saveBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]), 'image/jpeg');
  await withGraphMock(graph, async (calls) => {
    await tools.get('meta_ig_send_message')!.handler({
      recipient_id: 'u1',
      attachment: { type: 'image', media: { upload_id: upload.id } },
    });
    assert.deepEqual((calls[1].data as { message: unknown }).message, {
      attachment: { type: 'image', payload: { url: deps.uploads.publicUrl(upload) } },
    });
  });
});

test('send_message audio/file accept only url', async () => {
  const { tools } = setup();
  await withGraphMock(graph, async (calls) => {
    const bad = (await tools.get('meta_ig_send_message')!.handler({
      recipient_id: 'u1',
      attachment: { type: 'audio', media: { upload_id: 'x'.repeat(32) } },
    })) as Res;
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /url/);
    assert.equal(calls.length, 0);
    await tools.get('meta_ig_send_message')!.handler({
      recipient_id: 'u1',
      attachment: { type: 'file', media: { url: 'https://example.com/a.pdf' } },
    });
    assert.deepEqual((calls[1].data as { message: unknown }).message, {
      attachment: { type: 'file', payload: { url: 'https://example.com/a.pdf' } },
    });
  });
});

test('send_message generic_template limits to 10 elements', async () => {
  const { tools } = setup();
  const el = (i: number) => ({ title: `T${i}` });
  await withGraphMock(graph, async (calls) => {
    const bad = (await tools.get('meta_ig_send_message')!.handler({
      recipient_id: 'u1',
      generic_template: { elements: Array.from({ length: 11 }, (_, i) => el(i)) },
    })) as Res;
    assert.equal(bad.isError, true);
    await tools.get('meta_ig_send_message')!.handler({ recipient_id: 'u1', generic_template: { elements: [el(1)] } });
    const msg = (calls[1].data as { message: { attachment: { type: string; payload: { template_type: string } } } }).message;
    assert.equal(msg.attachment.type, 'template');
    assert.equal(msg.attachment.payload.template_type, 'generic');
  });
});

test('send_message surfaces the 24h window error', async () => {
  const { tools } = setup();
  await withGraphMock(
    (c) => {
      if (c.method === 'GET') return { access_token: 'page-token' };
      throw metaError(10, 2534022, 'outside window');
    },
    async () => {
      const res = (await tools.get('meta_ig_send_message')!.handler({ recipient_id: 'u1', text: 'Oi' })) as Res;
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /janela de 24 horas/);
    }
  );
});

test('react_message and send_sender_action', async () => {
  const { tools } = setup();
  await withGraphMock(graph, async (calls) => {
    await tools.get('meta_ig_react_message')!.handler({ recipient_id: 'u1', message_id: 'm1', action: 'react' });
    assert.deepEqual(calls[1].data, {
      recipient: { id: 'u1' }, sender_action: 'react', payload: { message_id: 'm1', reaction: 'love' },
    });
    await tools.get('meta_ig_send_sender_action')!.handler({ recipient_id: 'u1', action: 'typing_on' });
    assert.deepEqual(calls[2].data, { recipient: { id: 'u1' }, sender_action: 'typing_on' });
    assert.ok(calls[2].url.endsWith('/page-1/messages'));
  });
});

test('messaging profile get/set/delete', async () => {
  const { tools } = setup();
  await withGraphMock(graph, async (calls) => {
    await tools.get('meta_ig_get_messaging_profile')!.handler({});
    assert.ok(calls[1].url.endsWith('/page-1/messenger_profile'));
    assert.equal(calls[1].params.fields, 'ice_breakers,persistent_menu');
    assert.equal(calls[1].params.platform, 'instagram');

    await tools.get('meta_ig_set_ice_breakers')!.handler({ questions: [{ question: 'Q?', payload: 'p' }] });
    assert.equal(calls[2].method, 'POST');
    assert.equal(calls[2].params.platform, 'instagram');
    assert.deepEqual(calls[2].data, {
      ice_breakers: [{ locale: 'default', call_to_actions: [{ question: 'Q?', payload: 'p' }] }],
    });

    await tools.get('meta_ig_set_persistent_menu')!.handler({
      items: [{ type: 'postback', title: 'A', payload: 'a' }, { type: 'web_url', title: 'B', url: 'https://example.com' }],
    });
    assert.deepEqual(calls[3].data, {
      persistent_menu: [{
        locale: 'default',
        call_to_actions: [{ type: 'postback', title: 'A', payload: 'a' }, { type: 'web_url', title: 'B', url: 'https://example.com' }],
      }],
    });

    await tools.get('meta_ig_delete_messaging_profile_fields')!.handler({ fields: ['ice_breakers'] });
    assert.equal(calls[4].method, 'DELETE');
    assert.equal(calls[4].params.platform, 'instagram');
    assert.deepEqual(calls[4].data, { fields: ['ice_breakers'] });
  });
});

test('set_ice_breakers rejects 5 questions', async () => {
  const { tools } = setup();
  await withGraphMock(graph, async (calls) => {
    const res = (await tools.get('meta_ig_set_ice_breakers')!.handler({
      questions: Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}`, payload: `p${i}` })),
    })) as Res;
    assert.equal(res.isError, true);
    assert.equal(calls.length, 0);
  });
});
