/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const verdict = require('../site/verdict.js');
const exporter = require('../site/export.js');

const {
  findingSentence, rttFinding, overallVerdict, reachabilityFinding,
  rankRegions, regionRating, visibleRegions, detectVantage,
  detectProxyCaveats, relayGeographyNote, cloudShortpathNote, summarizeMetrics, sentences, labels
} = verdict;
const { hasCustomHosts, makeExport, makeIntakeEntry, parseSharedResult, compareResults, validateSentiment } = exporter;

const bands = [
  { below: 100, state: 'pass', claim: 'ideal' },
  { below: 150, state: 'warn', claim: 'target' },
  { atMost: 200, state: 'warn', claim: 'quality' },
  { otherwise: 'fail', claim: 'quality' }
];

test('RTT bands are inclusive only where the cited pack says they are', () => {
  assert.equal(rttFinding(99, bands).status, 'pass');
  assert.equal(rttFinding(100, bands).status, 'warn');
  assert.equal(rttFinding(150, bands).status, 'warn');
  assert.equal(rttFinding(200, bands).status, 'warn');
  assert.equal(rttFinding(201, bands).status, 'fail');
  assert.equal(rttFinding(201, bands).claim, 'quality');
  assert.equal(rttFinding(201, bands).threshold, '> 200 ms');
  assert.equal(rttFinding(null, bands).status, 'unknown');
});

test('overall verdict fails closed and ignores informational findings', () => {
  assert.equal(overallVerdict([]).status, 'unknown');
  assert.equal(overallVerdict([{ status: 'pass', required: true }]).status, 'pass');
  assert.equal(overallVerdict([{ status: 'pass', required: true }, { status: 'blocked', required: false }]).status, 'pass');
  assert.equal(overallVerdict([{ status: 'unknown', required: true }]).status, 'unknown');
  assert.equal(overallVerdict([{ status: 'fail', required: true }, { status: 'blocked', required: true }]).status, 'blocked');
});

test('a failed optional endpoint is unknown rather than a required block', () => {
  assert.equal(reachabilityFinding({ id: 'optional', required: false }, 'blocked').status, 'unknown');
  assert.equal(reachabilityFinding({ id: 'required', required: true }, 'blocked').status, 'blocked');
});

test('finding wording comes from the local result contract', () => {
  assert.equal(findingSentence('blocked'), 'This required check did not answer from this network; a proxy or blocker may be involved.');
  assert.equal(findingSentence('info'), 'This is informational and does not change the overall verdict.');
});

test('regional ranking sorts measured results first and unknowns last', () => {
  const ranking = rankRegions([
    { region: { id: 'slow' }, result: { median: 88 } },
    { region: { id: 'unknown' }, result: { median: null } },
    { region: { id: 'fast' }, result: { median: 24 } }
  ]);
  assert.deepEqual(ranking.map((item) => item.region.id), ['fast', 'slow', 'unknown']);
});

test('regional ranking uses the deployment portal latency ratings', () => {
  assert.equal(regionRating(null), 'No answer');
  assert.equal(regionRating(99), 'Good');
  assert.equal(regionRating(100), 'Usable');
  assert.equal(regionRating(150), 'Usable');
  assert.equal(regionRating(151), 'Sluggish');
});

test('region table shows five by default and retains a selected region outside the top five', () => {
  const regions = Array.from({ length: 8 }, (_, index) => ({ region: { id: `r${index}` }, result: { median: index } }));
  assert.deepEqual(visibleRegions(regions, 'r7', false, 5).map((entry) => entry.region.id), ['r0', 'r1', 'r2', 'r3', 'r4', 'r7']);
  assert.equal(visibleRegions(regions, 'r7', true, 5).length, 8);
});

test('vantage detection flags sub-5ms regional RTT as likely-session-host', () => {
  assert.equal(detectVantage([]), 'unknown');
  assert.equal(detectVantage([{ region: { id: 'eastus' }, result: { status: 'reached', median: 28 } }]), 'device');
  assert.equal(detectVantage([{ region: { id: 'eastus' }, result: { status: 'reached', median: 3.4 } }]), 'likely-session-host');
});

