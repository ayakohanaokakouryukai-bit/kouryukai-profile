import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-harness.js';

const ctx = loadGas();
const J = (x) => JSON.parse(JSON.stringify(x));
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

export function makeDeps(overrides = {}) {
  let tokenCounter = 0;
  const state = {
    now: new Date('2026-12-01T03:00:00Z'), // 12:00 JST
    applicants: [{ email: 'a@example.com', canceled: false }, { email: 'b@example.com', canceled: false }],
    tokens: [],
    profiles: [],
    sent: [],
    remaining: 100,
    trashed: [],
    saved: [],
    invalidations: 0,
    cachedList: null,
    gen: 'g0',
    puts: 0,
    alertSent: false,
    busy: false,
  };
  const keyOf = (arr, email) => arr.findIndex((r) => r.email === email);
  const deps = {
    state,
    config: { expiresAt: '2027-05-06T23:59:59+09:00', appBaseUrl: 'https://app.example.com', organizerEmail: 'org@example.com' },
    now: () => state.now,
    newToken: () => 'tok' + String(++tokenCounter).padStart(3, '0'),
    withLock: (fn) => (state.busy ? { ok: false, error: 'busy' } : fn()),
    store: {
      readApplicants: () => clone(state.applicants),
      getTokenRowByEmail: (e) => clone(state.tokens.find((r) => r.email === e) || null),
      getTokenRowByToken: (t) => clone(state.tokens.find((r) => r.token && r.token === t) || null),
      upsertTokenRow: (row) => {
        const i = keyOf(state.tokens, row.email);
        if (i < 0) state.tokens.push(clone(row)); else state.tokens[i] = clone(row);
      },
      listPendingTokenRows: () => clone(state.tokens.filter((r) => r.pending)),
      getProfileRow: (e) => clone(state.profiles.find((r) => r.email === e) || null),
      upsertProfileRow: (row) => {
        const i = keyOf(state.profiles, row.email);
        if (i < 0) state.profiles.push(clone(row)); else state.profiles[i] = clone(row);
      },
      listProfileRows: () => clone(state.profiles),
    },
    mail: {
      remaining: () => state.remaining,
      send: (to, msg) => { state.sent.push({ to, subject: msg.subject, body: msg.body }); state.remaining--; },
    },
    photo: {
      save: (base64, mime) => { const n = state.saved.length + 1; state.saved.push({ base64, mime }); return { fileId: 'file' + n, url: 'https://img/' + n }; },
      trash: (id) => state.trashed.push(id),
    },
    cache: {
      getList: () => clone(state.cachedList),
      generation: () => state.gen,
      putList: (l, gen) => { if (gen !== state.gen) return; state.cachedList = clone(l); state.puts++; },
      invalidate: () => { state.invalidations++; state.cachedList = null; state.gen = 'g' + state.invalidations; },
    },
    alerts: {
      alreadySentToday: () => state.alertSent,
      markSentToday: () => { state.alertSent = true; },
    },
  };
  return Object.assign(deps, overrides);
}

const run = (req, deps) => J(ctx.handleRequest(req, deps));
const GOOD = {
  name: '山田', job: '開発', fields: ['IT・Web'], challenge: 'c', strengths: 's', needs: 'n', link: '',
};
const tokenRow = (over = {}) => ({ email: 'a@example.com', token: 'T1', url: 'u', issuedAt: '2026-11-30T00:00:00Z', lastSentDate: '', pending: false, ...over });
function withToken(deps, email = 'a@example.com', token = 'T1') {
  deps.store.upsertTokenRow(tokenRow({ email, token }));
  return deps;
}
// make `email` a visible participant
function makeVisible(deps, email, name, consentAt = '2026-12-01T00:00:00Z') {
  deps.store.upsertProfileRow({ email, profile: { ...GOOD, name, photoUrl: '' }, photoFileId: '', consent: true, consentAt, staff: '' });
}

