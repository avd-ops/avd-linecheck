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

  function reachabilityFinding(target, outcome, value = null) {
    const status = outcome === 'reached' ? 'pass' : outcome === 'blocked' && target.required === true ? 'blocked' : 'unknown';
    return {
      id: target.id,
      status,
      value: Number.isFinite(value) ? Math.round(value) : null,
      unit: Number.isFinite(value) ? 'ms' : null,
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
    return caveats;
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
    relayGeographyNote,
    overallVerdict,
    rankRegions,
    visibleRegions,
    regionRating,
    findingSentence
  };
});
