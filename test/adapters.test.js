import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-harness.js';

const J = (x) => JSON.parse(JSON.stringify(x));

const REQUIRED = {
  FORM_SHEET_ID: 'f1', FORM_SHEET_NAME: 'シート1', EMAIL_HEADER: 'メールアドレス', DATA_SHEET_ID: 'd1',
  PHOTO_FOLDER_ID: 'p1', APP_BASE_URL: 'https://app.example.com/', ORGANIZER_EMAIL: 'org@example.com',
  EXPIRES_AT: '2027-05-06T23:59:59+09:00',
};
const props = (obj) => ({
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (k in obj ? obj[k] : null),
      setProperty: (k, v) => { obj[k] = v; },
    }),
  },
});

// ---- Config
test('getConfig: defaults CANCEL_HEADER and strips trailing slash', () => {
  const c = J(loadGas(props({ ...REQUIRED })).getConfig());
  assert.equal(c.cancelHeader, 'キャンセル');
  assert.equal(c.appBaseUrl, 'https://app.example.com');
  assert.equal(c.formSheetId, 'f1');
  assert.equal(c.expiresAt, REQUIRED.EXPIRES_AT);
  assert.equal(J(loadGas(props({ ...REQUIRED, CANCEL_HEADER: '取消' })).getConfig()).cancelHeader, '取消');
});

test('getConfig: invalid EXPIRES_AT throws', () => {
  assert.throws(() => loadGas(props({ ...REQUIRED, EXPIRES_AT: 'soon' })).getConfig());
});

test('getConfig: each missing required property throws', () => {
  for (const k of Object.keys(REQUIRED)) {
    const o = { ...REQUIRED };
    delete o[k];
    assert.throws(() => loadGas(props(o)).getConfig(), new RegExp(k));
  }
});

// ---- fake spreadsheet
function makeSheet(values) {
  const sheet = {
    values, formats: new Map(), formulas: new Map(), log: [],
    getDataRange: () => ({
      getValues: () => sheet.values.map((r) => r.slice()),
      getFormulas: () => sheet.values.map((r, i) => r.map((_, j) => sheet.formulas.get((i + 1) + ',' + (j + 1)) || '')),
    }),
    getLastRow: () => sheet.values.length,
    getMaxRows: () => 1000,
    getRange: (r, c, nr = 1, nc = 1) => ({
      setValues: (v) => { sheet.log.push('values'); for (let i = 0; i < nr; i++) { sheet.values[r - 1 + i] = sheet.values[r - 1 + i] || []; for (let j = 0; j < nc; j++) sheet.values[r - 1 + i][c - 1 + j] = v[i][j]; } },
      setNumberFormat: (f) => { sheet.log.push('fmt'); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sheet.formats.set((r + i) + ',' + (c + j), f); },
    }),
    setFrozenRows() {},
  };
  return sheet;
}
function makeSS(sheets) {
  const ss = {
    sheets,
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => { sheets[n] = makeSheet([]); return sheets[n]; },
  };
  return ss;
}
const CFG = { formSheetId: 'f1', formSheetName: 'F', emailHeader: 'メール', cancelHeader: 'キャンセル', dataSheetId: 'd1', appBaseUrl: 'x' };
function storeWith(form, data) {
  const SpreadsheetApp = { openById: (id) => (id === 'f1' ? form : data) };
  const ctx = loadGas({ SpreadsheetApp });
  return ctx.makeStore_(CFG);
}

test('readApplicants: finds columns by header, cancel = non-empty, no cancel column = none canceled', () => {
  const form = makeSS({ F: makeSheet([['x', 'キャンセル', 'メール'], ['1', '', ' A@x.com '], ['2', '○', 'b@x.com'], ['3', '', '']]) });
  const s = storeWith(form, makeSS({}));
  assert.deepEqual(J(s.readApplicants()), [{ email: 'A@x.com'.trim(), canceled: false }, { email: 'b@x.com', canceled: true }]);
  const form2 = makeSS({ F: makeSheet([['メール'], ['a@x.com']]) });
  assert.deepEqual(J(storeWith(form2, makeSS({})).readApplicants()), [{ email: 'a@x.com', canceled: false }]);
});

const TH = ['email', 'token', 'url', 'issuedAt', 'lastSentDate', 'pending'];
const PH = ['email', 'name', 'job', 'fields', 'challenge', 'strengths', 'needs', 'link', 'photoFileId', 'photoUrl', 'consent', 'consentAt', 'updatedAt', 'staff'];

