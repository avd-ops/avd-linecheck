/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT.
   export.js: pure export builder, personal-data scrubber, assessment intake helper, and shared-result parser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./verdict.js'));
  } else {
    root.LinecheckExport = factory(root.LinecheckVerdict);
  }
})(typeof self !== 'undefined' ? self : this, function (verdict) {
  'use strict';

  const SEVERITY = { blocked: 5, fail: 4, unknown: 3, warn: 2, pass: 1, info: 0 };
  const KNOWN_HOST_SUFFIXES = [
    'microsoft.com', 'microsoftonline.com', 'microsoftonline.us', 'microsoft.us', 'azure.us', 'cloud.microsoft', 'windows.net', 'office.com', 'aka.ms'
  ];
  const SYMPTOM_IDS = [
    'slow-typing',
    'frozen-blurry-screen',
    'teams-audio-video',
    'disconnects',
    'sign-in',
    'printing',
    'slow-apps'
  ];
  const SYMPTOM_LABELS = {
    'slow-typing': 'Slow typing',
    'frozen-blurry-screen': 'Frozen or blurry screen',
    'teams-audio-video': 'Teams audio or video',
    'disconnects': 'Disconnects',
    'sign-in': 'Sign-in',
    'printing': 'Printing',
    'slow-apps': 'Slow apps'
  };

  function hasCustomHosts(pack) {
    return ((pack && pack.hosts) || []).some(({ host }) =>
      !KNOWN_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
    );
  }

  function validateSentiment(input) {
    if (!input || typeof input !== 'object') return null;
    const rating = Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5 ? input.rating : null;
    const symptoms = Array.isArray(input.symptoms)
      ? [...new Set(input.symptoms.filter((s) => SYMPTOM_IDS.includes(s)))]
      : [];
    if (rating === null && !symptoms.length) return null;
    return { rating, symptoms };
  }

  function safeFinding(finding, allowedIds, pack) {
    if (!finding || !allowedIds.has(finding.id) || !Object.hasOwn(SEVERITY, finding.status)) return null;
    const status = finding.status === 'blocked' && finding.required !== true ? 'unknown' : finding.status;
    const customHost = hasCustomHosts(pack) && pack.hosts ? pack.hosts.find((host) => host.id === finding.id) : null;
    const claim = typeof finding.claim === 'string' && /^ref:[a-z0-9-]+#[a-z0-9-]+$/.test(finding.claim) ? finding.claim : null;
    const unit = ['ms', 'Mbit/s', 'count'].includes(finding.unit) ? finding.unit : null;
    const setupMs = Number.isFinite(finding.setupMs) && finding.setupMs >= 0 ? Math.round(finding.setupMs) : null;
    return {
      id: finding.id,
      status,
      required: finding.required === true,
      value: Number.isFinite(finding.value) ? Math.round(finding.value) : null,
      unit,
      ...(setupMs !== null ? { setupMs } : {}),
      threshold: typeof finding.threshold === 'string' && finding.threshold.length <= 32 ? finding.threshold : null,
      claim,
      ...(customHost ? { host: customHost.host, purpose: customHost.purpose } : {}),
      sentence: verdict.findingSentence(status)
    };
  }

  const CAVEAT_CLAIMS = {
    'proxy-or-tunnel': ['ref:avd-proxy#bypass-proxies', 'ref:rdp-traffic-optimization#bypass-tunnels'],
    'uniform-host-timing': ['ref:avd-proxy#bypass-proxies', 'ref:rdp-traffic-optimization#bypass-tunnels'],
    'geography-mismatch': ['ref:rdp-traffic-optimization#local-egress', 'ref:rdp-traffic-optimization#bypass-tunnels'],
    'high-setup-overhead': ['ref:avd-proxy#bypass-proxies', 'ref:rdp-traffic-optimization#no-tls-inspection']
  };
  const CAVEAT_SENTENCES = {
    'proxy-or-tunnel': 'A proxy, VPN or security agent may be carrying this traffic; the result is about that path.',
    'uniform-host-timing': 'All checked hosts answered within 5 ms of each other. A local proxy, VPN or secure web gateway may be terminating HTTPS close to this browser.',
    'geography-mismatch': 'The fastest measured region is outside your selected geography. Traffic may be egressing through a remote VPN or tunnel.',
    'high-setup-overhead': 'First-request connection setup took at least 250 ms longer than warm requests on one or more hosts. A slow DNS resolver or a TLS-inspecting proxy may be adding handshake overhead.'
  };

  function safeCaveats(caveats) {
    if (!Array.isArray(caveats)) return [];
    const allowedReasons = new Set(['uniform-host-timing', 'geography-mismatch', 'high-setup-overhead']);
    return caveats
      .filter((c) => c && Object.hasOwn(CAVEAT_CLAIMS, c.id))
      .map((c) => ({
        id: c.id,
        reasons: Array.isArray(c.reasons) ? c.reasons.filter((r) => allowedReasons.has(r)) : [c.id],
        sentence: CAVEAT_SENTENCES[c.id],
        claims: CAVEAT_CLAIMS[c.id]
      }));
  }

  function safeWebClient(input) {
    if (!input || typeof input !== 'object') return null;
    if (
      typeof input.webCodecs !== 'boolean' &&
      typeof input.h264 !== 'boolean' &&
      typeof input.av1 !== 'boolean' &&
      typeof input.clipboard !== 'boolean' &&
      typeof input.multiScreen !== 'boolean'
    ) {
      return null;
    }
    return {
      webCodecs: Boolean(input.webCodecs),
      h264: Boolean(input.h264),
      av1: Boolean(input.av1),
      clipboard: Boolean(input.clipboard),
      multiScreen: Boolean(input.multiScreen)
    };
  }

  function makeExport(run) {
    const allowedIds = new Set((run.pack && (run.pack.allowedFindingIds || run.pack.endpointIds)) || []);
    const rawFindings = Array.isArray(run.findings) ? run.findings : [];
    const safeFindings = rawFindings.map((finding) => safeFinding(finding, allowedIds, run.pack)).filter(Boolean);
    const regions = safeFindings.filter((finding) => finding.id.startsWith('region.') && finding.status === 'info' && Number.isFinite(finding.value));
    const sharedRegions = run.fullRegions ? regions : [...regions].sort((a, b) => a.value - b.value).slice(0, 3);
    const sharedRegionIds = new Set(sharedRegions.map((finding) => finding.id));
    const findings = safeFindings.filter((finding) => !finding.id.startsWith('region.') || sharedRegionIds.has(finding.id));
    const date = new Date(run.createdAt);
    if (Number.isNaN(date.valueOf())) throw new TypeError('Result date is invalid');
    const family = ['Chrome', 'Chromium', 'Edge', 'Firefox', 'Safari', 'Other'].includes(run.browser && run.browser.family) ? run.browser.family : 'Other';
    const major = Number.isInteger(run.browser && run.browser.major) && run.browser.major >= 0 ? run.browser.major : null;
    const platform = ['desktop', 'tablet', 'phone'].includes(run.platform) ? run.platform : 'unknown';
    const region = typeof run.region === 'string' && /^[a-z0-9]+$/.test(run.region) ? run.region : null;
    const notTested = [...new Set((run.notTested || []).filter((id) => allowedIds.has(id)))];
    const vantage = ['device', 'likely-session-host', 'unknown'].includes(run.vantage) ? run.vantage : 'unknown';
    const overall = verdict.overallVerdict(
      rawFindings.filter((finding) => finding && finding.required === true),
      { vantage: vantage === 'likely-session-host' ? 'likely-session-host' : 'device' }
    );
    const sentiment = validateSentiment(run.sentiment);
    const caveats = safeCaveats(run.caveats);
    const cloud = run.cloud === 'gov' || (run.pack && run.pack.cloud === 'gov') ? 'gov' : 'commercial';
    const workloads = Array.isArray(run.workloads)
      ? [...new Set(run.workloads.filter((w) => ['avd', 'w365', 'teams', 'm365'].includes(w)))]
      : [];
    const webClient = safeWebClient(run.webClient);

    return {
      schemaVersion: 1,
      toolVersion: '0.1.0',
      pack: { id: run.pack.id, version: run.pack.version },
      cloud,
      ...(workloads.length ? { workloads } : {}),
      custom: hasCustomHosts(run.pack),
      createdAt: `${date.toISOString().slice(0, 16)}Z`,
      browser: { family, major },
      platform,
      region,
      regionScope: run.fullRegions ? 'all-measured' : 'top-three',
      vantage,
      ...(webClient ? { webClient } : {}),
      ...(sentiment ? { sentiment } : {}),
      ...(caveats.length ? { caveats } : {}),
      overall,
      findings,
      notTested
    };
  }

  // Spec 6.5: formats a safe export as an intake.userNetworks evidence record for avd-assess / avd-current-state.
  function makeIntakeEntry(input) {
    const exportedResult = input && input.schemaVersion === 1 ? input : makeExport(input);
    const findings = Array.isArray(exportedResult.findings) ? exportedResult.findings : [];
    const reqEndpoints = findings.filter((f) => f.required && f.id !== 'target-region');
    const allowsClientEndpoints = !reqEndpoints.length
      ? 'unknown'
      : reqEndpoints.every((f) => f.status === 'pass')
        ? 'yes'
        : reqEndpoints.some((f) => f.status === 'blocked')
          ? 'no'
          : 'unknown';
    const hasCaveat = Array.isArray(exportedResult.caveats) && exportedResult.caveats.length > 0;
    const hasBlocked = reqEndpoints.some((f) => f.status === 'blocked');
    const proxyInPath = hasCaveat || hasBlocked ? 'possible' : 'unknown';
    const candidateRegionsRttMs = {};
    const topRegions = [];
    for (const f of findings) {
      if (f.id.startsWith('region.') && Number.isFinite(f.value)) {
        const regId = f.id.slice('region.'.length);
        candidateRegionsRttMs[regId] = f.value;
        topRegions.push({ id: regId, medianMs: f.value });
      }
    }
    const targetFinding = findings.find((f) => f.id === 'target-region' && Number.isFinite(f.value));
    if (exportedResult.region && targetFinding) {
      candidateRegionsRttMs[exportedResult.region] = targetFinding.value;
      if (!topRegions.some((r) => r.id === exportedResult.region)) {
        topRegions.push({ id: exportedResult.region, medianMs: targetFinding.value });
      }
    }
    const jitterFinding = findings.find((f) => f.id === 'jitter.primary' && Number.isFinite(f.value));
    const downloadFinding = findings.find((f) => f.id === 'download' && Number.isFinite(f.value));
    const claims = [...new Set(findings.map((f) => f.claim).filter(Boolean))];
    return {
      schema: 'avd-assess-user-network/v1',
      area: 'network.client',
      dimension: 'network.client',
      pack: exportedResult.pack,
      createdAt: exportedResult.createdAt,
      measuredAt: exportedResult.createdAt,
      vantage: exportedResult.vantage,
      overall: exportedResult.overall,
      allowsClientEndpoints,
      outboundUdpAllowed: 'unknown',
      proxyInPath,
      targetRegion: exportedResult.region,
      targetRegionMedianMs: targetFinding ? targetFinding.value : null,
      jitterMs: jitterFinding ? jitterFinding.value : null,
      downloadMbps: downloadFinding ? downloadFinding.value : null,
      topRegions,
      candidateRegionsRttMs,
      ...(exportedResult.sentiment ? { sentiment: exportedResult.sentiment } : {}),
      ...(exportedResult.caveats ? { caveats: exportedResult.caveats } : {}),
      claims
    };
  }

  function parseSharedResult(text, packOrMap) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new TypeError('Result is not valid JSON');
    }
    if (!value || value.schemaVersion !== 1 || !value.pack || !Array.isArray(value.findings)) {
      throw new TypeError('Result format or pack is not supported');
    }
    let pack = null;
    if (packOrMap && typeof packOrMap.id === 'string') {
      if (value.pack.id === packOrMap.id) pack = packOrMap;
    } else if (packOrMap && typeof packOrMap === 'object') {
      pack = packOrMap[value.pack.id] || null;
    }
    if (!pack) {
      throw new TypeError('Result format or pack is not supported');
    }
    const allowedIds = new Set(pack.allowedFindingIds || pack.endpointIds || []);
    const findings = value.findings.map((finding) => safeFinding(finding, allowedIds, pack)).filter(Boolean);
    const vantage = ['device', 'likely-session-host', 'unknown'].includes(value.vantage) ? value.vantage : 'unknown';
    const sentiment = validateSentiment(value.sentiment);
    const caveats = safeCaveats(value.caveats);
    const cloud = value.cloud === 'gov' || pack.cloud === 'gov' ? 'gov' : 'commercial';
    const workloads = Array.isArray(value.workloads)
      ? [...new Set(value.workloads.filter((w) => ['avd', 'w365', 'teams', 'm365'].includes(w)))]
      : [];
    const webClient = safeWebClient(value.webClient);
    return {
      pack: { id: pack.id, version: pack.version },
      cloud,
      ...(workloads.length ? { workloads } : {}),
      custom: hasCustomHosts(pack),
      sentencesAvailable: value.pack.version === pack.version,
      vantage,
      ...(webClient ? { webClient } : {}),
      ...(sentiment ? { sentiment } : {}),
      ...(caveats.length ? { caveats } : {}),
      overall: verdict.overallVerdict(findings, { vantage: vantage === 'likely-session-host' ? 'likely-session-host' : 'device' }),
      findings
    };
  }

  function compareResults(baseline, current) {
    if (!baseline || !current || !Array.isArray(baseline.findings) || !Array.isArray(current.findings)) {
      throw new TypeError('Both baseline and current results are required for comparison');
    }
    const findMetric = (res, id) => {
      const f = res.findings.find((item) => item && item.id === id && Number.isFinite(item.value));
      return f ? f.value : null;
    };
    const fastestRegionRtt = (res) => {
      const reg = res.findings.filter((item) => item && item.id.startsWith('region.') && Number.isFinite(item.value));
      if (!reg.length) return null;
      return Math.min(...reg.map((item) => item.value));
    };
    const baseRtt = findMetric(baseline, 'target-region') ?? fastestRegionRtt(baseline);
    const currRtt = findMetric(current, 'target-region') ?? fastestRegionRtt(current);
    const rttDeltaMs = baseRtt !== null && currRtt !== null ? Math.round(currRtt - baseRtt) : null;

    const baseJitter = findMetric(baseline, 'jitter.primary');
    const currJitter = findMetric(current, 'jitter.primary');
    const jitterDeltaMs = baseJitter !== null && currJitter !== null ? Math.round(currJitter - baseJitter) : null;

    const baseById = new Map(baseline.findings.map((f) => [f.id, f]));
    const currById = new Map(current.findings.map((f) => [f.id, f]));
    const blockedCleared = [];
    const newlyBlocked = [];
    for (const [id, bf] of baseById.entries()) {
      const cf = currById.get(id);
      if (bf.status === 'blocked' && cf && cf.status === 'pass') blockedCleared.push(id);
    }
    for (const [id, cf] of currById.entries()) {
      const bf = baseById.get(id);
      if (cf.status === 'blocked' && (!bf || bf.status !== 'blocked')) newlyBlocked.push(id);
    }

    const baseCaveats = new Set((baseline.caveats || []).map((c) => c.id));
    const currCaveats = new Set((current.caveats || []).map((c) => c.id));
    const caveatsCleared = [...baseCaveats].filter((id) => !currCaveats.has(id));
    const caveatsAdded = [...currCaveats].filter((id) => !baseCaveats.has(id));

    return {
      overallBefore: baseline.overall ? baseline.overall.status : 'unknown',
      overallAfter: current.overall ? current.overall.status : 'unknown',
      baseRttMs: baseRtt,
      currRttMs: currRtt,
      rttDeltaMs,
      baseJitterMs: baseJitter,
      currJitterMs: currJitter,
      jitterDeltaMs,
      blockedCleared,
      newlyBlocked,
      caveatsCleared,
      caveatsAdded
    };
  }

  return {
    SYMPTOM_IDS,
    SYMPTOM_LABELS,
    hasCustomHosts,
    validateSentiment,
    safeWebClient,
    makeExport,
    makeIntakeEntry,
    parseSharedResult,
    compareResults
  };
});