test('requestLink: unknown email returns ok and sends nothing', () => {
  const d = makeDeps();
  assert.deepEqual(run({ action: 'requestLink', email: 'x@example.com' }, d), { ok: true });
  assert.equal(d.state.sent.length, 0);
  assert.equal(d.state.tokens.length, 0);
});

test('requestLink: blank or missing email -> ok, nothing sent', () => {
  const d = makeDeps();
  assert.deepEqual(run({ action: 'requestLink' }, d), { ok: true });
  assert.deepEqual(run({ action: 'requestLink', email: '  ' }, d), { ok: true });
  assert.equal(d.state.sent.length, 0);
});

test('requestLink: eligible first time issues token and sends link with #t=', () => {
  const d = makeDeps();
  assert.deepEqual(run({ action: 'requestLink', email: '  A@Example.com ' }, d), { ok: true });
  assert.equal(d.state.sent.length, 1);
  assert.equal(d.state.sent[0].to, 'a@example.com');
  assert.ok(d.state.sent[0].body.includes('https://app.example.com/me.html#t=tok001'));
  assert.ok(d.state.sent[0].body.includes('2027年5月6日'));
  assert.equal(d.state.tokens[0].lastSentDate, '2026-12-01');
  assert.equal(d.state.tokens[0].pending, false);
});

test('requestLink: issued token row has url === appBaseUrl + "/me.html#t=" + token', () => {
  const d = makeDeps();
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  const row = d.state.tokens[0];
  assert.equal(row.url, 'https://app.example.com/me.html#t=' + row.token);
  assert.equal(row.issuedAt, d.state.now.toISOString());
});

test('requestLink: new token after clearing overwrites url too', () => {
  const d = makeDeps();
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  d.state.tokens[0].token = '';
  d.state.now = new Date('2026-12-02T03:00:00Z');
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  const row = d.state.tokens[0];
  assert.equal(row.token, 'tok002');
  assert.equal(row.url, 'https://app.example.com/me.html#t=tok002');
});

test('requestLink: second request same JST day sends nothing, same response', () => {
  const d = makeDeps();
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  const r = run({ action: 'requestLink', email: 'a@example.com' }, d);
  assert.deepEqual(r, { ok: true });
  assert.equal(d.state.sent.length, 1);
});

test('requestLink: next JST day resends the SAME token', () => {
  const d = makeDeps();
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  d.state.now = new Date('2026-12-02T03:00:00Z');
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  assert.equal(d.state.sent.length, 2);
  assert.ok(d.state.sent[1].body.includes('#t=tok001'));
  assert.equal(d.state.tokens.length, 1);
});

test('requestLink: JST day boundary (UTC 15:00 is next JST day)', () => {
  const d = makeDeps();
  d.state.now = new Date('2026-12-01T14:59:00Z');
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  d.state.now = new Date('2026-12-01T15:01:00Z');
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  assert.equal(d.state.sent.length, 2);
});

test('requestLink: cleared token cell issues a new token, old token -> invalid_token', () => {
  const d = makeDeps();
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  const old = d.state.tokens[0].token;
  d.state.tokens[0].token = '';
  d.state.now = new Date('2026-12-02T03:00:00Z');
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  assert.deepEqual(run({ action: 'getMe', token: old }, d), { ok: false, error: 'invalid_token' });
  assert.equal(run({ action: 'getMe', token: 'tok002' }, d).ok, true);
});

test('requestLink: quota 0 marks pending, response still ok', () => {
  const d = makeDeps();
  d.state.remaining = 0;
  assert.deepEqual(run({ action: 'requestLink', email: 'a@example.com' }, d), { ok: true });
  assert.equal(d.state.sent.length, 0);
  assert.equal(d.state.tokens[0].pending, true);
  assert.equal(d.state.tokens[0].lastSentDate, '');
});

test('requestLink: pending row is sent on a later request once quota is back', () => {
  const d = makeDeps();
  d.state.remaining = 0;
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  d.state.remaining = 50;
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  // lastSentDate is empty, so canSendToday is true and it sends now
  assert.equal(d.state.sent.length, 1);
  assert.equal(d.state.tokens[0].pending, false);
});

