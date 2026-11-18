import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-harness.js';

const J = (x) => JSON.parse(JSON.stringify(x));

const BASE_PROPS = {
  WORKER_URL: 'https://w.example.workers.dev', SYNC_SECRET: 'sec', FORM_SHEET_ID: 'f1', FORM_SHEET_NAME: 'シート1',
  EMAIL_HEADER: 'メールアドレス', DATA_SHEET_ID: 'd1', ORGANIZER_EMAIL: 'org@example.com',
};

// Builds fakes. `fetchHandler(url, opts)` returns {code, body}; sheets: {id: {name: values[][]}}.
function makeEnv({ props = {}, quota = 100, fetchHandler = () => ({ code: 200, body: '{"ok":true}' }), sheets = {} } = {}) {
  const p = { ...BASE_PROPS, ...props };
  const mails = [];
  const fetches = [];
  const writes = [];
  const g = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in p ? p[k] : null), setProperty: (k, v) => { p[k] = v; } }) },
    MailApp: {
      getRemainingDailyQuota: () => quota,
      sendEmail: (m) => { if (g.__failSend) throw new Error('boom'); mails.push(m); quota--; },
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        fetches.push({ url, opts });
        const r = fetchHandler(url, opts);
        return { getResponseCode: () => r.code, getContentText: () => r.body };
      },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }),
    },
    Utilities: { base64Encode: (b) => 'B64:' + b.join(',') },
    SpreadsheetApp: {
      openById: (id) => ({
        getSheetByName: (n) => {
          const values = sheets[id] && sheets[id][n];
          if (!values) return null;
          return {
            getDataRange: () => ({ getValues: () => values }),
            getLastRow: () => values.length,
            getRange: (r, c, nr, nc) => ({
              getValues: () => values.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
              setValues: (v) => writes.push(['setValues', id, n, r, c, J(v)]),
              setNumberFormat: (f) => writes.push(['format', id, n, r, c, nr, nc, f]),
              setValue: (v) => writes.push(['setValue', id, n, r, c, v]),
            }),
            clearContents: () => writes.push(['clear', id, n]),
            getMaxRows: () => 1000,
          };
        },
      }),
    },
  };
  return { g, p, mails, fetches, writes };
}
const load = (env) => loadGas(env.g, 'gas-bridge');
const post = (ctx, body) => J(JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text));
const linkReq = (secret = 'sec') => ({ secret, action: 'sendLink', email: 'a@x.com', url: 'https://w/#t=abc', expiresAt: '2027-05-06T23:59:59+09:00' });

// ---- pure functions
test('asLiteral prefixes formula-like strings only', () => {
  const ctx = load(makeEnv());
  assert.equal(ctx.asLiteral('=IMPORTRANGE("x")'), '\'=IMPORTRANGE("x")');
  assert.equal(ctx.asLiteral('+1'), "'+1");
  assert.equal(ctx.asLiteral('-1+1'), "'-1+1");
  assert.equal(ctx.asLiteral('3/4'), '3/4');
  assert.equal(ctx.asLiteral('007'), '007');
  assert.equal(ctx.asLiteral(5), 5);
});

test('readApplicantsFromTable ignores blank emails and flags cancel', () => {
  const ctx = load(makeEnv());
  const out = J(ctx.readApplicantsFromTable(
    ['名前', 'メールアドレス', 'キャンセル'],
    [['a', ' A@X.com ', ''], ['b', '', ''], ['c', 'c@x.com', '済']],
    'メールアドレス', 'キャンセル'));
  assert.deepEqual(out, [{ email: 'a@x.com', canceled: false }, { email: 'c@x.com', canceled: true }]);
});

test('readApplicantsFromTable returns [] when the email header is missing', () => {
  const ctx = load(makeEnv());
  assert.deepEqual(J(ctx.readApplicantsFromTable(['x'], [['a']], 'メールアドレス', 'キャンセル')), []);
});

test('pendingResetRows skips rows whose B is filled', () => {
  const ctx = load(makeEnv());
  const out = J(ctx.pendingResetRows([['メールアドレス', '結果'], ['a@x.com', ''], ['b@x.com', '済 2026-01-01 10:00'], ['', ''], [' C@x.com ', undefined]]));
  assert.deepEqual(out, [{ row: 2, email: 'a@x.com' }, { row: 5, email: 'c@x.com' }]);
});

test('formatResult', () => {
  const ctx = load(makeEnv());
  assert.equal(ctx.formatResult(false, new Date()), '見つかりません');
  assert.equal(ctx.formatResult(true, new Date('2026-11-19T00:05:00Z')), '済 2026-11-19 09:05');
});

