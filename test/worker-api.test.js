import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeD1 } from './fake-d1.js';
import worker from '../worker/src/index.js';
import { handleApi } from '../worker/src/api.js';
import { validateProfile } from '../worker/src/rules.js';

const NOW = new Date('2026-12-01T03:00:00Z');
const valid = { name: 'たろう', job: '会社員', fields: ['IT・Web'], challenge: '挑戦', strengths: '得意', needs: '苦手', link: '' };

async function setup(extra = {}) {
  const env = {
    DB: makeFakeD1(['worker/migrations/0001_init.sql', 'worker/migrations/0002_sns.sql']),
    EXPIRES_AT: '2027-05-06T23:59:59+09:00',
    ASSETS: { fetch: async (req) => new Response('asset:' + new URL(req.url).pathname) },
    ...extra,
  };
  for (const [e, t] of [['a@x.jp', 'tokena'], ['b@x.jp', 'tokenb'], ['c@x.jp', 'tokenc']]) {
    await env.DB.prepare('INSERT INTO applicants (email, canceled) VALUES (?, 0)').bind(e).run();
    await env.DB.prepare('INSERT INTO tokens (email, token, issued_at) VALUES (?, ?, ?)').bind(e, t, NOW.toISOString()).run();
  }
  return env;
}
function deps(now = NOW) {
  return { now: () => now, newToken: () => 't', newId: () => 'i', sendMail: async () => {}, waitUntil() {} };
}
const call = (env, req, now) => handleApi(req, env, deps(now));

test('getMe: unknown token -> invalid_token', async () => {
  const env = await setup();
  assert.deepEqual(await call(env, { action: 'getMe', token: 'nope' }), { ok: false, error: 'invalid_token' });
  assert.deepEqual(await call(env, { action: 'getMe' }), { ok: false, error: 'invalid_token' });
});

test('getMe: canceled applicant -> invalid_token, and immediately after cancel (no caching)', async () => {
  const env = await setup();
  assert.equal((await call(env, { action: 'getMe', token: 'tokena' })).ok, true);
  await env.DB.prepare("UPDATE applicants SET canceled = 1 WHERE email = 'a@x.jp'").run();
  assert.deepEqual(await call(env, { action: 'getMe', token: 'tokena' }), { ok: false, error: 'invalid_token' });
});

test('getMe: expired', async () => {
  const env = await setup();
  const r = await call(env, { action: 'getMe', token: 'tokena' }, new Date('2027-05-07T00:00:00+09:00'));
  assert.deepEqual(r, { ok: false, error: 'expired' });
});

test('getMe: fresh user', async () => {
  const env = await setup();
  assert.deepEqual(await call(env, { action: 'getMe', token: 'tokena' }),
    { ok: true, profile: null, consent: false, visible: false, expiresAt: env.EXPIRES_AT });
});

test('saveProfile: consent_required on first save', async () => {
  const env = await setup();
  assert.deepEqual(await call(env, { action: 'saveProfile', token: 'tokena', profile: valid }), { ok: false, error: 'consent_required' });
});

test('saveProfile: valid with consent -> visible, fields stored as JSON', async () => {
  const env = await setup();
  const r = await call(env, { action: 'saveProfile', token: 'tokena', profile: valid, consent: true });
  assert.equal(r.ok, true);
  assert.equal(r.visible, true);
  assert.deepEqual(r.profile, { ...valid, sns: {}, photoUrl: '' });
  const row = await env.DB.prepare("SELECT * FROM profiles WHERE email = 'a@x.jp'").first();
  assert.equal(row.fields, JSON.stringify(['IT・Web']));
  assert.equal(row.consent, 1);
  assert.equal(row.consent_at, NOW.toISOString());
  const me = await call(env, { action: 'getMe', token: 'tokena' });
  assert.equal(me.visible, true);
  assert.equal(me.consent, true);
  assert.deepEqual(me.profile, { ...valid, sns: {}, photoUrl: '' });
});

test('saveProfile: second save keeps consent without flag and original consentAt', async () => {
  const env = await setup();
  await call(env, { action: 'saveProfile', token: 'tokena', profile: valid, consent: true });
  const later = new Date('2026-12-02T03:00:00Z');
  const r = await call(env, { action: 'saveProfile', token: 'tokena', profile: { ...valid, name: 'じろう' } }, later);
  assert.equal(r.ok, true);
  const row = await env.DB.prepare("SELECT * FROM profiles WHERE email = 'a@x.jp'").first();
  assert.equal(row.consent_at, NOW.toISOString());
  assert.equal(row.updated_at, later.toISOString());
  assert.equal(row.name, 'じろう');
});

test('saveProfile: validation fieldErrors match validateProfile', async () => {
  const env = await setup();
  const bad = { ...valid, name: '', fields: [] };
  const r = await call(env, { action: 'saveProfile', token: 'tokena', profile: bad, consent: true });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'validation');
  assert.deepEqual(r.fieldErrors, validateProfile(bad).fieldErrors);
});

