import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const name of ['index.html', 'me.html', 'list.html']) {
  test(`redirect/${name} redirects and keeps the hash`, () => {
    const html = readFileSync(new URL(`../redirect/${name}`, import.meta.url), 'utf8');
    assert.match(html, /location\.replace\(/);
    assert.match(html, /location\.hash/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /NEW_ORIGIN = 'REPLACE_AT_SETUP'/);
    assert.match(html, /\/\^\\\/kouryukai-profile\//);
    assert.match(html, /<a id="go" href=/);
  });
}

test('pages workflow publishes the redirect folder', () => {
  const y = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(y, /path: redirect\s*$/m);
});
