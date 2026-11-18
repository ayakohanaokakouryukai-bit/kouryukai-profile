import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeD1 } from './fake-d1.js';
import { handleApi } from '../worker/src/api.js';
import { makeSendMail } from '../worker/src/mail.js';
import { markSent, getTokenRowByEmail } from '../worker/src/db.js';

const NOW = new Date('2026-12-01T03:00:00Z'); // JST 2026-12-01 12:00
const EXPIRES = '2027-05-06T23:59:59+09:00';

async function setup() {
  const env = {
    DB: makeFakeD1(['worker/migrations/0001_init.sql']),
    EXPIRES_AT: EXPIRES, APP_BASE_URL: 'https://app.example', SYNC_SECRET: 'sek', GAS_MAIL_URL: 'https://gas.example/exec',
  };
  await env.DB.prepare("INSERT INTO applicants (email, canceled) VALUES ('a@example.com', 0), ('c@example.com', 1)").run();
  return env;
}
function mk(env, { sendMail, now = NOW } = {}) {
  const sent = [];
  const waits = [];
  const deps = {
    now: () => now, newToken: () => 'f'.repeat(32), newId: () => 'i',
    sendMail: sendMail || (async (m) => { sent.push(m); }),
    waitUntil: (p) => waits.push(p),
  };
  return { deps, sent, waits, call: (email) => handleApi({ action: 'requestLink', email }, env, deps) };
}
const settle = (t) => Promise.all(t.waits);
const tokenCount = async (env) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM tokens').first()).n;

test('requestLink: unknown email -> ok, no token, no send', async () => {
  const env = await setup();
  const t = mk(env);
  assert.deepEqual(await t.call('zz@example.com'), { ok: true });
  assert.deepEqual(await t.call(''), { ok: true });
  await settle(t);
  assert.equal(await tokenCount(env), 0);
  assert.equal(t.sent.length, 0);
});

test('requestLink: normalizes email, creates token, marks pending, sends once', async () => {
  const env = await setup();
  const t = mk(env);
  assert.deepEqual(await t.call(' A@Example.com '), { ok: true });
  await Promise.all(t.waits);
  assert.deepEqual(t.sent, [{ email: 'a@example.com', url: 'https://app.example/me.html#t=' + 'f'.repeat(32) }]);
  const row = await getTokenRowByEmail(env.DB, 'a@example.com');
  assert.equal(row.token, 'f'.repeat(32));
  assert.equal(row.issuedAt, NOW.toISOString());
  assert.equal(row.pending, true);
  assert.equal(row.requestedAt, NOW.toISOString());
  assert.equal(row.lastSentDate, ''); // only markSent writes it
});

test('requestLink: while pending -> no second send; after markSent same JST day -> no send; next day -> send', async () => {
  const env = await setup();
  const t = mk(env);
  await t.call('a@example.com');
  await t.call('a@example.com');
  await settle(t);
  assert.equal(t.sent.length, 1);
  await markSent(env.DB, 'a@example.com', '2026-12-01');
  const row = await getTokenRowByEmail(env.DB, 'a@example.com');
  assert.deepEqual([row.pending, row.requestedAt, row.lastSentDate], [false, '', '2026-12-01']);
  await t.call('a@example.com');
  await settle(t);
  assert.equal(t.sent.length, 1);
  const next = mk(env, { now: new Date('2026-12-01T15:00:00Z') }); // JST 12-02 00:00
  await next.call('a@example.com');
  await settle(next);
  assert.equal(next.sent.length, 1);
  assert.equal(next.sent[0].url, 'https://app.example/me.html#t=' + 'f'.repeat(32)); // token reused
});

test('requestLink: canceled applicant -> nothing', async () => {
  const env = await setup();
  const t = mk(env);
  assert.deepEqual(await t.call('c@example.com'), { ok: true });
  await settle(t);
  assert.equal(await tokenCount(env), 0);
  assert.equal(t.sent.length, 0);
});

