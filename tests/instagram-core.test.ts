import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApiError } from '../src/client.ts';
import { resolveIgUserId, resolvePageId, getPageAccessToken, clearPageTokenCache } from '../src/instagram/context.ts';
import { toolResult, toolError } from '../src/instagram/tool-helpers.ts';
import { withGraphMock, metaError } from './helpers/graph-mock.ts';

test('resolveIgUserId prefers override, then env, else Portuguese error', () => {
  const saved = process.env.META_IG_USER_ID;
  try {
    process.env.META_IG_USER_ID = 'env-ig';
    assert.equal(resolveIgUserId('over'), 'over');
    assert.equal(resolveIgUserId(), 'env-ig');
    delete process.env.META_IG_USER_ID;
    assert.throws(() => resolveIgUserId(), /META_IG_USER_ID não configurado/);
  } finally {
    if (saved === undefined) delete process.env.META_IG_USER_ID;
    else process.env.META_IG_USER_ID = saved;
  }
});

test('resolvePageId prefers override, then env, else Portuguese error', () => {
  const saved = process.env.META_PAGE_ID;
  try {
    process.env.META_PAGE_ID = 'env-page';
    assert.equal(resolvePageId('over'), 'over');
    assert.equal(resolvePageId(), 'env-page');
    delete process.env.META_PAGE_ID;
    assert.throws(() => resolvePageId(), /META_PAGE_ID não configurado/);
  } finally {
    if (saved === undefined) delete process.env.META_PAGE_ID;
    else process.env.META_PAGE_ID = saved;
  }
});

test('getPageAccessToken fetches once and caches', async () => withGraphMock(
  () => ({ access_token: 'page-token', id: 'page-1' }),
  async (calls) => {
    clearPageTokenCache();
    assert.equal(await getPageAccessToken('page-1'), 'page-token');
    await getPageAccessToken('page-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.fields, 'access_token');
    assert.equal(calls[0].params.access_token, 'test-token');
  }));

test('toolResult wraps objects and arrays; toolError maps errors', () => {
  const obj = toolResult({ a: 1 });
  assert.deepEqual(obj.structuredContent, { a: 1 });
  assert.match(obj.content[0].text, /"a": 1/);
  assert.deepEqual(toolResult([1, 2]).structuredContent, { items: [1, 2] });
  const err = toolError(new Error('boom'));
  assert.equal(err.isError, true);
  assert.equal(err.content[0].text, 'Erro: boom');
});

test('handleApiError maps Instagram errors', () => {
  assert.match(handleApiError(metaError(10, 2534022, 'This message is sent outside of allowed window.')), /janela de 24 horas/);
  assert.match(handleApiError(metaError(10, 2018278, 'x')), /janela de 24 horas/);
  assert.match(handleApiError(metaError(9, 2207042, 'max posts')), /Limite de publicações/);
  assert.match(handleApiError(metaError(9007, 2207027, 'Media ID is not available')), /ainda não está pronta/);
  assert.match(handleApiError(metaError(10, undefined, 'requires instagram_content_publish permission')), /permissão de Instagram/);
});
