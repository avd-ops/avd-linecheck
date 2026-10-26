import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const site = join(root, 'site');
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

test('the shipped page keeps a strict CSP, the notice, and no inline code', () => {
  const html = readFileSync(join(site, 'index.html'), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(policy);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
  assert.match(policy[1], /^default-src 'none';/);
  assert.doesNotMatch(policy[1], /unsafe-inline|unsafe-eval|\*/);
  assert.match(html, /Personal project\. Research and learning only\. Not for production\. No warranty\./);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/);
  assert.doesNotMatch(html, /<style|\sstyle="|\son[a-z]+\s*=/i);
});

test('vendored design assets match the locked release manifest', () => {
  const lock = JSON.parse(readFileSync(join(site, 'assets', 'design-system.lock.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(site, 'assets', 'MANIFEST.json'), 'utf8'));
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.tag, `ds-v${manifest.version}`);
  const actual = walk(join(site, 'assets')).map((path) => path.slice(join(site, 'assets').length + 1).replaceAll('\\', '/'))
    .filter((path) => path !== 'MANIFEST.json' && path !== 'design-system.lock.json').sort();
  assert.deepEqual(actual, Object.keys(manifest.files).sort());
  for (const [path, expected] of Object.entries(manifest.files)) {
    const actual = createHash('sha256').update(readFileSync(join(site, 'assets', path))).digest('hex');
    assert.equal(actual, expected, `${path} differs from the pinned design system`);
  }
});

test('download blob is exactly sized and named by its SHA-256', () => {
  const files = readdirSync(join(site, 'blobs'));
  assert.equal(files.length, 1);
  const bytes = readFileSync(join(site, 'blobs', files[0]));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.length, 8388608);
  assert.equal(files[0], `8m-${digest}.bin`);
  for (const packName of ['generic.json', 'avd.json']) {
    const pack = JSON.parse(readFileSync(join(site, 'packs', packName), 'utf8'));
    assert.equal(pack.download.path, `blobs/${files[0]}`);
    assert.equal(pack.download.bytes, bytes.length);
  }
});

test('pack schema defines the generic and AVD contracts', () => {
  const schema = JSON.parse(readFileSync(join(site, 'packs', 'schema.json'), 'utf8'));
  const generic = JSON.parse(readFileSync(join(site, 'packs', 'generic.json'), 'utf8'));
  const avd = JSON.parse(readFileSync(join(site, 'packs', 'avd.json'), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.$id, 'urn:avd-ops:avd-linecheck:pack:v1');
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('hosts'));
  assert.equal(schema.allOf[0].then.properties.endpointIds.maxItems, 0);
  assert.equal(schema.allOf[0].then.properties.thresholds.maxItems, 0);
  assert.ok(schema.allOf[1].then.required.includes('endpointSource'));
  for (const pack of [generic, avd]) {
    for (const field of schema.required) assert.ok(Object.hasOwn(pack, field), `${pack.id} has ${field}`);
    assert.equal(pack.download.bytes, 8388608);
  }
});

test('site pages and scripts use no third-party runtime code or font host', () => {
  const files = walk(site).filter((path) => /\.(html|mjs|js|css)$/.test(path));
  const text = files.map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(text, /https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.)/i);
  assert.doesNotMatch(text, /<script[^>]+src="https?:/i);
  assert.doesNotMatch(text, /@import\s+url\(['"]?https?:/i);
});

test('text-first guides have checked sources and no unreviewed media', () => {
  const manifest = JSON.parse(readFileSync(join(site, 'steps', 'steps.json'), 'utf8'));
  const ids = manifest.steps.map((step) => step.id);
  assert.ok(ids.includes('windows.capture'));
  assert.ok(ids.includes('macos.capture'));
  assert.ok(ids.includes('avd.connection-info'));
  assert.equal(new Set(ids).size, ids.length);
  for (const step of manifest.steps) {
    assert.ok(step.actions.length > 0, `${step.id} has actions`);
    assert.equal(step.assets.length, 0, `${step.id} stays text-only until approved captures exist`);
    assert.match(step.source.checkedAt, /^2026-10-\d{2}$/);
    assert.match(step.source.url, /^https:\/\/(learn\.microsoft\.com|support\.microsoft\.com|support\.apple\.com)\//);
  }
  const html = readFileSync(join(site, 'steps', 'index.html'), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(policy);
  assert.match(policy[1], /connect-src 'self'/);
  assert.doesNotMatch(policy[1], /https:\/\//);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>|<style|\sstyle="|\son[a-z]+\s*=/i);
});