test('requestLink: after expiresAt sends nothing', () => {
  const d = makeDeps();
  d.state.now = new Date('2027-05-07T00:00:00+09:00');
  assert.deepEqual(run({ action: 'requestLink', email: 'a@example.com' }, d), { ok: true });
  assert.equal(d.state.sent.length, 0);
  assert.equal(d.state.tokens.length, 0);
});

test('requestLink: canceled applicant gets nothing', () => {
  const d = makeDeps();
  d.state.applicants[0].canceled = true;
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  assert.equal(d.state.sent.length, 0);
});

test('requestLink: busy lock result is passed through', () => {
  const d = makeDeps();
  d.state.busy = true;
  assert.deepEqual(run({ action: 'requestLink', email: 'a@example.com' }, d), { ok: false, error: 'busy' });
});

test('requestLink: remaining < 10 sends one organizer alert per day', () => {
  const d = makeDeps();
  d.state.remaining = 5;
  run({ action: 'requestLink', email: 'a@example.com' }, d); // remaining 4 after send
  run({ action: 'requestLink', email: 'b@example.com' }, d); // remaining 3
  const alerts = d.state.sent.filter((m) => m.to === 'org@example.com');
  assert.equal(alerts.length, 1);
  assert.equal(d.state.alertSent, true);
});

test('requestLink: no alert when remaining is 0 or >= 10', () => {
  const d = makeDeps();
  run({ action: 'requestLink', email: 'a@example.com' }, d); // 99 left
  assert.equal(d.state.sent.filter((m) => m.to === 'org@example.com').length, 0);
  const d2 = makeDeps();
  d2.state.remaining = 1;
  run({ action: 'requestLink', email: 'a@example.com' }, d2); // 0 left after send
  assert.equal(d2.state.sent.filter((m) => m.to === 'org@example.com').length, 0);
});

test('getMe: unknown token -> invalid_token', () => {
  const d = makeDeps();
  assert.deepEqual(run({ action: 'getMe', token: 'nope' }, d), { ok: false, error: 'invalid_token' });
  assert.deepEqual(run({ action: 'getMe', token: '' }, d), { ok: false, error: 'invalid_token' });
  assert.deepEqual(run({ action: 'getMe' }, d), { ok: false, error: 'invalid_token' });
});

test('getMe: canceled after issue -> invalid_token', () => {
  const d = withToken(makeDeps());
  d.state.applicants[0].canceled = true;
  assert.deepEqual(run({ action: 'getMe', token: 'T1' }, d), { ok: false, error: 'invalid_token' });
});

test('getMe: after expiry -> expired; unknown token after expiry still invalid_token', () => {
  const d = withToken(makeDeps());
  d.state.now = new Date('2027-05-07T00:00:00+09:00');
  assert.deepEqual(run({ action: 'getMe', token: 'T1' }, d), { ok: false, error: 'expired' });
  assert.deepEqual(run({ action: 'getMe', token: 'zzz' }, d), { ok: false, error: 'invalid_token' });
});

test('getMe: no profile -> profile null, consent false, visible false', () => {
  const d = withToken(makeDeps());
  const r = run({ action: 'getMe', token: 'T1' }, d);
  assert.deepEqual(r, { ok: true, profile: null, consent: false, visible: false, expiresAt: '2027-05-06T23:59:59+09:00' });
});

test('getMe: returns stored profile incl. photoUrl', () => {
  const d = withToken(makeDeps());
  makeVisible(d, 'a@example.com', '山田');
  const r = run({ action: 'getMe', token: 'T1' }, d);
  assert.equal(r.profile.name, '山田');
  assert.equal(r.profile.photoUrl, '');
  assert.equal(r.consent, true);
  assert.equal(r.visible, true);
});

test('saveProfile: without consent -> consent_required', () => {
  const d = withToken(makeDeps());
  const r = run({ action: 'saveProfile', token: 'T1', profile: GOOD }, d);
  assert.deepEqual(r, { ok: false, error: 'consent_required' });
  assert.equal(d.state.profiles.length, 0);
});

