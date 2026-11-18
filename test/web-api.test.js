import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from '../web/js/api.js';
import { API_URL } from '../web/js/config.js';

const res = (body, status = 200) => ({ status, ok: status < 400, json: async () => body });
const seq = (...items) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const it = items[Math.min(calls.length - 1, items.length - 1)];
    if (it instanceof Error) throw it;
    return it;
  };
  return { fetchImpl, calls };
};
const rec = () => { const d = []; return { d, sleep: async (ms) => { d.push(ms); } }; };

test('callApi retries on busy then succeeds', async () => {
  const { fetchImpl, calls } = seq(res({ ok: false, error: 'busy' }), res({ ok: true, x: 1 }));
  const { sleep, d } = rec();
  const r = await callApi('getMe', { token: 't' }, { fetchImpl, sleep, url: 'u' });
  assert.deepEqual(r, { ok: true, x: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(d, [2000]);
});

test('callApi does not retry on invalid_token', async () => {
  const { fetchImpl, calls } = seq(res({ ok: false, error: 'invalid_token' }));
  const { sleep, d } = rec();
  const r = await callApi('getMe', {}, { fetchImpl, sleep, url: 'u' });
  assert.deepEqual(r, { ok: false, error: 'invalid_token' });
  assert.equal(calls.length, 1);
  assert.deepEqual(d, []);
});

test('callApi returns network after retries exhausted with backoff delays', async () => {
  const { fetchImpl, calls } = seq(new Error('down'));
  const { sleep, d } = rec();
  const attempts = [];
  const r = await callApi('getMe', {}, { fetchImpl, sleep, url: 'u', onRetry: (n) => attempts.push(n) });
  assert.deepEqual(r, { ok: false, error: 'network' });
  assert.equal(calls.length, 5);
  assert.deepEqual(d, [2000, 4000, 8000, 16000]);
  assert.deepEqual(attempts, [1, 2, 3, 4]);
});

test('callApi retries on HTTP 5xx and unparsable JSON', async () => {
  const bad = { status: 200, ok: true, json: async () => { throw new Error('x'); } };
  const { fetchImpl, calls } = seq(res({}, 503), bad, res({ ok: true }));
  const { sleep } = rec();
  const r = await callApi('a', {}, { fetchImpl, sleep, url: 'u' });
  assert.deepEqual(r, { ok: true });
  assert.equal(calls.length, 3);
});

test('callApi sends text/plain JSON body with action', async () => {
  const { fetchImpl, calls } = seq(res({ ok: true }));
  await callApi('saveProfile', { token: 'abc', n: 1 }, { fetchImpl, url: 'https://gas.example/x' });
  const { url, init } = calls[0];
  assert.equal(url, 'https://gas.example/x');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(init.redirect, 'follow');
  assert.deepEqual(JSON.parse(init.body), { action: 'saveProfile', token: 'abc', n: 1 });
});

test('callApi defaults to the same-origin Worker API URL', async () => {
  const { fetchImpl, calls } = seq(res({ ok: true }));
  await callApi('getMe', {}, { fetchImpl });
  assert.equal(calls[0].url, '/api');
  assert.equal(API_URL, '/api');
});
