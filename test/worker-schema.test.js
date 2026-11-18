import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeD1 } from './fake-d1.js';

const files = ['worker/migrations/0001_init.sql'];

test('migration creates the four tables', async () => {
  const db = makeFakeD1(files);
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  assert.deepEqual(results.map((r) => r.name), ['applicants', 'photos', 'profiles', 'tokens']);
});

test('duplicate tokens.token throws', async () => {
  const db = makeFakeD1(files);
  const ins = 'INSERT INTO tokens (email, token, issued_at) VALUES (?, ?, ?)';
  await db.prepare(ins).bind('a@x.jp', 'a'.repeat(32), 't').run();
  await assert.rejects(db.prepare(ins).bind('b@x.jp', 'a'.repeat(32), 't').run());
});

test('BLOB round-trips with the same bytes', async () => {
  const db = makeFakeD1(files);
  await db.prepare('INSERT INTO photos (id, data, created_at) VALUES (?, ?, ?)')
    .bind('p1', new Uint8Array([0xff, 0xd8]), 't').run();
  const row = await db.prepare('SELECT data FROM photos WHERE id = ?').bind('p1').first();
  assert.deepEqual([...new Uint8Array(row.data)], [0xff, 0xd8]);
});

test('batch runs in a transaction and rolls back on failure', async () => {
  const db = makeFakeD1(files);
  const ins = 'INSERT INTO applicants (email, canceled) VALUES (?, ?)';
  await assert.rejects(db.batch([
    db.prepare(ins).bind('a@x.jp', 0),
    db.prepare(ins).bind('a@x.jp', 0),
  ]));
  const { results } = await db.prepare('SELECT * FROM applicants').all();
  assert.equal(results.length, 0);
});
