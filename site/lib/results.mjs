const severity = { blocked: 5, fail: 4, unknown: 3, warn: 2, pass: 1, info: 0 };
const knownHostSuffixes = ['microsoft.com', 'microsoftonline.com', 'cloud.microsoft', 'windows.net', 'office.com', 'aka.ms'];

export function hasCustomHosts(pack) {
  return (pack.hosts ?? []).some(({ host }) =>
    !knownHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  );
}

export function rttFinding(value, bands, { id = 'target-region', required = true } = {}) {
  if (!Number.isFinite(value) || value < 0) {
    return { id, status: 'unknown', value: null, unit: 'ms', required, claim: bands[0]?.claim ?? null };
  }
  const bandIndex = bands.findIndex((item) =>
    (Number.isFinite(item.below) && value < item.below) ||
    (Number.isFinite(item.atMost) && value <= item.atMost) ||
    item.otherwise
  );
  const band = bands[bandIndex];
  const status = band?.state ?? band?.otherwise ?? 'unknown';
  return {
    id,
    status,
    value: Math.round(value),
    unit: 'ms',
    required,
    claim: band?.claim ?? null,
    threshold: Number.isFinite(band?.below) ? `< ${band.below} ms` :
      Number.isFinite(band?.atMost) ? `<= ${band.atMost} ms` :
        band?.otherwise && Number.isFinite(bands[bandIndex - 1]?.atMost) ? `> ${bands[bandIndex - 1].atMost} ms` : null
  };
}

export function reachabilityFinding(target, outcome, value = null) {
  const status = outcome === 'reached' ? 'pass' : outcome === 'blocked' && target.required === true ? 'blocked' : 'unknown';
  return {
    id: target.id,
    status,
    value: Number.isFinite(value) ? Math.round(value) : null,
    unit: Number.isFinite(value) ? 'ms' : null,
    required: target.required === true,
    claim: target.claim
  };
}

export function overallVerdict(findings) {
  const required = findings.filter((finding) => finding.required === true);
  if (!required.length) return { status: 'unknown', label: 'Could not check' };
  const worst = required.reduce((a, b) => (severity[b.status] ?? severity.unknown) > (severity[a.status] ?? severity.unknown) ? b : a);
  const labels = {
    blocked: 'Something is blocking this network',
    fail: 'Likely to affect your desktop',
    unknown: 'Could not check',
    warn: 'Usable, with warnings',
    pass: 'Good to go'
  };
  return { status: worst.status, label: labels[worst.status] ?? labels.unknown };
}

export function rankRegions(results) {
  return [...results].sort((a, b) => {
    const left = Number.isFinite(a.result.median) ? a.result.median : Infinity;
    const right = Number.isFinite(b.result.median) ? b.result.median : Infinity;
    return left - right || a.region.id.localeCompare(b.region.id);
  });
}

export function visibleRegions(results, selectedId, showAll, top) {
  if (showAll) return results;
  return results.filter((entry, index) => index < top || entry.region.id === selectedId);
}

export function regionRating(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'No answer';
  if (milliseconds < 100) return 'Good';
  if (milliseconds <= 150) return 'Usable';
  return 'Sluggish';
}

export function findingSentence(status) {
  return {
    pass: 'This check answered from this network.',
    warn: 'The measured value is outside the ideal band.',
    blocked: 'This required check did not answer from this network; a proxy or blocker may be involved.',
    fail: 'The measured value is above the cited band.',
    unknown: 'This check could not be measured.',
    info: 'This is informational and does not change the overall verdict.'
  }[status] ?? 'This check could not be measured.';
}

function safeFinding(finding, allowedIds, pack) {
  if (!allowedIds.has(finding.id) || !Object.hasOwn(severity, finding.status)) return null;
  const status = finding.status === 'blocked' && finding.required !== true ? 'unknown' : finding.status;
  const customHost = hasCustomHosts(pack) ? pack.hosts?.find((host) => host.id === finding.id) : null;
  const claim = typeof finding.claim === 'string' && /^ref:[a-z0-9-]+#[a-z0-9-]+$/.test(finding.claim) ? finding.claim : null;
  const unit = ['ms', 'Mbit/s', 'count'].includes(finding.unit) ? finding.unit : null;
  return {
    id: finding.id,
    status,
    required: finding.required === true,
    value: Number.isFinite(finding.value) ? Math.round(finding.value) : null,
    unit,
    threshold: typeof finding.threshold === 'string' && finding.threshold.length <= 32 ? finding.threshold : null,
    claim,
    ...(customHost ? { host: customHost.host, purpose: customHost.purpose } : {}),
    sentence: findingSentence(status)
  };
}

export function makeExport(run) {
  const allowedIds = new Set(run.pack.allowedFindingIds ?? run.pack.endpointIds ?? []);
  const safeFindings = run.findings.map((finding) => safeFinding(finding, allowedIds, run.pack)).filter(Boolean);
  const regions = safeFindings.filter((finding) => finding.id.startsWith('region.') && finding.status === 'info' && Number.isFinite(finding.value));
  const sharedRegions = run.fullRegions ? regions : [...regions].sort((a, b) => a.value - b.value).slice(0, 3);
  const sharedRegionIds = new Set(sharedRegions.map((finding) => finding.id));
  const findings = safeFindings.filter((finding) => !finding.id.startsWith('region.') || sharedRegionIds.has(finding.id));
  const date = new Date(run.createdAt);
  if (Number.isNaN(date.valueOf())) throw new TypeError('Result date is invalid');
  const family = ['Chrome', 'Chromium', 'Edge', 'Firefox', 'Safari', 'Other'].includes(run.browser?.family) ? run.browser.family : 'Other';
  const major = Number.isInteger(run.browser?.major) && run.browser.major >= 0 ? run.browser.major : null;
  const platform = ['desktop', 'tablet', 'phone'].includes(run.platform) ? run.platform : 'unknown';
  const region = typeof run.region === 'string' && /^[a-z0-9]+$/.test(run.region) ? run.region : null;
  const notTested = [...new Set((run.notTested ?? []).filter((id) => allowedIds.has(id)))];
  const overall = overallVerdict(run.findings.filter((finding) => finding.required === true));

  return {
    schemaVersion: 1,
    toolVersion: '0.1.0',
    pack: { id: run.pack.id, version: run.pack.version },
    custom: hasCustomHosts(run.pack),
    createdAt: `${date.toISOString().slice(0, 16)}Z`,
    browser: { family, major },
    platform,
    region,
    regionScope: run.fullRegions ? 'all-measured' : 'top-three',
    vantage: ['device', 'likely-session-host', 'unknown'].includes(run.vantage) ? run.vantage : 'unknown',
    overall,
    findings,
    notTested
  };
}

export function parseSharedResult(text, pack) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError('Result is not valid JSON');
  }
  if (value?.schemaVersion !== 1 || value?.pack?.id !== pack.id || !Array.isArray(value.findings)) {
    throw new TypeError('Result format or pack is not supported');
  }
  const allowedIds = new Set(pack.allowedFindingIds ?? pack.endpointIds ?? []);
  const findings = value.findings.map((finding) => safeFinding(finding, allowedIds, pack)).filter(Boolean);
  return {
    pack: { id: pack.id, version: pack.version },
    custom: hasCustomHosts(pack),
    sentencesAvailable: value.pack.version === pack.version,
    overall: overallVerdict(findings),
    findings
  };
}