test('requestLink: expired -> nothing', async () => {
  const env = await setup();
  const t = mk(env, { now: new Date('2027-05-07T00:00:00+09:00') });
  await t.call('a@example.com');
  await settle(t);
  assert.equal(await tokenCount(env), 0);
  assert.equal(t.sent.length, 0);
});

test('requestLink: sendMail throwing (sync or async) -> still ok, row stays pending', async () => {
  for (const sendMail of [() => { throw new Error('boom'); }, async () => { throw new Error('boom'); }]) {
    const env = await setup();
    const t = mk(env, { sendMail });
    assert.deepEqual(await t.call('a@example.com'), { ok: true });
    await Promise.all(t.waits); // must not reject
    assert.equal((await getTokenRowByEmail(env.DB, 'a@example.com')).pending, true);
  }
});

test('requestLink: DB failure is swallowed -> ok', async () => {
  const env = await setup();
  const t = mk(env);
  env.DB.prepare = () => { throw new Error('db down'); };
  assert.deepEqual(await t.call('a@example.com'), { ok: true });
  await settle(t); // background failure must not reject
});

test('requestLink: responds before any D1 work finishes (no timing difference)', async () => {
  const env = await setup();
  const t = mk(env);
  env.DB.prepare = () => ({ bind: () => ({ first: () => new Promise(() => {}), run: () => new Promise(() => {}) }) });
  assert.deepEqual(await t.call('a@example.com'), { ok: true });
  assert.deepEqual(await t.call('nobody@example.com'), { ok: true });
  assert.equal(t.waits.length, 2); // the work is handed to waitUntil, still pending
});

async function pendingRow(env) {
  await env.DB.prepare("INSERT INTO tokens (email, token, issued_at, pending, requested_at) VALUES ('a@example.com', ?, ?, 1, ?)").bind('f'.repeat(32), NOW.toISOString(), NOW.toISOString()).run();
}
const FIXED = () => new Date('2026-12-01T03:00:00Z');
const payload = { email: 'a@example.com', url: 'https://app.example/me.html#t=x' };

test('makeSendMail: posts JSON to GAS and marks sent on {ok:true,sent:true}', async () => {
  const env = await setup();
  await pendingRow(env);
  let seen;
  const f = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ ok: true, sent: true })); };
  await makeSendMail(env, env.DB, FIXED, f)(payload);
  assert.equal(seen.url, 'https://gas.example/exec');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.redirect, 'follow');
  assert.deepEqual(JSON.parse(seen.init.body), { secret: 'sek', action: 'sendLink', email: 'a@example.com', url: payload.url, expiresAt: EXPIRES });
  const row = await getTokenRowByEmail(env.DB, 'a@example.com');
  assert.deepEqual([row.pending, row.requestedAt, row.lastSentDate], [false, '', '2026-12-01']);
});

test('makeSendMail: sent:false, bad JSON, throw, non-ok -> stays pending', async () => {
  const cases = [
    async () => new Response(JSON.stringify({ ok: true, sent: false, reason: 'quota' })),
    async () => new Response('<html>'),
    async () => { throw new Error('net'); },
    async () => new Response(JSON.stringify({ ok: false, sent: true })),
  ];
  for (const f of cases) {
    const env = await setup();
    await pendingRow(env);
    await makeSendMail(env, env.DB, FIXED, f)(payload); // must not throw
    const row = await getTokenRowByEmail(env.DB, 'a@example.com');
    assert.deepEqual([row.pending, row.lastSentDate], [true, '']);
  }
});

test('makeSendMail: timeout aborts the fetch and leaves pending', async () => {
  const env = await setup();
  await pendingRow(env);
  const f = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  await makeSendMail(env, env.DB, FIXED, f, 20)(payload);
  assert.equal((await getTokenRowByEmail(env.DB, 'a@example.com')).pending, true);
});
