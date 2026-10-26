import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureSamples, measureParallelSamples, measureUntil, probeOnce } from '../site/lib/network.mjs';

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
