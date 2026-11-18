import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeD1 } from './fake-d1.js';
import worker from '../worker/src/index.js';
import { handleApi } from '../worker/src/api.js';

const NOW = new Date('2026-12-01T03:00:00Z');
const valid = { name: 'たろう', job: '会社員', fields: ['IT・Web'], challenge: '挑戦', strengths: '得意', needs: '苦手', link: '' };
const CC = 'public, max-age=31536000, immutable';

async function setup() {
  const env = {
    DB: makeFakeD1(['worker/migrations/0001_init.sql']),
    EXPIRES_AT: '2027-05-06T23:59:59+09:00',
    ASSETS: { fetch: async (req) => new Response('asset:' + new URL(req.url).pathname) },
  };
  for (const [e, t] of [['a@x.jp', 'tokena'], ['b@x.jp', 'tokenb']]) {
    await env.DB.prepare('INSERT INTO applicants (email, canceled) VALUES (?, 0)').bind(e).run();
    await env.DB.prepare('INSERT INTO tokens (email, token, issued_at) VALUES (?, ?, ?)').bind(e, t, NOW.toISOString()).run();
  }
  return env;
}
let seq = 0;
function deps() {
  return { now: () => NOW, newToken: () => 't', newId: () => (++seq).toString(16).padStart(32, '0'), sendMail: async () => {}, waitUntil() {} };
}
const call = (env, req) => handleApi(req, env, deps());
const get = (env, path) => worker.fetch(new Request('https://x' + path), env, { waitUntil() {} });
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const jpeg = (extra = [1, 2, 3, 4]) => b64([0xff, 0xd8, 0xff, 0xe0, ...extra]);

test('uploadPhoto: rejects bad mime, bad prefix, too long, empty, non-string', async () => {
  const env = await setup();
  const t = 'tokena';
  assert.deepEqual(await call(env, { action: 'uploadPhoto', token: t, base64: jpeg(), mimeType: 'image/png' }), { ok: false, error: 'bad_image' });
  assert.deepEqual(await call(env, { action: 'uploadPhoto', token: t, base64: 'AAAA', mimeType: 'image/jpeg' }), { ok: false, error: 'bad_image' });
  assert.deepEqual(await call(env, { action: 'uploadPhoto', token: t, base64: '', mimeType: 'image/jpeg' }), { ok: false, error: 'bad_image' });
  assert.deepEqual(await call(env, { action: 'uploadPhoto', token: t, base64: 5, mimeType: 'image/jpeg' }), { ok: false, error: 'bad_image' });
  assert.deepEqual(await call(env, { action: 'uploadPhoto', token: t, base64: '/9j/' + 'A'.repeat(2000000 - 3), mimeType: 'image/jpeg' }), { ok: false, error: 'bad_image' });
  assert.deepEqual(await call(env, { action: 'uploadPhoto', token: 'nope', base64: jpeg(), mimeType: 'image/jpeg' }), { ok: false, error: 'invalid_token' });
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM photos').first();
  assert.equal(n.n, 0);
});

test('uploadPhoto: valid upload is served back identically with immutable cache', async () => {
  const env = await setup();
  const r = await call(env, { action: 'uploadPhoto', token: 'tokena', base64: jpeg(), mimeType: 'image/jpeg' });
  assert.equal(r.ok, true);
  assert.match(r.photoUrl, /^\/api\/photo\/[0-9a-f]{32}$/);
  const res = await get(env, r.photoUrl);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(res.headers.get('Cache-Control'), CC);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
  const me = await call(env, { action: 'getMe', token: 'tokena' });
  assert.equal(me.profile.name, ''); // photo-only row: empty text, photo kept
  assert.equal(me.profile.photoUrl, r.photoUrl);
  assert.equal(me.visible, false);
});

test('uploadPhoto: exactly 2,000,000 chars is accepted', async () => {
  const env = await setup();
  const r = await call(env, { action: 'uploadPhoto', token: 'tokena', base64: '/9j/' + 'A'.repeat(2000000 - 4), mimeType: 'image/jpeg' });
  assert.equal(r.ok, true);
});

