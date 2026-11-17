import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialOf } from '../web/js/text.js';

test('initialOf returns the first character', () => {
  assert.equal(initialOf('山田太郎'), '山');
  assert.equal(initialOf('Alice'), 'A');
});
test('initialOf does not split surrogate pairs', () => {
  assert.equal(initialOf('😀笑'), '😀');
});
test('initialOf handles empty or missing names', () => {
  assert.equal(initialOf(''), '?');
  assert.equal(initialOf(undefined), '?');
  assert.equal(initialOf('  花'), '花');
});
