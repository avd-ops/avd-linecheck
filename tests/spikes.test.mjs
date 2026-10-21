// The spike pages keep the same promises as the real page: a strict CSP, no inline code, the notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'spikes');
const walk = (d) => readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]);
const pages = walk(root).filter((p) => p.endsWith('.html'));
const scripts = walk(root).filter((p) => p.endsWith('.js'));

test('every spike page has a strict CSP, the notice, and no inline script or style', () => {
  assert.ok(pages.length >= 4);
  for (const p of pages) {
    const html = readFileSync(p, 'utf8');
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
    assert.ok(csp, `${p} has no CSP`);
    assert.match(csp[1], /^default-src 'none';/, `${p} CSP must start from default-src 'none'`);
    assert.doesNotMatch(csp[1], /unsafe-inline|unsafe-eval|\*/, `${p} CSP is too loose`);
    assert.match(html, /not affiliated with the author's employer, Liquidware or Microsoft/i, `${p} lacks the notice`);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, `${p} has an inline script`);
    assert.doesNotMatch(html, /<style|\sstyle="/, `${p} has inline style`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${p} has an inline event handler`);
  }
});

// Literal hosts only: a redirect target or a URL built at run time is not caught here; the CSP itself blocks those in the browser.
test('spike scripts reach only hosts their page lists in connect-src', () => {
  for (const s of scripts.filter((f) => !f.endsWith('common.js'))) {
    const page = readFileSync(join(dirname(s), 'index.html'), 'utf8');
    const connect = (page.match(/connect-src ([^;"]+)/) || [, ''])[1];
    for (const [url] of readFileSync(s, 'utf8').matchAll(/https:\/\/[a-z0-9.-]+/g)) {
      assert.ok(connect.split(/\s+/).includes(url), `${s} calls ${url}, not in its page's connect-src`);
    }
  }
});