test('saveProfile: invalid -> validation with fieldErrors', () => {
  const d = withToken(makeDeps());
  const r = run({ action: 'saveProfile', token: 'T1', consent: true, profile: { ...GOOD, name: '' } }, d);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'validation');
  assert.ok(r.fieldErrors.name);
});

test('saveProfile: valid -> visible true and cache.invalidate called', () => {
  const d = withToken(makeDeps());
  const r = run({ action: 'saveProfile', token: 'T1', consent: true, profile: GOOD }, d);
  assert.equal(r.ok, true);
  assert.equal(r.visible, true);
  assert.equal(r.profile.name, '山田');
  assert.equal(d.state.invalidations, 1);
  const row = d.state.profiles[0];
  assert.equal(row.consent, true);
  assert.equal(row.consentAt, d.state.now.toISOString());
  assert.equal(row.updatedAt, d.state.now.toISOString());
});

test('saveProfile: keeps photoUrl, photoFileId, staff and original consentAt', () => {
  const d = withToken(makeDeps());
  d.store.upsertProfileRow({ email: 'a@example.com', profile: { ...GOOD, photoUrl: 'https://img/9' }, photoFileId: 'f9', consent: true, consentAt: '2026-11-20T00:00:00Z', staff: '○' });
  const r = run({ action: 'saveProfile', token: 'T1', profile: { ...GOOD, name: '新' } }, d);
  assert.equal(r.ok, true); // existing consent true is enough
  const row = d.state.profiles[0];
  assert.equal(row.profile.photoUrl, 'https://img/9');
  assert.equal(row.photoFileId, 'f9');
  assert.equal(row.staff, '○');
  assert.equal(row.consentAt, '2026-11-20T00:00:00Z');
  assert.equal(row.profile.name, '新');
});

test('saveProfile: busy passes through', () => {
  const d = withToken(makeDeps());
  d.state.busy = true;
  assert.deepEqual(run({ action: 'saveProfile', token: 'T1', consent: true, profile: GOOD }, d), { ok: false, error: 'busy' });
});

test('saveProfile: invalid token / expired rejected', () => {
  const d = withToken(makeDeps());
  assert.equal(run({ action: 'saveProfile', token: 'bad', consent: true, profile: GOOD }, d).error, 'invalid_token');
  d.state.now = new Date('2027-05-07T00:00:00+09:00');
  assert.equal(run({ action: 'saveProfile', token: 'T1', consent: true, profile: GOOD }, d).error, 'expired');
});

test('getList: requester not visible -> not_visible', () => {
  const d = withToken(makeDeps());
  assert.deepEqual(run({ action: 'getList', token: 'T1' }, d), { ok: false, error: 'not_visible' });
});

test('getList: returns only visible profiles, none has email, newest consent first', () => {
  const d = withToken(makeDeps());
  makeVisible(d, 'a@example.com', 'A', '2026-12-01T00:00:00Z');
  makeVisible(d, 'b@example.com', 'B', '2026-12-02T00:00:00Z');
  d.store.upsertProfileRow({ email: 'c@example.com', profile: { ...GOOD, name: 'C' }, consent: false, consentAt: '2026-12-03T00:00:00Z' });
  d.state.applicants.push({ email: 'c@example.com', canceled: false });
  const r = run({ action: 'getList', token: 'T1' }, d);
  assert.equal(r.ok, true);
  assert.deepEqual(r.participants.map((p) => p.name), ['B', 'A']);
  assert.ok(!JSON.stringify(r).includes('@'));
  assert.ok(r.generatedAt);
});

test('getList: canceled applicants are excluded', () => {
  const d = withToken(makeDeps());
  makeVisible(d, 'a@example.com', 'A');
  makeVisible(d, 'b@example.com', 'B');
  d.state.applicants[1].canceled = true;
  const r = run({ action: 'getList', token: 'T1' }, d);
  assert.deepEqual(r.participants.map((p) => p.name), ['A']);
});

