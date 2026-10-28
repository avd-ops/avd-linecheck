/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT.
   verdict.js: pure classification of measurements against pack thresholds, vantage check, caveats, and plain-language sentences. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./assets/engine/core.js'),
      require('./assets/engine/bands.js')
    );
  } else {
    const eng = root.AvdOpsEngine || {};
    root.LinecheckVerdict = factory(eng.core, eng.bands);
  }
})(typeof self !== 'undefined' ? self : this, function (core, bandsEngine) {
  'use strict';

  const ORDER = ['pass', 'warn', 'unknown', 'fail', 'blocked'];
  const LABELS = {
    blocked: 'Something is blocking this network',
    fail: 'Likely to affect your desktop',
    unknown: 'Could not check',
    warn: 'Usable, with warnings',
    pass: 'Good to go'
  };

  function toBandTable(packBands) {
    const list = Array.isArray(packBands) ? packBands : [];
    const firstClaim = (list[0] && list[0].claim) || 'ref:avd-connection-quality#rtt-bands';
    const rows = list.map((item, idx) => {
      if (item.otherwise) {
        const prev = list[idx - 1];
        const prevBound = prev && Number.isFinite(prev.atMost) ? prev.atMost : prev && Number.isFinite(prev.below) ? prev.below : null;
        return {
          otherwise: true,
          state: item.otherwise,
          claim: item.claim || firstClaim,
          threshold: prevBound !== null ? `> ${prevBound} ms` : null
        };
      }
      if (Number.isFinite(item.below)) {
        return {
          lt: item.below,
          state: item.state,
          claim: item.claim || firstClaim,
          threshold: `< ${item.below} ms`
        };
      }
      return {
        le: item.atMost,
        state: item.state,
        claim: item.claim || firstClaim,
        threshold: `<= ${item.atMost} ms`
      };
    });
    return {
      noAnswer: { state: 'unknown', claim: firstClaim, threshold: null },
      rows
    };
  }

  function rttFinding(value, packBands, { id = 'target-region', required = true } = {}) {
    const list = Array.isArray(packBands) ? packBands : [];
    if (!Number.isFinite(value) || value < 0 || !list.length) {
      return { id, status: 'unknown', value: null, unit: 'ms', required, claim: (list[0] && list[0].claim) || null };
    }
    const table = toBandTable(list);
    const hit = bandsEngine && typeof bandsEngine.band === 'function'
      ? bandsEngine.band(value, table)
      : { state: 'unknown', claim: table.noAnswer.claim, threshold: null };
    return {
      id,
      status: hit.state,
      value: Math.round(value),
      unit: 'ms',
      required,
      claim: hit.claim || null,
      threshold: hit.threshold || null
    };
  }

  function reachabilityFinding(target, outcome, value = null, setupMs = null) {
    const status = outcome === 'reached' ? 'pass' : outcome === 'blocked' && target.required === true ? 'blocked' : 'unknown';
    const roundedSetup = Number.isFinite(setupMs) && setupMs >= 0 ? Math.round(setupMs) : null;
    return {
      id: target.id,
      status,
      value: Number.isFinite(value) ? Math.round(value) : null,
      unit: Number.isFinite(value) ? 'ms' : null,
      ...(roundedSetup !== null ? { setupMs: roundedSetup } : {}),
      required: target.required === true,
      claim: target.claim !== undefined ? target.claim : null
    };
  }

  // Spec 4.2: if a measured regional endpoint answers in under 5 ms, the browser is almost certainly running
  // inside an Azure session host rather than on the user's own device.
  function detectVantage(regionResults) {
    const list = Array.isArray(regionResults) ? regionResults : [];
    const measured = list.filter((entry) => entry && entry.result && Number.isFinite(entry.result.median) && entry.result.median >= 0);
    if (!measured.length) return 'unknown';
    const minMs = Math.min(...measured.map((entry) => entry.result.median));
    if (minMs < 5) return 'likely-session-host';
    return 'device';
  }

  // Spec 6.6: proxy and tunnel caveats (never findings). Notices when all probed hosts answer with nearly the
  // same time (<= 5 ms spread across >= 3 hosts) or when the fastest region sits in another geography than the
  // browser's coarse timezone hint suggests.
  function detectCaveats({ hostResults = [], regionResults = [], browserGeo = null, selectedGeographies = [] } = {}) {
    const caveats = [];
    const hostMedians = (Array.isArray(hostResults) ? hostResults : [])
      .map((h) => (h && h.result && Number.isFinite(h.result.median) ? h.result.median : null))
      .filter((v) => v !== null);
    const uniformHosts = hostMedians.length >= 3 && (Math.max(...hostMedians) - Math.min(...hostMedians) <= 5);

    const ranked = rankRegions(Array.isArray(regionResults) ? regionResults : []);
    const fastest = ranked.find((r) => r && r.result && Number.isFinite(r.result.median));
    const expectedGeo = browserGeo || (Array.isArray(selectedGeographies) && selectedGeographies.length === 1 ? selectedGeographies[0] : null);
    const geoMismatch = Boolean(
      expectedGeo && fastest && fastest.region && fastest.region.geo && fastest.region.geo !== expectedGeo
    );

    const hostSetupTimes = (Array.isArray(hostResults) ? hostResults : [])
      .map((h) => (h && h.result && Number.isFinite(h.result.setupMs) ? h.result.setupMs : null))
      .filter((v) => v !== null);
    const highSetupOverhead = hostSetupTimes.some((v) => v >= 250);

    if (uniformHosts) {
      caveats.push({
        id: 'uniform-host-timing',
        reasons: ['uniform-host-timing'],
        sentence: 'All checked hosts answered within 5 ms of each other. A local proxy, VPN or secure web gateway may be terminating HTTPS close to this browser.',
        claims: ['ref:avd-proxy#bypass-proxies', 'ref:rdp-traffic-optimization#bypass-tunnels']
      });
    }
    if (geoMismatch) {
      caveats.push({
        id: 'geography-mismatch',
        reasons: ['geography-mismatch'],
        sentence: `The fastest measured region is in ${fastest.region.geo} (${fastest.region.name}), outside your selected geography (${expectedGeo}). Traffic may be egressing through a remote VPN or tunnel.`,
        claims: ['ref:rdp-traffic-optimization#local-egress', 'ref:rdp-traffic-optimization#bypass-tunnels']
      });
    }
    if (highSetupOverhead) {
      caveats.push({
        id: 'high-setup-overhead',
        reasons: ['high-setup-overhead'],
        sentence: 'First-request connection setup took at least 250 ms longer than warm requests on one or more hosts. A slow DNS resolver or a TLS-inspecting proxy may be adding handshake overhead.',
        claims: ['ref:avd-proxy#bypass-proxies', 'ref:rdp-traffic-optimization#no-tls-inspection']
      });
    }
    return caveats;
  }

  // Spec 6.1 & 6.3: Azure US Government uses direct STUN Shortpath or TCP gateway; TURN relay is Commercial-only.
  function cloudShortpathNote(cloud = 'commercial') {
    if (cloud !== 'gov') return null;
    return {
      id: 'gov-shortpath-turn',
      cloud: 'gov',
      claim: 'ref:configure-rdp-shortpath#turn-public-cloud-only',
      claims: ['ref:configure-rdp-shortpath#turn-public-cloud-only'],
      sentence: 'RDP Shortpath with TURN relay is supported only in Azure Commercial. Azure US Government uses direct STUN Shortpath or falls back to the TCP gateway.'
    };
  }

  // Spec 6.4: relay geography note when the closest TURN-capable region is far (> 150 ms).
  function relayGeographyNote(regionResults, avdTargetRegionIds = []) {
    const allow = new Set(Array.isArray(avdTargetRegionIds) ? avdTargetRegionIds : []);
    const ranked = rankRegions(Array.isArray(regionResults) ? regionResults : []);
    const candidates = allow.size
      ? ranked.filter((r) => r && r.region && allow.has(r.region.id) && r.result && Number.isFinite(r.result.median))
      : ranked.filter((r) => r && r.result && Number.isFinite(r.result.median));
    if (!candidates.length) return null;
    const nearest = candidates[0];
    if (nearest.result.median <= 150) return null;
    return {
      id: 'relay-geography',
      regionId: nearest.region.id,
      medianMs: Math.round(nearest.result.median),
      sentence: 'The closest measured region is over 150 ms away from this network; a distant relay may cause connections to fall back to TCP.',
      claims: ['ref:rdp-shortpath#turn-range', 'ref:rdp-traffic-optimization#local-egress']
    };
  }

  function overallVerdict(findings, { vantage = 'device' } = {}) {
    if (vantage === 'likely-session-host') {
      return {
        status: 'unknown',
        label: LABELS.unknown,
        note: 'This looks like it ran inside the remote desktop; the result is not about your network.'
      };
    }
    const list = Array.isArray(findings) ? findings : [];
    const required = list.filter((finding) => finding && finding.required === true);
    if (!required.length) return { status: 'unknown', label: LABELS.unknown };
    const states = required.map((f) => (ORDER.includes(f.status) ? f.status : 'unknown'));
    const worstState = bandsEngine && typeof bandsEngine.worst === 'function'
      ? bandsEngine.worst(states, ORDER)
      : states.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), 'pass');
    return { status: worstState, label: LABELS[worstState] || LABELS.unknown };
  }

  function rankRegions(results) {
    return [...(Array.isArray(results) ? results : [])].sort((a, b) => {
      const left = a && a.result && Number.isFinite(a.result.median) ? a.result.median : Infinity;
      const right = b && b.result && Number.isFinite(b.result.median) ? b.result.median : Infinity;
      return left - right || String((a && a.region && a.region.id) || '').localeCompare(String((b && b.region && b.region.id) || ''));
    });
  }

  function visibleRegions(results, selectedId, showAll, top) {
    if (showAll) return results;
    return results.filter((entry, index) => index < top || (entry && entry.region && entry.region.id === selectedId));
  }

  const PORTAL_LATENCY_TABLE = {
    noAnswer: { rating: 'No answer', claim: 'ref:avd-prerequisites#rtt-under-150' },
    rows: [
      { lt: 100, rating: 'Good', claim: 'ref:avd-insights-use-cases#rtt-ideal-100-poor-200' },
      { le: 150, rating: 'Usable', claim: 'ref:avd-prerequisites#rtt-under-150' },
      { otherwise: true, rating: 'Sluggish', claim: 'ref:avd-connection-quality#rtt-bands' }
    ]
  };

  function regionRating(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'No answer';
    if (bandsEngine && typeof bandsEngine.band === 'function') {
      return bandsEngine.band(milliseconds, PORTAL_LATENCY_TABLE).rating;
    }
    if (milliseconds < 100) return 'Good';
    if (milliseconds <= 150) return 'Usable';
    return 'Sluggish';
  }

  const SENTENCES = {
    pass: 'This check answered from this network.',
    warn: 'The measured value is outside the ideal band.',
    blocked: 'This required check did not answer from this network; a proxy or blocker may be involved.',
    fail: 'The measured value is above the cited band.',
    unknown: 'This check could not be measured.',
    info: 'This is informational and does not change the overall verdict.'
  };

  function findingSentence(status) {
    return SENTENCES[status] || SENTENCES.unknown;
  }

  function summarizeMetrics(run = {}) {
    const findings = Array.isArray(run.findings) ? run.findings : [];
    const byId = new Map(findings.filter((f) => f && f.id).map((f) => [f.id, f]));
    const regionResults = Array.isArray(run.regionResults) ? run.regionResults : [];
    const ranked = rankRegions(regionResults);
    const fastestRegion = ranked.find((r) => r && r.result && r.result.status === 'reached' && Number.isFinite(r.result.median));
    const targetRegionEntry = run.region ? regionResults.find((r) => r && r.region && r.region.id === run.region) : null;
    const targetFinding = byId.get('target-region');
    const primaryRegionEntry = targetRegionEntry || fastestRegion || null;
    const rttMs = targetFinding && Number.isFinite(targetFinding.value)
      ? Math.round(targetFinding.value)
      : primaryRegionEntry && primaryRegionEntry.result && Number.isFinite(primaryRegionEntry.result.median)
        ? Math.round(primaryRegionEntry.result.median)
        : null;
    const rttRegionLabel = targetRegionEntry && targetRegionEntry.region
      ? `${targetRegionEntry.region.name} (${targetRegionEntry.region.id})`
      : fastestRegion && fastestRegion.region
        ? `Fastest: ${fastestRegion.region.name} (${fastestRegion.region.id})`
        : run.region || 'No region measured';

    const jitterFinding = byId.get('jitter.primary');
    const jitterMs = run.jitterDetail && Number.isFinite(run.jitterDetail.jitter)
      ? Math.round(run.jitterDetail.jitter)
      : jitterFinding && Number.isFinite(jitterFinding.value)
        ? Math.round(jitterFinding.value)
        : null;
    const jitterFloor = Boolean(run.jitterDetail && run.jitterDetail.jitterFloor) || (jitterMs !== null && jitterMs < 2);

    const stallsFinding = byId.get('stalls.primary');
    const slowFinding = byId.get('slow-samples');
    const stalls = run.jitterDetail && Number.isFinite(run.jitterDetail.stalls)
      ? run.jitterDetail.stalls
      : stallsFinding && Number.isFinite(stallsFinding.value)
        ? stallsFinding.value
        : null;
    const slowSamples = run.jitterDetail && Number.isFinite(run.jitterDetail.slowSamples)
      ? run.jitterDetail.slowSamples
      : slowFinding && Number.isFinite(slowFinding.value)
        ? slowFinding.value
        : null;

    const setupFinding = byId.get('setup.max');
    const hostResults = Array.isArray(run.hostResults) ? run.hostResults : [];
    const hostSetupValues = hostResults
      .map((h) => (h && h.result && Number.isFinite(h.result.setupMs) ? Math.round(h.result.setupMs) : null))
      .filter((v) => v !== null);
    const maxSetupMs = hostSetupValues.length
      ? Math.max(...hostSetupValues)
      : setupFinding && Number.isFinite(setupFinding.value)
        ? Math.round(setupFinding.value)
        : null;

    const dlFinding = byId.get('download');
    const dlDetail = run.downloadDetail || null;
    const dlMbps = dlDetail && Number.isFinite(dlDetail.reportedMbps)
      ? dlDetail.reportedMbps
      : dlFinding && Number.isFinite(dlFinding.value)
        ? dlFinding.value
        : null;
    const dlCapped = dlDetail ? Boolean(dlDetail.capped) : (dlMbps !== null && dlMbps >= 67);

    const loadedFinding = byId.get('loaded-latency');
    const loadedMs = loadedFinding && Number.isFinite(loadedFinding.value)
      ? Math.round(loadedFinding.value)
      : null;
    const dnsFinding = byId.get('dns.origin');
    const dnsMs = Number.isFinite(run.dnsOriginMs)
      ? Math.round(run.dnsOriginMs)
      : dnsFinding && Number.isFinite(dnsFinding.value)
        ? Math.round(dnsFinding.value)
        : null;

    const cards = [
      {
        id: 'rtt',
        label: targetRegionEntry || (targetFinding && run.region) ? 'Target region RTT' : 'Nearest region RTT',
        value: rttMs !== null ? `at most ${rttMs} ms` : 'No answer',
        detail: rttMs !== null ? `${rttRegionLabel} - ${regionRating(rttMs)}` : rttRegionLabel,
        status: targetFinding ? targetFinding.status : (rttMs !== null ? (rttMs < 100 ? 'pass' : rttMs <= 200 ? 'warn' : 'fail') : 'unknown')
      },
      {
        id: 'jitter',
        label: 'Serial jitter',
        value: jitterMs !== null ? (jitterFloor ? 'Under 2 ms' : `${jitterMs} ms`) : 'Not measured',
        detail: jitterMs !== null ? '8 serial HTTPS samples to primary host' : 'Primary host did not answer',
        status: jitterMs !== null ? 'info' : 'unknown'
      },
      {
        id: 'stability',
        label: 'Sample stability',
        value: stalls !== null ? `${stalls} stalls / ${slowSamples ?? 0} slow` : 'Not measured',
        detail: 'Timed-out requests and samples > 3x median',
        status: stalls === 0 ? 'pass' : stalls !== null && stalls > 0 ? 'warn' : 'unknown'
      },
      {
        id: 'setup',
        label: 'Cold setup overhead',
        value: maxSetupMs !== null ? `+${maxSetupMs} ms max` : 'Not measured',
        detail: maxSetupMs !== null && maxSetupMs >= 250
          ? 'High first-request overhead (>= 250 ms; possible TLS proxy or slow DNS)'
          : 'Warm-up minus warm median (DNS, TCP, TLS)',
        status: maxSetupMs !== null ? (maxSetupMs >= 250 ? 'warn' : 'info') : 'unknown'
      },
      {
        id: 'download',
        label: 'Download sufficiency',
        value: run.lite
          ? 'Skipped (Lite)'
          : dlMbps !== null
            ? (dlCapped ? `at least ${dlMbps} Mbit/s` : `${Math.round(dlMbps)} Mbit/s`)
            : 'Not measured',
        detail: run.lite
          ? '8 MiB transfer skipped by Lite mode'
          : dlDetail && Number.isFinite(dlDetail.elapsed) && dlDetail.elapsed > 0
            ? `8 MiB HTTPS transfer in ${dlDetail.elapsed} ms`
            : '8 MiB same-origin HTTPS transfer',
        status: dlMbps !== null ? 'info' : 'unknown'
      },
      {
        id: 'loaded-dns',
        label: 'Loaded RTT & origin DNS',
        value: `${loadedMs !== null ? `at most ${loadedMs} ms` : 'n/a'} / ${dnsMs !== null ? `${dnsMs} ms DNS` : 'cached DNS'}`,
        detail: 'Latency during download & same-origin DNS lookup',
        status: loadedMs !== null || dnsMs !== null ? 'info' : 'unknown'
      }
    ];

    const cloudLabel = run.cloud === 'gov' || (run.pack && run.pack.cloud === 'gov')
      ? 'Azure US Government'
      : 'Azure Commercial';
    const packTitle = run.pack ? `${run.pack.title || run.pack.id} (${run.pack.version || '1.0'})` : 'Azure Virtual Desktop';
    const workloadsText = Array.isArray(run.workloads) && run.workloads.length
      ? ` - Workloads: ${run.workloads.join(', ')}`
      : '';
    const vantageLabel = run.vantage === 'likely-session-host'
      ? 'Likely inside a remote session (< 5 ms regional RTT)'
      : run.vantage === 'device'
        ? 'Client device (outside Azure datacenter)'
        : 'Unknown vantage';
    const browserLabel = run.browser && run.browser.family
      ? `${run.browser.family}${run.browser.major ? ` ${run.browser.major}` : ''} (${run.platform || 'unknown'})`
      : (run.platform || 'Unknown');
    const caveats = Array.isArray(run.caveats) ? run.caveats : [];
    const caveatSummary = caveats.length
      ? caveats.map((c) => c.id).join(', ')
      : 'None triggered';
    const transportScope = cloudLabel === 'Azure US Government'
      ? 'Browser probes HTTPS/TCP 443; Azure US Government uses direct STUN Shortpath or TCP gateway (TURN relay is Commercial-only).'
      : 'Browser probes HTTPS/TCP 443; RDP Shortpath (UDP 3478 STUN/TURN) and Teams media relays (UDP 3478-3481) require the native client.';

    const connectionDetails = [
      { label: 'Cloud environment', value: cloudLabel },
      { label: 'Active pack & workloads', value: `${packTitle}${workloadsText}` },
      { label: 'Target / nearest region', value: rttMs !== null ? `${rttRegionLabel} (at most ${rttMs} ms, ${regionRating(rttMs)})` : rttRegionLabel },
      { label: 'Detected vantage', value: vantageLabel },
      { label: 'Client browser & platform', value: browserLabel },
      { label: 'Transport & Shortpath scope', value: transportScope },
      { label: 'Proxy / tunnel caveats', value: caveatSummary }
    ];

    const endpoints = hostResults.length
      ? hostResults.map(({ target, result }) => ({
          id: target.id,
          host: target.host,
          purpose: target.purpose || target.id,
          required: Boolean(target.required),
          status: result.status === 'reached' ? 'pass' : (target.required ? 'blocked' : 'unknown'),
          warmUpMs: Number.isFinite(result.warmUpMs) ? Math.round(result.warmUpMs) : null,
          medianMs: Number.isFinite(result.median) ? Math.round(result.median) : null,
          setupMs: Number.isFinite(result.setupMs) ? Math.round(result.setupMs) : null,
          sampleCount: Array.isArray(result.samples) ? result.samples.length : 0,
          stalls: Number.isFinite(result.stalls) ? result.stalls : 0,
          slowSamples: Number.isFinite(result.slowSamples) ? result.slowSamples : 0
        }))
      : findings
          .filter((f) => f && f.id && !f.id.startsWith('region.') && ![
            'target-region', 'jitter.primary', 'slow-samples', 'stalls.primary',
            'download', 'loaded-latency', 'dns.origin', 'setup.max'
          ].includes(f.id))
          .map((f) => ({
            id: f.id,
            host: f.host || f.id,
            purpose: f.id,
            required: Boolean(f.required),
            status: f.status,
            warmUpMs: Number.isFinite(f.value) && Number.isFinite(f.setupMs) ? Math.round(f.value + f.setupMs) : null,
            medianMs: Number.isFinite(f.value) ? Math.round(f.value) : null,
            setupMs: Number.isFinite(f.setupMs) ? Math.round(f.setupMs) : null,
            sampleCount: Number.isFinite(f.value) ? 8 : 0,
            stalls: 0,
            slowSamples: 0
          }));

    return {
      cards,
      connectionDetails,
      endpoints
    };
  }

  return {
    ORDER,
    LABELS,
    SENTENCES,
    labels: LABELS,
    sentences: SENTENCES,
    rttFinding,
    reachabilityFinding,
    detectVantage,
    detectCaveats,
    detectProxyCaveats: detectCaveats,
    cloudShortpathNote,
    relayGeographyNote,
    overallVerdict,
    rankRegions,
    visibleRegions,
    regionRating,
    findingSentence,
    summarizeMetrics
  };
});
