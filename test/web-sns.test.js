import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnsId, validateSns, parseSns, snsEntries, snsUrl } from '../web/js/sns.js';

const ok = (key, raw) => normalizeSnsId(key, raw);

test('plain id, @id and full-width @ give the same id', () => {
  assert.deepEqual(ok('instagram', 'tomoki_d_'), { ok: true, value: 'tomoki_d_' });
  assert.deepEqual(ok('instagram', '@tomoki_d_'), { ok: true, value: 'tomoki_d_' });
  assert.deepEqual(ok('instagram', ' ＠tomoki_d_ '), { ok: true, value: 'tomoki_d_' });
});

test('pasted profile URLs are reduced to the id', () => {
  assert.equal(ok('instagram', 'https://www.instagram.com/tomoki_d_?avpt=abc&utm_source=qr').value, 'tomoki_d_');
  assert.equal(ok('instagram', 'instagram.com/tomoki_d_/').value, 'tomoki_d_');
  assert.equal(ok('x', 'https://twitter.com/abc_1').value, 'abc_1');
  assert.equal(ok('x', 'https://x.com/abc_1/status/123').value, 'abc_1');
  assert.equal(ok('threads', 'https://www.threads.net/@a.b_c').value, 'a.b_c');
  assert.equal(ok('facebook', 'https://m.facebook.com/hanako.yamada').value, 'hanako.yamada');
  assert.equal(ok('facebook', 'https://www.facebook.com/profile.php?id=1000123').value, 'profile.php?id=1000123');
});

test('empty and missing values are allowed', () => {
  assert.deepEqual(ok('x', ''), { ok: true, value: '' });
  assert.deepEqual(ok('x', '   '), { ok: true, value: '' });
  assert.deepEqual(ok('x', undefined), { ok: true, value: '' });
});

test('bad ids and other sites are rejected', () => {
  assert.equal(ok('x', 'way_too_long_handle_123').ok, false);
  assert.equal(ok('x', 'has space').ok, false);
  assert.equal(ok('instagram', 'https://example.com/tomoki').ok, false);
  assert.equal(ok('instagram', 'https://evilinstagram.com/x').ok, false);
  assert.equal(ok('instagram', '<script>').ok, false);
  assert.equal(ok('facebook', 'javascript:alert(1)').ok, false);
  assert.equal(ok('x', 123).ok, false);
});

test('validateSns keeps only filled keys and reports errors per key', () => {
  assert.deepEqual(validateSns({ instagram: '@a', x: '', threads: undefined, other: 'zzz' }), { ok: true, value: { instagram: 'a' } });
  const r = validateSns({ x: 'bad id' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.x);
  assert.deepEqual(validateSns(null), { ok: true, value: {} });
});

test('parseSns tolerates broken stored JSON', () => {
  assert.deepEqual(parseSns('{"x":"abc"}'), { x: 'abc' });
  assert.deepEqual(parseSns('not json'), {});
  assert.deepEqual(parseSns('{"x":"bad id"}'), {});
  assert.deepEqual(parseSns(''), {});
});

test('urls and display order', () => {
  assert.equal(snsUrl('instagram', 'a'), 'https://www.instagram.com/a/');
  assert.equal(snsUrl('x', 'a'), 'https://x.com/a');
  assert.equal(snsUrl('threads', 'a'), 'https://www.threads.com/@a');
  assert.equal(snsUrl('facebook', 'a.b'), 'https://www.facebook.com/a.b');
  assert.deepEqual(snsEntries({ facebook: 'f', instagram: 'i' }).map((e) => e.key), ['instagram', 'facebook']);
});