test('getList: uses cache when present, builds and puts when absent', () => {
  const d = withToken(makeDeps());
  makeVisible(d, 'a@example.com', 'A');
  const r1 = run({ action: 'getList', token: 'T1' }, d);
  assert.equal(d.state.puts, 1);
  assert.equal(r1.participants.length, 1);
  d.state.cachedList = [{ id: 'cached', name: 'CACHED' }];
  const r2 = run({ action: 'getList', token: 'T1' }, d);
  assert.equal(r2.participants[0].name, 'CACHED');
  assert.equal(d.state.puts, 1);
});

test('getList: stale putList after a concurrent withdraw+invalidate is rejected', () => {
  const d = withToken(makeDeps());
  withToken(d, 'b@example.com', 'T2');
  makeVisible(d, 'a@example.com', 'A');
  makeVisible(d, 'b@example.com', 'B');
  // A misses the cache and reads rows while B is still visible...
  const origList = d.store.listProfileRows;
  d.store.listProfileRows = () => {
    const rows = origList();
    // ...then B withdraws (under lock) and invalidates before A writes its list.
    d.store.listProfileRows = origList;
    const b = d.state.profiles.find((r) => r.email === 'b@example.com');
    b.consent = false;
    d.cache.invalidate();
    return rows;
  };
  const r1 = run({ action: 'getList', token: 'T1' }, d);
  assert.equal(r1.participants.length, 2); // A's own response was built from the stale read
  assert.equal(d.state.cachedList, null); // but the stale list was NOT cached
  assert.equal(d.state.puts, 0);
  const r2 = run({ action: 'getList', token: 'T1' }, d);
  assert.deepEqual(r2.participants.map((p) => p.name), ['A']);
});

test('getList: PublicProfile has no id and no email', () => {
  const d = withToken(makeDeps());
  makeVisible(d, 'a@example.com', 'A');
  const p = run({ action: 'getList', token: 'T1' }, d).participants[0];
  assert.equal('id' in p, false);
  assert.equal('email' in p, false);
});

test('withdrawConsent: requester disappears from next getList and cache invalidated', () => {
  const d = withToken(makeDeps());
  withToken(d, 'b@example.com', 'T2');
  makeVisible(d, 'a@example.com', 'A');
  makeVisible(d, 'b@example.com', 'B');
  assert.equal(run({ action: 'getList', token: 'T2' }, d).participants.length, 2);
  const before = d.state.invalidations;
  assert.deepEqual(run({ action: 'withdrawConsent', token: 'T1' }, d), { ok: true });
  assert.equal(d.state.invalidations, before + 1);
  assert.deepEqual(run({ action: 'getList', token: 'T2' }, d).participants.map((p) => p.name), ['B']);
  assert.equal(run({ action: 'getList', token: 'T1' }, d).error, 'not_visible');
  assert.equal(d.state.profiles.find((r) => r.email === 'a@example.com').profile.name, 'A'); // data kept
});

test('uploadPhoto: replaces old file (trash called with old id) and invalidates cache', () => {
  const d = withToken(makeDeps());
  const a = run({ action: 'uploadPhoto', token: 'T1', base64: '/9j/AAAA', mimeType: 'image/jpeg' }, d);
  assert.deepEqual(a, { ok: true, photoUrl: 'https://img/1' });
  assert.deepEqual(d.state.trashed, []);
  const b = run({ action: 'uploadPhoto', token: 'T1', base64: '/9j/BBBB', mimeType: 'image/jpeg' }, d);
  assert.deepEqual(b, { ok: true, photoUrl: 'https://img/2' });
  assert.deepEqual(d.state.trashed, ['file1']);
  assert.equal(d.state.invalidations, 2);
  const row = d.state.profiles[0];
  assert.equal(row.photoFileId, 'file2');
  assert.equal(row.consent, false);
});

