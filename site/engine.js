/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT.
   engine.js: pack validation, target resolution, and browser network probes built on the avd-ops portal engine (probe.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./assets/engine/core.js'),
      require('./assets/engine/probe.js')
    );
  } else {
    const eng = root.AvdOpsEngine || {};
    root.LinecheckEngine = factory(eng.core, eng.probe);
  }
})(typeof self !== 'undefined' ? self : this, function (core, probe) {
  'use strict';

  const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  const RESERVED_SUFFIXES = [
    'localhost', 'local', 'localdomain', 'internal', 'intranet', 'corp', 'home',
    'test', 'invalid', 'example', 'example.com', 'example.net', 'example.org',
    'example.edu', 'arpa', 'home.arpa', 'onion', 'lan'
  ];
  const RESERVED_IDS = new Set([
    'site.origin', 'target-region', 'jitter.primary', 'slow-samples', 'stalls.primary',
    'download', 'loaded-latency', 'upload', 'udp', 'session-transport', 'session-host',
    'wildcard-endpoints', 'dns', 'packet-loss', 'vantage'
  ]);
  const MAX_SUFFICIENCY_MBPS = 67;

  function isPublicHost(host) {
    if (typeof host !== 'string') return false;
    const h = host.toLowerCase();
    if (!HOST_PATTERN.test(h)) return false;
    if (RESERVED_SUFFIXES.some((suffix) => h === suffix || h.endsWith(`.${suffix}`))) return false;
    try {
      if (probe && typeof probe.checkHost === 'function') probe.checkHost(h);
    } catch {
      return false;
    }
    return true;
  }

  function endpointById(endpointMap) {
    return new Map((endpointMap && Array.isArray(endpointMap.endpoints) ? endpointMap.endpoints : []).map((ep) => [ep.id, ep]));
  }

  function validatePack(pack, endpointMap, regions) {
    if (!endpointMap || endpointMap.schema !== 'avd-assess-endpoints/v1') {
      throw new TypeError('Endpoint map schema is unsupported');
    }
    if (!pack || !/^[a-z][a-z0-9-]*$/.test(pack.id) || !Array.isArray(pack.endpointIds) || !Array.isArray(pack.hosts)) {
      throw new TypeError('Pack needs an id, endpoint list, and host list');
    }
    const allowed = new Set((endpointMap.views && endpointMap.views.browser && endpointMap.views.browser.probe) || []);
    const endpoints = endpointById(endpointMap);
    const seen = new Set();
    for (const id of pack.endpointIds) {
      if (seen.has(id) || !allowed.has(id)) throw new TypeError(`Endpoint is not in the browser probe map: ${id}`);
      seen.add(id);
      const endpoint = endpoints.get(id);
      if (
        !endpoint || endpoint.kind !== 'fqdn' || endpoint.protocol !== 'tcp' || endpoint.port !== 443 ||
        !Array.isArray(endpoint.probeFrom) || !endpoint.probeFrom.includes('browser') || !isPublicHost(endpoint.host)
      ) {
        throw new TypeError(`Endpoint cannot be probed by the browser: ${id}`);
      }
    }
    const hostIds = new Set();
    for (const host of pack.hosts) {
      if (
        !host || !/^[a-z][a-z0-9-]*$/.test(host.id) || RESERVED_IDS.has(host.id) || seen.has(host.id) || hostIds.has(host.id) ||
        !isPublicHost(host.host) || host.port !== 443 || typeof host.required !== 'boolean' ||
        typeof host.purpose !== 'string' || !host.purpose ||
        (host.claim !== null && host.claim !== undefined && !/^ref:[a-z0-9-]+#[a-z0-9-]+$/.test(host.claim))
      ) {
        throw new TypeError(`Pack host is not a public HTTPS target: ${(host && host.id) || 'unknown'}`);
      }
      hostIds.add(host.id);
    }
    if (
      pack.regionalProbe && regions !== undefined &&
      (!Array.isArray(regions) || regions.length === 0 || regions.some((r) => !/^[a-z0-9]+$/.test(r.id) || !r.name || !r.geo))
    ) {
      throw new TypeError('Regional probes need named public regions');
    }
    if (!Array.isArray(pack.thresholds)) throw new TypeError('Pack thresholds must be a list');
    if (pack.thresholds.length && !pack.thresholds[pack.thresholds.length - 1].otherwise) {
      throw new TypeError('Thresholds need an otherwise band');
    }
    for (const band of pack.thresholds) {
      const state = band.state !== undefined ? band.state : band.otherwise;
      if (!band.claim || !['pass', 'warn', 'fail'].includes(state)) {
        throw new TypeError('Every threshold needs a state and claim');
      }
    }
    if (pack.stun !== undefined && (!Array.isArray(pack.stun) || (pack.stun.length !== 0 && pack.stun.length !== 2))) {
      throw new TypeError('Pack stun must be empty or contain exactly two endpoints');
    }
    return true;
  }

  function regionalHost(regionMap, region) {
    if (!regionMap || regionMap.hostTemplate !== '{region}.api.cognitive.microsoft.com' || !region || !/^[a-z0-9]+$/.test(region.id)) {
      throw new TypeError('Regional host is not in the pinned public map');
    }
    return regionMap.hostTemplate.replace('{region}', region.id);
  }

  function connectOrigins(packs, endpointMap, regionMap) {
    const endpoints = endpointById(endpointMap);
    const hosts = [];
    for (const pack of packs) {
      validatePack(pack, endpointMap, regionMap.regions);
      for (const id of pack.endpointIds) hosts.push(endpoints.get(id).host);
      for (const host of pack.hosts) hosts.push(host.host);
      if (pack.regionalProbe) {
        for (const region of regionMap.regions) hosts.push(regionalHost(regionMap, region));
      }
    }
    const origins = probe && typeof probe.connectSrc === 'function'
      ? probe.connectSrc(hosts)
      : [...new Set(hosts.map((h) => `https://${h}`))];
    return [...origins].sort();
  }

  function probeTargets(pack, endpointMap) {
    validatePack(pack, endpointMap);
    const endpoints = endpointById(endpointMap);
    const mapped = pack.endpointIds.map((id) => {
      const endpoint = endpoints.get(id);
      return {
        id,
        host: endpoint.host,
        purpose: endpoint.purpose,
        required: endpoint.verdict === 'required',
        claim: endpoint.source.claim
      };
    });
    return [...mapped, ...pack.hosts.map((host) => ({ id: host.id, ...host }))];
  }

  function selectRegions(regions, geographies, targetId = '') {
    const selectedGeographies = new Set(geographies);
    const selectedIds = new Set(regions.filter((r) => selectedGeographies.has(r.geo)).map((r) => r.id));
    if (regions.some((r) => r.id === targetId)) selectedIds.add(targetId);
    return regions.filter((r) => selectedIds.has(r.id));
  }

  function median(values) {
    if (!Array.isArray(values) || !values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
  }

  async function probeOnce(host, {
    fetchImpl = globalThis.fetch,
    now = () => globalThis.performance.now(),
    nonce = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    method = 'HEAD',
    timeoutMs = 4000,
    signal: externalSignal,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout
  } = {}) {
    const h = probe && typeof probe.checkHost === 'function' ? probe.checkHost(host) : host;
    const controller = new AbortController();
    const url = new URL('/', `https://${h}`);
    url.searchParams.set('linecheck', nonce());
    const abort = () => controller.abort();
    if (externalSignal && externalSignal.aborted) controller.abort();
    else if (externalSignal) externalSignal.addEventListener('abort', abort, { once: true });
    const started = now();
    const timer = setTimer(() => controller.abort(), timeoutMs);
    try {
      await fetchImpl(url.href, {
        method,
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'follow',
        signal: controller.signal
      });
      return Math.max(0, now() - started);
    } finally {
      clearTimer(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', abort);
    }
  }

  async function measureSamples({ probe: probeFn, now = () => globalThis.performance.now(), samples = 8, stopOnStall = false }) {
    try {
      await probeFn();
    } catch {
      return { status: 'blocked', median: null, jitter: null, jitterFloor: false, stalls: 0, slowSamples: 0, samples: [] };
    }

    const timed = new Array(samples).fill(null);
    let stalls = 0;
    for (let index = 0; index < samples; index++) {
      const started = now();
      try {
        await probeFn();
        timed[index] = Math.max(0, now() - started);
      } catch {
        stalls++;
        if (stopOnStall) {
          return {
            status: 'blocked',
            median: null,
            jitter: null,
            jitterFloor: false,
            stalls,
            slowSamples: 0,
            samples: timed.filter(Number.isFinite).map(Math.round)
          };
        }
      }
    }
    const values = timed.filter(Number.isFinite);
    if (!values.length) {
      return { status: 'blocked', median: null, jitter: null, jitterFloor: false, stalls, slowSamples: 0, samples: [] };
    }

    const center = median(values);
    const differences = timed.slice(1).flatMap((value, index) =>
      Number.isFinite(value) && Number.isFinite(timed[index]) ? [Math.abs(value - timed[index])] : []
    );
    const rawJitter = differences.length ? median(differences) : null;
    return {
      status: 'reached',
      median: center,
      jitter: rawJitter,
      jitterFloor: rawJitter !== null && rawJitter < 2,
      stalls,
      slowSamples: values.filter((value) => value > center * 3).length,
      samples: values.map(Math.round)
    };
  }

  async function measureParallelSamples({ probe: probeFn, samples = 8 }) {
    try {
      await probeFn();
    } catch {
      return { status: 'blocked', median: null, jitter: null, jitterFloor: false, stalls: 0, slowSamples: 0, samples: [] };
    }
    const settled = await Promise.allSettled(Array.from({ length: samples }, () => probeFn()));
    const values = settled
      .filter((item) => item.status === 'fulfilled' && Number.isFinite(item.value) && item.value >= 0)
      .map((item) => item.value);
    const stalls = settled.length - values.length;
    if (!values.length) {
      return { status: 'blocked', median: null, jitter: null, jitterFloor: false, stalls, slowSamples: 0, samples: [] };
    }
    const center = median(values);
    const differences = values.slice(1).map((value, index) => Math.abs(value - values[index]));
    const rawJitter = differences.length ? median(differences) : null;
    return {
      status: 'reached',
      median: center,
      jitter: rawJitter,
      jitterFloor: rawJitter !== null && rawJitter < 2,
      stalls,
      slowSamples: values.filter((value) => value > center * 3).length,
      samples: values.map(Math.round)
    };
  }

  async function measureUntil({ probe: probeFn, stop, samples = 8 }) {
    const values = [];
    let stalls = 0;
    let stopped = false;
    const stopPromise = Promise.resolve(stop).then(() => {
      stopped = true;
      return { kind: 'stop' };
    });
    for (let index = 0; index < samples; index++) {
      if (stopped) break;
      const measurement = Promise.resolve().then(probeFn).then(
        (value) => ({ kind: 'sample', value }),
        () => ({ kind: 'failed' })
      );
      const result = await Promise.race([measurement, stopPromise]);
      if (result.kind === 'stop') break;
      if (result.kind !== 'sample' || !Number.isFinite(result.value) || result.value < 0) stalls++;
      else values.push(result.value);
    }
    return { samples: values, stalls };
  }

  // Spec 4.4 & B4: download sufficiency from a fixed hash-named blob, catching local cache hits via transferSize,
  // measuring first byte to last byte, and capping the reported sufficiency figure at 67 Mbit/s (8 MiB / 1 s).
  async function measureDownload(download, {
    url: explicitUrl = null,
    baseUrl = typeof location !== 'undefined' ? location.href : 'https://linecheck.avd-ops.dev/',
    fetchImpl = globalThis.fetch,
    getEntries = null,
    getEntriesByName = (href) => (globalThis.performance && globalThis.performance.getEntriesByName ? globalThis.performance.getEntriesByName(href, 'resource') : []),
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
    timeoutMs = 15000
  } = {}) {
    if (!download || !download.path || !download.bytes) {
      return { status: 'unknown', mbps: null, reportedMbps: null, rawMbps: null, capped: false, elapsed: 0, loadedLatencyEligible: false };
    }
    const url = explicitUrl ? new URL(explicitUrl, baseUrl) : new URL(download.path, baseUrl);
    const resolveEntries = getEntries || getEntriesByName;
    const fetchOnce = async (cacheMode) => {
      const controller = new AbortController();
      const timer = setTimer(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url.href, {
          cache: cacheMode,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: controller.signal
        });
        if (!response || !response.ok) throw new Error('Download did not complete');
        const bytes = await response.arrayBuffer();
        if (!bytes || bytes.byteLength !== download.bytes) throw new Error('Download size did not match the pack');
        const entries = resolveEntries(url.href) || [];
        const entry = entries[entries.length - 1] || null;
        return { entry, size: bytes.byteLength };
      } finally {
        clearTimer(timer);
      }
    };

    let res = await fetchOnce('default');
    if (!res.entry || typeof res.entry.transferSize !== 'number' || res.entry.transferSize === 0 || res.entry.transferSize < download.bytes) {
      res = await fetchOnce('reload');
    }
    if (!res.entry || typeof res.entry.transferSize !== 'number' || res.entry.transferSize === 0 || res.entry.transferSize < download.bytes) {
      return { status: 'unknown', mbps: null, reportedMbps: null, rawMbps: null, capped: false, elapsed: 0, loadedLatencyEligible: false };
    }
    const elapsed = res.entry.responseEnd - res.entry.responseStart;
    if (!Number.isFinite(elapsed) || elapsed <= 0) {
      return { status: 'unknown', mbps: null, reportedMbps: null, rawMbps: null, capped: false, elapsed: 0, loadedLatencyEligible: false };
    }
    const rawMbps = (download.bytes * 8) / (elapsed * 1000);
    const capped = rawMbps >= MAX_SUFFICIENCY_MBPS;
    const mbps = Math.min(MAX_SUFFICIENCY_MBPS, Math.round(rawMbps * 10) / 10);
    const reportedMbps = capped ? MAX_SUFFICIENCY_MBPS : mbps;
    return {
      status: 'measured',
      mbps,
      reportedMbps,
      rawMbps: Math.round(rawMbps * 10) / 10,
      capped,
      elapsed: Math.round(elapsed),
      loadedLatencyEligible: elapsed >= 3000
    };
  }

  // Spec section 5 & B5: runs Reachability, Jitter (serial), Region ranking, and Target region (serial) through
  // the shared portal engine's probe.run with per-step deadlines and an 85-second whole-run deadline.
  async function runProbePhases({
    targets = [],
    primaryHost = null,
    regions = [],
    regionMap,
    targetRegion = null,
    targetRegionId = null,
    env = null,
    now = null,
    probeImpl = null,
    deadlineMs = 85000,
    onProgress = null
  } = {}) {
    if (!probe || typeof probe.run !== 'function') {
      throw new Error('AvdOpsEngine.probe is required for runProbePhases');
    }
    const resolvedPrimary = primaryHost || (targets[0] && targets[0].host) || null;
    const resolvedTarget = targetRegion || (targetRegionId ? regions.find((r) => r.id === targetRegionId) : null);
    const reachHosts = targets.map((t) => t.host);
    const regHosts = regions.map((r) => regionalHost(regionMap, r));
    const targetHost = resolvedTarget ? [regionalHost(regionMap, resolvedTarget)] : [];
    const resolvedEnv = env || (probeImpl || now ? {
      fetch: probeImpl || ((url, init) => globalThis.fetch(url, init)),
      now: now || (() => performance.now()),
      dateNow: Date.now,
      random: Math.random,
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)),
      clearTimeout: (id) => clearTimeout(id),
      AbortController
    } : undefined);
    const phases = [
      {
        name: 'Reachability',
        targets: reachHosts,
        concurrency: 3,
        deadlineMs: 20000,
        opts: { samples: 8, timeoutMs: 4000, method: 'HEAD', param: 'linecheck', warmUp: true, countStalls: true }
      },
      {
        name: 'Jitter',
        targets: resolvedPrimary ? [resolvedPrimary] : [],
        concurrency: 1,
        deadlineMs: 10000,
        opts: { samples: 8, timeoutMs: 4000, method: 'HEAD', param: 'linecheck', warmUp: true, countStalls: true }
      },
      {
        name: 'Region ranking',
        targets: regHosts,
        concurrency: (regionMap && regionMap.measurement && regionMap.measurement.concurrency) || 3,
        deadlineMs: 25000,
        opts: {
          samples: (regionMap && regionMap.measurement && regionMap.measurement.samples) || 5,
          timeoutMs: (regionMap && regionMap.measurement && regionMap.measurement.timeoutMs) || 4000,
          method: (regionMap && regionMap.measurement && regionMap.measurement.method) || 'GET',
          param: 'linecheck',
          warmUp: true,
          countStalls: false
        }
      },
      {
        name: 'Target region',
        targets: targetHost,
        concurrency: 1,
        deadlineMs: 10000,
        opts: { samples: 8, timeoutMs: 4000, method: 'GET', param: 'linecheck', warmUp: true, countStalls: false }
      }
    ];
    if (typeof onProgress === 'function') onProgress('Reachability');
    const [reachOut, jitterOut, regionOut, targetOut] = await probe.run(phases, { deadlineMs, env: resolvedEnv });
    if (typeof onProgress === 'function') {
      onProgress('Jitter');
      onProgress('Region ranking');
      if (resolvedTarget) onProgress('Target region');
    }
    const toMeasurement = (m) => {
      if (!m || m.median === null || m.median === undefined) {
        return { status: 'blocked', median: null, jitter: null, stalls: m ? (m.stalls || 0) : 0, slowSamples: null, samples: (m && m.samples) || [] };
      }
      const center = m.median;
      const samples = m.samples || [];
      return {
        status: 'reached',
        median: center,
        jitter: m.jitter ?? null,
        stalls: m.stalls || 0,
        slowSamples: samples.filter((v) => v > center * 3).length,
        samples
      };
    };
    const hostResults = targets.map((target, idx) => ({
      target,
      result: toMeasurement(reachOut && reachOut[idx])
    }));
    const jitterResult = toMeasurement(jitterOut && jitterOut[0]);
    const regionResults = regions.map((region, idx) => ({
      region,
      result: toMeasurement(regionOut && regionOut[idx])
    }));
    const targetRegionResult = resolvedTarget
      ? { regionId: resolvedTarget.id, result: toMeasurement(targetOut && targetOut[0]) }
      : null;
    return {
      reachOut,
      jitterOut,
      regionOut,
      targetOut,
      hostResults,
      jitterResult,
      regionResults,
      targetRegionResult
    };
  }

  return {
    MAX_SUFFICIENCY_MBPS,
    isPublicHost,
    validatePack,
    regionalHost,
    connectOrigins,
    probeTargets,
    selectRegions,
    median,
    probeOnce,
    measureSamples,
    measureParallelSamples,
    measureUntil,
    measureDownload,
    runProbePhases
  };
});