test('token rows: type conversion on read (Date -> ISO / JST date, booleans), order independent', () => {
  const tokens = makeSheet([['pending', 'lastSentDate', 'issuedAt', 'token', 'email', 'url'],
    ['TRUE', new Date('2026-12-01T16:00:00Z'), new Date('2026-11-30T00:00:00Z'), 'T1', 'a@x.com', 'u1'],
    [false, '2026-12-01', '', '', 'b@x.com', '']]);
  const s = storeWith(makeSS({}), makeSS({ tokens, profiles: makeSheet([PH]) }));
  const r = J(s.getTokenRowByToken('T1'));
  assert.deepEqual(r, { email: 'a@x.com', token: 'T1', url: 'u1', issuedAt: '2026-11-30T00:00:00.000Z', lastSentDate: '2026-12-02', pending: true });
  assert.equal(s.getTokenRowByToken(''), null);
  assert.equal(J(s.getTokenRowByEmail('B@x.com')).lastSentDate, '2026-12-01');
  assert.deepEqual(J(s.listPendingTokenRows()).map((x) => x.email), ['a@x.com']);
});

test('upsertTokenRow: update in place by header, append new, lastSentDate as text', () => {
  const tokens = makeSheet([TH, ['a@x.com', '', '', '', '', false]]);
  const s = storeWith(makeSS({}), makeSS({ tokens, profiles: makeSheet([PH]) }));
  s.upsertTokenRow({ email: 'a@x.com', token: 'T', url: 'u', issuedAt: 'i', lastSentDate: '2026-12-01', pending: true });
  assert.deepEqual(tokens.values[1], ['a@x.com', 'T', 'u', 'i', '2026-12-01', true]);
  assert.equal(tokens.formats.get('2,5'), '@');
  s.upsertTokenRow({ email: 'new@x.com', token: 'N', url: 'u', issuedAt: 'i', lastSentDate: '', pending: false });
  assert.equal(tokens.values.length, 3);
  assert.equal(tokens.values[2][0], 'new@x.com');
});

test('profile rows: read conversions and write (fields join, booleans, staff preserved, formula text)', () => {
  const profiles = makeSheet([PH,
    ['a@x.com', '山田', '開発', 'IT・Web、学生', 'c', 's', 'n', '', 'F1', 'http://p', 'TRUE', new Date('2026-12-01T00:00:00Z'), '2026-12-02T00:00:00Z', '○'],
    ['b@x.com', '', '', '', '', '', '', '', '', '', false, '', '', '']]);
  const s = storeWith(makeSS({}), makeSS({ tokens: makeSheet([TH]), profiles }));
  const r = J(s.getProfileRow('a@x.com'));
  assert.deepEqual(r, {
    email: 'a@x.com',
    profile: { name: '山田', job: '開発', fields: ['IT・Web', '学生'], challenge: 'c', strengths: 's', needs: 'n', link: '', photoUrl: 'http://p' },
    photoFileId: 'F1', consent: true, consentAt: '2026-12-01T00:00:00.000Z', updatedAt: '2026-12-02T00:00:00Z', staff: true,
  });
  assert.equal(J(s.getProfileRow('b@x.com')).profile, null);
  assert.equal(J(s.getProfileRow('b@x.com')).staff, false);
  assert.equal(s.getProfileRow('zzz@x.com'), null);
  r.profile.fields = ['飲食'];
  r.profile.name = '=HYPERLINK("x")';
  r.consent = false;
  s.upsertProfileRow(r);
  const row = profiles.values[1];
  // Written with a leading apostrophe so real Sheets stores literal text (it strips the
  // apostrophe on read). The '@' format alone was shown live not to prevent evaluation.
  assert.equal(row[1], '\'=HYPERLINK("x")');
  assert.equal(row[4], 'c');
  assert.equal(profiles.formats.get('2,2'), '@');
  assert.equal(profiles.formats.get('2,3'), '@');
  assert.equal(row[3], '飲食');
  assert.equal(row[10], false);
  assert.equal(row[13], '○'); // staff untouched
  s.upsertProfileRow({ email: 'c@x.com', profile: null, photoFileId: '', consent: false, consentAt: '', updatedAt: '', staff: '' });
  assert.equal(profiles.values.length, 4);
  assert.equal(J(s.listProfileRows()).length, 3);
});