test('proxy and tunnel caveats detect uniform host timings and geography mismatch with citations', () => {
  const caveats = detectProxyCaveats({
    hostResults: [
      { target: { id: 'h1' }, result: { status: 'reached', median: 12 } },
      { target: { id: 'h2' }, result: { status: 'reached', median: 14 } },
      { target: { id: 'h3' }, result: { status: 'reached', median: 15 } }
    ],
    regionResults: [
      { region: { id: 'westeurope', name: 'West Europe', geo: 'Europe' }, result: { status: 'reached', median: 22 } }
    ],
    selectedGeographies: ['Americas']
  });
  assert.deepEqual(caveats.map((c) => c.id), ['uniform-host-timing', 'geography-mismatch']);
  assert.ok(caveats[0].claims.includes('ref:avd-proxy#bypass-proxies'));
  assert.ok(caveats[1].claims.includes('ref:rdp-traffic-optimization#local-egress'));
});

test('relay geography note surfaces when the nearest measured region exceeds 150 ms', () => {
  assert.equal(relayGeographyNote([{ region: { id: 'eastus', name: 'East US' }, result: { status: 'reached', median: 45 } }]), null);
  const note = relayGeographyNote([{ region: { id: 'eastus', name: 'East US' }, result: { status: 'reached', median: 185 } }]);
  assert.ok(note);
  assert.equal(note.id, 'relay-geography');
  assert.ok(note.claims.includes('ref:rdp-shortpath#turn-range'));
});

test('share export allowlists fields, rounds its timestamp to a minute, and validates sentiment', () => {
  const raw = {
    pack: { id: 'avd', version: '2026.10', allowedFindingIds: ['client.sign-in', 'client.wvd'] },
    createdAt: '2026-10-25T13:14:59.000Z',
    browser: { family: 'Firefox', major: 142, userAgent: 'private ua' },
    platform: 'desktop',
    region: 'eastus',
    vantage: 'device',
    sentiment: { rating: 2, symptoms: ['frozen-blurry-screen', 'slow-typing', 'free-text-leak'] },
    findings: [{ id: 'client.sign-in', status: 'pass', value: 42.8, unit: 'ms', required: true, claim: 'ref:endpoints#client-list', sentence: 'private text', tenant: 'private tenant' }],
    notTested: ['client.wvd'],
    ip: 'private ip',
    deviceName: 'private device',
    comments: 'private comments'
  };
  const result = makeExport(raw);

  assert.equal(result.createdAt, '2026-10-25T13:14Z');
  assert.equal(result.browser.family, 'Firefox');
  assert.equal(result.vantage, 'device');
  assert.deepEqual(result.sentiment, { rating: 2, symptoms: ['frozen-blurry-screen', 'slow-typing'] });
  assert.equal(result.findings[0].sentence, 'This check answered from this network.');
  for (const secret of ['private ua', 'private tenant', 'private ip', 'private device', 'private comments', 'private text', 'free-text-leak']) {
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  }
  assert.equal(validateSentiment({ rating: 9, symptoms: ['not-a-symptom'] }), null);
});

test('assessment intake entry exports only non-identifying network.client summary fields', () => {
  const intake = makeIntakeEntry({
    pack: { id: 'avd', version: '2026.10', allowedFindingIds: ['client.sign-in', 'target-region', 'jitter.primary', 'download', 'region.eastus'] },
    createdAt: '2026-10-25T13:14:59.000Z',
    region: 'eastus',
    vantage: 'device',
    sentiment: { rating: 3, symptoms: ['slow-typing'] },
    findings: [
      { id: 'client.sign-in', status: 'pass', required: true, value: 30, unit: 'ms' },
      { id: 'target-region', status: 'warn', required: true, value: 120, unit: 'ms' },
      { id: 'jitter.primary', status: 'info', required: false, value: 8, unit: 'ms' },
      { id: 'download', status: 'info', required: false, value: 67, unit: 'Mbit/s' }
    ],
    regionResults: [
      { region: { id: 'eastus' }, result: { status: 'reached', median: 120 } }
    ]
  });
  assert.equal(intake.schema, 'avd-assess-user-network/v1');
  assert.equal(intake.area, 'network.client');
  assert.equal(intake.targetRegion, 'eastus');
  assert.equal(intake.targetRegionMedianMs, 120);
  assert.equal(intake.jitterMs, 8);
  assert.equal(intake.downloadMbps, 67);
  assert.deepEqual(intake.topRegions, [{ id: 'eastus', medianMs: 120 }]);
});

test('share export includes three measured regions by default and all only by choice', () => {
  const pack = { id: 'generic', version: '1.0', allowedFindingIds: ['region.a', 'region.b', 'region.c', 'region.d'] };
  const run = {
    pack,
    createdAt: '2026-10-25T13:14:00Z',
    findings: ['a', 'b', 'c', 'd'].map((id, index) => ({ id: `region.${id}`, status: 'info', value: (index + 1) * 10, unit: 'ms' }))
  };
  assert.equal(makeExport(run).findings.length, 3);
  assert.equal(makeExport({ ...run, fullRegions: true }).findings.length, 4);
});