test('mirrorRows maps export to tab rows', () => {
  const ctx = load(makeEnv());
  const out = J(ctx.mirrorRows({
    tokens: [{ email: 'a@x.com', url: 'u', issuedAt: 'i', lastSentDate: '2026-11-19', pending: true }, { email: 'b@x.com', url: 'u2', issuedAt: 'i2', lastSentDate: '', pending: false }],
    profiles: [{ email: 'a@x.com', name: '=evil', job: 'j', fields: ['x', 'y'], challenge: 'c', strengths: 's', needs: 'n', link: 'l', hasPhoto: true, consent: false, consentAt: '', updatedAt: 'u' }],
  }));
  assert.deepEqual(out.tokens, [['a@x.com', 'u', 'i', '2026-11-19', '送信待ち'], ['b@x.com', 'u2', 'i2', '', '']]);
  assert.deepEqual(out.profiles[0], ['a@x.com', "'=evil", 'j', 'x、y', 'c', 's', 'n', 'l', 'あり', '', '', 'u']);
  assert.equal(out.profiles[0].length, 12);
});

// ---- doPost
test('doPost: wrong secret -> unauthorized, no mail', () => {
  const env = makeEnv(); const ctx = load(env);
  assert.deepEqual(post(ctx, linkReq('bad')), { ok: false, error: 'unauthorized' });
  assert.equal(env.mails.length, 0);
});

test('doPost: quota 0 -> sent:false, no mail', () => {
  const env = makeEnv({ quota: 0 }); const ctx = load(env);
  assert.deepEqual(post(ctx, linkReq()), { ok: true, sent: false, reason: 'quota' });
  assert.equal(env.mails.length, 0);
});

test('doPost: sends one mail with URL and expiry label', () => {
  const env = makeEnv(); const ctx = load(env);
  assert.deepEqual(post(ctx, linkReq()), { ok: true, sent: true });
  assert.equal(env.mails.length, 1);
  assert.equal(env.mails[0].to, 'a@x.com');
  assert.ok(env.mails[0].body.includes('https://w/#t=abc'));
  assert.ok(env.mails[0].body.includes('2027年5月6日'));
});

test('doPost: send failure -> reason error', () => {
  const env = makeEnv(); env.g.__failSend = true; const ctx = load(env);
  assert.deepEqual(post(ctx, linkReq()), { ok: true, sent: false, reason: 'error' });
});

test('doPost: low quota alerts organizer once per day', () => {
  const env = makeEnv({ quota: 10 }); const ctx = load(env);
  post(ctx, linkReq()); post(ctx, linkReq());
  const alerts = env.mails.filter((m) => m.to === 'org@example.com');
  assert.equal(alerts.length, 1);
  assert.equal(env.mails.length, 3);
});

test('doPost: garbage body -> server_error JSON, never throws', () => {
  const ctx = load(makeEnv());
  assert.deepEqual(J(JSON.parse(ctx.doPost({ postData: { contents: 'nope' } }).text)), { ok: false, error: 'server_error' });
});

// ---- resendPending
test('resendPending posts mail-result for each sent, stops at quota 0', () => {
  const env = makeEnv({
    quota: 2,
    fetchHandler: (url) => (url.endsWith('/admin/pending-mails')
      ? { code: 200, body: JSON.stringify({ ok: true, mails: [1, 2, 3].map((i) => ({ email: `u${i}@x.com`, url: `https://w/#t=${i}` })) }) }
      : { code: 200, body: '{"ok":true}' }),
  });
  const ctx = load(env);
  ctx.resendPending();
  assert.equal(env.mails.length, 2);
  const results = env.fetches.filter((f) => f.url.endsWith('/admin/mail-result'));
  assert.equal(results.length, 2);
  assert.deepEqual(JSON.parse(results[0].opts.payload), { email: 'u1@x.com', sent: true });
  assert.equal(results[0].opts.headers['X-Sync-Secret'], 'sec');
  assert.equal(results[0].opts.muteHttpExceptions, true);
});

// ---- pushApplicants
const FORM = { f1: { シート1: [['メールアドレス', 'キャンセル'], ['a@x.com', '']] } };

test('pushApplicants posts the applicants list', () => {
  const env = makeEnv({ sheets: FORM }); const ctx = load(env);
  ctx.pushApplicants();
  const f = env.fetches[0];
  assert.equal(f.url, 'https://w.example.workers.dev/admin/applicants');
  assert.deepEqual(JSON.parse(f.opts.payload), { applicants: [{ email: 'a@x.com', canceled: false }] });
  assert.equal(env.mails.length, 0);
});