test('uploadPhoto: second upload deletes the first photo row', async () => {
  const env = await setup();
  const a = await call(env, { action: 'uploadPhoto', token: 'tokena', base64: jpeg([1]), mimeType: 'image/jpeg' });
  const b = await call(env, { action: 'uploadPhoto', token: 'tokena', base64: jpeg([2]), mimeType: 'image/jpeg' });
  assert.notEqual(a.photoUrl, b.photoUrl);
  assert.equal((await get(env, a.photoUrl)).status, 404);
  assert.equal((await get(env, b.photoUrl)).status, 200);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM photos').first()).n, 1);
});

test('uploadPhoto then saveProfile keeps the photo; saveProfile then uploadPhoto keeps profile fields', async () => {
  const env = await setup();
  const a = await call(env, { action: 'uploadPhoto', token: 'tokena', base64: jpeg(), mimeType: 'image/jpeg' });
  const s = await call(env, { action: 'saveProfile', token: 'tokena', profile: valid, consent: true });
  assert.equal(s.profile.photoUrl, a.photoUrl);
  const c = await call(env, { action: 'uploadPhoto', token: 'tokena', base64: jpeg([9]), mimeType: 'image/jpeg' });
  const me = await call(env, { action: 'getMe', token: 'tokena' });
  assert.deepEqual(me.profile, { ...valid, photoUrl: c.photoUrl });
  assert.equal(me.consent, true);
});

test('photo writes touch only photo columns (no clobber of concurrent saveProfile)', async () => {
  const env = await setup();
  await call(env, { action: 'saveProfile', token: 'tokena', profile: valid, consent: true });
  // simulate a concurrent saveProfile changing the name after uploadPhoto read its state
  const realPrepare = env.DB.prepare.bind(env.DB);
  let hooked = false;
  env.DB.prepare = (sql) => {
    if (!hooked && /UPDATE profiles|INSERT INTO profiles/i.test(sql)) {
      hooked = true;
      return realPrepare("UPDATE profiles SET name = 'concurrent' WHERE email = 'a@x.jp'").run().then(() => null) && realPrepare(sql);
    }
    return realPrepare(sql);
  };
  await call(env, { action: 'uploadPhoto', token: 'tokena', base64: jpeg(), mimeType: 'image/jpeg' });
  const row = await env.DB.prepare("SELECT name, photo_id FROM profiles WHERE email = 'a@x.jp'").first();
  assert.equal(row.name, 'concurrent');
  assert.match(row.photo_id, /^[0-9a-f]{32}$/);
});

test('deletePhoto clears the photo and the row; harmless without a profile', async () => {
  const env = await setup();
  const a = await call(env, { action: 'uploadPhoto', token: 'tokena', base64: jpeg(), mimeType: 'image/jpeg' });
  assert.deepEqual(await call(env, { action: 'deletePhoto', token: 'tokena' }), { ok: true });
  assert.equal((await get(env, a.photoUrl)).status, 404);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM photos').first()).n, 0);
  assert.equal((await env.DB.prepare("SELECT photo_id FROM profiles WHERE email = 'a@x.jp'").first()).photo_id, '');
  assert.deepEqual(await call(env, { action: 'deletePhoto', token: 'tokenb' }), { ok: true });
  assert.equal(await env.DB.prepare("SELECT 1 FROM profiles WHERE email = 'b@x.jp'").first(), null);
  assert.deepEqual(await call(env, { action: 'deletePhoto', token: 'nope' }), { ok: false, error: 'invalid_token' });
});

test('withdrawConsent updates only consent and updated_at', async () => {
  const env = await setup();
  await call(env, { action: 'saveProfile', token: 'tokena', profile: valid, consent: true });
  await call(env, { action: 'withdrawConsent', token: 'tokena' });
  const row = await env.DB.prepare("SELECT name, consent FROM profiles WHERE email = 'a@x.jp'").first();
  assert.equal(row.name, 'たろう');
  assert.equal(row.consent, 0);
});

test('GET /api/photo: bad ids and unknown ids -> 404', async () => {
  const env = await setup();
  for (const p of ['/api/photo/../x', '/api/photo/ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', '/api/photo/' + 'a'.repeat(32), '/api/photo/' + 'a'.repeat(31), '/api/photo/', '/api/photo/..%2fx']) {
    assert.equal((await get(env, p)).status, 404, p);
  }
});
