/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT. */
(function () {
  'use strict';
  const engine = window.LinecheckEngine;
  const verdict = window.LinecheckVerdict;
  const exporter = window.LinecheckExport;
  const portalEngine = window.AvdOpsEngine || {};

  const $ = (id) => document.getElementById(id);
  const packSelect = $('pack-select');
  const regionSelect = $('region-select');
  const runButton = $('run-check');
  const runState = $('run-state');
  const progress = $('progress');

  const STEPS = [
    { id: 'check', stage: 'check', label: 'Run check' },
    { id: 'results', stage: 'results', label: 'Verdict' },
    { id: 'context', stage: 'context', label: 'Add context' },
    { id: 'share', stage: 'share', label: 'Share or read' }
  ];
  const IDS = STEPS.map((s) => s.id);
  const NAMES = { check: 'Check', results: 'Results', context: 'Context', share: 'Share' };
  const PACK_KEY = 'avd-linecheck-pack';
  const REPO_URL = 'https://github.com/avd-ops/avd-linecheck';

  const statusNames = {
    pass: 'Reached',
    warn: 'Warning',
    blocked: 'Blocked',
    fail: 'High latency',
    unknown: 'Not measured',
    info: 'Info'
  };
  const generalNotTested = [
    'upload', 'udp', 'session-transport', 'session-host',
    'wildcard-endpoints', 'dns', 'packet-loss', 'vantage'
  ];

  let currentStep = 'check';
  let packData = null;
  let lastRun = null;
  let lastExport = null;
  let showAllRegions = false;
  let contextDone = false;
  let shareDone = false;
  let commentsDirty = false;
  let activeCaptureUrl = null;
  let activeRecorder = null;
  let activeStream = null;
  let activeRecordTimer = 0;

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    for (const child of children || []) node.append(child);
    return node;
  }

  // ---- Wizard stepper ----
  const isDone = {
    check: () => !!lastRun,
    results: () => !!lastRun,
    context: () => contextDone,
    share: () => shareDone
  };

  function stageOf() {
    return (STEPS.find((s) => s.id === currentStep) || STEPS[0]).stage;
  }

  function renderSteps() {
    const list = $('steps');
    const bar = $('steps-bar');
    if (!list || !bar) return;
    list.replaceChildren();
    bar.replaceChildren();
    let phase = null;
    let segs = null;
    let group = '';
    STEPS.forEach((s, i) => {
      const current = s.id === currentStep;
      const done = !current && isDone[s.stage]();
      if (s.stage !== group) {
        group = s.stage;
        const g = el('li', { className: 'group', textContent: NAMES[s.stage] });
        g.setAttribute('aria-hidden', 'true');
        list.append(g);
        phase = el('li', { className: 'phase' });
        phase.dataset.steps = '0';
        segs = el('div', { className: 'segs' });
        phase.append(el('span', { className: 'phase-name', textContent: NAMES[s.stage] }), segs);
        bar.append(phase);
      }
      phase.dataset.steps = String(Number(phase.dataset.steps) + 1);
      if (current) phase.classList.add('now');
      const label = `${i + 1}. ${s.label}${done ? ', done' : ''}`;
      const mark = current ? ' current' : done ? ' done' : '';
      const item = el('button', { className: `step${mark}` }, [
        el('span', { className: 'n', textContent: done ? '\u2713' : String(i + 1) }),
        el('span', { className: 'lbl', textContent: s.label })
      ]);
      const seg = el('button', { className: `seg${mark}`, title: `${i + 1}. ${s.label}` });
      for (const b of [item, seg]) {
        b.type = 'button';
        b.setAttribute('aria-current', current ? 'step' : 'false');
        b.setAttribute('aria-label', label);
        b.addEventListener('click', () => go(s.id, true));
      }
      list.append(el('li', {}, [item]));
      segs.append(seg);
    });
    const idx = IDS.indexOf(currentStep);
    $('back').disabled = idx === 0;
    $('next').disabled = idx === IDS.length - 1;
    $('next').textContent = idx < IDS.length - 1 ? `Next: ${STEPS[idx + 1].label} \u2192` : 'Next \u2192';
    $('where').textContent = `${NAMES[stageOf()]} \u00b7 step ${idx + 1} of ${IDS.length}`;
  }

  function go(step, focus) {
    if (!IDS.includes(step)) step = 'check';
    currentStep = step;
    for (const s of IDS) {
      const sec = $(`stage-${s}`);
      if (sec) sec.classList.toggle('hidden', s !== step);
    }
    renderSteps();
    if (focus) {
      const heading = $(`${step}-title`);
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
    }
  }

  $('back').addEventListener('click', () => go(IDS[Math.max(0, IDS.indexOf(currentStep) - 1)], true));
  $('next').addEventListener('click', () => go(IDS[Math.min(IDS.length - 1, IDS.indexOf(currentStep) + 1)], true));

  // ---- Sheets (Settings and Report a problem) ----
  let opener = null;
  const SHEETS = {
    settings: ['settings-panel', 'settings-link'],
    report: ['report-panel', 'report-link']
  };
  const sheetOpen = () => Object.keys(SHEETS).find((k) => !$(SHEETS[k][0]).classList.contains('hidden'));

  function showSheet(name, open) {
    for (const k of Object.keys(SHEETS)) {
      const on = open && k === name;
      $(SHEETS[k][0]).classList.toggle('hidden', !on);
      $(SHEETS[k][1]).setAttribute('aria-expanded', String(on));
    }
    $('sheet-backdrop').classList.toggle('hidden', !open);
    for (const n of document.querySelectorAll('main.wz-layout, nav.wz-nav, .after')) n.inert = !!open;
  }

  function closeSheet() {
    const k = sheetOpen();
    if (!k) return;
    showSheet(k, false);
    (opener && opener.isConnected ? opener : $(SHEETS[k][1])).focus();
    opener = null;
  }

  function toggleSettings(open) {
    if (open && !sheetOpen()) opener = document.activeElement;
    showSheet('settings', open);
    if (open) $('default-pack').focus();
  }

  $('settings-link').addEventListener('click', () => toggleSettings(sheetOpen() !== 'settings'));
  $('settings-close').addEventListener('click', closeSheet);
  $('sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });

  try {
    const savedPack = localStorage.getItem(PACK_KEY);
    if (savedPack === 'generic' || savedPack === 'avd') {
      $('default-pack').value = savedPack;
      packSelect.value = savedPack;
    }
  } catch { /* storage blocked */ }

  $('default-pack').addEventListener('change', () => {
    const val = $('default-pack').value;
    try {
      if (val === 'generic' || val === 'avd') localStorage.setItem(PACK_KEY, val);
      else localStorage.removeItem(PACK_KEY);
    } catch { /* storage blocked */ }
    if (val === 'generic' || val === 'avd') {
      packSelect.value = val;
      selectionChanged();
    }
  });

  if (new URL(location.href).searchParams.has('lite')) {
    $('lite-mode').checked = true;
  }

  $('reset').addEventListener('click', () => {
    try { localStorage.removeItem(PACK_KEY); } catch { /* ignore */ }
    commentsDirty = false;
    location.reload();
  });

  // ---- Report a problem sheet ----
  let reportEdited = false;

  function reportTerms() {
    return $('report-terms').value.split(',').map((t) => t.trim()).filter(Boolean);
  }

  function buildReport() {
    if (!portalEngine.redact) {
      $('report-body').value = '';
      $('report-summary').textContent = 'The redaction script did not load, so this page cannot build a report.';
      return null;
    }
    const hasSummary = !!lastExport;
    $('report-output').disabled = !hasSummary;
    const rawSummary = $('report-output').checked && hasSummary ? summaryText(lastExport) : '';
    const lines = [
      '## What happened',
      $('report-desc').value.trim() || '(describe what happened)',
      '',
      '## Step',
      `${NAMES[stageOf()]} (${currentStep})`
    ];
    if (rawSummary) {
      lines.push('', '## Check summary', '```text', rawSummary, '```');
    }
    const redaction = portalEngine.redact.redact(lines.join('\n'), { extraTerms: reportTerms() });
    const firstLine = ($('report-desc').value.trim().split('\n')[0] || 'Problem report').slice(0, 72);
    const title = portalEngine.redact.redact(`avd-linecheck: ${firstLine}`, { extraTerms: reportTerms() }).text;
    return { title, body: redaction.text, redaction };
  }

  function renderReport() {
    const r = buildReport();
    if (!r) return;
    if (!reportEdited) $('report-body').value = r.body;
    const sum = portalEngine.redact.summary(r.redaction);
    $('report-summary').textContent = `${sum}${reportEdited ? ' You edited the report: it is redacted again when you open the issue.' : ''}`;
    $('report-status').textContent = '';
  }

  function finalReport() {
    const r = buildReport();
    if (!r) return null;
    const body = portalEngine.redact.redact($('report-body').value, { extraTerms: reportTerms() }).text;
    return { title: r.title, body };
  }

  function toggleReport(open) {
    if (open && !sheetOpen()) opener = document.activeElement;
    showSheet('report', open);
    if (open) {
      reportEdited = false;
      $('report-ok').checked = false;
      $('report-submit').disabled = true;
      renderReport();
      $('report-desc').focus();
    }
  }

  $('report-link').addEventListener('click', () => toggleReport(sheetOpen() !== 'report'));
  $('report-close').addEventListener('click', closeSheet);
  for (const id of ['report-desc', 'report-terms']) $(id).addEventListener('input', renderReport);
  $('report-output').addEventListener('change', () => {
    reportEdited = false;
    $('report-ok').checked = false;
    $('report-submit').disabled = true;
    renderReport();
  });
  $('report-body').addEventListener('input', () => {
    reportEdited = true;
    $('report-ok').checked = false;
    $('report-submit').disabled = true;
  });
  $('report-ok').addEventListener('change', () => {
    $('report-submit').disabled = !$('report-ok').checked;
  });
  $('report-submit').addEventListener('click', () => {
    const r = finalReport();
    if (!r) return;
    try {
      const link = portalEngine.redact.issueUrl(REPO_URL, r.title, r.body);
      window.open(link.url, '_blank', 'noopener');
      $('report-status').textContent = link.trimmed
        ? `The report was too long for a GitHub link, so ${link.trimmed} lines were cut. Copy the report and paste it if needed.`
        : 'Opened GitHub in a new tab.';
    } catch (e) {
      $('report-status').textContent = e.message;
    }
  });
  $('report-copy').addEventListener('click', () => {
    const r = finalReport();
    if (!r) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(r.body).then(() => {
        $('report-status').textContent = 'Copied.';
      }, () => { $('report-body').select(); });
    } else {
      $('report-body').select();
    }
  });

  // ---- Pack loading & initialization ----
  function json(path) {
    return fetch(path, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${path}`);
        return response.json();
      });
  }

  async function init() {
    renderSteps();
    initCaptureControls();
    initContextControls();
    const [generic, avd, endpointMap, regionMap] = await Promise.all([
      json('packs/generic.json'),
      json('packs/avd.json'),
      json('packs/endpoints.json'),
      json('packs/regions.json')
    ]);
    const packs = { generic, avd };
    for (const pack of Object.values(packs)) engine.validatePack(pack, endpointMap, regionMap.regions);
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
    $('download-intake').addEventListener('click', downloadIntake);
    $('read-result').addEventListener('click', readSharedResult);
    $('full-regions').addEventListener('change', () => {
      if (lastRun) {
        lastRun.fullRegions = $('full-regions').checked;
        lastExport = exporter.makeExport(lastRun);
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
      $('results-empty').hidden = false;
      progress.hidden = true;
      $('copy-summary').disabled = true;
      $('download-json').disabled = true;
      $('download-intake').disabled = true;
      runState.textContent = 'Selection changed. Run a new check.';
      renderSteps();
    }
  }

  function targetsFor(pack) {
    return pack.id === 'avd'
      ? engine.probeTargets(pack, packData.endpointMap)
      : [
        { id: 'site.origin', host: location.host, purpose: 'This page', required: true, claim: null },
        ...engine.probeTargets(pack, packData.endpointMap)
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
    $('region-field').hidden = !pack.regionalProbe;
    regionSelect.replaceChildren(new Option('No region selected', ''));
    for (const region of packData.regionMap.regions.filter((item) => regionIds.includes(item.id))) {
      regionSelect.append(new Option(`${region.name} (${region.geo})`, region.id));
    }
    if (regionIds.includes(priorRegion)) regionSelect.value = priorRegion;
    $('region-label').firstChild.textContent = pack.id === 'avd' ? 'Host pool region ' : 'Region to compare ';
    $('avd-links').hidden = pack.id !== 'avd';
    const targets = targetsFor(pack).map((target) => `${target.host} - ${target.purpose}`);
    $('pack-warning').hidden = !exporter.hasCustomHosts(pack);
    if (pack.regionalProbe) targets.push(...packData.regionMap.regions.map((region) => `${engine.regionalHost(packData.regionMap, region)} - regional timing`));
    const list = $('target-list');
    list.replaceChildren(...targets.map((text) => el('li', { textContent: text })));
  }

  function selectedRegions() {
    if (!currentPack().regionalProbe) return [];
    const geographies = [...document.querySelectorAll('input[name="region-geo"]:checked')].map((input) => input.value);
    return engine.selectRegions(packData.regionMap.regions, geographies, regionSelect.value);
  }

  function selectedGeographies() {
    return [...document.querySelectorAll('input[name="region-geo"]:checked')].map((input) => input.value);
  }

  function browserDetails() {
    const ua = navigator.userAgent;
    const patterns = [
      ['Edge', /Edg\/(\d+)/],
      ['Firefox', /Firefox\/(\d+)/],
      ['Chrome', /Chrome\/(\d+)/],
      ['Safari', /Version\/(\d+).*Safari/]
    ];
    const found = patterns.find(([, pattern]) => pattern.test(ua));
    const match = found ? found[1].exec(ua) : null;
    const touch = navigator.maxTouchPoints > 1;
    const width = Math.min(screen.width, screen.height);
    const platform = touch && width < 700 ? 'phone' : touch && width < 1100 ? 'tablet' : 'desktop';
    return { family: found ? found[0] : 'Other', major: match ? Number(match[1]) : null, platform };
  }

  function addProgress(done, total, message) {
    progress.hidden = false;
    progress.max = Math.max(1, total);
    progress.value = Math.min(done, Math.max(1, total));
    runState.textContent = message;
  }

  function addInfo(id, result, unit, claim = null, extra = {}) {
    return {
      id,
      status: result === null || result === undefined ? 'unknown' : 'info',
      required: false,
      value: Number.isFinite(result) ? result : null,
      unit: result === null || result === undefined ? null : unit,
      claim,
      ...extra
    };
  }

  // ---- Phased check execution ----
  async function runCheck() {
    const pack = currentPack();
    const targets = targetsFor(pack);
    const regions = selectedRegions();
    const geographies = selectedGeographies();
    const targetRegion = pack.regionalProbe ? packData.regionMap.regions.find((region) => region.id === regionSelect.value) : null;
    const lite = $('lite-mode').checked || new URL(location.href).searchParams.has('lite');
    if (pack.regionalProbe && regions.length === 0) {
      runState.textContent = 'Pick at least one geography or choose a region to compare.';
      return;
    }
    const total = targets.length + regions.length + (targetRegion ? 4 : 3);
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
    $('download-intake').disabled = true;
    $('results').hidden = false;
    $('results-empty').hidden = true;
    $('finding-list').replaceChildren();
    $('not-tested').replaceChildren();
    $('region-rows').replaceChildren();
    $('region-ranking').hidden = true;
    showAllRegions = false;
    lastExport = null;
    lastRun = null;
    $('full-regions').checked = false;
    addProgress(done, total, 'Starting the check...');

    const phased = await engine.runProbePhases({
      targets,
      regions,
      regionMap: packData.regionMap,
      targetRegionId: targetRegion ? targetRegion.id : null,
      deadlineMs: 85000,
      onProgress: (phase) => {
        done++;
        addProgress(done, total, `Running ${phase}...`);
      }
    });

    const hostResults = phased.hostResults;
    findings.push(...hostResults.map(({ target, result }) => verdict.reachabilityFinding(target, result.status, result.median)));
    notTested.push(...hostResults.filter(({ result }) => result.status !== 'reached').map(({ target }) => target.id));

    const regionResults = verdict.rankRegions(phased.regionResults);
    findings.push(...regionResults.map(({ region, result }) => ({
      id: `region.${region.id}`,
      status: result.status === 'reached' ? 'info' : 'unknown',
      required: false,
      value: result.median,
      unit: result.median === null ? null : 'ms',
      claim: null
    })));
    notTested.push(...regionResults.filter(({ result }) => result.status !== 'reached').map(({ region }) => `region.${region.id}`));

    const jitter = phased.jitterResult || { status: 'unreachable', jitter: null, slowSamples: null, stalls: null };
    findings.push(addInfo('jitter.primary', jitter.status === 'reached' ? jitter.jitter : null, 'ms'));
    findings.push(addInfo('slow-samples', jitter.status === 'reached' ? jitter.slowSamples : null, 'count'));
    findings.push(addInfo('stalls.primary', jitter.status === 'reached' ? jitter.stalls : null, 'count'));

    const primary = targets[0];
    if (lite) {
      notTested.push('download', 'loaded-latency');
    } else {
      addProgress(done, total, 'Checking download sufficiency...');
      const loadedController = new AbortController();
      let finishDownload;
      const downloadFinished = new Promise((resolve) => { finishDownload = resolve; });
      const blobUrl = new URL(pack.download.path, location.href).href;
      const downloadPromise = engine.measureDownload(pack.download, { url: blobUrl, timeoutMs: 15000 })
        .catch(() => ({ status: 'unknown', mbps: null, reportedMbps: null, capped: false, elapsed: 0 }))
        .finally(finishDownload);
      const loadedPromise = engine.measureUntil({
        probe: () => engine.probeOnce(primary.host, { signal: loadedController.signal }),
        stop: downloadFinished,
        samples: 8
      });
      const download = await downloadPromise;
      loadedController.abort();
      const loaded = await loadedPromise;
      const loadedLatency = download.loadedLatencyEligible ? engine.median(loaded.samples) : null;
      if (download.status !== 'measured') notTested.push('download', 'loaded-latency');
      else if (!Number.isFinite(loadedLatency)) notTested.push('loaded-latency');
      const dlSentence = download.status === 'measured'
        ? download.capped
          ? `Download sufficiency reached at least ${download.reportedMbps} Mbit/s over HTTPS from this site.`
          : `Download throughput measured ${Math.round(download.reportedMbps)} Mbit/s over HTTPS from this site.`
        : verdict.findingSentence('unknown');
      findings.push(addInfo('download', download.status === 'measured' ? download.reportedMbps : null, 'Mbit/s', pack.download.claim, {
        sentence: dlSentence
      }));
      findings.push(addInfo('loaded-latency', loadedLatency, 'ms'));
    }

    const vantage = verdict.detectVantage(regionResults);
    if (vantage !== 'unknown') {
      const vantageIdx = notTested.indexOf('vantage');
      if (vantageIdx >= 0) notTested.splice(vantageIdx, 1);
    }
    const caveats = verdict.detectProxyCaveats({
      hostResults,
      regionResults,
      selectedGeographies: geographies
    });
    const relayNote = verdict.relayGeographyNote(regionResults);
    const browser = browserDetails();
    const run = {
      pack,
      createdAt: new Date().toISOString(),
      browser,
      platform: browser.platform,
      region: targetRegion ? targetRegion.id : null,
      vantage,
      caveats,
      relayNote,
      sentiment: readSentiment(),
      findings,
      notTested,
      regionResults,
      targetRegionDetail: phased.targetRegionResult,
      fullRegions: false
    };
    if (targetRegion) setTargetRegionResult(run, targetRegion.id);
    lastRun = run;
    renderRun(run, 'Check complete. Nothing was shared.');
    progress.value = progress.max;
    runButton.disabled = false;
    packSelect.disabled = false;
    regionSelect.disabled = false;
    document.querySelectorAll('input[name="region-geo"]').forEach((input) => { input.disabled = false; });
    $('full-regions').disabled = false;
    $('copy-summary').disabled = false;
    $('download-json').disabled = false;
    $('download-intake').disabled = false;
    go('results', true);
  }

  function setTargetRegionResult(run, regionId) {
    run.findings = run.findings.filter((finding) => finding.id !== 'target-region');
    run.notTested = run.notTested.filter((id) => id !== 'target-region');
    run.region = regionId || null;
    if (!regionId) {
      if (run.pack.regionalProbe) run.notTested.push('target-region');
      return;
    }
    const detail = run.targetRegionDetail && run.targetRegionDetail.regionId === regionId
      ? run.targetRegionDetail.result
      : run.regionResults.find((entry) => entry.region.id === regionId)?.result;
    const medianMs = detail && detail.status === 'reached' ? detail.median : null;
    if (run.pack.thresholds.length) {
      run.findings.push(verdict.rttFinding(medianMs, run.pack.thresholds, { id: 'target-region', required: true }));
    } else {
      run.findings.push(addInfo('target-region', medianMs, 'ms'));
    }
    if (!detail || detail.status !== 'reached') run.notTested.push('target-region');
  }

  function renderRun(run, statusMessage) {
    lastExport = exporter.makeExport(run);
    const overall = verdict.overallVerdict(run.findings);
    const tone = overall.status === 'pass' ? 'good' : (overall.status === 'warn' || overall.status === 'blocked') ? 'ok' : overall.status === 'fail' ? 'poor' : '';
    const overallEl = $('overall');
    overallEl.className = `bl overall${tone ? ` ${tone}` : ''}`;
    overallEl.dataset.status = overall.status;
    overallEl.textContent = overall.label;

    const vantageText = run.vantage === 'likely-session-host'
      ? 'This browser appears to be running inside or next to an Azure datacenter (regional RTT under 5 ms). Run this check on your own device for a client-path result.'
      : 'Browser HTTPS check complete. Timings are upper bounds from this browser and do not measure UDP Shortpath or the session host.';
    $('overall-note').textContent = vantageText;

    const caveatList = $('caveat-list');
    const caveats = run.caveats || [];
    caveatList.hidden = caveats.length === 0;
    caveatList.replaceChildren(...caveats.map((c) => el('li', { textContent: c.sentence })));

    const relayEl = $('relay-note');
    if (run.relayNote) {
      relayEl.hidden = false;
      relayEl.textContent = run.relayNote.sentence;
    } else {
      relayEl.hidden = true;
      relayEl.textContent = '';
    }

    renderFindings(run.findings.filter((finding) => !finding.id.startsWith('region.')));
    renderNotTested(run.notTested);
    renderRegionRanking(run);
    runState.textContent = statusMessage;
    renderSteps();
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
    const visible = verdict.visibleRegions(results, run.region, showAllRegions, top);
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
        result.status === 'reached' ? `at most ${Math.round(result.median)} ms` : 'No answer',
        verdict.regionRating(result.median)
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
      ? `${target.region.name}: ${target.result.status === 'reached' ? `at most ${Math.round(target.result.median)} ms` : 'no answer'}. This browser measurement is to a regional service endpoint, not the session host.`
      : fastest
        ? `Fastest measured: ${fastest.region.name} (at most ${Math.round(fastest.result.median)} ms). ${run.pack.id === 'avd' ? 'Select your actual host pool region to apply the AVD threshold.' : 'Select a region to compare it.'}`
        : 'No selected regional endpoint answered.';
    const more = $('show-regions');
    more.hidden = results.length <= top;
    more.textContent = showAllRegions ? `Show top ${top} only` : `Show all ${results.length} regions`;
    more.setAttribute('aria-expanded', String(showAllRegions));
  }

  function labelFor(id) {
    if (!packData) return id;
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
      const head = el('div', { className: 'finding-head' });
      const pill = el('strong', {
        className: `outcome o-${finding.status}`,
        textContent: statusNames[finding.status] ?? 'Not measured'
      });
      const valText = Number.isFinite(finding.value)
        ? finding.unit === 'ms' && finding.id !== 'jitter.primary'
          ? ` - at most ${Math.round(finding.value)} ms`
          : ` - ${Math.round(finding.value)} ${finding.unit ?? ''}`
        : '';
      head.append(pill, document.createTextNode(` ${labelFor(finding.id)}${valText}`));
      item.append(head);
      const sentence = el('p', { textContent: finding.sentence ?? verdict.findingSentence(finding.status) });
      item.append(sentence);
      if (finding.id === 'target-region' && (finding.status === 'warn' || finding.status === 'fail')) {
        const help = el('p');
        const link1 = el('a', { href: 'steps/index.html?step=avd.connection-info', textContent: 'Check session Connection Information' });
        const link2 = el('a', { href: 'steps/index.html?step=avd.shortpath-test', textContent: 'Run the Microsoft Shortpath test' });
        help.append(link1, document.createTextNode(' \u00b7 '), link2);
        item.append(help);
      }
      return item;
    }));
  }

  function renderNotTested(ids) {
    const list = $('not-tested');
    list.replaceChildren(...[...new Set(ids)].map((id) => el('li', { textContent: labelFor(id) })));
  }

  // ---- Context step: sentiment, capture, comments ----
  function readSentiment() {
    const ratingEl = document.querySelector('input[name="sentiment-rating"]:checked');
    const rating = ratingEl && ratingEl.value ? Number(ratingEl.value) : null;
    const symptoms = [...document.querySelectorAll('input[name="symptom-id"]:checked')].map((i) => i.value);
    return exporter.validateSentiment({ rating, symptoms });
  }

  function initContextControls() {
    document.querySelectorAll('input[name="sentiment-rating"], input[name="symptom-id"]').forEach((input) => {
      input.addEventListener('change', () => {
        contextDone = true;
        if (lastRun) {
          lastRun.sentiment = readSentiment();
          lastExport = exporter.makeExport(lastRun);
        }
        renderSteps();
      });
    });

    const commentText = $('comment-text');
    const commentTime = $('comment-time');
    const saveBtn = $('save-comments');
    const syncComments = () => {
      const hasText = commentText.value.trim().length > 0 || commentTime.value.trim().length > 0;
      saveBtn.disabled = !hasText;
      commentsDirty = hasText;
    };
    commentText.addEventListener('input', syncComments);
    commentTime.addEventListener('input', syncComments);
    saveBtn.addEventListener('click', () => {
      const lines = [
        'avd-linecheck private user notes (not included in avd-linecheck-result.json)',
        `Created: ${new Date().toISOString()}`,
        ...(commentTime.value.trim() ? [`When noticed: ${commentTime.value.trim()}`] : []),
        '',
        commentText.value.trim(),
        ''
      ];
      downloadBlob(lines.join('\n'), 'text/plain', 'comments.txt');
      commentsDirty = false;
      contextDone = true;
      $('comment-state').textContent = 'Saved comments.txt to your device.';
      renderSteps();
    });
    window.addEventListener('beforeunload', (e) => {
      if (commentsDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function clearCapturePreview() {
    if (activeCaptureUrl) {
      URL.revokeObjectURL(activeCaptureUrl);
      activeCaptureUrl = null;
    }
    $('capture-img').hidden = true;
    $('capture-img').removeAttribute('src');
    $('capture-vid').hidden = true;
    $('capture-vid').removeAttribute('src');
    $('capture-preview').hidden = true;
  }

  function stopCaptureStream() {
    clearTimeout(activeRecordTimer);
    if (activeStream) {
      activeStream.getTracks().forEach((t) => t.stop());
      activeStream = null;
    }
    $('capture-stop').hidden = true;
  }

  function initCaptureControls() {
    const isMac = /Mac/i.test(navigator.userAgent);
    $('capture-guide-link').href = `steps/index.html?step=${isMac ? 'macos.capture' : 'windows.capture'}`;
    const canDisplay = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
    const canRecord = canDisplay && typeof window.MediaRecorder === 'function';
    if (!canDisplay) {
      $('capture-photo').disabled = true;
      $('capture-video').disabled = true;
      $('capture-state').textContent = 'This browser does not support in-browser window capture. Use the OS screenshot guide instead.';
      return;
    }
    if (!canRecord) {
      $('capture-video').disabled = true;
    }

    $('capture-photo').addEventListener('click', async () => {
      clearCapturePreview();
      $('capture-state').textContent = 'Choose a window or screen to capture...';
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        activeStream = stream;
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        stopCaptureStream();
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Could not encode screenshot');
        activeCaptureUrl = URL.createObjectURL(blob);
        $('capture-img').src = activeCaptureUrl;
        $('capture-img').hidden = false;
        $('capture-save').href = activeCaptureUrl;
        $('capture-save').download = 'linecheck-screenshot.png';
        $('capture-preview').hidden = false;
        $('capture-state').textContent = 'Review the screenshot below for private details before saving it.';
        contextDone = true;
        renderSteps();
      } catch {
        stopCaptureStream();
        $('capture-state').textContent = 'Screenshot cancelled or unavailable. You can also use the OS screenshot guide.';
      }
    });

    $('capture-video').addEventListener('click', async () => {
      clearCapturePreview();
      $('capture-state').textContent = 'Choose a window or screen to record (up to 15 seconds)...';
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        activeStream = stream;
        const chunks = [];
        const recorder = new MediaRecorder(stream);
        activeRecorder = recorder;
        recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); });
        recorder.addEventListener('stop', () => {
          stopCaptureStream();
          const mime = recorder.mimeType || 'video/webm';
          const ext = mime.includes('mp4') ? 'mp4' : 'webm';
          const blob = new Blob(chunks, { type: mime });
          activeCaptureUrl = URL.createObjectURL(blob);
          $('capture-vid').src = activeCaptureUrl;
          $('capture-vid').hidden = false;
          $('capture-save').href = activeCaptureUrl;
          $('capture-save').download = `linecheck-clip.${ext}`;
          $('capture-preview').hidden = false;
          $('capture-state').textContent = 'Review the recording below for private details before saving it.';
          contextDone = true;
          renderSteps();
        });
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          if (recorder.state !== 'inactive') recorder.stop();
        });
        recorder.start();
        $('capture-stop').hidden = false;
        $('capture-state').textContent = 'Recording (stops automatically after 15 seconds)...';
        activeRecordTimer = setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
        }, 15000);
      } catch {
        stopCaptureStream();
        $('capture-state').textContent = 'Recording cancelled or unavailable.';
      }
    });

    $('capture-stop').addEventListener('click', () => {
      if (activeRecorder && activeRecorder.state !== 'inactive') activeRecorder.stop();
    });

    $('capture-discard').addEventListener('click', () => {
      clearCapturePreview();
      $('capture-state').textContent = 'Capture discarded.';
    });
  }

  // ---- Share and read ----
  function summaryText(result = lastExport) {
    if (!result) return '';
    const lines = [
      `avd-linecheck ${result.toolVersion} - ${result.pack.id} ${result.pack.version}`,
      `Overall: ${result.overall.label}`,
      `Run: ${result.createdAt} (${result.platform}, ${result.browser.family}${result.browser.major ? ` ${result.browser.major}` : ''}, vantage: ${result.vantage})`,
      `Regional detail: ${result.regionScope === 'all-measured' ? 'all measured regions' : 'top three measured regions'}`,
      ...(result.custom ? ['Custom pack: review host names before sharing publicly.'] : []),
      ...(result.caveats && result.caveats.length ? result.caveats.map((c) => `Caveat (${c.id}): ${c.sentence}`) : []),
      ...(result.sentiment && result.sentiment.rating ? [`User rating: ${result.sentiment.rating}/5${result.sentiment.symptoms.length ? ` (${result.sentiment.symptoms.join(', ')})` : ''}`] : []),
      ...result.findings.map((finding) => `${statusNames[finding.status] ?? finding.status}: ${labelFor(finding.id)}${finding.value === null ? '' : ` - ${finding.value} ${finding.unit ?? ''}`}. ${finding.sentence}`),
      `Not tested: ${result.notTested.map(labelFor).join(', ') || 'none listed'}`,
      'This is a browser network check, not a production assessment.'
    ];
    return lines.join('\n');
  }

  function downloadBlob(content, type, filename) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryText());
      shareDone = true;
      $('share-state').textContent = 'Summary copied. Review it before sharing.';
      runState.textContent = 'Summary copied. Review it before sharing.';
      renderSteps();
    } catch {
      $('share-state').textContent = 'Copy failed. Download the JSON result instead.';
    }
  }

  function downloadJson() {
    if (!lastExport) return;
    downloadBlob(`${JSON.stringify(lastExport, null, 2)}\n`, 'application/json', 'avd-linecheck-result.json');
    shareDone = true;
    $('share-state').textContent = 'Downloaded avd-linecheck-result.json.';
    renderSteps();
  }

  function downloadIntake() {
    if (!lastRun) return;
    const entry = exporter.makeIntakeEntry(lastRun);
    downloadBlob(`${JSON.stringify(entry, null, 2)}\n`, 'application/json', 'avd-linecheck-intake.json');
    shareDone = true;
    $('share-state').textContent = 'Downloaded avd-linecheck-intake.json for the assessment portal.';
    renderSteps();
  }

  function readSharedResult() {
    $('paste-findings').replaceChildren();
    $('paste-reply').hidden = false;
    try {
      const result = exporter.parseSharedResult($('paste-input').value, currentPack());
      const tone = result.overall.status === 'pass' ? 'good' : (result.overall.status === 'warn' || result.overall.status === 'blocked') ? 'ok' : result.overall.status === 'fail' ? 'poor' : '';
      $('paste-state').className = `bl run-state${tone ? ` ${tone}` : ''}`;
      $('paste-state').textContent = `${result.overall.label}. ${result.sentencesAvailable
        ? 'Shared result. Its wording was checked against this pack.'
        : 'This pack version differs. Numbers and states are shown; sentences may not match.'}`;
      const extraNotes = [];
      if (result.caveats && result.caveats.length) {
        extraNotes.push(...result.caveats.map((c) => c.sentence));
      }
      if (result.sentiment && (result.sentiment.rating || result.sentiment.symptoms.length)) {
        extraNotes.push(`User experience: ${result.sentiment.rating ? `${result.sentiment.rating}/5` : 'unrated'}${result.sentiment.symptoms.length ? ` (${result.sentiment.symptoms.join(', ')})` : ''}.`);
      }
      $('paste-note').textContent = extraNotes.join(' ');
      renderFindings(result.findings, 'paste-findings');
      shareDone = true;
      renderSteps();
    } catch {
      $('paste-state').className = 'bl run-state poor';
      $('paste-state').textContent = 'This result is not valid for the selected pack.';
      $('paste-note').textContent = '';
    }
  }

  init().catch(() => {
    runButton.disabled = true;
    runState.textContent = 'The check could not load its local pack files.';
  });
})();
