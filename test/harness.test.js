import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-harness.js';

test('loadGas exposes top-level functions', () => {
  const ctx = loadGas();
  assert.equal(typeof ctx.normalizeEmail, 'function');
});

function makeWeb(depsRes = { ok: true, x: 1 }) {
  const out = { text: null, mime: null };
  const ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput: (t) => { out.text = t; return { setMimeType: (m) => { out.mime = m; return out; } }; },
  };
  return { out, ContentService };
}

test('doPost passes parsed JSON to handleRequest and returns JSON output', () => {
  const { out, ContentService } = makeWeb();
  const ctx = loadGas({ ContentService });
  let seen = null;
  ctx.buildDeps = () => ({ marker: true });
  ctx.handleRequest = (req, deps) => { seen = { req, deps }; return { ok: true, echo: req.action }; };
  ctx.doPost({ postData: { contents: JSON.stringify({ action: 'getList', token: 't' }) } });
  assert.equal(seen.req.action, 'getList');
  assert.equal(seen.deps.marker, true);
  assert.deepEqual(JSON.parse(out.text), { ok: true, echo: 'getList' });
  assert.equal(out.mime, 'JSON');
});

test('doPost: malformed JSON or missing body -> server_error', () => {
  const { out, ContentService } = makeWeb();
  const ctx = loadGas({ ContentService, console: { error() {} } });
  ctx.doPost({ postData: { contents: '{not json' } });
  assert.deepEqual(JSON.parse(out.text), { ok: false, error: 'server_error' });
  ctx.doPost({});
  assert.deepEqual(JSON.parse(out.text), { ok: false, error: 'server_error' });
});

test('doGet returns {ok:true}', () => {
  const { out, ContentService } = makeWeb();
  const ctx = loadGas({ ContentService });
  ctx.doGet();
  assert.deepEqual(JSON.parse(out.text), { ok: true });
});