test('custom hosts mark shared results as public-sensitive', () => {
  const pack = { id: 'generic', version: '1.0', hosts: [{ id: 'support', host: 'support.contoso.com', purpose: 'Support service' }], allowedFindingIds: ['support'] };
  assert.equal(hasCustomHosts(pack), true);
  const result = makeExport({ pack, createdAt: '2026-10-25T13:14:00Z', findings: [{ id: 'support', status: 'pass', required: false }] });
  assert.equal(result.custom, true);
  assert.equal(result.findings[0].host, 'support.contoso.com');
});

test('pasted results use only local IDs, states, and wording', () => {
  const pack = { id: 'avd', version: '2026.10', allowedFindingIds: ['client.sign-in', 'client.wvd'] };
  const text = JSON.stringify({
    schemaVersion: 1,
    pack: { id: 'avd', version: '2026.10' },
    overall: { status: 'pass', label: 'ignore this' },
    sentiment: { rating: 4, symptoms: ['disconnects', '<script>'] },
    findings: [{ id: 'client.sign-in', status: 'pass', required: true, value: 20, unit: 'ms', sentence: '<script>bad</script>' }, { id: 'client.wvd', status: 'blocked', required: false, value: null }, { id: 'host.wvd', status: 'pass', required: true, value: 1 }, { id: 'not-known', status: 'pass', value: 1 }]
  });
  const parsed = parseSharedResult(text, pack);

  assert.equal(parsed.overall.status, 'pass');
  assert.equal(parsed.findings.length, 2);
  assert.equal(parsed.findings[0].sentence, 'This check answered from this network.');
  assert.equal(parsed.findings[1].status, 'unknown');
  assert.deepEqual(parsed.sentiment, { rating: 4, symptoms: ['disconnects'] });
  assert.throws(() => parseSharedResult('{', pack));
});

test('verdict labels and sentences stay plain-language and within reading-level bounds', () => {
  const texts = [...Object.values(labels), ...Object.values(sentences)];
  for (const text of texts) {
    const words = text.trim().split(/\s+/);
    assert.ok(words.length <= 24, `sentence is concise (<= 24 words): "${text}"`);
    assert.doesNotMatch(text, /\b(telecommunications|infrastructure|instrumentation|synchronization|remediation|unauthenticated)\b/i);
  }
});

test('high-setup-overhead caveat surfaces when cold setup time is >= 250 ms', () => {
  const caveats = detectProxyCaveats({
    hostResults: [
      { target: { id: 'h1', host: 'login.microsoftonline.com' }, result: { status: 'reached', median: 20, setupMs: 310 } },
      { target: { id: 'h2', host: 'windows.cloud.microsoft' }, result: { status: 'reached', median: 45, setupMs: 40 } }
    ],
    regionResults: [],
    selectedGeographies: []
  });
  const overhead = caveats.find((c) => c.id === 'high-setup-overhead');
  assert.ok(overhead);
  assert.ok(overhead.claims.includes('ref:avd-proxy#bypass-proxies'));
  assert.ok(overhead.claims.includes('ref:rdp-traffic-optimization#no-tls-inspection'));
});

test('cloudShortpathNote returns cited Azure US Government Shortpath note only for gov', () => {
  assert.equal(cloudShortpathNote('commercial'), null);
  const note = cloudShortpathNote('gov');
  assert.ok(note);
  assert.equal(note.id, 'gov-shortpath-turn');
  assert.ok(note.claims.includes('ref:configure-rdp-shortpath#turn-public-cloud-only'));
});

test('compareResults computes RTT/jitter deltas and blocked/caveat transitions', () => {
  const baseline = {
    overall: { status: 'blocked', label: 'Action needed' },
    findings: [
      { id: 'target-region', status: 'warn', value: 140, unit: 'ms', required: true },
      { id: 'jitter.primary', status: 'info', value: 18, unit: 'ms', required: false },
      { id: 'client.sign-in', status: 'blocked', value: null, required: true }
    ],
    caveats: [{ id: 'high-setup-overhead', sentence: 'Overhead', claims: [] }]
  };
  const current = {
    overall: { status: 'pass', label: 'Ready' },
    findings: [
      { id: 'target-region', status: 'pass', value: 42, unit: 'ms', required: true },
      { id: 'jitter.primary', status: 'info', value: 4, unit: 'ms', required: false },
      { id: 'client.sign-in', status: 'pass', value: 25, unit: 'ms', required: true }
    ],
    caveats: []
  };
  const diff = compareResults(baseline, current);
  assert.ok(diff);
  assert.equal(diff.rttDeltaMs, -98);
  assert.equal(diff.jitterDeltaMs, -14);
  assert.deepEqual(diff.blockedCleared, ['client.sign-in']);
  assert.deepEqual(diff.newlyBlocked, []);
  assert.deepEqual(diff.caveatsCleared, ['high-setup-overhead']);
  assert.deepEqual(diff.caveatsAdded, []);
});

