/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const {
  connectOrigins, probeTargets, combineWorkloadTargets, regionalHost,
  regionsForCloud, selectRegions, validatePack, buildHelpdeskUrl
} = createRequire(import.meta.url)('../site/engine.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

test('AVD pack consumes the pinned endpoint map and probeable browser view', () => {
  const pack = readJson('site/packs/avd.json');
  const endpointMap = readJson('site/packs/endpoints.json');
  const regions = readJson('site/packs/regions.json');

  assert.equal(pack.endpointSource.repo, 'avd-ops/avd-assess');
  assert.equal(pack.endpointSource.commit, 'd8b6983b6fd947eb795cd5945e30e54cf1dc194b');
  assert.equal(pack.endpointSource.sha256, createHash('sha256').update(readFileSync(resolve(root, 'site/packs/endpoints.json'))).digest('hex'));
  assert.deepEqual(pack.endpointIds, endpointMap.views.browser.probe);
  assert.equal(regions.source.commit, '901deb119f7256c40a617bc30d2c7fa73edc03b3');
  assert.equal(regions.avdTargetSource.gitCommitId, '98f726730d8d63d52a4fea0415ab8eaffffcd975');
  assert.deepEqual(regions.measurement, { method: 'GET', samples: 5, timeoutMs: 4000, concurrency: 3, top: 5 });
  assert.ok(regions.avdTargetRegionIds.every((id) => regions.regions.some((region) => region.id === id)));
  assert.doesNotThrow(() => validatePack(pack, endpointMap, regions.regions));
});

test('pack origins exactly cover named endpoint and regional probes', () => {
  const generic = readJson('site/packs/generic.json');
  const avd = readJson('site/packs/avd.json');
  const avdGov = readJson('site/packs/avd-gov.json');
  const w365 = readJson('site/packs/w365.json');
  const teams = readJson('site/packs/teams.json');
  const m365 = readJson('site/packs/m365.json');
  const endpointMap = readJson('site/packs/endpoints.json');
  const regionMap = readJson('site/packs/regions.json');
  const html = readFileSync(resolve(root, 'site/index.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);

  assert.ok(csp, 'the page has a CSP before its scripts');
  const connect = csp[1].match(/connect-src ([^;]+)/)?.[1].split(/\s+/) ?? [];
  const expected = connectOrigins([generic, avd, avdGov, w365, teams, m365], endpointMap, regionMap);

  assert.deepEqual(connect, ["'self'", ...expected]);
  assert.match(csp[1], /^default-src 'none';/);
  assert.doesNotMatch(csp[1], /unsafe-inline|unsafe-eval|\*/);
});

test('Azure US Government and workload packs (Windows 365, Teams VDI, Microsoft 365 Core) validate and cite sources', () => {
  const endpointMap = readJson('site/packs/endpoints.json');
  const regionMap = readJson('site/packs/regions.json');
  const avdGov = readJson('site/packs/avd-gov.json');
  const w365 = readJson('site/packs/w365.json');
  const teams = readJson('site/packs/teams.json');
  const m365 = readJson('site/packs/m365.json');

  assert.doesNotThrow(() => validatePack(avdGov, endpointMap, regionMap.govRegions));
  assert.doesNotThrow(() => validatePack(w365, endpointMap, regionMap.regions));
  assert.doesNotThrow(() => validatePack(teams, endpointMap, regionMap.regions));
  assert.doesNotThrow(() => validatePack(m365, endpointMap, regionMap.regions));

  assert.equal(avdGov.cloud, 'gov');
  assert.equal(avdGov.shortpathNote.claim, 'ref:configure-rdp-shortpath#turn-public-cloud-only');
  assert.ok(avdGov.hosts.some((h) => h.host === 'login.microsoftonline.us' && h.required));
  assert.ok(avdGov.hosts.some((h) => h.host === 'graph.microsoft.us'));
  assert.ok(avdGov.notTested.includes('gov.wvd'));
  assert.deepEqual(regionMap.avdGovTargetRegionIds, ['usgovvirginia', 'usgovarizona', 'usgovtexas']);

  assert.ok(w365.hosts.some((h) => h.host === 'windows.cloud.microsoft' && h.required));
  assert.ok(w365.hosts.some((h) => h.host === 'windows365.microsoft.com' && h.required));
  assert.ok(w365.hosts.some((h) => h.host === 'intune.microsoft.com'));

  assert.ok(teams.hosts.some((h) => h.host === 'teams.cloud.microsoft' && h.required));
  assert.ok(teams.hosts.some((h) => h.host === 'teams.microsoft.com' && h.required));
  assert.ok(teams.notTested.includes('teams.media-udp'));
  assert.equal(teams.links.vdiCheck, 'steps/index.html?step=teams.logs.windows');

  assert.ok(m365.hosts.some((h) => h.host === 'outlook.cloud.microsoft' && h.required));
  assert.ok(m365.hosts.some((h) => h.host === 'outlook.office.com' && h.required));
  assert.ok(m365.hosts.some((h) => h.host === 'officeclient.microsoft.com'));
  assert.ok(m365.hosts.some((h) => h.host === 'graph.microsoft.com'));

  const combined = combineWorkloadTargets([w365, m365, teams], endpointMap);
  const uniqueHosts = new Set(combined.map((t) => t.host));
  assert.equal(combined.length, uniqueHosts.size, 'deduplicates shared hosts such as graph.microsoft.com across workloads');
});

test('helpdesk link builder formats cloud, pack, workloads, region, and lite query parameters cleanly', () => {
  assert.equal(
    buildHelpdeskUrl({ baseUrl: 'https://linecheck.avd-ops.dev/?old=1#hash', cloud: 'gov', pack: 'avd', region: 'usgovvirginia', lite: true }),
    'https://linecheck.avd-ops.dev/?cloud=gov&pack=avd-gov&region=usgovvirginia&lite=1'
  );
  assert.equal(
    buildHelpdeskUrl({ baseUrl: 'https://linecheck.avd-ops.dev/', cloud: 'commercial', workloads: ['w365', 'teams'], region: 'eastus', lite: false }),
    'https://linecheck.avd-ops.dev/?workloads=w365%2Cteams&region=eastus'
  );
});

test('a pack cannot probe a wildcard, unknown, or unlisted endpoint', () => {
  const pack = readJson('site/packs/avd.json');
  const endpointMap = readJson('site/packs/endpoints.json');
  const regions = readJson('site/packs/regions.json').regions;

  assert.throws(() => validatePack({ ...pack, endpointIds: [...pack.endpointIds, 'client.service'] }, endpointMap, regions));
  assert.throws(() => validatePack({ ...pack, endpointIds: ['not-in-the-map'] }, endpointMap, regions));
});

test('a fork can add a public host, and private or wildcard hosts are refused', () => {
  const endpointMap = readJson('site/packs/endpoints.json');
  const regionMap = readJson('site/packs/regions.json');
  const pack = {
    id: 'custom', version: '1', title: 'Custom network check', endpointIds: [],
    hosts: [{ id: 'support', host: 'support.contoso.com', purpose: 'Support service', required: false, port: 443, claim: null }],
    regionalProbe: false, thresholds: [], download: { path: 'blobs/8m-test.bin', bytes: 8388608, claim: null }
  };

  assert.doesNotThrow(() => validatePack(pack, endpointMap, regionMap.regions));
  assert.deepEqual(connectOrigins([pack], endpointMap, regionMap), ['https://support.contoso.com']);
  assert.equal(probeTargets(pack, endpointMap)[0].host, 'support.contoso.com');
  assert.throws(() => validatePack({ ...pack, hosts: [{ ...pack.hosts[0], host: '127.0.0.1' }] }, endpointMap, regionMap.regions));
  assert.throws(() => validatePack({ ...pack, hosts: [{ ...pack.hosts[0], host: '192.168.1.1' }] }, endpointMap, regionMap.regions));
  assert.throws(() => validatePack({ ...pack, hosts: [{ ...pack.hosts[0], host: '*.contoso.com' }] }, endpointMap, regionMap.regions));
  assert.throws(() => validatePack({ ...pack, hosts: [{ ...pack.hosts[0], host: 'service.local' }] }, endpointMap, regionMap.regions));
  assert.throws(() => validatePack({ ...pack, hosts: [{ ...pack.hosts[0], host: 'host.home.arpa' }] }, endpointMap, regionMap.regions));
});

test('regional selection covers checked geographies and always includes the chosen target', () => {
  const regions = readJson('site/packs/regions.json').regions;
  const geographies = [...new Set(regions.map((region) => region.geo))];
  const all = selectRegions(regions, geographies);
  const europe = selectRegions(regions, ['Europe']);
  const targeted = selectRegions(regions, ['Europe'], 'eastus');

  assert.equal(regions.length, 38);
  assert.deepEqual(all, regions);
  assert.ok(europe.length > 3);
  assert.ok(europe.every((region) => region.geo === 'Europe'));
  assert.ok(targeted.some((region) => region.id === 'eastus'));
  assert.ok(targeted.length > europe.length);
  assert.deepEqual(selectRegions(regions, []), []);
});

test('regional probe hosts come from the pinned regional map template for both Commercial and US Government', () => {
  const regionMap = readJson('site/packs/regions.json');
  assert.equal(regionalHost(regionMap, regionMap.regions[0]), 'eastus.api.cognitive.microsoft.com');
  assert.equal(regionalHost(regionMap, regionMap.govRegions[0]), 'usgovvirginia.api.cognitive.microsoft.us');
  assert.equal(regionsForCloud(regionMap, 'gov').length, 3);
  assert.throws(() => regionalHost({ ...regionMap, hostTemplate: '{region}.example.com' }, regionMap.regions[0]));
  assert.throws(() => regionalHost({ ...regionMap, govHostTemplate: '{region}.example.us' }, regionMap.govRegions[0]));
});
