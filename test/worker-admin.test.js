import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeD1 } from './fake-d1.js';
import { handleApi } from '../worker/src/api.js';
import { handleAdmin } from '../worker/src/admin.js';
import { getTokenRowByEmail, getPhotoData } from '../worker/src/db.js';

const NOW = new Date('2026-12-01T03:00:00Z');
const EXPIRES = '2027-05-06T23:59:59+09:00';
const BASE = 'https://app.example';
const TOK = 'a'.repeat(32);

async function setup() {
  const env = {
    DB: makeFakeD1(['worker/migrations/0001_init.sql', 'worker/migrations/0002_sns.sql']),
    EXPIRES_AT: EXPIRES, APP_BASE_URL: BASE, SYNC_SECRET: 'sek', GAS_MAIL_URL: 'https://gas.example/exec',
  };
  await env.DB.prepare("INSERT INTO applicants (email, canceled) VALUES ('a@example.com', 0)").run();
  return env;
}
function mkDeps(now = NOW) {
  const sent = [];
  const waits = [];
  let n = 0;
  return {
    sent, waits,
    now: () => now,
    newToken: () => 'b'.repeat(32),
    newId: () => String(++n).padStart(32, '0'),
    sendMail: async (m) => { sent.push(m); },
    waitUntil: (p) => waits.push(p),
  };
}
async function admin(env, method, path, body, { deps = mkDeps(), secret = 'sek' } = {}) {
  const headers = {};
  if (secret !== null) headers['X-Sync-Secret'] = secret;
  const req = new Request('https://w.example' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handleAdmin(req, env, deps);
  return { status: res.status, json: await res.json() };
}
const count = async (env, t) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM ' + t).first()).n;
const seedToken = (env, extra = {}) => env.DB.prepare(
  'INSERT INTO tokens (email, token, issued_at, last_sent_date, pending, requested_at) VALUES (?, ?, ?, ?, ?, ?)'
).bind(extra.email || 'a@example.com', extra.token || TOK, '2026-11-30T00:00:00.000Z', extra.last || '', extra.pending ? 1 : 0, extra.req || '').run();

test('every admin route rejects missing/wrong/empty secret with 401', async () => {
  const env = await setup();
  const routes = [['POST', '/admin/applicants', { applicants: [] }], ['POST', '/admin/reset-token', { email: 'a@example.com' }],
    ['GET', '/admin/export'], ['GET', '/admin/pending-mails'], ['POST', '/admin/mail-result', { email: 'a@example.com', sent: true }],
    ['POST', '/admin/import', { tokens: [], profiles: [] }], ['GET', '/admin/nope']];
  for (const [m, p, b] of routes) {
    for (const secret of [null, 'wrong', 'sekx', '']) {
      const r = await admin(env, m, p, b, { secret });
      assert.equal(r.status, 401, m + p);
      assert.deepEqual(r.json, { ok: false, error: 'unauthorized' });
    }
  }
  const noSecretEnv = { ...env, SYNC_SECRET: '' };
  assert.equal((await admin(noSecretEnv, 'GET', '/admin/export', undefined, { secret: '' })).status, 401);
  const undefEnv = { ...env, SYNC_SECRET: undefined };
  assert.equal((await admin(undefEnv, 'GET', '/admin/export', undefined, { secret: 'undefined' })).status, 401);
});

test('unknown admin path with valid secret -> 404 json', async () => {
  const env = await setup();
  const r = await admin(env, 'GET', '/admin/nope');
  assert.equal(r.status, 404);
  assert.equal(r.json.ok, false);
});

test('applicants: normalizes and merges duplicates (active if any row not canceled)', async () => {
  const env = await setup();
  const r = await admin(env, 'POST', '/admin/applicants', { applicants: [
    { email: ' A@X.com ', canceled: false }, { email: 'a@x.com', canceled: true }, { email: 'b@x.com', canceled: true }, { email: '', canceled: false },
  ] });
  assert.deepEqual(r.json, { ok: true, count: 2 });
  const { results } = await env.DB.prepare('SELECT email, canceled FROM applicants ORDER BY email').all();
  assert.deepEqual(results, [{ email: 'a@x.com', canceled: 0 }, { email: 'b@x.com', canceled: 1 }]);
});

test('applicants: suspicious shrink refused, table unchanged', async () => {
  const env = await setup();
  await env.DB.prepare('DELETE FROM applicants').run();
  const ten = Array.from({ length: 10 }, (_, i) => ({ email: 'u' + i + '@x.com', canceled: false }));
  assert.equal((await admin(env, 'POST', '/admin/applicants', { applicants: ten })).json.count, 10);
  let r = await admin(env, 'POST', '/admin/applicants', { applicants: [] });
  assert.deepEqual(r.json, { ok: false, error: 'suspicious_shrink', current: 10, received: 0 });
  r = await admin(env, 'POST', '/admin/applicants', { applicants: ten.slice(0, 4) });
  assert.deepEqual(r.json, { ok: false, error: 'suspicious_shrink', current: 10, received: 4 });
  assert.equal(await count(env, 'applicants'), 10);
  assert.equal((await admin(env, 'POST', '/admin/applicants', { applicants: ten.slice(0, 5) })).json.ok, true);
  assert.equal(await count(env, 'applicants'), 5);
});

test('applicants: first push into empty table with 5 rows ok; 0 rows into empty refused', async () => {
  const env = await setup();
  await env.DB.prepare('DELETE FROM applicants').run();
  const five = Array.from({ length: 5 }, (_, i) => ({ email: 'u' + i + '@x.com', canceled: false }));
  assert.deepEqual((await admin(env, 'POST', '/admin/applicants', { applicants: five })).json, { ok: true, count: 5 });
  await env.DB.prepare('DELETE FROM applicants').run();
  assert.equal((await admin(env, 'POST', '/admin/applicants', { applicants: [] })).json.error, 'suspicious_shrink');
});

test('reset-token: deletes row; old token invalid; requestLink same day sends a new token', async () => {
  const env = await setup();
  await seedToken(env, { last: '2026-12-01' });
  const deps = mkDeps();
  assert.equal((await handleApi({ action: 'getMe', token: TOK }, env, deps)).ok, true);
  assert.deepEqual((await admin(env, 'POST', '/admin/reset-token', { email: ' A@Example.com ' }, { deps })).json, { ok: true, found: true });
  assert.deepEqual((await admin(env, 'POST', '/admin/reset-token', { email: 'a@example.com' }, { deps })).json, { ok: true, found: false });
  assert.deepEqual(await handleApi({ action: 'getMe', token: TOK }, env, deps), { ok: false, error: 'invalid_token' });
  await handleApi({ action: 'requestLink', email: 'a@example.com' }, env, deps);
  await Promise.all(deps.waits);
  assert.deepEqual(deps.sent, [{ email: 'a@example.com', url: BASE + '/me.html#t=' + 'b'.repeat(32) }]);
});

test('pending-mails: only rows pending >= 15 min, and claims them', async () => {
  const env = await setup();
  await env.DB.prepare("INSERT INTO applicants (email, canceled) VALUES ('b@example.com', 0), ('c@example.com', 0), ('d@example.com', 0)").run();
  const ago = (m) => new Date(NOW.getTime() - m * 60000).toISOString();
  await seedToken(env, { email: 'a@example.com', token: '1'.repeat(32), pending: true, req: ago(16) });
  await seedToken(env, { email: 'b@example.com', token: '2'.repeat(32), pending: true, req: ago(5) });
  await seedToken(env, { email: 'c@example.com', token: '3'.repeat(32), pending: false, req: '' });
  await seedToken(env, { email: 'd@example.com', token: '4'.repeat(32), pending: true, req: '' });
  const r = await admin(env, 'GET', '/admin/pending-mails');
  assert.deepEqual(r.json, { ok: true, mails: [{ email: 'a@example.com', url: BASE + '/me.html#t=' + '1'.repeat(32) }] });
  assert.deepEqual((await admin(env, 'GET', '/admin/pending-mails')).json, { ok: true, mails: [] });
  assert.equal((await getTokenRowByEmail(env.DB, 'a@example.com')).requestedAt, NOW.toISOString());
  assert.equal((await getTokenRowByEmail(env.DB, 'a@example.com')).pending, true);
});

test('mail-result: sent:true clears pending and writes JST date; sent:false leaves pending', async () => {
  const env = await setup();
  await seedToken(env, { pending: true, req: NOW.toISOString() });
  assert.deepEqual((await admin(env, 'POST', '/admin/mail-result', { email: 'a@example.com', sent: false })).json, { ok: true });
  let row = await getTokenRowByEmail(env.DB, 'a@example.com');
  assert.equal(row.pending, true);
  assert.equal(row.lastSentDate, '');
  assert.deepEqual((await admin(env, 'POST', '/admin/mail-result', { email: ' A@example.com', sent: true })).json, { ok: true });
  row = await getTokenRowByEmail(env.DB, 'a@example.com');
  assert.equal(row.pending, false);
  assert.equal(row.requestedAt, '');
  assert.equal(row.lastSentDate, '2026-12-01');
});

test('export: tokens with url, profiles with fields array, no photo bytes', async () => {
  const env = await setup();
  await seedToken(env, { last: '2026-11-30', pending: true, req: 'x' });
  await env.DB.prepare('INSERT INTO photos (id, data, created_at) VALUES (?, ?, ?)').bind('p'.repeat(32), new Uint8Array([1, 2, 3]), 't').run();
  await env.DB.prepare(
    "INSERT INTO profiles (email, name, job, fields, challenge, strengths, needs, link, photo_id, consent, consent_at, updated_at) VALUES " +
    "('a@example.com','N','J','[\"IT\",\"x\"]','c','s','n','','" + 'p'.repeat(32) + "',1,'ca','ua')"
  ).run();
  const r = await admin(env, 'GET', '/admin/export');
  assert.deepEqual(r.json, {
    ok: true,
    tokens: [{ email: 'a@example.com', url: BASE + '/me.html#t=' + TOK, issuedAt: '2026-11-30T00:00:00.000Z', lastSentDate: '2026-11-30', pending: true }],
    profiles: [{ email: 'a@example.com', name: 'N', job: 'J', fields: ['IT', 'x'], challenge: 'c', strengths: 's', needs: 'n', link: '', sns: {},
      hasPhoto: true, consent: true, consentAt: 'ca', updatedAt: 'ua' }],
  });
  assert.ok(!JSON.stringify(r.json).includes('"data"'));
});

test('import: round-trips profile with photo; imported token authorizes getMe', async () => {
  const env = await setup();
  const deps = mkDeps();
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2]);
  const b64 = btoa(String.fromCharCode(...bytes));
  const body = {
    tokens: [{ email: ' A@Example.com', token: TOK, issuedAt: 'i', lastSentDate: '2026-11-01' }],
    profiles: [
      { email: 'a@example.com', profile: { name: 'N', job: 'J', fields: ['IT'], challenge: 'c', strengths: 's', needs: 'n', link: '' },
        consent: true, consentAt: 'ca', updatedAt: 'ua', photoBase64: b64 },
    ],
  };
  assert.deepEqual((await admin(env, 'POST', '/admin/import', body, { deps })).json, { ok: true, tokens: 1, profiles: 1 });
  const me = await handleApi({ action: 'getMe', token: TOK }, env, deps);
  assert.equal(me.ok, true);
  assert.equal(me.profile.name, 'N');
  assert.equal(me.consent, true);
  const id = me.profile.photoUrl.slice('/api/photo/'.length);
  assert.deepEqual([...new Uint8Array(await getPhotoData(env.DB, id))], [...bytes]);
  assert.equal((await getTokenRowByEmail(env.DB, 'a@example.com')).lastSentDate, '2026-11-01');
  // re-import replaces the photo row instead of leaking it
  assert.equal((await admin(env, 'POST', '/admin/import', body, { deps })).json.ok, true);
  assert.equal(await count(env, 'photos'), 1);
  assert.equal(await count(env, 'tokens'), 1);
});
