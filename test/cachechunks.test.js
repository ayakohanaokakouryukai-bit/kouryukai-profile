import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-harness.js';

const ctx = loadGas();
const { splitForCache, joinFromCache, CACHE_CHUNK_CHARS } = ctx;

test('CACHE_CHUNK_CHARS is 30000', () => {
  assert.equal(CACHE_CHUNK_CHARS, 30000);
});

test('split/join roundtrip', () => {
  const s = 'あ'.repeat(70001);
  const parts = splitForCache(s, CACHE_CHUNK_CHARS);
  assert.equal(parts.length, 3);
  assert.equal(joinFromCache(parts), s);
});

test('splitForCache of empty string returns one empty part and joins back to empty', () => {
  const parts = splitForCache('', 10);
  assert.equal(JSON.stringify(parts), JSON.stringify(['']));
  assert.equal(joinFromCache(parts), '');
});

test('splitForCache throws if size is not a positive integer', () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, '10', undefined]) {
    assert.throws(() => splitForCache('abc', bad), /size|positive|integer/i, `size=${String(bad)}`);
  }
});

const isHigh = (c) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;

function assertNoLoneSurrogates(parts) {
  for (const p of parts) {
    if (p.length === 0) continue;
    assert.ok(!isLow(p.charCodeAt(0)), 'part starts with a lone low surrogate');
    assert.ok(!isHigh(p.charCodeAt(p.length - 1)), 'part ends with a lone high surrogate');
  }
}

test('emoji straddling the boundary is not split across parts', () => {
  // 😀 is U+1F600 = two UTF-16 units; the pair occupies indexes 29999 and 30000.
  const s = 'a'.repeat(29999) + '😀' + 'b'.repeat(10);
  const parts = splitForCache(s, 30000);
  assertNoLoneSurrogates(parts);
  assert.equal(joinFromCache(parts), s);
  assert.ok(parts.some((p) => p.startsWith('😀')), 'emoji kept whole in one part');
});

test('size 1 keeps a surrogate pair together in one part', () => {
  const parts = splitForCache('😀a', 1);
  assertNoLoneSurrogates(parts);
  assert.equal(joinFromCache(parts), '😀a');
  assert.equal(parts[0], '😀');
});

test('exact multiple of size gives exactly 2 parts with no trailing empty part', () => {
  const parts = splitForCache('あ'.repeat(60000), 30000);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.length === 30000));
});
