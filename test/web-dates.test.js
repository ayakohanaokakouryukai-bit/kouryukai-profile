import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatJstDateLabel } from '../web/js/dates.js';

test('JST offset input', () => {
  assert.equal(formatJstDateLabel('2027-05-06T23:59:59+09:00'), '2027年5月6日');
});
test('UTC input crossing into next JST day', () => {
  assert.equal(formatJstDateLabel('2027-05-06T15:00:00Z'), '2027年5月7日');
});
test('no zero padding', () => {
  assert.equal(formatJstDateLabel('2027-02-06T00:00:00+09:00'), '2027年2月6日');
});
test('invalid input returns empty string', () => {
  assert.equal(formatJstDateLabel('nope'), '');
  assert.equal(formatJstDateLabel(undefined), '');
});
