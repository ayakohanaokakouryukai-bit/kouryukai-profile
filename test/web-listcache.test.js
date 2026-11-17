import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadList, saveList, clearList } from '../web/js/listCache.js';
import { readToken, clearToken } from '../web/js/token.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const thrower = () => ({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } });
const T = 'a'.repeat(31) + 'f';
const T2 = '0123456789abcdef0123456789abcdef';

test('listCache: round trip, missing and corrupt', () => {
  const s = mem();
  assert.equal(loadList(s), null);
  saveList(s, { participants: [1], generatedAt: 'x' });
  assert.deepEqual(loadList(s), { participants: [1], generatedAt: 'x' });
  s.setItem('kp_list', '{bad');
  assert.equal(loadList(s), null);
});

test('listCache: storage throwing does not break', () => {
  assert.equal(loadList(thrower()), null);
  assert.doesNotThrow(() => saveList(thrower(), { participants: [] }));
});

test('token: #t= is saved and returned; without hash returns saved', () => {
  const s = mem();
  assert.equal(readToken({ hash: '#t=' + T }, s), T);
  assert.equal(s.getItem('kp_token'), T);
  assert.equal(readToken({ hash: '' }, s), T);
  assert.equal(readToken({ hash: '#x=1&t=' + T2 }, s), T2);
  assert.equal(s.getItem('kp_token'), T2);
});

test('token: invalid hash ignored, saved one returned', () => {
  const s = mem();
  s.setItem('kp_token', T);
  assert.equal(readToken({ hash: '#t=ABC' }, s), T);
  assert.equal(readToken({ hash: '#t=' + T.toUpperCase() }, s), T);
  assert.equal(s.getItem('kp_token'), T);
  const e = mem();
  assert.equal(readToken({ hash: '#t=zzz' }, e), null);
  e.setItem('kp_token', 'bad');
  assert.equal(readToken({ hash: '' }, e), null);
});

test('token: storage throwing still returns hash token', () => {
  assert.equal(readToken({ hash: '#t=' + T }, thrower()), T);
  assert.equal(readToken({ hash: '' }, thrower()), null);
});

test('token: clearToken', () => {
  const s = mem();
  s.setItem('kp_token', T);
  clearToken(s);
  assert.equal(s.getItem('kp_token'), null);
  assert.doesNotThrow(() => clearToken(thrower()));
});

test('listCache: clearList removes the saved list and tolerates throwing storage', () => {
  const s = mem();
  saveList(s, { participants: [1], generatedAt: 'x' });
  clearList(s);
  assert.equal(loadList(s), null);
  assert.doesNotThrow(() => clearList(thrower()));
});