test('pushApplicants: suspicious_shrink mails organizer once per JST day', () => {
  const env = makeEnv({ sheets: FORM, fetchHandler: () => ({ code: 200, body: JSON.stringify({ ok: false, error: 'suspicious_shrink', current: 10, received: 2 }) }) });
  const ctx = load(env);
  ctx.pushApplicants(); ctx.pushApplicants();
  assert.equal(env.mails.length, 1);
  assert.equal(env.mails[0].to, 'org@example.com');
});

test('pushApplicants: HTTP error also alerts once', () => {
  const env = makeEnv({ sheets: FORM, fetchHandler: () => ({ code: 500, body: 'x' }) });
  const ctx = load(env);
  ctx.pushApplicants(); ctx.pushApplicants();
  assert.equal(env.mails.length, 1);
});

// ---- mirror
test('mirror writes @ format before values on both tabs', () => {
  const sheets = { d1: { '写し_合鍵': [['h']], '写し_プロフィール': [['h']] } };
  const env = makeEnv({ sheets, fetchHandler: () => ({ code: 200, body: JSON.stringify({ ok: true, tokens: [{ email: 'a@x.com', url: 'u', issuedAt: 'i', lastSentDate: '', pending: false }], profiles: [] }) }) });
  const ctx = load(env);
  ctx.mirror();
  const keys = env.writes.filter((w) => w[2] === '写し_合鍵');
  const fi = keys.findIndex((w) => w[0] === 'format'), vi = keys.findIndex((w) => w[0] === 'setValues');
  assert.ok(fi >= 0 && vi > fi, 'format precedes values');
  assert.equal(keys[fi][7], '@');
  const header = keys[vi][5][0];
  assert.deepEqual(header, ['メールアドレス', '専用URL', '発行日時', '最後に送った日', '送信待ち']);
});

