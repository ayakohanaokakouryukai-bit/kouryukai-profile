import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterParticipants } from '../web/js/search.js';
import { FIELD_OPTIONS, LIMITS } from '../web/js/fields.js';
import { fitWithin } from '../web/js/photo.js';
import { loadGas } from './gas-harness.js';

const P = (o) => ({ name: '', job: '', challenge: '', strengths: '', needs: '', fields: [], ...o });
const list = [
  P({ name: '山田', job: 'Webデザイナー', strengths: '集客', fields: ['IT・Web', 'デザイン・クリエイティブ'] }),
  P({ name: '佐藤', job: '料理人', needs: 'デザイン', fields: ['飲食'] }),
  P({ name: '鈴木', challenge: '集客 と デザイン', fields: ['飲食', 'その他'] }),
];

test('search: AND of space-separated terms across all text fields', () => {
  assert.deepEqual(filterParticipants(list, '集客 デザイン', []).map((p) => p.name), ['山田', '鈴木']);
  assert.deepEqual(filterParticipants(list, '集客　デザイン', []).map((p) => p.name), ['山田', '鈴木']);
  assert.deepEqual(filterParticipants(list, 'デザイン 料理', []).map((p) => p.name), ['佐藤']);
});

test('search: full-width/half-width and case insensitive (NFKC)', () => {
  assert.deepEqual(filterParticipants(list, 'ＷＥＢ', []).map((p) => p.name), ['山田']);
  assert.deepEqual(filterParticipants(list, 'web', []).map((p) => p.name), ['山田']);
});

test('search: fields filter is OR, combined with query by AND', () => {
  assert.deepEqual(filterParticipants(list, '', ['飲食', 'IT・Web']).map((p) => p.name), ['山田', '佐藤', '鈴木']);
  assert.deepEqual(filterParticipants(list, 'デザイン', ['飲食']).map((p) => p.name), ['佐藤', '鈴木']);
});

test('search: empty query and no fields returns all (new array, no mutation)', () => {
  const copy = JSON.stringify(list);
  const r = filterParticipants(list, '  ', []);
  assert.deepEqual(r, list);
  assert.notEqual(r, list);
  assert.equal(JSON.stringify(list), copy);
});

test('fields: FIELD_OPTIONS exact order and matches GAS', () => {
  const expected = ['IT・Web', 'デザイン・クリエイティブ', '美容・健康', '飲食', '教育・コーチング',
    '士業・金融', 'コミュニティ運営', '会社員', '学生', 'その他'];
  assert.deepEqual(FIELD_OPTIONS, expected);
  const gas = loadGas();
  assert.equal(JSON.stringify(FIELD_OPTIONS), JSON.stringify(Array.from(gas.FIELD_OPTIONS)));
  assert.deepEqual(LIMITS, { ...JSON.parse(JSON.stringify(gas.REQUIRED_TEXT_LIMITS)), link: gas.LINK_MAX });
});

test('photo: fitWithin scales long edge, rounds, never upscales', () => {
  assert.deepEqual(fitWithin(800, 600, 400), { width: 400, height: 300 });
  assert.deepEqual(fitWithin(600, 800, 400), { width: 300, height: 400 });
  assert.deepEqual(fitWithin(300, 200, 400), { width: 300, height: 200 });
  assert.deepEqual(fitWithin(1000, 333, 400), { width: 400, height: 133 });
});
