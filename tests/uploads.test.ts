import assert from 'node:assert/strict';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import test from 'node:test';
import { request } from 'node:http';
import express from 'express';

const { UploadStore, UploadTooLargeError, UnsupportedMediaTypeError, UPLOAD_TTL_MS } = await import('../src/uploads/upload-store.ts');
const { createUploadRouter, createMediaRouter } = await import('../src/uploads/upload-router.ts');
const { mediaInputSchema, resolveMediaSource } = await import('../src/instagram/media-source.ts');
const { openDatabase } = await import('../src/storage/database.ts');
const { createTestDeps } = await import('./helpers/instagram-deps.ts');

function makeStore(now?: () => number, limits?: any) {
  const { dataDir } = createTestDeps();
  const db = openDatabase(dataDir);
  const store = new UploadStore({ db, dataDir, publicBaseUrl: 'https://example.test', now, limits });
  return { store, db, dataDir };
}
const files = (dir: string) => (existsSync(`${dir}/uploads`) ? readdirSync(`${dir}/uploads`) : []);

test('saveStream stores a JPEG on disk', async () => {
  const { store, dataDir } = makeStore();
  const rec = await store.saveStream(Readable.from([Buffer.alloc(1000, 1)]), 'image/jpeg');
  assert.equal(rec.kind, 'image');
  assert.equal(rec.sizeBytes, 1000);
  assert.ok(existsSync(rec.path));
  assert.match(rec.fileName, /^[A-Za-z0-9_-]{32}\.jpg$/);
  assert.equal(store.publicUrl(rec), `https://example.test/media/${rec.fileName}`);
  rmSync(dataDir, { recursive: true, force: true });
});

test('oversized stream is aborted with no file and no row', async () => {
  const { store, db, dataDir } = makeStore();
  const chunk = Buffer.alloc(1024 * 1024, 2);
  const src = Readable.from((function* () { for (let i = 0; i < 9; i++) yield chunk; })());
  await assert.rejects(store.saveStream(src, 'image/jpeg'), UploadTooLargeError);
  assert.deepEqual(files(dataDir), []);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM uploads').get() as any).n, 0);
  rmSync(dataDir, { recursive: true, force: true });
});

test('oversized 8MiB+1 buffer is rejected', async () => {
  const { store, dataDir } = makeStore();
  await assert.rejects(store.saveBuffer(Buffer.alloc(8 * 1024 * 1024 + 1), 'image/jpeg'), UploadTooLargeError);
  assert.deepEqual(files(dataDir), []);
  rmSync(dataDir, { recursive: true, force: true });
});

test('image/png is rejected mentioning JPEG', async () => {
  const { store, dataDir } = makeStore();
  await assert.rejects(store.saveBuffer(Buffer.from('x'), 'image/png'), (e: any) => {
    assert.ok(e instanceof UnsupportedMediaTypeError);
    assert.match(e.message, /JPEG/);
    return true;
  });
  rmSync(dataDir, { recursive: true, force: true });
});

test('expired uploads are hidden and purged', async () => {
  let t = 1_000_000;
  const { store, dataDir } = makeStore(() => t);
  const rec = await store.saveBuffer(Buffer.from('abc'), 'video/mp4');
  assert.ok(store.get(rec.id));
  t += UPLOAD_TTL_MS + 1;
  assert.equal(store.get(rec.id), undefined);
  assert.equal(await store.purgeExpired(), 1);
  assert.ok(!existsSync(rec.path));
  rmSync(dataDir, { recursive: true, force: true });
});

async function withServer<T>(store: InstanceType<typeof UploadStore>, fn: (base: string) => Promise<T>, auth?: express.RequestHandler) {
  const app = express();
  app.use(createMediaRouter(store));
  app.use(auth ?? ((_req, _res, next) => next()), createUploadRouter(store, () => undefined));
  const server = app.listen(0);
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

test('router: upload, download, traversal and short names', async () => {
  const { store, dataDir } = makeStore();
  await withServer(store, async (base) => {
    const body = Buffer.from('fake-mp4-bytes');
    const res = await fetch(`${base}/uploads`, { method: 'POST', headers: { 'content-type': 'video/mp4', 'x-filename': 'a.mp4' }, body });
    assert.equal(res.status, 201);
    const json: any = await res.json();
    assert.equal(json.kind, 'video');
    assert.equal(json.size_bytes, body.length);
    assert.ok(!Number.isNaN(Date.parse(json.expires_at)));
    const rec = store.get(json.upload_id)!;
    const got = await fetch(`${base}/media/${rec.fileName}`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), body);
    assert.equal((await fetch(`${base}/media/..%2Fmcp.sqlite`)).status, 404);
    assert.equal((await fetch(`${base}/media/curto.jpg`)).status, 404);
    const png = await fetch(`${base}/uploads`, { method: 'POST', headers: { 'content-type': 'image/png' }, body });
    assert.equal(png.status, 415);
    assert.match(((await png.json()) as any).error, /Tipo não suportado: image\/png/);
  });
  rmSync(dataDir, { recursive: true, force: true });
});

