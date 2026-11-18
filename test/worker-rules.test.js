import test from 'node:test';
import assert from 'node:assert/strict';
import * as ctx from '../worker/src/rules.js';

const {
  normalizeEmail, isEligible, validateProfile, isComplete, isVisible,
  isExpired, jstDate, canSendToday, toPublicProfile, formatJstDateLabel,
} = ctx;

const valid = {
  name: 'たろう', job: '会社員', fields: ['IT・Web'],
  challenge: '挑戦', strengths: '得意', needs: '苦手', link: '',
};

test('FIELD_OPTIONS are the 10 options in order', () => {
  assert.equal(JSON.stringify(ctx.FIELD_OPTIONS), JSON.stringify([
    'IT・Web', 'デザイン・クリエイティブ', '美容・健康', '飲食', '教育・コーチング',
    '士業・金融', 'コミュニティ運営', '会社員', '学生', 'その他',
  ]));
});
test('normalizeEmail trims and lowercases', () =>
  assert.equal(normalizeEmail('  Taro@Example.COM '), 'taro@example.com'));
test('isEligible matches normalized email', () =>
  assert.equal(isEligible([{ email: ' Taro@Example.com ', canceled: false }], 'taro@example.com'), true));
test('isEligible false when only canceled rows', () =>
  assert.equal(isEligible([{ email: 'a@x.jp', canceled: true }], 'a@x.jp'), false));
test('isEligible true when one duplicate row is not canceled', () =>
  assert.equal(isEligible([{ email: 'a@x.jp', canceled: true }, { email: 'A@x.jp', canceled: false }], 'a@x.jp'), true));
test('isEligible false for unknown email', () => assert.equal(isEligible([], 'a@x.jp'), false));

test('validateProfile accepts valid', () => {
  const r = validateProfile(valid);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(r.value), JSON.stringify({ ...valid, sns: {} }));
});
test('validateProfile rejects 4 fields', () =>
  assert.ok(validateProfile({ ...valid, fields: ['IT・Web', '飲食', '学生', 'その他'] }).fieldErrors.fields));
test('validateProfile rejects duplicate fields', () =>
  assert.ok(validateProfile({ ...valid, fields: ['IT・Web', 'IT・Web'] }).fieldErrors.fields));
test('validateProfile rejects empty fields', () =>
  assert.ok(validateProfile({ ...valid, fields: [] }).fieldErrors.fields));
test('validateProfile rejects unknown field option', () =>
  assert.ok(validateProfile({ ...valid, fields: ['宇宙'] }).fieldErrors.fields));
test('validateProfile rejects javascript: link', () =>
  assert.ok(validateProfile({ ...valid, link: 'javascript:alert(1)' }).fieldErrors.link));
test('validateProfile accepts https link, rejects 301-char link', () => {
  assert.equal(validateProfile({ ...valid, link: 'https://x.jp' }).ok, true);
  assert.ok(validateProfile({ ...valid, link: 'https://' + 'a'.repeat(293) }).fieldErrors.link);
});
test('validateProfile rejects 51-char name, accepts 50', () => {
  assert.ok(validateProfile({ ...valid, name: 'あ'.repeat(51) }).fieldErrors.name);
  assert.equal(validateProfile({ ...valid, name: 'あ'.repeat(50) }).ok, true);
});
test('validateProfile rejects empty/whitespace required', () => {
  assert.ok(validateProfile({ ...valid, job: '   ' }).fieldErrors.job);
  assert.ok(validateProfile({ ...valid, challenge: undefined }).fieldErrors.challenge);
});
test('validateProfile limits', () => {
  assert.ok(validateProfile({ ...valid, job: 'a'.repeat(201) }).fieldErrors.job);
  assert.ok(validateProfile({ ...valid, needs: 'a'.repeat(501) }).fieldErrors.needs);
});
test('validateProfile trims and accepts empty link', () => {
  const r = validateProfile({ ...valid, name: ' たろう ', link: '' });
  assert.equal(r.value.name, 'たろう');
  assert.equal(r.ok, true);
});
test('validateProfile ignores unknown keys and photoUrl', () => {
  const r = validateProfile({ ...valid, photoUrl: 'x', evil: 1 });
  assert.equal(r.ok, true);
  assert.equal('photoUrl' in r.value, false);
  assert.equal('evil' in r.value, false);
});

test('isComplete', () => {
  assert.equal(isComplete(valid), true);
  assert.equal(isComplete(null), false);
  assert.equal(isComplete({ ...valid, fields: [] }), false);
  assert.equal(isComplete({ ...valid, needs: '' }), false);
});
test('isVisible false when consented but challenge empty', () =>
  assert.equal(isVisible({ consent: true, profile: { ...valid, challenge: '' } }), false));
test('isVisible false when complete but not consented', () =>
  assert.equal(isVisible({ consent: false, profile: valid }), false));
test('isVisible true when consented and complete', () =>
  assert.equal(isVisible({ consent: true, profile: valid }), true));

test('isExpired boundary', () => {
  assert.equal(isExpired(new Date('2027-05-06T14:59:59Z'), '2027-05-06T23:59:59+09:00'), false);
  assert.equal(isExpired(new Date('2027-05-06T15:00:00Z'), '2027-05-06T23:59:59+09:00'), true);
});
test('jstDate', () => {
  assert.equal(jstDate(new Date('2026-11-24T14:59:00Z')), '2026-11-24');
  assert.equal(jstDate(new Date('2026-11-24T15:00:00Z')), '2026-11-25');
});
test('canSendToday uses JST date', () => {
  assert.equal(canSendToday('2026-11-24', new Date('2026-11-24T14:59:00Z')), false);
  assert.equal(canSendToday('2026-11-24', new Date('2026-11-24T15:00:00Z')), true);
  assert.equal(canSendToday('', new Date()), true);
});
test('formatJstDateLabel', () => {
  assert.equal(formatJstDateLabel('2027-05-06T23:59:59+09:00'), '2027年5月6日');
  assert.equal(formatJstDateLabel('2027-05-06T15:00:00Z'), '2027年5月7日');
  assert.equal(formatJstDateLabel('2027-12-31T14:59:59Z'), '2027年12月31日');
});
test('toPublicProfile has no email and right shape', () => {
  const p = toPublicProfile({ email: 'a@x.jp', profile: { ...valid, photoUrl: 'u' }, staff: 1 });
  assert.equal('email' in p, false);
  assert.equal('id' in p, false);
  assert.equal(p.photoUrl, 'u');
  assert.equal('staff' in p, false);
  assert.equal(p.link, '');
  assert.equal(JSON.stringify(p.fields), JSON.stringify(['IT・Web']));
  const q = toPublicProfile({ email: 'a@x.jp', profile: valid, staff: '' });
  assert.equal(q.photoUrl, '');
  assert.equal('staff' in q, false);
});
