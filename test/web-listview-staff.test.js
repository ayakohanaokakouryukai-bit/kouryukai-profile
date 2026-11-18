import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// listView.js touches `document`, so it is checked as source text rather than imported.
const src = readFileSync(fileURLToPath(new URL('../web/js/listView.js', import.meta.url)), 'utf8');

test('listView.js has no staff badge (no `staff` field, no スタッフ label)', () => {
  assert.equal(src.includes('staff'), false);
  assert.equal(src.includes('スタッフ'), false);
});