// ---- cache
function fakeCache() {
  const m = new Map();
  return { m, get: (k) => (m.has(k) ? m.get(k) : null), put: (k, v, t) => { m.set(k, v); m.ttl = t; }, remove: (k) => { m.delete(k); } };
}
test('writes set text format on the row before setValues; formula cells read back as formula text', () => {
  const profiles = makeSheet([PH, ['a@x.com', 'ZZ', '', '', '', '', '', '', '', '', false, '', '', '']]);
  const tokens = makeSheet([TH]);
  const s = storeWith(makeSS({}), makeSS({ tokens, profiles }));
  s.upsertProfileRow({ email: 'a@x.com', profile: { name: '3/4', job: '007', fields: [], challenge: '', strengths: '', needs: '', link: '', photoUrl: '' }, photoFileId: '', consent: false, consentAt: '', updatedAt: '', staff: false });
  const vi = profiles.log.indexOf('values');
  assert.ok(vi > 0 && profiles.log.slice(0, vi).every((e) => e === 'fmt') && profiles.log.slice(vi + 1).every((e) => e !== 'fmt'));
  assert.equal(profiles.formats.get('2,2'), '@');
  assert.equal(profiles.formats.get('2,3'), '@');
  assert.equal(profiles.formats.get('2,11'), undefined); // consent stays boolean
  s.upsertTokenRow({ email: 'a@x.com', token: 'T', url: 'u', issuedAt: 'i', lastSentDate: '', pending: false });
  assert.ok(tokens.log.indexOf('values') > tokens.log.lastIndexOf('fmt'));
  // a cell that holds a formula: Store must return the formula text, not the computed value
  profiles.values[1][0] = 'other@x.com'; // computed value of =A3
  profiles.formulas.set('2,1', '=A3');
  profiles.values[1][1] = 'computed';
  profiles.formulas.set('2,2', '=A3');
  const p = s.listProfileRows()[0];
  assert.equal(p.email, '=A3');
  assert.equal(p.profile.name, '=A3');
  assert.equal(s.getProfileRow('=A3').email, '=A3');
});

test('cache adapter: putList failure is swallowed',() => {
  const cache = { get: () => null, put: () => { throw new Error('quota'); }, remove() {} };
  let warned = 0;
  const ctx = loadGas({ CacheService: { getScriptCache: () => cache }, console: { warn: () => warned++ } });
  const c = ctx.makeCache_();
  c.putList([{ id: 'a' }], c.generation());
  assert.equal(warned, 1);
});

test('cache adapter: chunk roundtrip, TTL 600, invalidate, missing chunk -> null', () => {
  const cache = fakeCache();
  const ctx = loadGas({ CacheService: { getScriptCache: () => cache } });
  const c = ctx.makeCache_();
  assert.equal(c.getList(), null);
  const list = [{ id: 'a', name: 'あ'.repeat(70000) }, { id: 'b' }];
  c.putList(list, c.generation());
  assert.ok(Number(cache.get('list:n')) >= 3);
  assert.equal(cache.m.ttl, 600);
  assert.deepEqual(J(c.getList()), list);
  cache.m.delete('list:1');
  assert.equal(c.getList(), null);
  c.putList(list, c.generation());
  c.invalidate();
  assert.equal(cache.get('list:n'), null);
  assert.equal(c.getList(), null);
  cache.put('list:n', '1'); cache.put('list:0', '{bad');
  assert.equal(c.getList(), null);
});

test('cache adapter: putList is rejected when the generation changed (invalidate in between)', () => {
  const cache = fakeCache();
  const ctx = loadGas({ CacheService: { getScriptCache: () => cache } });
  const c = ctx.makeCache_();
  const g0 = c.generation();
  c.invalidate();
  assert.notEqual(c.generation(), g0);
  c.putList([{ name: 'stale' }], g0);
  assert.equal(c.getList(), null);
  c.putList([{ name: 'fresh' }], c.generation());
  assert.deepEqual(J(c.getList()), [{ name: 'fresh' }]);
});

// ---- lock
function lockCtx(got) {
  const log = [];
  const ctx = loadGas({ LockService: { getScriptLock: () => ({ tryLock: (ms) => { log.push('try' + ms); return got; }, releaseLock: () => log.push('release') }) } });
  return { ctx, log };
}
test('withLock: busy when lock not acquired; releases after fn, even on throw', () => {
  let r = lockCtx(false);
  assert.deepEqual(J(r.ctx.withLock_(() => 'x')), { ok: false, error: 'busy' });
  assert.deepEqual(r.log, ['try10000']);
  r = lockCtx(true);
  assert.equal(r.ctx.withLock_(() => 'x'), 'x');
  assert.deepEqual(r.log, ['try10000', 'release']);
  r = lockCtx(true);
  assert.throws(() => r.ctx.withLock_(() => { throw new Error('boom'); }));
  assert.deepEqual(r.log, ['try10000', 'release']);
});

