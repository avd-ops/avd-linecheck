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
    'wildcard-endpoints', 'dns', 'dns.origin', 'setup.max', 'packet-loss', 'vantage'
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
        !host || !/^[a-z][a-z0-9.-]*$/.test(host.id) || RESERVED_IDS.has(host.id) || seen.has(host.id) || hostIds.has(host.id) ||
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
    if (!regionMap || !region || !/^[a-z0-9]+$/.test(region.id)) {
      throw new TypeError('Regional host is not in the pinned public map');
    }
    const isGov = region.cloud === 'gov' || /^usgov/.test(region.id);
    const tpl = isGov ? regionMap.govHostTemplate : regionMap.hostTemplate;
    const expectedTpl = isGov ? '{region}.api.cognitive.microsoft.us' : '{region}.api.cognitive.microsoft.com';
    if (tpl !== expectedTpl) {
      throw new TypeError('Regional host is not in the pinned public map');
    }
    return tpl.replace('{region}', region.id);
  }

  function regionsForCloud(regionMap, cloud = 'commercial') {
    if (!regionMap) return [];
    if (cloud === 'gov') return Array.isArray(regionMap.govRegions) ? regionMap.govRegions : [];
    return Array.isArray(regionMap.regions) ? regionMap.regions : [];
  }

  function connectOrigins(packs, endpointMap, regionMap) {
    const endpoints = endpointById(endpointMap);
    const hosts = [];
    for (const pack of packs) {
      const cloudRegions = pack.cloud === 'gov' && regionMap.govRegions ? regionMap.govRegions : regionMap.regions;
      validatePack(pack, endpointMap, cloudRegions);
      for (const id of pack.endpointIds) hosts.push(endpoints.get(id).host);
      for (const host of pack.hosts) hosts.push(host.host);
      if (pack.regionalProbe) {
        for (const region of regionMap.regions) hosts.push(regionalHost(regionMap, region));
        for (const region of regionMap.govRegions || []) hosts.push(regionalHost(regionMap, region));
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

  function combineWorkloadTargets(packs, endpointMap) {
    const list = Array.isArray(packs) ? packs : [];
    const byHost = new Map();
    for (const pack of list) {
      for (const target of probeTargets(pack, endpointMap)) {
        const existing = byHost.get(target.host);
        if (!existing) {
          byHost.set(target.host, { ...target });
        } else if (target.required && !existing.required) {
          existing.required = true;
          if (target.claim && !existing.claim) existing.claim = target.claim;
        }
      }
    }
    return [...byHost.values()];
  }

  function sameOriginDnsHint(navEntries) {
    let entries = navEntries;
    if (!entries && typeof globalThis.performance !== 'undefined' && typeof globalThis.performance.getEntriesByType === 'function') {
      entries = globalThis.performance.getEntriesByType('navigation');
    }
    const nav = Array.isArray(entries) && entries.length ? entries[0] : null;
    if (!nav || !Number.isFinite(nav.domainLookupStart) || !Number.isFinite(nav.domainLookupEnd)) return null;
    const delta = nav.domainLookupEnd - nav.domainLookupStart;
    if (!Number.isFinite(delta) || delta <= 0) return null;
    return Math.round(delta);
  }

  async function detectWebClientCapabilities(env = {}) {
    const g = env.global || (typeof globalThis !== 'undefined' ? globalThis : {});
    const nav = env.navigator || g.navigator || {};
    const videoDecoder = env.VideoDecoder !== undefined ? env.VideoDecoder : g.VideoDecoder;
    let h264 = false;
    let av1 = false;
    if (videoDecoder && typeof videoDecoder.isConfigSupported === 'function') {
      try {
        const h264Res = await videoDecoder.isConfigSupported({ codec: 'avc1.42001E' });
        h264 = Boolean(h264Res && h264Res.supported);
      } catch {
        h264 = false;
      }
      try {
        const av1Res = await videoDecoder.isConfigSupported({ codec: 'av01.0.04M.08' });
        av1 = Boolean(av1Res && av1Res.supported);
      } catch {
        av1 = false;
      }
    }
    const clipboard = Boolean(
      nav.clipboard && (typeof nav.clipboard.readText === 'function' || typeof nav.clipboard.writeText === 'function')
    );
    const getScreenDetailsFn = env.getScreenDetails !== undefined ? env.getScreenDetails : g.getScreenDetails;
    const multiScreen = typeof getScreenDetailsFn === 'function';
    return {
      webCodecs: Boolean(videoDecoder && typeof videoDecoder.isConfigSupported === 'function'),
      h264,
      av1,
      clipboard,
      multiScreen
    };
  }

  function buildHelpdeskUrl({
    baseUrl = typeof location !== 'undefined' ? location.href : 'https://linecheck.avd-ops.dev/',
    cloud = 'commercial',
    pack = '',
    workloads = [],
    region = '',
    lite = false
  } = {}) {
    const url = new URL(baseUrl);
    url.search = '';
    url.hash = '';
    if (cloud === 'gov') url.searchParams.set('cloud', 'gov');
    const cleanWorkloads = Array.isArray(workloads)
      ? [...new Set(workloads.filter((w) => ['avd', 'w365', 'teams', 'm365'].includes(w)))]
      : [];
    if (cleanWorkloads.length > 1) {
      url.searchParams.set('workloads', cleanWorkloads.join(','));
    } else if (cleanWorkloads.length === 1) {
      const single = cleanWorkloads[0];
      url.searchParams.set('pack', single === 'avd' && cloud === 'gov' ? 'avd-gov' : single);
    } else if (pack && ['generic', 'avd', 'avd-gov', 'w365', 'teams', 'm365'].includes(pack)) {
      url.searchParams.set('pack', pack === 'avd' && cloud === 'gov' ? 'avd-gov' : pack);
    }
    if (typeof region === 'string' && /^[a-z0-9]+$/.test(region)) {
      url.searchParams.set('region', region);
    }
    if (lite) {
      url.searchParams.set('lite', '1');
    }
    return url.href;
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
    let warmUpMs = null;
    try {
      const wStart = now();
      const wRet = await probeFn();
      const wElapsed = Math.max(0, now() - wStart);
      warmUpMs = wElapsed > 0 ? wElapsed : Number.isFinite(wRet) && wRet >= 0 ? wRet : wElapsed;
    } catch {
      return { status: 'blocked', median: null, warmUpMs: null, setupMs: null, jitter: null, jitterFloor: false, stalls: 0, slowSamples: 0, samples: [] };
    }

    const timed = new Array(samples).fill(null);
    let stalls = 0;
    for (let index = 0; index < samples; index++) {
      const started = now();
      try {
        const sRet = await probeFn();
        const sElapsed = Math.max(0, now() - started);
        timed[index] = sElapsed > 0 ? sElapsed : Number.isFinite(sRet) && sRet >= 0 ? sRet : sElapsed;
      } catch {
        stalls++;
        if (stopOnStall) {
          return {
            status: 'blocked',
            median: null,
            warmUpMs: Math.round(warmUpMs),
            setupMs: null,
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
      return { status: 'blocked', median: null, warmUpMs: Math.round(warmUpMs), setupMs: null, jitter: null, jitterFloor: false, stalls, slowSamples: 0, samples: [] };
    }

    const center = median(values);
    const setupMs = Number.isFinite(warmUpMs) && Number.isFinite(center) ? Math.max(0, Math.round(warmUpMs - center)) : null;
    const differences = timed.slice(1).flatMap((value, index) =>
      Number.isFinite(value) && Number.isFinite(timed[index]) ? [Math.abs(value - timed[index])] : []
    );
    const rawJitter = differences.length ? median(differences) : null;
    return {
      status: 'reached',
      median: center,
      warmUpMs: Math.round(warmUpMs),
      setupMs,
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
    const baseFetch = (env && env.fetch) || probeImpl || ((url, init) => globalThis.fetch(url, init));
    const baseNow = (env && env.now) || now || (() => performance.now());
    const reachHostSet = new Set(reachHosts);
    const reachWarmUps = new Map();
    const wrappedFetch = (url, init) => {
      let host = null;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch { /* ignore */ }
      if (!host || !reachHostSet.has(host) || reachWarmUps.has(host)) {
        return baseFetch(url, init);
      }
      const t0 = baseNow();
      return Promise.resolve().then(() => baseFetch(url, init)).then((res) => {
        if (!reachWarmUps.has(host)) {
          reachWarmUps.set(host, Math.max(0, baseNow() - t0));
        }
        return res;
      });
    };
    const resolvedEnv = {
      ...(env || {}),
      fetch: wrappedFetch,
      now: baseNow,
      dateNow: (env && env.dateNow) || Date.now,
      random: (env && env.random) || Math.random,
      setTimeout: (env && env.setTimeout) || (probeImpl || now ? (fn, ms) => setTimeout(fn, Math.min(ms, 5)) : (fn, ms) => setTimeout(fn, ms)),
      clearTimeout: (env && env.clearTimeout) || ((id) => clearTimeout(id)),
      AbortController: (env && env.AbortController) || AbortController
    };
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
    const toMeasurement = (m, warmUpOverride = null) => {
      if (!m || m.median === null || m.median === undefined) {
        return {
          status: 'blocked',
          median: null,
          warmUpMs: Number.isFinite(warmUpOverride) ? Math.round(warmUpOverride) : null,
          setupMs: null,
          jitter: null,
          stalls: m ? (m.stalls || 0) : 0,
          slowSamples: null,
          samples: (m && m.samples) || []
        };
      }
      const center = Math.round(m.median);
      const samples = m.samples || [];
      const warmUpMs = Number.isFinite(warmUpOverride) ? Math.round(warmUpOverride) : null;
      const setupMs = warmUpMs !== null ? Math.max(0, Math.round(warmUpMs - center)) : null;
      return {
        status: 'reached',
        median: center,
        warmUpMs,
        setupMs,
        jitter: m.jitter ?? null,
        stalls: m.stalls || 0,
        slowSamples: samples.filter((v) => v > center * 3).length,
        samples
      };
    };
    const hostResults = targets.map((target, idx) => ({
      target,
      result: toMeasurement(reachOut && reachOut[idx], reachWarmUps.get(target.host.toLowerCase()))
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

  // Optional v2a server probe client helpers (docs/spec.md section 10, off by default unless a pack configures probe).
  async function probeEchoTiming(echoUrl, {
    fetchImpl = globalThis.fetch,
    getEntriesByName = (href) => (globalThis.performance && globalThis.performance.getEntriesByName ? globalThis.performance.getEntriesByName(href, 'resource') : []),
    now = () => (globalThis.performance ? globalThis.performance.now() : Date.now())
  } = {}) {
    const started = now();
    try {
      const response = await fetchImpl(echoUrl, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer'
      });
      const elapsed = Math.max(0, Math.round(now() - started));
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const authentic = Boolean(response && response.ok && body && body.schema === 'avd-linecheck-echo/v1' && body.ok === true);
      const entries = getEntriesByName ? getEntriesByName(echoUrl) : [];
      const entry = entries && entries.length ? entries[entries.length - 1] : null;
      const span = (a, b) => (entry && Number.isFinite(entry[a]) && Number.isFinite(entry[b]) && entry[b] >= entry[a] && entry[b] > 0)
        ? Math.round(entry[b] - entry[a])
        : null;

      return {
        status: authentic ? 'reached' : 'intercepted',
        proxyIntercepted: !authentic,
        httpStatus: response ? response.status : null,
        totalMs: elapsed,
        dnsMs: span('domainLookupStart', 'domainLookupEnd'),
        tcpMs: span('connectStart', 'connectEnd'),
        tlsMs: entry && Number.isFinite(entry.secureConnectionStart) && entry.secureConnectionStart > 0
          ? span('secureConnectionStart', 'connectEnd')
          : null,
        ttfbMs: span('requestStart', 'responseStart')
      };
    } catch {
      return {
        status: 'blocked',
        proxyIntercepted: false,
        httpStatus: null,
        totalMs: null,
        dnsMs: null,
        tcpMs: null,
        tlsMs: null,
        ttfbMs: null
      };
    }
  }

  async function measureUpload(sinkUrl, {
    bytes = 1048576,
    fetchImpl = globalThis.fetch,
    now = () => (globalThis.performance ? globalThis.performance.now() : Date.now())
  } = {}) {
    const clampedBytes = Math.max(1024, Math.min(16 * 1024 * 1024, Number(bytes) || 1048576));
    const payload = new Uint8Array(clampedBytes);
    const started = now();
    try {
      const response = await fetchImpl(sinkUrl, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: payload
      });
      const durationMs = Math.max(1, Math.round(now() - started));
      if (!response || !response.ok) {
        return { status: 'blocked', bytes: 0, durationMs, mbps: null };
      }
      const body = await response.json();
      if (!body || body.schema !== 'avd-linecheck-sink/v1' || body.ok !== true) {
        return { status: 'blocked', bytes: 0, durationMs, mbps: null };
      }
      const received = Number(body.receivedBytes) || clampedBytes;
      const mbps = Number(((received * 8) / (durationMs / 1000) / 1e6).toFixed(1));
      return {
        status: 'measured',
        bytes: received,
        durationMs,
        mbps
      };
    } catch {
      return { status: 'blocked', bytes: 0, durationMs: null, mbps: null };
    }
  }

  return {
    MAX_SUFFICIENCY_MBPS,
    isPublicHost,
    validatePack,
    regionalHost,
    regionsForCloud,
    connectOrigins,
    probeTargets,
    combineWorkloadTargets,
    sameOriginDnsHint,
    detectWebClientCapabilities,
    buildHelpdeskUrl,
    selectRegions,
    median,
    probeOnce,
    measureSamples,
    measureParallelSamples,
    measureUntil,
    measureDownload,
    runProbePhases,
    probeEchoTiming,
    measureUpload
  };
});