test('share export and parser preserve cloud, workloads, setupMs, and webClient fields', () => {
  const packMap = {
    'avd-gov': { id: 'avd-gov', version: '2026.10', allowedFindingIds: ['gov.sign-in', 'dns.origin'] }
  };
  const exported = makeExport({
    pack: packMap['avd-gov'],
    cloud: 'gov',
    workloads: ['avd', 'teams'],
    createdAt: '2026-10-25T13:14:00Z',
    webClient: {
      webCodecs: true,
      h264: true,
      av1: false,
      clipboard: true,
      multiScreen: false
    },
    findings: [
      { id: 'gov.sign-in', host: 'login.microsoftonline.us', status: 'pass', value: 32, setupMs: 280, unit: 'ms', required: true },
      { id: 'dns.origin', status: 'info', value: 18, unit: 'ms', required: false }
    ]
  });
  assert.equal(exported.cloud, 'gov');
  assert.deepEqual(exported.workloads, ['avd', 'teams']);
  assert.equal(exported.findings[0].setupMs, 280);
  assert.equal(exported.webClient.h264, true);

  const parsed = parseSharedResult(JSON.stringify(exported), packMap);
  assert.equal(parsed.cloud, 'gov');
  assert.deepEqual(parsed.workloads, ['avd', 'teams']);
  assert.equal(parsed.findings[0].setupMs, 280);
  assert.equal(parsed.webClient.h264, true);
});

test('summarizeMetrics builds performance cards, connection details, and per-endpoint breakdown', () => {
  const summary = summarizeMetrics({
    pack: { id: 'avd', title: 'Azure Virtual Desktop', version: '2026.10' },
    cloud: 'commercial',
    workloads: ['avd', 'teams'],
    region: 'eastus',
    vantage: 'device',
    browser: { family: 'Edge', major: 157 },
    platform: 'desktop',
    caveats: [{ id: 'high-setup-overhead' }],
    dnsOriginMs: 14,
    lite: false,
    jitterDetail: { status: 'reached', jitter: 4, jitterFloor: false, stalls: 0, slowSamples: 1 },
    downloadDetail: { status: 'measured', reportedMbps: 67, capped: true, elapsed: 420 },
    regionResults: [
      { region: { id: 'eastus', name: 'East US', geo: 'Americas' }, result: { status: 'reached', median: 28 } }
    ],
    hostResults: [
      {
        target: { id: 'client.sign-in', host: 'login.microsoftonline.com', purpose: 'Microsoft Entra sign-in', required: true },
        result: { status: 'reached', warmUpMs: 310, median: 30, setupMs: 280, samples: [28, 30, 32], stalls: 0, slowSamples: 0 }
      }
    ],
    findings: [
      { id: 'target-region', status: 'pass', value: 28, unit: 'ms', required: true },
      { id: 'loaded-latency', status: 'info', value: 36, unit: 'ms', required: false }
    ]
  });

  assert.equal(summary.cards.length, 6);
  assert.equal(summary.cards.find((c) => c.id === 'rtt').value, 'at most 28 ms');
  assert.equal(summary.cards.find((c) => c.id === 'jitter').value, '4 ms');
  assert.equal(summary.cards.find((c) => c.id === 'stability').value, '0 stalls / 1 slow');
  assert.equal(summary.cards.find((c) => c.id === 'setup').value, '+280 ms max');
  assert.equal(summary.cards.find((c) => c.id === 'download').value, 'at least 67 Mbit/s');
  assert.equal(summary.cards.find((c) => c.id === 'loaded-dns').value, 'at most 36 ms / 14 ms DNS');

  assert.equal(summary.connectionDetails.length, 7);
  assert.equal(summary.connectionDetails[0].value, 'Azure Commercial');
  assert.match(summary.connectionDetails[1].value, /Workloads: avd, teams/);

  assert.equal(summary.endpoints.length, 1);
  assert.equal(summary.endpoints[0].host, 'login.microsoftonline.com');
  assert.equal(summary.endpoints[0].warmUpMs, 310);
  assert.equal(summary.endpoints[0].medianMs, 30);
  assert.equal(summary.endpoints[0].setupMs, 280);
});