test('router: expired media link is 404', async () => {
  let t = 5_000;
  const { store, dataDir } = makeStore(() => t);
  const rec = await store.saveBuffer(Buffer.from('x'), 'image/jpeg');
  t += UPLOAD_TTL_MS + 1;
  await withServer(store, async (base) => {
    assert.equal((await fetch(`${base}/media/${rec.fileName}`)).status, 404);
  });
  rmSync(dataDir, { recursive: true, force: true });
});

test('router: upload router sits behind auth', async () => {
  const { store, dataDir } = makeStore();
  await withServer(store, async (base) => {
    const res = await fetch(`${base}/uploads`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('x') });
    assert.equal(res.status, 401);
    assert.deepEqual(files(dataDir), []);
  }, (_req, res) => { res.status(401).json({ error: 'no' }); });
  rmSync(dataDir, { recursive: true, force: true });
});

test('router: oversized upload returns 413 and leaves nothing', async () => {
  const { store, db, dataDir } = makeStore();
  await withServer(store, async (base) => {
    const res = await fetch(`${base}/uploads`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: Buffer.alloc(8 * 1024 * 1024 + 1) });
    assert.equal(res.status, 413);
    assert.deepEqual(files(dataDir), []);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM uploads').get() as any).n, 0);
  });
  rmSync(dataDir, { recursive: true, force: true });
});

test('router: chunked oversize upload (no Content-Length) gets 413 and leaves nothing', async () => {
  const { store, db, dataDir } = makeStore(undefined, { 'video/mp4': { kind: 'video', ext: 'mp4', maxBytes: 1000 } });
  await withServer(store, async (base) => {
    const url = new URL(base);
    const status = await new Promise<number>((resolveStatus, reject) => {
      const req = request({ host: url.hostname, port: url.port, path: '/uploads', method: 'POST',
        headers: { 'content-type': 'video/mp4', 'transfer-encoding': 'chunked' } }, (res) => {
        res.resume();
        resolveStatus(res.statusCode!);
      });
      req.on('error', reject);
      for (let i = 0; i < 64; i++) req.write(Buffer.alloc(64 * 1024, 3));
      req.end();
    });
    assert.equal(status, 413);
    assert.deepEqual(files(dataDir), []);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM uploads').get() as any).n, 0);
  });
  rmSync(dataDir, { recursive: true, force: true });
});

test('router: client abort mid-upload leaves no file and no row, and is not logged as an error', async () => {
  const { store, db, dataDir } = makeStore();
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    await withServer(store, async (base) => {
      const url = new URL(base);
      const req = request({ host: url.hostname, port: url.port, path: '/uploads', method: 'POST',
        headers: { 'content-type': 'video/mp4', 'transfer-encoding': 'chunked' } });
      req.on('error', () => undefined);
      req.write(Buffer.alloc(4096, 4));
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(files(dataDir).length, 1);
      req.destroy();
      const deadline = Date.now() + 2000;
      while (files(dataDir).length > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(files(dataDir), []);
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM uploads').get() as any).n, 0);
      await new Promise((r) => setTimeout(r, 50));
    });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(errors, []);
  rmSync(dataDir, { recursive: true, force: true });
});

test('router: media supports Range requests', async () => {
  const { store, dataDir } = makeStore();
  const rec = await store.saveBuffer(Buffer.from('0123456789'), 'video/mp4');
  await withServer(store, async (base) => {
    const res = await fetch(`${base}/media/${rec.fileName}`, { headers: { range: 'bytes=0-3' } });
    assert.equal(res.status, 206);
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), '0123');
  });
  rmSync(dataDir, { recursive: true, force: true });
});

test('mediaInputSchema requires exactly one source', () => {
  assert.ok(mediaInputSchema.safeParse({ url: 'https://a.test/x.jpg' }).success);
  assert.ok(!mediaInputSchema.safeParse({ url: 'https://a.test/x.jpg', upload_id: 'abc' }).success);
  assert.ok(!mediaInputSchema.safeParse({}).success);
  assert.ok(!mediaInputSchema.safeParse({ url: 'https://a.test/x.jpg', extra: 1 }).success);
});

test('resolveMediaSource', async () => {
  const { store, dataDir } = makeStore();
  const vid = await store.saveBuffer(Buffer.from('v'), 'video/mp4');
  await assert.rejects(resolveMediaSource({ upload_id: vid.id }, 'image', store),
    new Error(`O upload ${vid.id} é video, mas esta publicação precisa de image.`));
  await assert.rejects(resolveMediaSource({ upload_id: 'nope' }, 'image', store), /Upload nope não encontrado ou expirado\./);
  const ok = await resolveMediaSource({ upload_id: vid.id }, 'video', store);
  assert.equal(ok.url, store.publicUrl(vid));
  assert.equal(ok.upload?.id, vid.id);
  assert.deepEqual(await resolveMediaSource({ url: 'https://a.test/x.jpg' }, 'image', store), { url: 'https://a.test/x.jpg' });
  const b64 = await resolveMediaSource({ base64: `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}` }, 'image', store);
  assert.ok(b64.url.startsWith('https://') && b64.url.endsWith('.jpg'));
  await assert.rejects(resolveMediaSource({ base64: Buffer.from('x').toString('base64') }, 'video', store), /só é aceito para imagens/);
  rmSync(dataDir, { recursive: true, force: true });
});
