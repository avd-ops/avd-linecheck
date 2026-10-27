/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { measureSamples, measureParallelSamples, measureUntil, measureDownload, runProbePhases, probeOnce } = createRequire(import.meta.url)('../site/engine.js');

test('sample runner times successful probes and counts stalls without calling them passes', async () => {
  let clock = 0;
  let calls = 0;
  const durations = [1, 10, 20, 30];
  const result = await measureSamples({
    probe: async () => { clock += durations[calls++]; },
    now: () => clock,
    samples: 3
  });

  assert.equal(calls, 4, 'one warm-up plus three timed samples');
  assert.equal(result.status, 'reached');
  assert.equal(result.median, 20);
  assert.equal(result.jitter, 10);
  assert.equal(result.stalls, 0);
});

test('a stalled sample is not bridged when calculating jitter', async () => {
  let clock = 0;
  let calls = 0;
  const result = await measureSamples({
    probe: async () => {
      calls++;
      if (calls === 1) { clock += 1; return; }
      if (calls === 3) throw new Error('timeout');
      clock += calls === 2 ? 10 : 20;
    },
    now: () => clock,
    samples: 3
  });
  assert.equal(result.stalls, 1);
  assert.equal(result.jitter, null);
});

test('portal-style regional latency stops on the first failed timed sample', async () => {
  let calls = 0;
  const result = await measureSamples({
    probe: async () => { calls++; if (calls === 3) throw new Error('timeout'); },
    now: () => 10,
    samples: 5,
    stopOnStall: true
  });
  assert.equal(calls, 3, 'one warm-up, one timed success, then the failing sample');
  assert.equal(result.status, 'blocked');
  assert.equal(result.median, null);
  assert.equal(result.stalls, 1);
});

test('a failed warm-up or all failed samples is blocked, never a passing zero', async () => {
  const warmup = await measureSamples({ probe: async () => { throw new Error('timeout'); }, now: () => 0, samples: 2 });
  assert.equal(warmup.status, 'blocked');
  assert.equal(warmup.median, null);
  let calls = 0;
  const stalled = await measureSamples({
    probe: async () => { calls++; if (calls > 1) throw new Error('timeout'); },
    now: () => 0,
    samples: 2
  });
  assert.equal(stalled.status, 'blocked');
  assert.equal(stalled.stalls, 2);
  assert.equal(stalled.median, null);
});

test('browser probe is a credential-free opaque HEAD request with a deadline', async () => {
  let request;
  let cleared = false;
  const result = await probeOnce('example.microsoft.com', {
    fetchImpl: async (url, options) => { request = { url, options }; return {}; },
    now: () => 12,
    nonce: () => 'sample',
    setTimer: (callback) => { assert.equal(typeof callback, 'function'); return 7; },
    clearTimer: (id) => { cleared = id === 7; }
  });

  assert.equal(result, 0);
  assert.match(request.url, /^https:\/\/example\.microsoft\.com\//);
  assert.equal(request.options.method, 'HEAD');
  assert.equal(request.options.mode, 'no-cors');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(cleared, true);
});

test('regional-style probes can use GET to match the deployment portal', async () => {
  let method;
  await probeOnce('eastus.api.cognitive.microsoft.com', {
    method: 'GET',
    fetchImpl: async (_url, options) => { method = options.method; return {}; },
    now: () => 0,
    nonce: () => 'sample',
    setTimer: () => 1,
    clearTimer: () => {}
  });
  assert.equal(method, 'GET');
});

test('parallel reachability samples preserve individual timings and fail closed', async () => {
  let calls = 0;
  const result = await measureParallelSamples({
    probe: async () => { calls++; if (calls === 1) return 1; if (calls === 3) throw new Error('blocked'); return calls * 10; },
    samples: 3
  });
  assert.equal(result.status, 'reached');
  assert.deepEqual(result.samples, [20, 40]);
  assert.equal(result.stalls, 1);
  const unknown = await measureParallelSamples({ probe: async () => { throw new Error('blocked'); }, samples: 2 });
  assert.equal(unknown.status, 'blocked');
});

test('loaded samples stop when the download finishes', async () => {
  let calls = 0;
  let stopDownload;
  const stop = new Promise((resolve) => { stopDownload = resolve; });
  const result = await measureUntil({
    probe: async () => { calls++; if (calls === 2) stopDownload(); return calls * 10; },
    stop,
    samples: 8
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.samples, [10]);
});

test('download sufficiency retries on cache hit, uses first-to-last-byte timing, and caps fast bursts at 67 Mbit/s', async () => {
  const caches = [];
  const entries = [
    [{ transferSize: 0, responseStart: 10, responseEnd: 20 }],
    [{ transferSize: 8388608, responseStart: 400, responseEnd: 600 }]
  ];
  const fast = await measureDownload({ path: 'blobs/8m.bin', bytes: 8388608 }, {
    url: 'https://linecheck.avd-ops.dev/blobs/8m.bin',
    fetchImpl: async (_url, opts) => {
      caches.push(opts.cache);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8388608) };
    },
    getEntries: () => entries[caches.length - 1]
  });
  assert.deepEqual(caches, ['default', 'reload'], 'cache hit triggers a reload fetch');
  assert.equal(fast.status, 'measured');
  assert.equal(fast.elapsed, 200, 'uses responseEnd - responseStart rather than cold-edge TTFB');
  assert.equal(fast.capped, true);
  assert.equal(fast.reportedMbps, 67);
  assert.equal(fast.loadedLatencyEligible, false);

  const sustained = await measureDownload({ path: 'blobs/8m.bin', bytes: 8388608 }, {
    url: 'https://linecheck.avd-ops.dev/blobs/8m.bin',
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8388608) }),
    getEntries: () => [{ transferSize: 8388608, responseStart: 100, responseEnd: 4100 }]
  });
  assert.equal(sustained.status, 'measured');
  assert.equal(sustained.capped, false);
  assert.equal(sustained.loadedLatencyEligible, true);
  assert.equal(Math.round(sustained.reportedMbps), 17);
});

test('phased run completes with a verdict when all hosts time out inside the deadline', async () => {
  let clock = 0;
  const phasesSeen = [];
  const res = await runProbePhases({
    targets: [
      { id: 'client.sign-in', host: 'login.microsoftonline.com', purpose: 'Microsoft Entra sign-in', required: true },
      { id: 'client.portal', host: 'windows.cloud.microsoft', purpose: 'Windows App web portal', required: true }
    ],
    regions: [
      { id: 'eastus', name: 'East US', geo: 'Americas' },
      { id: 'westeurope', name: 'West Europe', geo: 'Europe' }
    ],
    regionMap: {
      hostTemplate: '{region}.api.cognitive.microsoft.com',
      measurement: { method: 'GET', samples: 3, timeoutMs: 100, concurrency: 2, top: 5 }
    },
    targetRegionId: 'eastus',
    deadlineMs: 500,
    now: () => clock,
    probeImpl: async () => {
      clock += 60;
      throw new Error('timeout');
    },
    onProgress: (phase) => phasesSeen.push(phase)
  });

  assert.equal(res.hostResults.length, 2);
  assert.ok(res.hostResults.every((h) => h.result.status === 'blocked'));
  assert.equal(res.regionResults.length, 2);
  assert.ok(res.regionResults.every((r) => r.result.status !== 'reached'));
  assert.ok(phasesSeen.includes('Reachability'));
});