// ---- processResets
test('processResets posts reset-token and writes result in B', () => {
  const sheets = { d1: { 'URL作り直し': [['メールアドレス', '結果'], ['a@x.com', ''], ['b@x.com', '済 x']] } };
  const env = makeEnv({ sheets, fetchHandler: () => ({ code: 200, body: '{"ok":true,"found":true}' }) });
  const ctx = load(env);
  ctx.processResets();
  const posts = env.fetches.filter((f) => f.url.endsWith('/admin/reset-token'));
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].opts.payload), { email: 'a@x.com' });
  const w = env.writes.find((x) => x[0] === 'setValue');
  assert.equal(w[3], 2); assert.equal(w[4], 2);
  assert.match(w[5], /^済 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

// ---- migration
test('migrateFromOldTabs posts tokens and profiles (no staff) with photos', () => {
  const sheets = { d1: {
    tokens: [['email', 'token', 'url', 'issuedAt', 'lastSentDate', 'pending'], [' A@X.com ', 'tok1', 'u', '2026-11-01T00:00:00.000Z', '2026-11-18', false]],
    profiles: [['email', 'name', 'job', 'fields', 'challenge', 'strengths', 'needs', 'link', 'photoFileId', 'photoUrl', 'consent', 'consentAt', 'updatedAt', 'staff'],
      ['A@x.com', 'N', 'J', 'x、y', 'c', 's', 'n', 'l', 'fid', 'pu', true, 'ca', 'ua', true]],
  } };
  const env = makeEnv({ sheets });
  env.g.DriveApp = { getFileById: (id) => ({ getBlob: () => ({ getBytes: () => [1, 2, 3] }) }) };
  const ctx = load(env);
  ctx.migrateFromOldTabs();
  const bodies = env.fetches.filter((x) => x.url.endsWith('/admin/import')).map((f) => JSON.parse(f.opts.payload));
  const body = { tokens: bodies.flatMap((x) => x.tokens), profiles: bodies.flatMap((x) => x.profiles) };
  assert.deepEqual(body.tokens, [{ email: 'a@x.com', token: 'tok1', issuedAt: '2026-11-01T00:00:00.000Z', lastSentDate: '2026-11-18' }]);
  assert.equal(body.profiles[0].email, 'a@x.com');
  assert.deepEqual(body.profiles[0].profile, { name: 'N', job: 'J', fields: ['x', 'y'], challenge: 'c', strengths: 's', needs: 'n', link: 'l' });
  assert.equal(body.profiles[0].photoBase64, 'B64:1,2,3');
  assert.equal(body.profiles[0].consent, true);
  assert.equal('staff' in body.profiles[0] || 'staff' in body.profiles[0].profile, false);
});

// ---- reset retry
const RESET_SHEETS = () => ({ d1: { 'URL作り直し': [['メールアドレス', '結果'], ['a@x.com', '']], '写し_合鍵': [['h']], '写し_プロフィール': [['h']] }, f1: { シート1: [['メールアドレス', 'キャンセル']] } });

test('timerEvery5Min processes a pending reset row', () => {
  const env = makeEnv({ sheets: RESET_SHEETS(), fetchHandler: (url) => ({ code: 200, body: url.endsWith('/admin/export') ? '{"ok":true,"tokens":[],"profiles":[]}' : '{"ok":true,"found":true}' }) });
  load(env).timerEvery5Min();
  assert.equal(env.fetches.filter((f) => f.url.endsWith('/admin/reset-token')).length, 1);
  assert.ok(env.writes.some((w) => w[0] === 'setValue' && w[4] === 2 && /^済 /.test(w[5])));
});

test('reset failure leaves B empty and writes a C note; later success fills B and clears C', () => {
  let fail = true;
  const env = makeEnv({ sheets: RESET_SHEETS(), fetchHandler: () => (fail ? { code: 500, body: 'x' } : { code: 200, body: '{"ok":true,"found":true}' }) });
  const ctx = load(env);
  ctx.processResets();
  const sv = () => env.writes.filter((w) => w[0] === 'setValue');
  assert.equal(sv().filter((w) => w[4] === 2).length, 0);
  assert.match(sv().find((w) => w[4] === 3)[5], /^失敗（5分以内に自動で再試行します）/);
  fail = false;
  env.writes.length = 0;
  ctx.processResets();
  assert.match(sv().find((w) => w[4] === 2)[5], /^済 /);
  assert.equal(sv().find((w) => w[4] === 3)[5], '');
});

test('timerEvery5Min: a failing step does not stop the others', () => {
  const env = makeEnv({ sheets: RESET_SHEETS(), fetchHandler: (url) => { throw new Error('net'); } });
  assert.doesNotThrow(() => load(env).timerEvery5Min());
  assert.ok(env.fetches.length >= 3);
});

// ---- final review fixes
test('migrate: 12 profiles are sent as 3 import POSTs (5/5/2), tokens in chunks of 20', () => {
  const profRows = Array.from({ length: 12 }, (_, i) => [`p${i}@x.com`, 'N', 'J', 'x', 'c', 's', 'n', 'l', '', '', true, 'ca', 'ua']);
  const tokRows = Array.from({ length: 45 }, (_, i) => [`t${i}@x.com`, `tok${i}`, 'u', '2026-11-01T00:00:00.000Z', '2026-11-18', false]);
  const sheets = { d1: {
    tokens: [['email', 'token', 'url', 'issuedAt', 'lastSentDate', 'pending'], ...tokRows],
    profiles: [['email', 'name', 'job', 'fields', 'challenge', 'strengths', 'needs', 'link', 'photoFileId', 'photoUrl', 'consent', 'consentAt', 'updatedAt'], ...profRows],
  } };
  const env = makeEnv({ sheets, fetchHandler: () => ({ code: 200, body: '{"ok":true,"tokens":0,"profiles":0}' }) });
  load(env).migrateFromOldTabs();
  const bodies = env.fetches.filter((x) => x.url.endsWith('/admin/import')).map((f) => JSON.parse(f.opts.payload));
  const withProfiles = bodies.filter((b) => b.profiles.length > 0);
  assert.deepEqual(withProfiles.map((b) => b.profiles.length), [5, 5, 2]);
  assert.ok(withProfiles.every((b) => b.tokens.length === 0));
  const withTokens = bodies.filter((b) => b.tokens.length > 0);
  assert.deepEqual(withTokens.map((b) => b.tokens.length), [20, 20, 5]);
  assert.equal(bodies.length, 6);
});

test('migrate: a failing chunk throws', () => {
  const sheets = { d1: { tokens: [['email', 'token'], ['a@x.com', 't']], profiles: [['email']] } };
  const env = makeEnv({ sheets, fetchHandler: () => ({ code: 500, body: 'x' }) });
  assert.throws(() => load(env).migrateFromOldTabs(), /import failed/);
});

test('resendPending: quota alert carries the count of mails still unsent', () => {
  const env = makeEnv({
    quota: 5,
    fetchHandler: (url) => (url.endsWith('/admin/pending-mails')
      ? { code: 200, body: JSON.stringify({ ok: true, mails: [1, 2, 3].map((i) => ({ email: `u${i}@x.com`, url: `https://w/#t=${i}` })) }) }
      : { code: 200, body: '{"ok":true}' }),
  });
  const orig = env.g.MailApp.sendEmail;
  env.g.MailApp.sendEmail = (m) => { if (m.to !== 'org@example.com' && m.to !== 'u1@x.com') throw new Error('boom'); orig(m); };
  load(env).resendPending();
  const alert = env.mails.find((m) => m.to === 'org@example.com');
  assert.ok(alert, 'alert sent');
  assert.match(alert.body, /送信待ちのメール: 2 通/);
});