test('uploadPhoto: oversize or non-JPEG base64 -> bad_image, valid /9j/ ok', () => {
  const d = withToken(makeDeps());
  const bad = { ok: false, error: 'bad_image' };
  assert.deepEqual(run({ action: 'uploadPhoto', token: 'T1', base64: '/9j/' + 'A'.repeat(2000000), mimeType: 'image/jpeg' }, d), bad);
  assert.deepEqual(run({ action: 'uploadPhoto', token: 'T1', base64: 'iVBORw0KGgo=', mimeType: 'image/jpeg' }, d), bad);
  assert.equal(d.state.saved.length, 0);
  assert.equal(run({ action: 'uploadPhoto', token: 'T1', base64: '/9j/AAAA', mimeType: 'image/jpeg' }, d).ok, true);
});

test('uploadPhoto: non-jpeg mimeType or empty base64 -> bad_image', () => {
  const d = withToken(makeDeps());
  assert.deepEqual(run({ action: 'uploadPhoto', token: 'T1', base64: 'AAAA', mimeType: 'image/png' }, d), { ok: false, error: 'bad_image' });
  assert.deepEqual(run({ action: 'uploadPhoto', token: 'T1', base64: '', mimeType: 'image/jpeg' }, d), { ok: false, error: 'bad_image' });
  assert.deepEqual(run({ action: 'uploadPhoto', token: 'T1', mimeType: 'image/jpeg' }, d), { ok: false, error: 'bad_image' });
  assert.equal(d.state.saved.length, 0);
});

test('deletePhoto: trashes file, clears fields, invalidates; ok without photo', () => {
  const d = withToken(makeDeps());
  assert.deepEqual(run({ action: 'deletePhoto', token: 'T1' }, d), { ok: true });
  run({ action: 'uploadPhoto', token: 'T1', base64: '/9j/AAAA', mimeType: 'image/jpeg' }, d);
  const inv = d.state.invalidations;
  assert.deepEqual(run({ action: 'deletePhoto', token: 'T1' }, d), { ok: true });
  assert.deepEqual(d.state.trashed, ['file1']);
  assert.equal(d.state.invalidations, inv + 1);
  const row = d.state.profiles[0];
  assert.ok(!row.photoFileId);
  assert.ok(!(row.profile && row.profile.photoUrl));
});

test('processPending: sends pending rows while remaining > 0, clears pending, sets lastSentDate', () => {
  const d = makeDeps();
  d.state.remaining = 0;
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  run({ action: 'requestLink', email: 'b@example.com' }, d);
  d.state.remaining = 1;
  d.state.now = new Date('2026-12-01T05:00:00Z');
  const r = J(ctx.processPending(d));
  assert.deepEqual(r, { sent: 1, stillPending: 1 });
  const a = d.state.tokens.find((t) => t.email === 'a@example.com');
  assert.equal(a.pending, false);
  assert.equal(a.lastSentDate, '2026-12-01');
  assert.ok(d.state.sent[0].body.includes('#t=' + a.token));
  d.state.remaining = 50;
  assert.deepEqual(J(ctx.processPending(d)), { sent: 1, stillPending: 0 });
});

test('processPending: a throwing send does not abort the batch; failed row pending cleared, no lastSentDate', () => {
  const d = makeDeps();
  d.state.applicants.push({ email: 'c@example.com', canceled: false });
  d.store.upsertTokenRow(tokenRow({ email: 'a@example.com', token: 'T1', pending: true }));
  d.store.upsertTokenRow(tokenRow({ email: 'b@example.com', token: 'T2', pending: true }));
  d.store.upsertTokenRow(tokenRow({ email: 'c@example.com', token: 'T3', pending: true }));
  const origSend = d.mail.send;
  d.mail.send = (to, msg) => { if (to === 'b@example.com') throw new Error('bad address'); origSend(to, msg); };
  const errs = [];
  const ctx2 = loadGas({ console: { error: (m) => errs.push(String(m)), warn() {}, log() {} } });
  const r = J(ctx2.processPending(d));
  assert.deepEqual(r, { sent: 2, stillPending: 0 });
  assert.deepEqual(d.state.sent.map((m) => m.to), ['a@example.com', 'c@example.com']);
  const b = d.state.tokens.find((t) => t.email === 'b@example.com');
  assert.equal(b.pending, false);
  assert.equal(b.lastSentDate, '');
  assert.ok(errs.length >= 1 && errs.every((m) => !m.includes('@')));
});

