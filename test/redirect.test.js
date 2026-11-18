import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const name of ['index.html', 'me.html', 'list.html']) {
  test(`redirect/${name} redirects and keeps the hash`, () => {
    const html = readFileSync(new URL(`../redirect/${name}`, import.meta.url), 'utf8');
    assert.match(html, /location\.replace\(/);
    assert.match(html, /location\.hash/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /NEW_ORIGIN = 'https:\/\/kouryukai-profile\.kouryukai-profile-worker\.workers\.dev'/);
    assert.match(html, /\/\^\\\/kouryukai-profile\//);
    assert.match(html, /<a id="go" href=/);
  });
}

test('pages workflow publishes the redirect folder', () => {
  const y = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(y, /path: redirect\s*$/m);
});

for (const name of ['index.html', 'me.html', 'list.html']) {
  test(`redirect/${name} only redirects when NEW_ORIGIN is an https URL`, () => {
    const html = readFileSync(new URL(`../redirect/${name}`, import.meta.url), 'utf8');
    assert.match(html, /NEW_ORIGIN\.indexOf\('https:\/\/'\) === 0/);
    assert.match(html, /準備中/);
    const run = (origin) => {
      const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/NEW_ORIGIN = '[^']*'/, 'NEW_ORIGIN = ' + JSON.stringify(origin));
      const calls = [];
      const link = { href: '#', style: {} };
      const msg = { style: { display: 'none' } };
      const els = { go: link, wait: msg };
      const fakeDoc = { addEventListener: (_, f) => f(), getElementById: (id) => els[id] };
      const loc = { pathname: '/kouryukai-profile/me.html', hash: '#t=abc', replace: (u) => calls.push(u) };
      new Function('location', 'document', script)(loc, fakeDoc);
      return { calls, link, msg };
    };
    const bad = run('REPLACE_AT_SETUP');
    assert.deepEqual(bad.calls, []);
    assert.equal(bad.link.href, '#');
    assert.notEqual(bad.msg.style.display, 'none');
    const good = run('https://k.example.workers.dev');
    assert.deepEqual(good.calls, ['https://k.example.workers.dev/me.html#t=abc']);
    assert.equal(good.link.href, 'https://k.example.workers.dev/me.html#t=abc');
  });
}
