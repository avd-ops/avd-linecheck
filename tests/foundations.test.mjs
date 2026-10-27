// Repo foundations: the notice, the license, links that resolve, and no private values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function files(dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === 'output') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out); else out.push(p);
  }
  return out;
}
// Every file is scanned except known binary types, so a new extension can't slip past the leak checks.
const binary = ['.bin', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.mp4', '.webm', '.woff', '.woff2', '.zip'];
const textFiles = files().filter((p) => !binary.includes(extname(p).toLowerCase()));

// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens.
const anchors = (md) => new Set([...md.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,6}\s+(.+)$/gm)]
  .map(([, h]) => h.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-')));

test('README keeps the research-only warning', () => {
  const readme = read('README.md');
  assert.match(readme, /Personal project\. Research and learning only\. Not for production\. No warranty\./);
  assert.match(readme, /not affiliated with, endorsed by or supported by my employer/);
  assert.match(readme, /Contributions and forks are welcome and encouraged/);
  assert.match(readme, /\[MIT License\]\(LICENSE\)/);
});

test('LICENSE is MIT', () => {
  assert.match(read('LICENSE'), /^MIT License/);
});

test('every relative Markdown link resolves', () => {
  for (const p of textFiles.filter((f) => f.endsWith('.md'))) {
    const body = readFileSync(p, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const [, target] of body.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [file, frag] = target.split('#');
      const dest = file ? resolve(dirname(p), decodeURIComponent(file)) : p;
      assert.ok(existsSync(dest), `${p.slice(root.length + 1)} links to missing ${target}`);
      if (frag && dest.endsWith('.md')) {
        assert.ok(anchors(readFileSync(dest, 'utf8')).has(frag), `${p.slice(root.length + 1)} links to missing anchor ${target}`);
      }
    }
  }
});

test('no GUIDs or email addresses', () => {
  const guid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  const email = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
  // Well-known Microsoft public app and built-in role IDs in the vendored portal engine's redact.js.
  const publicIds = new Set([
    '00000000-0000-0000-0000-000000000000',
    '00000003-0000-0000-c000-000000000000',
    '9cdead84-a844-4324-93f2-b2e6bb768d07',
    'acdd72a7-3385-48ef-bd42-f606fba81ae7'
  ]);
  for (const p of textFiles) {
    const body = readFileSync(p, 'utf8');
    const rel = p.slice(root.length + 1).replace(/\\/g, '/');
    for (const [hit] of body.matchAll(guid)) {
      if ((rel === 'site/assets/engine/redact.js' || rel === 'tests/foundations.test.mjs') && publicIds.has(hit.toLowerCase())) continue;
      assert.fail(`${rel} holds a GUID (${hit})`);
    }
    assert.doesNotMatch(body, email, `${rel} holds an email address`);
  }
});

test('no HCL and no names outside the lane', () => {
  for (const p of files()) assert.ok(!/\.(tf|tfvars|hcl|pkr\.hcl)$/.test(p), `HCL file ${p.slice(root.length + 1)}`);
  for (const p of textFiles.filter((f) => !/(foundations\.test\.mjs|CLAUDE\.md)$/.test(f))) {
    assert.doesNotMatch(readFileSync(p, 'utf8'), /\bnerdio\b/i, `${p.slice(root.length + 1)} names Nerdio`);
  }
});