test('mail URL is built from current appBaseUrl at send time and row.url refreshed', () => {
  const d = makeDeps();
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  d.config.appBaseUrl = 'https://new.example.com';
  d.state.tokens[0].lastSentDate = '';
  d.state.tokens[0].pending = true;
  d.state.now = new Date('2026-12-02T03:00:00Z');
  ctx.processPending(d);
  const row = d.state.tokens[0];
  assert.equal(row.url, 'https://new.example.com/me.html#t=' + row.token);
  assert.ok(d.state.sent[d.state.sent.length - 1].body.includes('https://new.example.com/me.html#t=' + row.token));
  // requestLink path too
  d.config.appBaseUrl = 'https://newer.example.com';
  d.state.now = new Date('2026-12-03T03:00:00Z');
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  assert.equal(d.state.tokens[0].url, 'https://newer.example.com/me.html#t=' + row.token);
  assert.ok(d.state.sent[d.state.sent.length - 1].body.includes('https://newer.example.com/me.html#t='));
});

test('processPending: ineligible or expired rows are cleared without sending', () => {
  const d = makeDeps();
  d.state.remaining = 0;
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  d.state.applicants[0].canceled = true;
  d.state.remaining = 50;
  assert.deepEqual(J(ctx.processPending(d)), { sent: 0, stillPending: 0 });
  assert.equal(d.state.sent.length, 0);
  assert.equal(d.state.tokens[0].pending, false);
});

test('processPending: sends organizer alert when remaining drops below 10', () => {
  const d = makeDeps();
  d.state.remaining = 0;
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  d.state.remaining = 5;
  ctx.processPending(d);
  assert.equal(d.state.sent.filter((m) => m.to === 'org@example.com').length, 1);
});

test('unknown action -> server_error', () => {
  const d = makeDeps();
  assert.deepEqual(run({ action: 'nope' }, d), { ok: false, error: 'server_error' });
});

test('thrown error -> server_error with no details', () => {
  const d = withToken(makeDeps());
  d.store.getProfileRow = () => { throw new Error('boom a@example.com'); };
  const orig = console.error;
  console.error = () => {};
  const r = run({ action: 'getMe', token: 'T1' }, d);
  console.error = orig;
  assert.deepEqual(r, { ok: false, error: 'server_error' });
});

test('requestLink: pending row with lastSentDate today stays pending, nothing sent', () => {
  const d = makeDeps();
  d.store.upsertTokenRow(tokenRow({ lastSentDate: '2026-12-01', pending: true }));
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  assert.equal(d.state.sent.length, 0);
  assert.equal(d.state.tokens[0].pending, true);
});

test('requestLink: responses for unknown, canceled, expired, quota-0, repeat are all exactly {ok:true}', () => {
  const out = [];
  out.push(run({ action: 'requestLink', email: 'zzz@example.com' }, makeDeps()));
  const c = makeDeps(); c.state.applicants[0].canceled = true;
  out.push(run({ action: 'requestLink', email: 'a@example.com' }, c));
  const e = makeDeps(); e.state.now = new Date('2027-05-07T00:00:00+09:00');
  out.push(run({ action: 'requestLink', email: 'a@example.com' }, e));
  const q = makeDeps(); q.state.remaining = 0;
  out.push(run({ action: 'requestLink', email: 'a@example.com' }, q));
  const r = makeDeps();
  run({ action: 'requestLink', email: 'a@example.com' }, r);
  out.push(run({ action: 'requestLink', email: 'a@example.com' }, r));
  for (const x of out) assert.deepEqual(x, { ok: true });
});

test('requestLink: mail.send throwing for an eligible address still returns exactly {ok:true}', () => {
  const d = makeDeps();
  d.mail.send = () => { throw new Error('mail down'); };
  const orig = console.error; console.error = () => {};
  const r = run({ action: 'requestLink', email: 'a@example.com' }, d);
  console.error = orig;
  assert.deepEqual(r, { ok: true });
});

