import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, formatSummary } from '../tools/loadtest.mjs';

test('summarize computes nearest-rank percentiles', () => {
  const d = Array.from({ length: 100 }, (_, i) => (i + 1) * 10); // 10..1000
  const s = summarize(d, 100);
  assert.deepEqual(s, { ok: 100, failed: 0, p50: 500, p95: 950, max: 1000 });
});
test('summarize counts failures and handles unsorted input', () => {
  const s = summarize([300, 100, 200], 1);
  assert.equal(s.ok, 1);
  assert.equal(s.failed, 2);
  assert.equal(s.max, 300);
  assert.equal(s.p50, 200);
});
test('summarize handles empty input', () => {
  assert.deepEqual(summarize([], 0), { ok: 0, failed: 0, p50: 0, p95: 0, max: 0 });
});
test('formatSummary prints integers in the agreed format', () => {
  assert.equal(formatSummary({ ok: 2, failed: 1, p50: 10.4, p95: 20.6, max: 30 }), 'ok=2 failed=1 p50=10 p95=21 max=30');
});