// ---- photo / mail / alerts
test('photo.save / trash', () => {
  const calls = [];
  const file = { getId: () => 'FID', setSharing: (a, p) => calls.push(['share', a, p]) };
  const folder = { createFile: (b) => { calls.push(['create', b]); return file; }, };
  const ctx = loadGas({
    DriveApp: { getFolderById: (id) => { calls.push(['folder', id]); return folder; }, getFileById: (id) => { if (id === 'gone') throw new Error('nf'); return { setTrashed: (v) => calls.push(['trash', id, v]) }; }, Access: { ANYONE_WITH_LINK: 'AWL' }, Permission: { VIEW: 'V' } },
    Utilities: { getUuid: () => 'abcdef01-0000', base64Decode: (s) => 'bytes:' + s, newBlob: (b, m, n) => ({ b, m, n }) },
    console: { warn() {}, error() {} },
  });
  const p = ctx.makePhoto_({ photoFolderId: 'p1', now: () => new Date('2026-12-01T00:00:00Z') }, () => new Date('2026-12-01T00:00:00Z'));
  const res = J(p.save('QQ', 'image/jpeg'));
  assert.deepEqual(res, { fileId: 'FID', url: 'https://drive.google.com/thumbnail?id=FID&sz=w400' });
  assert.equal(calls[0][1], 'p1');
  assert.equal(calls[1][1].b, 'bytes:QQ');
  assert.equal(calls[1][1].m, 'image/jpeg');
  assert.match(calls[1][1].n, /\.jpg$/);
  assert.deepEqual(calls[2], ['share', 'AWL', 'V']);
  p.trash('F9');
  assert.deepEqual(calls[3], ['trash', 'F9', true]);
  p.trash('gone'); // tolerated
});

test('mail adapter and alerts', () => {
  const sent = [];
  const store = {};
  const ctx = loadGas({
    MailApp: { getRemainingDailyQuota: () => 42, sendEmail: (o) => sent.push(o) },
    ...props(store),
  });
  const m = ctx.makeMail_();
  assert.equal(m.remaining(), 42);
  m.send('a@x.com', { subject: 'S', body: 'B' });
  assert.deepEqual(J(sent[0]), { to: 'a@x.com', subject: 'S', body: 'B', name: '100人交流会 運営事務局' });
  const a = ctx.makeAlerts_(() => new Date('2026-12-01T03:00:00Z'));
  assert.equal(a.alreadySentToday(), false);
  a.markSentToday();
  assert.equal(store.ALERT_SENT_DATE, '2026-12-01');
  assert.equal(a.alreadySentToday(), true);
});

test('newToken is 32 hex chars from getUuid', () => {
  const ctx = loadGas({ Utilities: { getUuid: () => '12345678-1234-1234-1234-123456789abc' } });
  assert.equal(ctx.newToken_(), '12345678123412341234123456789abc');
  const up = loadGas({ Utilities: { getUuid: () => 'ABCDEF12-1234-1234-1234-123456789ABC' } });
  assert.equal(up.newToken_(), 'abcdef12123412341234123456789abc');
});

// ---- triggers / setup
test('processPendingTrigger: runs processPending under lock; skips when busy; swallows errors', () => {
  const { ctx } = lockCtx(true);
  ctx.console = { error() {} };
  let n = 0;
  ctx.buildDeps = () => ({ marker: 1 });
  ctx.processPending = (d) => { n += d.marker; };
  ctx.processPendingTrigger();
  assert.equal(n, 1);
  ctx.processPending = () => { throw new Error('x'); };
  ctx.processPendingTrigger();
  const b = lockCtx(false);
  b.ctx.buildDeps = () => ({ marker: 1 });
  let ran = false;
  b.ctx.processPending = () => { ran = true; };
  b.ctx.processPendingTrigger();
  assert.equal(ran, false);
});

test('setupDataSheet creates sheets with headers, idempotent', () => {
  const data = makeSS({});
  const ctx = loadGas({ ...props({ ...REQUIRED }), SpreadsheetApp: { openById: () => data } });
  ctx.setupDataSheet();
  assert.deepEqual(data.sheets.tokens.values[0], TH);
  assert.deepEqual(data.sheets.profiles.values[0], PH);
  assert.equal(data.sheets.tokens.formats.get('5,5'), '@'); // lastSentDate column
  assert.equal(data.sheets.profiles.formats.get('9,2'), '@'); // name column
  assert.equal(data.sheets.profiles.formats.get('9,11'), undefined); // consent column
  data.sheets.tokens.values.push(['a']);
  ctx.setupDataSheet();
  assert.equal(data.sheets.tokens.values.length, 2);
});

test('setupTriggers deletes same-named triggers then creates one hourly', () => {
  const log = [];
  const existing = [{ getHandlerFunction: () => 'processPendingTrigger', id: 1 }, { getHandlerFunction: () => 'other', id: 2 }];
  const builder = { timeBased() { return this; }, everyHours(n) { log.push('every' + n); return this; }, create() { log.push('create'); } };
  const ctx = loadGas({ ScriptApp: {
    getProjectTriggers: () => existing,
    deleteTrigger: (t) => log.push('del' + t.id),
    newTrigger: (name) => { log.push('new:' + name); return builder; },
  } });
  ctx.setupTriggers();
  assert.deepEqual(log, ['del1', 'new:processPendingTrigger', 'every1', 'create']);
});
