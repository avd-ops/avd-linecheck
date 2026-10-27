/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const stepsApi = createRequire(import.meta.url)('../site/steps/steps.js');

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const site = join(root, 'site');
const read = (f) => readFileSync(join(root, f), 'utf8');
const pages = ['site/index.html', 'site/steps/index.html'];
const scripts = ['site/engine.js', 'site/verdict.js', 'site/export.js', 'site/app.js', 'site/steps/steps.js'];

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

test('the shipped page keeps a strict CSP, the notice before the step list, and no inline code', () => {
  const html = read('site/index.html');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(policy);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
  assert.match(policy[1], /^default-src 'none';/);
  assert.match(policy[1], /img-src 'self' data: blob:;/);
  assert.match(policy[1], /media-src blob:;/);
  assert.match(policy[1], /webrtc 'block'/);
  assert.doesNotMatch(policy[1], /unsafe-inline|unsafe-eval|\*/);
  const top = html.split('<ol class="wz-list"')[0];
  assert.match(top, /Personal project\. Research and learning only\. Not for production\. No warranty\./);
  assert.match(top, /without warranty of any kind/);
  assert.match(top, /Not affiliated with, endorsed by or supported by the author's employer/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/);
  assert.doesNotMatch(html, /<style|\sstyle="|\son[a-z]+\s*=/i);
  for (const f of scripts) {
    assert.match(read(f).split('\n')[0], /Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft\./, f);
  }
});

test('the avd-ops design system is vendored at one version and linecheck.css uses only design-system tokens', () => {
  const v = (f, re) => (read(f).match(re) || [])[1];
  const base = v('site/assets/avd-ops.css', /^\/\* avd-ops design system (v\d+\.\d+\.\d+) /);
  assert.ok(base, 'version line');
  assert.equal(v('site/assets/avd-ops-portal.css', /^\/\* avd-ops portal components (v\d+\.\d+\.\d+) /), base);
  for (const [, src] of read('site/assets/avd-ops.css').matchAll(/url\("([^"]+)"\)/g)) {
    assert.ok(existsSync(join(root, 'site/assets', src)), src);
  }
  const html = read('site/index.html');
  assert.match(html, /<body class="portal shell">/);
  for (const [f, re] of [
    ['site/assets/avd-ops-shell.css', /^\/\* avd-ops app shell (v\d+\.\d+\.\d+) /],
    ['site/assets/theme.js', /^\/\* avd-ops theme and drawer (v\d+\.\d+\.\d+) /]
  ]) {
    assert.equal(v(f, re), base, f);
  }
  const css = read('site/linecheck.css');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b|:root|@font-face/, 'colors and fonts come from avd-ops.css');
  const defined = new Set([...read('site/assets/avd-ops.css').matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
  for (const [, t] of css.matchAll(/var\((--[\w-]+)/g)) {
    assert.ok(defined.has(t), `${t} is not an avd-ops token`);
  }
});

test('the portal opens in the avd-ops shell bar, with the credit line', () => {
  const html = read('site/index.html');
  const bar = (html.match(/<header class="bar">([\s\S]*?)<\/header>/) || [])[1] || '';
  assert.match(bar, /<a class="brand" href="https:\/\/avd-ops\.dev\/"><img class="mark" src="assets\/brand\/mark\.svg" alt="" width="44" height="44"><span class="name"><span class="word">avd-ops<\/span><span class="tag">Deploy quietly<\/span><\/span><\/a>/);
  const notice = (bar.match(/<details class="notice" id="disclaimer">([\s\S]*?)<\/details>/) || [])[1] || '';
  assert.match(notice, /<strong class="short">Not for production<\/strong>/);
  assert.match(notice, /<strong>Personal project, not for production\.<\/strong> Provided "as is," without warranty of any kind/);
  assert.match(notice, /MIT License/);
  assert.match(notice, /Not affiliated with, endorsed by or supported by the author's employer/);
  assert.match(notice, /Not a certification, a compliance attestation or a security audit\./);
  assert.match(bar, /<a href="https:\/\/deploy\.avd-ops\.dev\/portal\/">Deploy<\/a><a href="https:\/\/assess\.avd-ops\.dev\/portal\/">Assess<\/a><a href="\.\/" aria-current="page">Linecheck<\/a>/);
  assert.match(bar, /class="iconbtn theme"/);
  assert.doesNotMatch(html, /class="iconbtn menu"|class="side"/, 'no side list in a portal');
  assert.match(html, /<p class="credit">A <a href="https:\/\/prignano\.ai\/">prignano\.ai<\/a> production<\/p>/);
});

test('vendored design assets match design-system.lock.json and MANIFEST.json', () => {
  const lock = JSON.parse(read('site/assets/design-system.lock.json'));
  const manifest = JSON.parse(read('site/assets/MANIFEST.json'));
  assert.match(lock.tag, /^ds-v\d+\.\d+\.\d+$/);
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.tag, `ds-v${manifest.version}`);
  assert.ok(read('site/assets/avd-ops.css').startsWith(`/* avd-ops design system ${lock.tag.slice(3)} `));
  const actual = walk(join(site, 'assets'))
    .map((path) => path.slice(join(site, 'assets').length + 1).replaceAll('\\', '/'))
    .filter((path) => path !== 'MANIFEST.json' && path !== 'design-system.lock.json' && path !== 'engine.lock.json' && !path.startsWith('engine/'))
    .sort();
  assert.deepEqual(actual, Object.keys(manifest.files).sort());
  for (const [path, expected] of Object.entries(manifest.files)) {
    const sha = createHash('sha256').update(readFileSync(join(site, 'assets', path))).digest('hex');
    assert.equal(sha, expected, `${path} differs from the pinned design system`);
  }
});

test('the portal engine copy matches engine.lock.json, needs nothing unlisted, and the page loads it first', () => {
  const lock = JSON.parse(read('site/assets/engine.lock.json'));
  assert.match(lock.tag, /^pe-v\d+\.\d+\.\d+$/);
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  const present = readdirSync(join(root, 'site/assets/engine')).filter((f) => f !== 'package.json').sort();
  assert.deepEqual(present, Object.keys(lock.files).sort(), 'every engine file is listed and every listed file is present');
  assert.deepEqual(present, ['bands.js', 'core.js', 'probe.js', 'redact.js']);
  const needs = [];
  for (const [f, sha] of Object.entries(lock.files)) {
    const text = readFileSync(join(root, 'site/assets/engine', f));
    assert.equal(createHash('sha256').update(text).digest('hex'), sha, f);
    assert.ok(text.toString().startsWith(`/* avd-ops portal engine ${lock.tag.slice(3)}: ${f}. `), `${f} is ${lock.tag}`);
    for (const [, need] of text.toString().matchAll(/require\('\.\/([\w-]+\.js)'\)/g)) {
      assert.ok(lock.files[need], `${f} needs ${need}`);
      needs.push([f, need]);
    }
  }
  const html = read('site/index.html');
  const at = (src) => html.indexOf(`<script src="${src}"></script>`);
  assert.ok(at('assets/engine/core.js') >= 0, 'core.js is loaded');
  for (const [f, need] of needs) {
    assert.ok(at(`assets/engine/${need}`) >= 0 && at(`assets/engine/${need}`) < at(`assets/engine/${f}`), `${need} loads before ${f}`);
  }
  for (const f of Object.keys(lock.files)) {
    assert.ok(at(`assets/engine/${f}`) >= at('assets/engine/core.js') && at(`assets/engine/${f}`) < at('engine.js'), `${f} loads after core.js and before engine.js`);
  }
});

test('the portal is a wizard: every step has its screen, a title, one purpose line, and sheets', () => {
  const html = read('site/index.html');
  const js = read('site/app.js');
  assert.match(html, /<main class="wz-layout" id="main">\s*<header class="top wz-rail">/);
  assert.match(html, /<ol class="wz-list" id="steps"[^>]*><\/ol>\s*<ol class="wz-progress" id="steps-bar"[^>]*><\/ol>/);
  assert.match(html, /<nav class="wz-nav wide"[^>]*><div class="in">[\s\S]*?id="back"[\s\S]*?id="where"[\s\S]*?id="next"/);
  const steps = [...js.match(/const STEPS = \[([\s\S]*?)\];/)[1].matchAll(/id: '(\w+)', stage: '(\w+)'/g)];
  assert.deepEqual(steps.map((m) => m[1]), ['check', 'results', 'context', 'share']);
  for (const [, id] of steps) {
    const sec = (html.match(new RegExp(`<section class="wz-stage[^"]*" id="stage-${id}" data-step="${id}"[^>]*>([\\s\\S]*?)</section>`)) || [])[1];
    assert.ok(sec, `${id} has a screen`);
    assert.match(sec, new RegExp(`^\\s*<h2 id="${id}-title">[^<]+</h2>\\s*<p class="purpose">`), `${id} opens with its title and purpose line`);
    const purpose = sec.match(/<p class="purpose">([^<]+)<\/p>/)[1];
    assert.ok(purpose.length <= 100, `${id}: the purpose line is one short line`);
  }
  assert.equal([...html.matchAll(/<section class="wz-stage/g)].length, steps.length, 'one screen per step');
  for (const s of ['settings-panel', 'report-panel']) {
    assert.match(html, new RegExp(`<section class="sheet hidden" id="${s}" role="dialog" aria-modal="true"`), s);
  }
});

test('American English, ASCII only, local assets, and safe DOM APIs in the pages and scripts', () => {
  for (const f of pages) {
    for (const [, url] of read(f).matchAll(/<(?:script|link|img)[^>]+(?:src|href)="([^"]+)"/g)) {
      assert.doesNotMatch(url, /^(https?:)?\/\//, `${f}: ${url}`);
      assert.ok(existsSync(join(root, dirname(f), url.split('#')[0])), `${f}: ${url} resolves`);
    }
  }
  for (const f of pages.concat(scripts)) {
    const t = read(f);
    assert.doesNotMatch(t, /[^\x00-\x7e]/, `${f}: ASCII only (use entities or escapes)`);
    assert.doesNotMatch(t, /\b(colour|organis|behaviour|licence|analys(e|ing)\b|catalogue|centre)\w*/i, `${f}: American English`);
  }
  for (const f of scripts) {
    const js = read(f);
    assert.doesNotMatch(js, /\beval\s*\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write/, `${f}: safe DOM and no eval`);
  }
});

test('download blob is exactly sized and named by its SHA-256', () => {
  const files = readdirSync(join(site, 'blobs'));
  assert.equal(files.length, 1);
  const bytes = readFileSync(join(site, 'blobs', files[0]));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.length, 8388608);
  assert.equal(files[0], `8m-${digest}.bin`);
  for (const packName of ['generic.json', 'avd.json', 'avd-gov.json', 'w365.json', 'teams.json', 'm365.json']) {
    const pack = JSON.parse(readFileSync(join(site, 'packs', packName), 'utf8'));
    assert.equal(pack.download.path, `blobs/${files[0]}`);
    assert.equal(pack.download.bytes, bytes.length);
  }
});

test('pack schema defines the generic, AVD, US Gov, and workload pack contracts', () => {
  const schema = JSON.parse(readFileSync(join(site, 'packs', 'schema.json'), 'utf8'));
  const generic = JSON.parse(readFileSync(join(site, 'packs', 'generic.json'), 'utf8'));
  const avd = JSON.parse(readFileSync(join(site, 'packs', 'avd.json'), 'utf8'));
  const avdGov = JSON.parse(readFileSync(join(site, 'packs', 'avd-gov.json'), 'utf8'));
  const w365 = JSON.parse(readFileSync(join(site, 'packs', 'w365.json'), 'utf8'));
  const teams = JSON.parse(readFileSync(join(site, 'packs', 'teams.json'), 'utf8'));
  const m365 = JSON.parse(readFileSync(join(site, 'packs', 'm365.json'), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.$id, 'urn:avd-ops:avd-linecheck:pack:v1');
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('hosts'));
  assert.equal(schema.allOf[0].then.properties.endpointIds.maxItems, 0);
  assert.equal(schema.allOf[0].then.properties.thresholds.maxItems, 0);
  assert.ok(schema.allOf[1].then.required.includes('endpointSource'));
  for (const pack of [generic, avd, avdGov, w365, teams, m365]) {
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

test('text-first guides cover all seven spec topics, detect platform ambiguity, and check freshness', () => {
  const manifest = JSON.parse(readFileSync(join(site, 'steps', 'steps.json'), 'utf8'));
  const ids = manifest.steps.map((step) => step.id);
  for (const requiredId of [
    'windows.capture',
    'macos.capture',
    'avd.connection-info',
    'avd.logs.windows',
    'avd.logs.macos',
    'avd.logs.ios',
    'avd.logs.android',
    'avd.logs.web',
    'teams.logs.windows',
    'teams.logs.macos',
    'teams.vdi-optimization',
    'avd.shortpath-test',
    'avd.mmr-logs',
    'avd.log-bundle-prep'
  ]) {
    assert.ok(ids.includes(requiredId), `steps.json includes ${requiredId}`);
  }
  assert.equal(new Set(ids).size, ids.length);
  for (const step of manifest.steps) {
    assert.ok(step.actions.length > 0, `${step.id} has actions`);
    assert.equal(step.reviewed, true, `${step.id} is marked reviewed`);
    assert.ok(step.reviewer, `${step.id} records reviewer`);
    assert.equal(step.assets.length, 0, `${step.id} stays text-only until approved captures exist`);
    assert.match(step.source.checkedAt, /^2026-10-\d{2}$/);
    assert.match(step.source.url, /^https:\/\/(learn\.microsoft\.com|support\.microsoft\.com|support\.apple\.com)\//);
    assert.equal(stepsApi.isStepStale(step, '2026-11-01'), false);
    assert.equal(stepsApi.isStepStale(step, '2027-06-01'), true);
    assert.match(stepsApi.freshnessNotice({ ...step, sourceChangedAt: '2026-10-26' }, '2026-10-26'), /last checked against the vendor documentation/);
  }

  assert.deepEqual(stepsApi.detectStepPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 5 }), {
    platform: 'macOS',
    ipadAmbiguous: true
  });
  assert.deepEqual(stepsApi.detectStepPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 }), {
    platform: 'Windows',
    ipadAmbiguous: false
  });

  const html = readFileSync(join(site, 'steps', 'index.html'), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(policy);
  assert.match(policy[1], /connect-src 'self'/);
  assert.doesNotMatch(policy[1], /https:\/\//);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>|<style|\sstyle="|\son[a-z]+\s*=/i);
});