test('saveProfile keeps existing photoUrl derived from photo_id', async () => {
  const env = await setup();
  await env.DB.prepare("INSERT INTO profiles (email, photo_id) VALUES ('a@x.jp', 'abc123')").run();
  const r = await call(env, { action: 'saveProfile', token: 'tokena', profile: valid, consent: true });
  assert.equal(r.profile.photoUrl, '/api/photo/abc123');
});

test('getList: not_visible for caller who is not visible', async () => {
  const env = await setup();
  assert.deepEqual(await call(env, { action: 'getList', token: 'tokena' }), { ok: false, error: 'not_visible' });
});

test('getList: only visible non-canceled, newest consent first, no email/staff', async () => {
  const env = await setup();
  await call(env, { action: 'saveProfile', token: 'tokena', profile: { ...valid, name: 'A' }, consent: true }, new Date('2026-12-01T01:00:00Z'));
  await call(env, { action: 'saveProfile', token: 'tokenb', profile: { ...valid, name: 'B' }, consent: true }, new Date('2026-12-01T02:00:00Z'));
  await call(env, { action: 'saveProfile', token: 'tokenc', profile: { ...valid, name: 'C' }, consent: true }, new Date('2026-12-01T02:30:00Z'));
  await env.DB.prepare("INSERT INTO applicants (email, canceled) VALUES ('d@x.jp', 0)").run();
  await env.DB.prepare("INSERT INTO profiles (email, name, job, fields, challenge, strengths, needs, link, consent, consent_at) VALUES ('d@x.jp','D','j','[\"学生\"]','c','s','n','',0,'')").run();
  await env.DB.prepare("UPDATE applicants SET canceled = 1 WHERE email = 'c@x.jp'").run();
  const r = await call(env, { action: 'getList', token: 'tokena' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.participants.map((p) => p.name), ['B', 'A']);
  for (const p of r.participants) {
    assert.equal('email' in p, false);
    assert.equal('staff' in p, false);
    assert.deepEqual(Object.keys(p).sort(), ['challenge', 'fields', 'job', 'link', 'name', 'needs', 'photoUrl', 'sns', 'strengths']);
  }
  assert.equal(r.generatedAt, NOW.toISOString());
});

test('withdrawConsent then getList -> not_visible', async () => {
  const env = await setup();
  await call(env, { action: 'saveProfile', token: 'tokena', profile: valid, consent: true });
  assert.deepEqual(await call(env, { action: 'withdrawConsent', token: 'tokena' }), { ok: true });
  assert.deepEqual(await call(env, { action: 'getList', token: 'tokena' }), { ok: false, error: 'not_visible' });
  assert.deepEqual(await call(env, { action: 'withdrawConsent', token: 'tokenb' }), { ok: true });
});

test('unknown action -> server_error', async () => {
  const env = await setup();
  assert.deepEqual(await call(env, { action: 'zzz', token: 'tokena' }), { ok: false, error: 'server_error' });
});

test('router: POST /api invalid JSON -> server_error with no-store', async () => {
  const env = await setup();
  const res = await worker.fetch(new Request('https://x/api', { method: 'POST', body: 'not json' }), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), { ok: false, error: 'server_error' });
});

test('router: POST /api valid call', async () => {
  const env = await setup();
  const res = await worker.fetch(new Request('https://x/api', { method: 'POST', body: JSON.stringify({ action: 'getMe', token: 'tokena' }) }), env, { waitUntil() {} });
  assert.equal((await res.json()).ok, true);
});

test('router: other paths go to ASSETS', async () => {
  const env = await setup();
  const res = await worker.fetch(new Request('https://x/me.html'), env, { waitUntil() {} });
  assert.equal(await res.text(), 'asset:/me.html');
});

test('saveProfile: SNS ids are normalized, stored as JSON and shown in getMe and getList', async () => {
  const env = await setup();
  const profile = { ...valid, sns: { instagram: '@ig_user', x: 'https://x.com/x_user', threads: '', facebook: 'fb.name' } };
  const r = await call(env, { action: 'saveProfile', token: 'tokena', profile, consent: true });
  assert.equal(r.ok, true);
  const want = { instagram: 'ig_user', x: 'x_user', facebook: 'fb.name' };
  assert.deepEqual(r.profile.sns, want);
  const row = await env.DB.prepare("SELECT sns FROM profiles WHERE email = 'a@x.jp'").first();
  assert.deepEqual(JSON.parse(row.sns), want);
  const me = await call(env, { action: 'getMe', token: 'tokena' });
  assert.deepEqual(me.profile.sns, want);
  const list = await call(env, { action: 'getList', token: 'tokena' });
  assert.deepEqual(list.participants[0].sns, want);
});

test('saveProfile: a bad SNS id is a validation error keyed sns_<name>', async () => {
  const env = await setup();
  const r = await call(env, { action: 'saveProfile', token: 'tokena', profile: { ...valid, sns: { x: 'not valid id!' } }, consent: true });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'validation');
  assert.ok(r.fieldErrors.sns_x);
});
