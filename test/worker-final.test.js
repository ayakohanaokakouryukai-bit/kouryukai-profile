import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeD1 } from './fake-d1.js';
import worker from '../worker/src/index.js';
import { handleAdmin } from '../worker/src/admin.js';
import { handleApi } from '../worker/src/api.js';
import { getProfile, replaceApplicants, countApplicants } from '../worker/src/db.js';

const NOW = new Date('2026-12-01T03:00:00Z');
const BASE = 'https://app.example';
const newDb = () => makeFakeD1(['worker/migrations/0001_init.sql', 'worker/migrations/0002_sns.sql']);

// Wraps a D1 so that the BLOB column comes back as a plain number array, like real D1.
function arrayBlobDb(db) {
  return {
    ...db,
    batch: (s) => db.batch(s),
    prepare(sql) {
      const st = db.prepare(sql);
      if (!/SELECT data FROM photos/.test(sql)) return st;
      const wrap = (s) => ({
        bind: (...a) => wrap(s.bind(...a)),
        first: async () => {
          const r = await s.first();
          return r ? { data: Array.from(r.data) } : r;
        },
      });
      return wrap(st);
    },
  };
}

test('photo: BLOB returned as a plain number array is still served as the right bytes', async () => {
  const db = newDb();
  const id = 'a'.repeat(32);
  await db.prepare('INSERT INTO photos (id, data, created_at) VALUES (?, ?, ?)').bind(id, new Uint8Array([0xff, 0xd8, 0xff, 255, 0, 7]).buffer, 'x').run();
  const env = { DB: arrayBlobDb(db), ASSETS: { fetch: async () => new Response('a') } };
  const res = await worker.fetch(new Request('https://x/api/photo/' + id), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([0xff, 0xd8, 0xff, 255, 0, 7]));
});

test('replaceApplicants: 120 applicants in one batch of at most 4 statements', async () => {
  const db = newDb();
  const batches = [];
  const counting = { prepare: (s) => db.prepare(s), batch: (st) => { batches.push(st.length); return db.batch(st); } };
  await db.prepare("INSERT INTO applicants (email, canceled) VALUES ('old@x.com', 0)").run();
  const rows = Array.from({ length: 120 }, (_, i) => ({ email: `u${i}@x.com`, canceled: i % 2 === 0 }));
  await replaceApplicants(counting, rows);
  assert.equal(batches.length, 1);
  assert.ok(batches[0] <= 4, 'statements: ' + batches[0]);
  assert.equal(await countApplicants(db), 120);
  const c = await db.prepare('SELECT COUNT(*) AS n FROM applicants WHERE canceled = 1').first();
  assert.equal(c.n, 60);
});

test('replaceApplicants: empty list just clears', async () => {
  const db = newDb();
  await db.prepare("INSERT INTO applicants (email, canceled) VALUES ('old@x.com', 0)").run();
  await replaceApplicants(db, []);
  assert.equal(await countApplicants(db), 0);
});

test('getProfile: photo-only row keeps photoUrl, is not visible; no text and no photo stays null', async () => {
  const db = newDb();
  await db.prepare("INSERT INTO profiles (email, photo_id, consent, updated_at) VALUES ('a@x.com', ?, 1, '')").bind('b'.repeat(32)).run();
  const r = await getProfile(db, 'a@x.com');
  assert.deepEqual(r.profile, { name: '', job: '', fields: [], challenge: '', strengths: '', needs: '', link: '', sns: {}, photoUrl: '/api/photo/' + 'b'.repeat(32) });
  const { isVisible } = await import('../worker/src/rules.js');
  assert.equal(isVisible(r), false);
  await db.prepare("INSERT INTO profiles (email, consent, updated_at) VALUES ('c@x.com', 0, '')").run();
  assert.equal((await getProfile(db, 'c@x.com')).profile, null);
});

// ---- pending-mails
async function adminSetup(extra = {}) {
  const env = { DB: newDb(), EXPIRES_AT: '2027-05-06T23:59:59+09:00', APP_BASE_URL: BASE, SYNC_SECRET: 'sek', ...extra };
  return env;
}
const pending = (env, now = NOW) => handleAdmin(new Request('https://w/admin/pending-mails', { headers: { 'X-Sync-Secret': 'sek' } }), env, { now: () => now }).then((r) => r.json());
async function seed(env, email, { canceled = 0, applicant = true } = {}) {
  if (applicant) await env.DB.prepare('INSERT INTO applicants (email, canceled) VALUES (?, ?)').bind(email, canceled).run();
  await env.DB.prepare('INSERT INTO tokens (email, token, issued_at, pending, requested_at) VALUES (?, ?, ?, 1, ?)')
    .bind(email, 't'.repeat(10) + email, 'i', new Date(NOW.getTime() - 3600000).toISOString()).run();
}

test('pending-mails: returns at most 20 per call and claims only those', async () => {
  const env = await adminSetup();
  for (let i = 0; i < 25; i++) await seed(env, `u${String(i).padStart(2, '0')}@x.com`);
  const r1 = await pending(env);
  assert.equal(r1.mails.length, 20);
  const r2 = await pending(env);
  assert.equal(r2.mails.length, 5);
  assert.equal((await pending(env)).mails.length, 0);
});

test('pending-mails: skips missing / canceled applicants and leaves their rows untouched', async () => {
  const env = await adminSetup();
  await seed(env, 'ok@x.com');
  await seed(env, 'gone@x.com', { canceled: 1 });
  await seed(env, 'nobody@x.com', { applicant: false });
  const r = await pending(env);
  assert.deepEqual(r.mails.map((m) => m.email), ['ok@x.com']);
  const rows = await env.DB.prepare("SELECT email, requested_at FROM tokens WHERE email IN ('gone@x.com','nobody@x.com')").all();
  for (const x of rows.results) assert.equal(x.requested_at, new Date(NOW.getTime() - 3600000).toISOString());
});

test('pending-mails: nothing after EXPIRES_AT, rows stay as they are', async () => {
  const env = await adminSetup();
  await seed(env, 'ok@x.com');
  const r = await pending(env, new Date('2027-05-07T00:00:00+09:00'));
  assert.deepEqual(r, { ok: true, mails: [] });
  const row = await env.DB.prepare("SELECT requested_at FROM tokens WHERE email = 'ok@x.com'").first();
  assert.equal(row.requested_at, new Date(NOW.getTime() - 3600000).toISOString());
});
