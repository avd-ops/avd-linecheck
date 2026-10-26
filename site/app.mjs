import { probeTargets, regionalHost, selectRegions, validatePack } from './lib/packs.mjs';
import { measureParallelSamples, measureSamples, measureUntil, median, probeOnce } from './lib/network.mjs';
import { findingSentence, hasCustomHosts, makeExport, overallVerdict, parseSharedResult, rankRegions, reachabilityFinding, regionRating, rttFinding, visibleRegions } from './lib/results.mjs';

const $ = (id) => document.getElementById(id);
const packSelect = $('pack-select');
const regionSelect = $('region-select');
const runButton = $('run-check');
const runState = $('run-state');
const progress = $('progress');
const statusNames = { pass: 'Reached', warn: 'Warning', blocked: 'Blocked', fail: 'High latency', unknown: 'Not measured', info: 'Info' };
const generalNotTested = ['upload', 'udp', 'session-transport', 'session-host', 'wildcard-endpoints', 'dns', 'packet-loss', 'vantage'];
let packData;
let lastExport;
let lastRun;
let showAllRegions = false;

function json(path) {
  return fetch(new URL(path, import.meta.url), { credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load ${path}`);
      return response.json();
    });
}

async function init() {
  const [generic, avd, endpointMap, regionMap] = await Promise.all([
    json('packs/generic.json'), json('packs/avd.json'), json('packs/endpoints.json'), json('packs/regions.json')
  ]);
  const packs = { generic, avd };
  for (const pack of Object.values(packs)) validatePack(pack, endpointMap, regionMap.regions);
  const regions = regionMap.regions;
  const url = new URL(location.href);
  const requestedPack = url.searchParams.get('pack');
  if (requestedPack === 'avd' || url.searchParams.has('region')) packSelect.value = 'avd';
  if (requestedPack === 'generic' || requestedPack === 'avd') packSelect.value = requestedPack;
  const requestedRegion = url.searchParams.get('region');

  packData = { packs, endpointMap, regionMap };
  for (const pack of Object.values(packs)) {
    pack.allowedFindingIds = [
      'site.origin', 'target-region', 'jitter.primary', 'slow-samples', 'stalls.primary', 'download', 'loaded-latency',
      ...generalNotTested,
      ...endpointMap.views.browser.probe,
      ...endpointMap.views.browser.notTested,
      ...pack.hosts.map((host) => host.id),
      ...regions.map((region) => `region.${region.id}`)
    ];
  }
  packSelect.addEventListener('change', selectionChanged);
  regionSelect.addEventListener('change', () => lastRun ? selectTargetRegion(regionSelect.value) : updatePackView());
  document.querySelectorAll('input[name="region-geo"]').forEach((input) => input.addEventListener('change', selectionChanged));
  runButton.addEventListener('click', runCheck);
  $('show-regions').addEventListener('click', () => {
    showAllRegions = !showAllRegions;
    if (lastRun) renderRegionRanking(lastRun);
  });
  $('copy-summary').addEventListener('click', copySummary);
  $('download-json').addEventListener('click', downloadJson);
  $('read-result').addEventListener('click', readSharedResult);
  $('full-regions').addEventListener('change', () => {
    if (lastRun) {
      lastRun.fullRegions = $('full-regions').checked;
      lastExport = makeExport(lastRun);
    }
  });
  updatePackView();
  const targetRegions = currentPack().regionalProbe
    ? currentPack().id === 'avd' ? regionMap.avdTargetRegionIds : regions.map((region) => region.id)
    : [];
  if (targetRegions.includes(requestedRegion)) regionSelect.value = requestedRegion;
  runButton.disabled = false;
}

function currentPack() {
  return packData.packs[packSelect.value] ?? packData.packs.generic;
}

function selectionChanged() {
  updatePackView();
  if (lastRun) {
    lastRun = null;
    lastExport = null;
    $('results').hidden = true;
    progress.hidden = true;
    $('copy-summary').disabled = true;
    $('download-json').disabled = true;
    runState.textContent = 'Selection changed. Run a new check.';
  }
}

function targetsFor(pack) {
  return pack.id === 'avd'
    ? probeTargets(pack, packData.endpointMap)
    : [
      { id: 'site.origin', host: location.host, purpose: 'This page', required: true, claim: null },
      ...probeTargets(pack, packData.endpointMap)
    ];
}

function updatePackView() {
  if (!packData) return;
  const pack = currentPack();
  const priorRegion = regionSelect.value;
  const regionIds = pack.regionalProbe
    ? pack.id === 'avd' ? packData.regionMap.avdTargetRegionIds : packData.regionMap.regions.map((region) => region.id)
    : [];
  $('region-control').hidden = !pack.regionalProbe;
  regionSelect.replaceChildren(new Option('No region selected', ''));
  for (const region of packData.regionMap.regions.filter((item) => regionIds.includes(item.id))) {
    regionSelect.append(new Option(`${region.name} (${region.geo})`, region.id));
  }
  if (regionIds.includes(priorRegion)) regionSelect.value = priorRegion;
  $('region-label').firstChild.textContent = pack.id === 'avd' ? 'Host pool region ' : 'Region to compare ';
  $('avd-links').hidden = pack.id !== 'avd';
  const targets = targetsFor(pack).map((target) => `${target.host} - ${target.purpose}`);
  $('pack-warning').hidden = !hasCustomHosts(pack);
  if (pack.regionalProbe) targets.push(...packData.regionMap.regions.map((region) => `${regionalHost(packData.regionMap, region)} - regional timing`));
  const list = $('target-list');
  list.replaceChildren(...targets.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
}

function mapLimit(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  })).then(() => results);
}

function selectedRegions() {
  if (!currentPack().regionalProbe) return [];
  const geographies = [...document.querySelectorAll('input[name="region-geo"]:checked')].map((input) => input.value);
  return selectRegions(packData.regionMap.regions, geographies, regionSelect.value);
}

function browserDetails() {
  const ua = navigator.userAgent;
  const patterns = [
    ['Edge', /Edg\/(\d+)/], ['Firefox', /Firefox\/(\d+)/], ['Chrome', /Chrome\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]
  ];
  const found = patterns.find(([, pattern]) => pattern.test(ua));
  const match = found?.[1].exec(ua);
  const touch = navigator.maxTouchPoints > 1;
  const width = Math.min(screen.width, screen.height);
  const platform = touch && width < 700 ? 'phone' : touch && width < 1100 ? 'tablet' : 'desktop';
  return { family: found?.[0] ?? 'Other', major: match ? Number(match[1]) : null, platform };
}

function addProgress(done, total, message) {
  progress.hidden = false;
  progress.max = total;
  progress.value = done;
  runState.textContent = message;
}

function addInfo(id, result, unit, claim = null) {
  return {
    id,
    status: result === null || result === undefined ? 'unknown' : 'info',
    required: false,
    value: Number.isFinite(result) ? result : null,
    unit: result === null || result === undefined ? null : unit,
    claim
  };
}

async function downloadCheck(download) {
  const url = new URL(download.path, import.meta.url);
  const fetchDownload = async (cache) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { cache, credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok) throw new Error('Download did not complete');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== download.bytes) throw new Error('Download size did not match the pack');
      const entries = performance.getEntriesByName(url.href, 'resource');
      const entry = entries[entries.length - 1];
      return { entry, size: bytes.byteLength };
    } finally {
      clearTimeout(timer);
    }
  };
  let result = await fetchDownload('default');
  if (!result.entry || result.entry.transferSize === 0 || result.entry.transferSize < download.bytes) result = await fetchDownload('reload');
  const elapsed = result.entry ? result.entry.responseEnd - result.entry.responseStart : 0;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return { status: 'unknown', mbps: null, elapsed };
  return { status: 'measured', mbps: download.bytes * 8 / (elapsed * 1000), elapsed };
}

async function runCheck() {
  const pack = currentPack();
  const targets = targetsFor(pack);
  const regions = selectedRegions();
  const targetRegion = pack.regionalProbe ? packData.regionMap.regions.find((region) => region.id === regionSelect.value) : null;
  const lite = new URL(location.href).searchParams.has('lite');
  if (pack.regionalProbe && regions.length === 0) {
    runState.textContent = 'Pick at least one geography or choose a region to compare.';
    return;
  }
  const total = targets.length + regions.length + 3;
  let done = 0;
  const findings = [];
  const notTested = pack.id === 'avd'
    ? [...packData.endpointMap.views.browser.notTested, ...generalNotTested]
    : [...generalNotTested];
  if (pack.regionalProbe && !targetRegion) notTested.push('target-region');
  runButton.disabled = true;
  packSelect.disabled = true;
  regionSelect.disabled = true;
  document.querySelectorAll('input[name="region-geo"]').forEach((input) => { input.disabled = true; });
  $('full-regions').disabled = true;
  $('copy-summary').disabled = true;
  $('download-json').disabled = true;
  $('results').hidden = false;
  $('finding-list').replaceChildren();
  $('not-tested').replaceChildren();
  $('region-rows').replaceChildren();
  $('region-ranking').hidden = true;
  showAllRegions = false;
  lastExport = null;
  lastRun = null;
  $('full-regions').checked = false;
  addProgress(done, total, 'Starting the check...');

  const hostResults = await mapLimit(targets, 3, async (target) => {
    addProgress(done, total, `Checking ${target.purpose}...`);
    const result = await measureParallelSamples({ probe: () => probeOnce(target.host), samples: 8 });
    done++;
    return { target, result };
  });
  findings.push(...hostResults.map(({ target, result }) => reachabilityFinding(target, result.status, result.median)));
  notTested.push(...hostResults.filter(({ result }) => result.status !== 'reached').map(({ target }) => target.id));

  const regionResults = rankRegions(await mapLimit(regions, packData.regionMap.measurement.concurrency, async (region) => {
    addProgress(done, total, `Ranking ${region.name}...`);
    const result = await measureSamples({
      probe: () => probeOnce(regionalHost(packData.regionMap, region), {
        method: packData.regionMap.measurement.method,
        timeoutMs: packData.regionMap.measurement.timeoutMs
      }),
      samples: packData.regionMap.measurement.samples,
      stopOnStall: true
    });
    done++;
    return { region, result };
  }));
  findings.push(...regionResults.map(({ region, result }) => ({
    id: `region.${region.id}`,
    status: result.status === 'reached' ? 'info' : 'unknown',
    required: false,
    value: result.median,
    unit: result.median === null ? null : 'ms',
    claim: null
  })));
  notTested.push(...regionResults.filter(({ result }) => result.status !== 'reached').map(({ region }) => `region.${region.id}`));
  const primary = targets[0];
  addProgress(done, total, 'Measuring jitter...');
  const jitter = await measureSamples({ probe: () => probeOnce(primary.host), samples: 8 });
  findings.push(addInfo('jitter.primary', jitter.status === 'reached' ? jitter.jitter : null, 'ms'));
  findings.push(addInfo('slow-samples', jitter.status === 'reached' ? jitter.slowSamples : null, 'count'));
  findings.push(addInfo('stalls.primary', jitter.status === 'reached' ? jitter.stalls : null, 'count'));
  done++;

  if (lite) {
    notTested.push('download', 'loaded-latency');
    done += 2;
  } else {
    addProgress(done, total, 'Checking download sufficiency...');
    const loadedController = new AbortController();
    let finishDownload;
    const downloadFinished = new Promise((resolve) => { finishDownload = resolve; });
    const downloadPromise = downloadCheck(pack.download)
      .catch(() => ({ status: 'unknown', mbps: null, elapsed: 0 }))
      .finally(finishDownload);
    const loadedPromise = measureUntil({
      probe: () => probeOnce(primary.host, { signal: loadedController.signal }),
      stop: downloadFinished,
      samples: 8
    });
    const download = await downloadPromise;
    loadedController.abort();
    const loaded = await loadedPromise;
    const loadedLatency = download.elapsed >= 3000 ? median(loaded.samples) : null;
    if (download.status !== 'measured') notTested.push('download', 'loaded-latency');
    else if (!Number.isFinite(loadedLatency)) notTested.push('loaded-latency');
    findings.push(addInfo('download', download.status === 'measured' ? download.mbps : null, 'Mbit/s', pack.download.claim));
    findings.push(addInfo('loaded-latency', loadedLatency, 'ms'));
    done += 2;
  }

  const browser = browserDetails();
  const run = {
    pack,
    createdAt: new Date().toISOString(),
    browser,
    platform: browser.platform,
    region: targetRegion?.id ?? null,
    vantage: 'unknown',
    findings,
    notTested,
    regionResults,
    fullRegions: false
  };
  if (targetRegion) setTargetRegionResult(run, targetRegion.id);
  lastRun = run;
  renderRun(run, 'Check complete. Nothing was shared.');
  progress.value = total;
  runButton.disabled = false;
  packSelect.disabled = false;
  regionSelect.disabled = false;
  document.querySelectorAll('input[name="region-geo"]').forEach((input) => { input.disabled = false; });
  $('full-regions').disabled = false;
  $('copy-summary').disabled = false;
  $('download-json').disabled = false;
}

function setTargetRegionResult(run, regionId) {
  run.findings = run.findings.filter((finding) => finding.id !== 'target-region');
  run.notTested = run.notTested.filter((id) => id !== 'target-region');
  run.region = regionId || null;
  if (!regionId) {
    if (run.pack.regionalProbe) run.notTested.push('target-region');
    return;
  }
  const measurement = run.regionResults.find((entry) => entry.region.id === regionId)?.result;
  if (run.pack.thresholds.length) {
    run.findings.push(rttFinding(measurement?.status === 'reached' ? measurement.median : null, run.pack.thresholds, { id: 'target-region', required: true }));
  } else {
    run.findings.push(addInfo('target-region', measurement?.status === 'reached' ? measurement.median : null, 'ms'));
  }
  if (measurement?.status !== 'reached') run.notTested.push('target-region');
}

function renderRun(run, statusMessage) {
  lastExport = makeExport(run);
  const overall = overallVerdict(run.findings);
  $('overall').dataset.status = overall.status;
  $('overall').textContent = overall.label;
  renderFindings(run.findings.filter((finding) => !finding.id.startsWith('region.')));
  renderNotTested(run.notTested);
  renderRegionRanking(run);
  runState.textContent = statusMessage;
}

function selectTargetRegion(regionId) {
  if (!lastRun) return;
  const measurement = lastRun.regionResults.find((entry) => entry.region.id === regionId);
  if (!measurement) {
    selectionChanged();
    return;
  }
  regionSelect.value = regionId;
  setTargetRegionResult(lastRun, regionId);
  renderRun(lastRun, `Target region changed to ${measurement.region.name}; reused the existing measurement.`);
}

function renderRegionRanking(run) {
  const section = $('region-ranking');
  const results = run.regionResults ?? [];
  section.hidden = results.length === 0;
  if (!results.length) return;
  const top = packData.regionMap.measurement.top;
  const visible = visibleRegions(results, run.region, showAllRegions, top);
  const rows = $('region-rows');
  rows.replaceChildren(...visible.map((entry) => {
    const { region, result } = entry;
    const row = document.createElement('tr');
    row.dataset.selected = String(region.id === run.region);
    const pickerCell = document.createElement('td');
    pickerCell.className = 'region-picker';
    const picker = document.createElement('input');
    picker.type = 'radio';
    picker.name = 'region-target';
    picker.value = region.id;
    picker.checked = region.id === run.region;
    picker.disabled = result.status !== 'reached' || (run.pack.id === 'avd' && !packData.regionMap.avdTargetRegionIds.includes(region.id));
    picker.setAttribute('aria-label', `Use ${region.name} as the target region`);
    picker.addEventListener('change', () => { if (picker.checked) selectTargetRegion(region.id); });
    pickerCell.append(picker);
    const values = [
      pickerCell,
      String(results.indexOf(entry) + 1),
      `${region.name} (${region.id})`,
      region.geo,
      result.status === 'reached' ? `${Math.round(result.median)} ms` : 'No answer',
      regionRating(result.median)
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value;
      row.append(cell);
    }
    return row;
  }));
  const fastest = results.find((entry) => entry.result.status === 'reached');
  const target = results.find((entry) => entry.region.id === run.region);
  $('region-summary').textContent = target
    ? `${target.region.name}: ${target.result.status === 'reached' ? `${Math.round(target.result.median)} ms` : 'no answer'}. This browser measurement is to a regional service endpoint, not the session host.`
    : fastest
      ? `Fastest measured: ${fastest.region.name} (${Math.round(fastest.result.median)} ms). ${run.pack.id === 'avd' ? 'Select your actual host pool region to apply the AVD threshold.' : 'Select a region to compare it.'}`
      : 'No selected regional endpoint answered.';
  const more = $('show-regions');
  more.hidden = results.length <= top;
  more.textContent = showAllRegions ? `Show top ${top} only` : `Show all ${results.length} regions`;
  more.setAttribute('aria-expanded', String(showAllRegions));
}

function labelFor(id) {
  const endpoint = packData.endpointMap.endpoints.find((item) => item.id === id);
  if (endpoint) return `${endpoint.host} (${endpoint.purpose})`;
  const customHost = currentPack().hosts.find((item) => item.id === id);
  if (customHost) return `${customHost.host} (${customHost.purpose})`;
  const regionId = id.replace(/^region\./, '');
  const region = packData.regionMap.regions.find((item) => item.id === regionId);
  if (region) return `${region.name} regional timing`;
  return ({
    'site.origin': 'This page',
    'target-region': currentPack().id === 'avd' ? 'Selected host pool region, measured from this browser' : 'Selected region, measured from this browser',
    'jitter.primary': 'Jitter to the primary host',
    'slow-samples': 'Slow samples',
    'stalls.primary': 'Timed-out jitter samples',
    download: 'Download sufficiency from this site',
    'loaded-latency': 'Latency while downloading',
    upload: 'Upload speed',
    udp: 'UDP reachability',
    'session-transport': 'Transport used by your desktop session',
    'session-host': 'Session host connectivity',
    'wildcard-endpoints': 'Wildcard service endpoints the browser cannot probe',
    dns: 'DNS lookup time for probe hosts',
    'packet-loss': 'Packet loss',
    vantage: "Whether this ran on the user's device or inside a remote session"
  })[id] ?? id;
}

function renderFindings(findings, listId = 'finding-list') {
  const list = $(listId);
  list.replaceChildren(...findings.map((finding) => {
    const item = document.createElement('li');
    item.dataset.status = finding.status;
    const strong = document.createElement('strong');
    strong.textContent = statusNames[finding.status] ?? 'Not measured';
    const value = Number.isFinite(finding.value) ? ` - ${Math.round(finding.value)} ${finding.unit ?? ''}` : '';
    item.append(strong, document.createTextNode(` | ${labelFor(finding.id)}${value}`));
    const sentence = document.createElement('p');
    sentence.textContent = finding.sentence ?? findingSentence(finding.status);
    item.append(sentence);
    return item;
  }));
}

function renderNotTested(ids) {
  const list = $('not-tested');
  list.replaceChildren(...[...new Set(ids)].map((id) => {
    const item = document.createElement('li');
    item.textContent = labelFor(id);
    return item;
  }));
}

function summaryText(result = lastExport) {
  if (!result) return '';
  const lines = [
    `avd-linecheck ${result.toolVersion} - ${result.pack.id} ${result.pack.version}`,
    `Overall: ${result.overall.label}`,
    `Run: ${result.createdAt} (${result.platform}, ${result.browser.family}${result.browser.major ? ` ${result.browser.major}` : ''})`,
    `Regional detail: ${result.regionScope === 'all-measured' ? 'all measured regions' : 'top three measured regions'}`,
    ...(result.custom ? ['Custom pack: review host names before sharing publicly.'] : []),
    ...result.findings.map((finding) => `${statusNames[finding.status] ?? finding.status}: ${labelFor(finding.id)}${finding.value === null ? '' : ` - ${finding.value} ${finding.unit ?? ''}`}. ${finding.sentence}`),
    `Not tested: ${result.notTested.map(labelFor).join(', ') || 'none listed'}`,
    'This is a browser network check, not a production assessment.'
  ];
  return lines.join('\n');
}

async function copySummary() {
  try {
    await navigator.clipboard.writeText(summaryText());
    runState.textContent = 'Summary copied. Review it before sharing.';
  } catch {
    runState.textContent = 'Copy failed. Download the JSON result instead.';
  }
}

function downloadJson() {
  if (!lastExport) return;
  const blob = new Blob([`${JSON.stringify(lastExport, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'avd-linecheck-result.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function readSharedResult() {
  $('paste-findings').replaceChildren();
  try {
    const result = parseSharedResult($('paste-input').value, currentPack());
    $('paste-state').textContent = `${result.overall.label}. ${result.sentencesAvailable
      ? 'Shared result. Its wording was checked against this pack.'
      : 'This pack version differs. Numbers and states are shown; sentences may not match.'}`;
    renderFindings(result.findings, 'paste-findings');
  } catch {
    $('paste-state').textContent = 'This result is not valid for the selected pack.';
  }
}

init().catch(() => {
  runButton.disabled = true;
  runState.textContent = 'The check could not load its local pack files.';
});