test('requestLink: issued token is persisted even when mail.send throws', () => {
  const d = makeDeps();
  d.mail.send = () => { throw new Error('mail down'); };
  const orig = console.error; console.error = () => {};
  run({ action: 'requestLink', email: 'a@example.com' }, d);
  console.error = orig;
  assert.equal(d.state.tokens[0].token, 'tok001');
  assert.equal(d.state.tokens[0].lastSentDate, '');
  assert.equal(run({ action: 'getMe', token: 'tok001' }, d).ok, true);
});

test('uploadPhoto: photo.trash throwing still returns ok, updates row, invalidates cache', () => {
  const d = withToken(makeDeps());
  run({ action: 'uploadPhoto', token: 'T1', base64: '/9j/AAAA', mimeType: 'image/jpeg' }, d);
  d.photo.trash = () => { throw new Error('drive'); };
  const orig = console.error; console.error = () => {};
  const inv = d.state.invalidations;
  const r = run({ action: 'uploadPhoto', token: 'T1', base64: '/9j/BBBB', mimeType: 'image/jpeg' }, d);
  console.error = orig;
  assert.deepEqual(r, { ok: true, photoUrl: 'https://img/2' });
  assert.equal(d.state.profiles[0].photoFileId, 'file2');
  assert.equal(d.state.invalidations, inv + 1);
});

test('deletePhoto: photo.trash throwing still clears fields and invalidates', () => {
  const d = withToken(makeDeps());
  run({ action: 'uploadPhoto', token: 'T1', base64: '/9j/AAAA', mimeType: 'image/jpeg' }, d);
  d.photo.trash = () => { throw new Error('drive'); };
  const orig = console.error; console.error = () => {};
  const inv = d.state.invalidations;
  const r = run({ action: 'deletePhoto', token: 'T1' }, d);
  console.error = orig;
  assert.deepEqual(r, { ok: true });
  assert.ok(!d.state.profiles[0].photoFileId);
  assert.equal(d.state.profiles[0].profile.photoUrl, '');
  assert.equal(d.state.invalidations, inv + 1);
});

test('uploadPhoto: photo.save throwing leaves trashed empty and row unchanged', () => {
  const d = withToken(makeDeps());
  run({ action: 'uploadPhoto', token: 'T1', base64: '/9j/AAAA', mimeType: 'image/jpeg' }, d);
  const before = JSON.stringify(d.state.profiles);
  d.photo.save = () => { throw new Error('drive'); };
  const orig = console.error; console.error = () => {};
  const r = run({ action: 'uploadPhoto', token: 'T1', base64: '/9j/BBBB', mimeType: 'image/jpeg' }, d);
  console.error = orig;
  assert.deepEqual(r, { ok: false, error: 'server_error' });
  assert.deepEqual(d.state.trashed, []);
  assert.equal(JSON.stringify(d.state.profiles), before);
});

test('processPending: row already sent today stays pending, nothing sent', () => {
  const d = makeDeps();
  d.store.upsertTokenRow(tokenRow({ lastSentDate: '2026-12-01', pending: true }));
  assert.deepEqual(J(ctx.processPending(d)), { sent: 0, stillPending: 1 });
  assert.equal(d.state.sent.length, 0);
});

test('processPending: blank token clears pending without sending; blank url is rebuilt', () => {
  const d = makeDeps();
  d.store.upsertTokenRow(tokenRow({ token: '', pending: true }));
  d.store.upsertTokenRow(tokenRow({ email: 'b@example.com', token: 'T2', url: '', pending: true }));
  assert.deepEqual(J(ctx.processPending(d)), { sent: 1, stillPending: 0 });
  assert.deepEqual(d.state.sent.map((m) => m.to), ['b@example.com']);
  assert.equal(d.state.tokens.find((t) => t.email === 'b@example.com').url, 'https://app.example.com/me.html#t=T2');
});
