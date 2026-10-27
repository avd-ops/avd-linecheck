/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT. */
(function () {
  'use strict';
  const engine = window.LinecheckEngine;
  const verdict = window.LinecheckVerdict;
  const exporter = window.LinecheckExport;
  const portalEngine = window.AvdOpsEngine || {};

  const $ = (id) => document.getElementById(id);
  const cloudSelect = $('cloud-select');
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
  const PACK_IDS = ['generic', 'avd', 'avd-gov', 'w365', 'teams', 'm365'];
  const WORKLOAD_IDS = ['avd', 'w365', 'teams', 'm365'];
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
  let baselineExport = null;
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
    if (PACK_IDS.includes(savedPack)) {
      $('default-pack').value = savedPack;
      packSelect.value = savedPack;
      if (savedPack === 'avd-gov' && cloudSelect) cloudSelect.value = 'gov';
    }
  } catch { /* storage blocked */ }

  $('default-pack').addEventListener('change', () => {
    const val = $('default-pack').value;
    try {
      if (PACK_IDS.includes(val)) localStorage.setItem(PACK_KEY, val);
      else localStorage.removeItem(PACK_KEY);
    } catch { /* storage blocked */ }
    if (PACK_IDS.includes(val)) {
      packSelect.value = val;
      if (val === 'avd-gov' && cloudSelect) cloudSelect.value = 'gov';
      syncWorkloadsFromPack();
      selectionChanged();
    }
  });

  if (new URL(location.href).searchParams.has('lite')) {
    $('lite-mode').checked = true;
  }
  $('lite-mode').addEventListener('change', () => {
    if ($('hd-lite')) $('hd-lite').checked = $('lite-mode').checked;
    updateHelpdeskLinks();
  });

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

  function currentCloud() {
    if (cloudSelect && cloudSelect.value === 'gov') return 'gov';
    if (packSelect.value === 'avd-gov') return 'gov';
    return 'commercial';
  }

  function selectedWorkloads() {
    return [...document.querySelectorAll('input[name="workload-id"]:checked')].map((i) => i.value);
  }

  function syncWorkloadsFromPack() {
    const p = packSelect.value;
    const targetWorkload = p === 'avd-gov' ? 'avd' : WORKLOAD_IDS.includes(p) ? p : '';
    document.querySelectorAll('input[name="workload-id"]').forEach((input) => {
      input.checked = Boolean(targetWorkload && input.value === targetWorkload);
    });
  }

  function syncPackFromWorkloads() {
    const wl = selectedWorkloads();
    const cloud = currentCloud();
    if (wl.length === 1) {
      packSelect.value = wl[0] === 'avd' && cloud === 'gov' ? 'avd-gov' : wl[0];
    } else if (wl.length > 1) {
      if (wl.includes('avd')) packSelect.value = cloud === 'gov' ? 'avd-gov' : 'avd';
      else packSelect.value = wl[0];
    }
  }

  async function init() {
    renderSteps();
    initCaptureControls();
    initContextControls();
    const [generic, avd, avdGov, w365, teams, m365, endpointMap, regionMap] = await Promise.all([
      json('packs/generic.json'),
      json('packs/avd.json'),
      json('packs/avd-gov.json'),
      json('packs/w365.json'),
      json('packs/teams.json'),
      json('packs/m365.json'),
      json('packs/endpoints.json'),
      json('packs/regions.json')
    ]);
    const packs = { generic, avd, 'avd-gov': avdGov, w365, teams, m365 };
    for (const pack of Object.values(packs)) {
      const regList = pack.cloud === 'gov' ? regionMap.govRegions : regionMap.regions;
      engine.validatePack(pack, endpointMap, regList);
    }
    const allRegions = [...regionMap.regions, ...(regionMap.govRegions || [])];
    const allHostIds = [...new Set(Object.values(packs).flatMap((p) => [
      ...p.hosts.map((h) => h.id),
      ...(p.notTested || [])
    ]))];
    const url = new URL(location.href);
    const requestedCloud = url.searchParams.get('cloud');
    const requestedPack = url.searchParams.get('pack');
    const requestedWorkloads = (url.searchParams.get('workloads') || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => WORKLOAD_IDS.includes(s));
    const requestedRegion = url.searchParams.get('region');

    if (requestedCloud === 'gov' || requestedPack === 'avd-gov' || /^usgov/.test(requestedRegion || '')) {
      if (cloudSelect) cloudSelect.value = 'gov';
      packSelect.value = 'avd-gov';
    } else if (requestedPack && PACK_IDS.includes(requestedPack)) {
      packSelect.value = requestedPack;
    } else if (url.searchParams.has('region')) {
      packSelect.value = currentCloud() === 'gov' ? 'avd-gov' : 'avd';
    }

    if (requestedWorkloads.length) {
      document.querySelectorAll('input[name="workload-id"]').forEach((input) => {
        input.checked = requestedWorkloads.includes(input.value);
      });
      syncPackFromWorkloads();
    } else {
      syncWorkloadsFromPack();
    }

    packData = { packs, endpointMap, regionMap };
    for (const pack of Object.values(packs)) {
      pack.allowedFindingIds = [
        'site.origin', 'target-region', 'jitter.primary', 'slow-samples', 'stalls.primary',
        'download', 'loaded-latency', 'dns.origin', 'setup.max',
        ...generalNotTested,
        ...endpointMap.views.browser.probe,
        ...endpointMap.views.browser.notTested,
        ...allHostIds,
        ...allRegions.map((region) => `region.${region.id}`)
      ];
    }
    if (cloudSelect) {
      cloudSelect.addEventListener('change', () => {
        if (cloudSelect.value === 'gov' && packSelect.value === 'avd') packSelect.value = 'avd-gov';
        else if (cloudSelect.value === 'commercial' && packSelect.value === 'avd-gov') packSelect.value = 'avd';
        selectionChanged();
      });
    }
    packSelect.addEventListener('change', () => {
      if (packSelect.value === 'avd-gov' && cloudSelect) cloudSelect.value = 'gov';
      else if (packSelect.value === 'avd' && cloudSelect && cloudSelect.value === 'gov') cloudSelect.value = 'commercial';
      syncWorkloadsFromPack();
      selectionChanged();
    });
    document.querySelectorAll('input[name="workload-id"]').forEach((input) => {
      input.addEventListener('change', () => {
        syncPackFromWorkloads();
        selectionChanged();
      });
    });
    regionSelect.addEventListener('change', () => {
      updateHelpdeskLinks();
      if (lastRun) selectTargetRegion(regionSelect.value);
      else updatePackView();
    });
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
    $('keep-baseline').addEventListener('click', keepAsBaseline);
    if ($('toggle-metrics')) {
      $('toggle-metrics').addEventListener('click', () => {
        const panel = $('connection-metrics');
        if (!panel) return;
        const willShow = panel.hidden;
        panel.hidden = !willShow;
        $('toggle-metrics').setAttribute('aria-expanded', String(willShow));
        $('toggle-metrics').textContent = willShow
          ? 'Hide connection details & metrics'
          : 'Show connection details & metrics';
      });
    }
    if ($('copy-metrics')) {
      $('copy-metrics').addEventListener('click', copyMetrics);
    }
    $('run-compare').addEventListener('click', runCompare);
    $('clear-baseline').addEventListener('click', clearBaseline);
    $('full-regions').addEventListener('change', () => {
      if (lastRun) {
        lastRun.fullRegions = $('full-regions').checked;
        lastExport = exporter.makeExport(lastRun);
      }
    });
    initHelpdeskControls();
    updatePackView();
    const validRegionIds = availableTargetRegions().map((r) => r.id);
    if (requestedRegion && validRegionIds.includes(requestedRegion)) {
      regionSelect.value = requestedRegion;
      if ($('hd-region')) $('hd-region').value = requestedRegion;
    }
    updateHelpdeskLinks();
    runButton.disabled = false;
  }

  function currentPack() {
    return packData.packs[packSelect.value] ?? packData.packs.generic;
  }

  function activeWorkloadPacks() {
    const wl = selectedWorkloads();
    const cloud = currentCloud();
    if (!wl.length) return [currentPack()];
    return wl.map((id) => {
      if (id === 'avd' && cloud === 'gov') return packData.packs['avd-gov'];
      return packData.packs[id];
    }).filter(Boolean);
  }

  function availableTargetRegions() {
    if (!packData) return [];
    const cloud = currentCloud();
    const packs = activeWorkloadPacks();
    if (!packs.some((p) => p.regionalProbe)) return [];
    if (cloud === 'gov') return packData.regionMap.govRegions || [];
    const isAvdOrW365 = packs.some((p) => p.id === 'avd' || p.id === 'w365');
    return isAvdOrW365
      ? packData.regionMap.regions.filter((r) => packData.regionMap.avdTargetRegionIds.includes(r.id))
      : packData.regionMap.regions;
  }

  function selectionChanged() {
    updatePackView();
    updateHelpdeskLinks();
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
    const wlPacks = activeWorkloadPacks();
    if (wlPacks.length > 1) {
      return engine.combineWorkloadTargets(wlPacks, packData.endpointMap);
    }
    if (pack.id !== 'generic') {
      return engine.probeTargets(pack, packData.endpointMap);
    }
    return [
      { id: 'site.origin', host: location.host, purpose: 'This page', required: true, claim: null },
      ...engine.probeTargets(pack, packData.endpointMap)
    ];
  }

  function updatePackView() {
    if (!packData) return;
    const pack = currentPack();
    const cloud = currentCloud();
    const wlPacks = activeWorkloadPacks();
    const hasRegionalProbe = wlPacks.some((p) => p.regionalProbe);
    const priorRegion = regionSelect.value;
    const targetRegions = availableTargetRegions();
    const regionIds = targetRegions.map((r) => r.id);

    $('gov-shortpath-banner').hidden = cloud !== 'gov';
    document.querySelectorAll('#geo-fieldset label[data-cloud]').forEach((label) => {
      const isMatch = label.dataset.cloud === cloud;
      label.hidden = !isMatch;
      const input = label.querySelector('input');
      if (input && isMatch && ![...document.querySelectorAll(`#geo-fieldset label[data-cloud="${cloud}"] input:checked`)].length) {
        input.checked = true;
      }
    });

    $('region-control').hidden = !hasRegionalProbe;
    $('region-field').hidden = !hasRegionalProbe;
    regionSelect.replaceChildren(new Option('No region selected', ''));
    for (const region of targetRegions) {
      regionSelect.append(new Option(`${region.name} (${region.geo})`, region.id));
    }
    if (regionIds.includes(priorRegion)) regionSelect.value = priorRegion;
    $('region-label').firstChild.textContent = (pack.id === 'avd' || pack.id === 'avd-gov' || pack.id === 'w365') ? 'Host pool region ' : 'Region to compare ';
    const hasAvd = wlPacks.some((p) => p.id === 'avd' || p.id === 'avd-gov' || p.id === 'w365');
    const hasTeams = wlPacks.some((p) => p.id === 'teams');
    $('avd-links').hidden = !hasAvd;
    if (hasAvd && pack.links && pack.links.endpoints) {
      $('avd-endpoints-link').href = pack.links.endpoints;
    }
    $('teams-links').hidden = !hasTeams;
    const targets = targetsFor(pack).map((target) => `${target.host} - ${target.purpose}`);
    $('pack-warning').hidden = !wlPacks.some((p) => exporter.hasCustomHosts(p));
    const activeRegionPool = engine.regionsForCloud(packData.regionMap, cloud);
    if (hasRegionalProbe) {
      targets.push(...activeRegionPool.map((region) => `${engine.regionalHost(packData.regionMap, region)} - regional timing`));
    }
    const list = $('target-list');
    list.replaceChildren(...targets.map((text) => el('li', { textContent: text })));
  }

  function selectedRegions() {
    const wlPacks = activeWorkloadPacks();
    if (!wlPacks.some((p) => p.regionalProbe)) return [];
    const cloud = currentCloud();
    const pool = engine.regionsForCloud(packData.regionMap, cloud);
    const geographies = selectedGeographies();
    return engine.selectRegions(pool, geographies, regionSelect.value);
  }

  function selectedGeographies() {
    const cloud = currentCloud();
    return [...document.querySelectorAll(`#geo-fieldset label[data-cloud="${cloud}"] input[name="region-geo"]:checked`)].map((input) => input.value);
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
    const cloud = currentCloud();
    const wlPacks = activeWorkloadPacks();
    const workloads = selectedWorkloads();
    const hasRegionalProbe = wlPacks.some((p) => p.regionalProbe);
    const targets = targetsFor(pack);
    const regions = selectedRegions();
    const geographies = selectedGeographies();
    const activeRegionPool = engine.regionsForCloud(packData.regionMap, cloud);
    const targetRegion = hasRegionalProbe ? activeRegionPool.find((region) => region.id === regionSelect.value) : null;
    const lite = $('lite-mode').checked || new URL(location.href).searchParams.has('lite');
    if (hasRegionalProbe && regions.length === 0) {
      runState.textContent = 'Pick at least one geography or choose a region to compare.';
      return;
    }
    const total = targets.length + regions.length + (targetRegion ? 4 : 3);
    let done = 0;
    const findings = [];
    const packNotTested = wlPacks.flatMap((p) => [
      ...(p.id === 'avd' ? packData.endpointMap.views.browser.notTested : []),
      ...(p.notTested || [])
    ]);
    const notTested = [...new Set([...packNotTested, ...generalNotTested])];
    if (hasRegionalProbe && !targetRegion) notTested.push('target-region');

    runButton.disabled = true;
    if (cloudSelect) cloudSelect.disabled = true;
    packSelect.disabled = true;
    regionSelect.disabled = true;
    document.querySelectorAll('input[name="workload-id"], input[name="region-geo"]').forEach((input) => { input.disabled = true; });
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

    const [phased, webClient] = await Promise.all([
      engine.runProbePhases({
        targets,
        regions,
        regionMap: packData.regionMap,
        targetRegionId: targetRegion ? targetRegion.id : null,
        deadlineMs: 85000,
        onProgress: (phase) => {
          done++;
          addProgress(done, total, `Running ${phase}...`);
        }
      }),
      engine.detectWebClientCapabilities()
    ]);

    const hostResults = phased.hostResults;
    findings.push(...hostResults.map(({ target, result }) =>
      verdict.reachabilityFinding(target, result.status, result.median, result.setupMs)
    ));
    notTested.push(...hostResults.filter(({ result }) => result.status !== 'reached').map(({ target }) => target.id));

    const setupValues = hostResults
      .map(({ result }) => (result && Number.isFinite(result.setupMs) ? result.setupMs : null))
      .filter((v) => v !== null);
    if (setupValues.length) {
      findings.push(addInfo('setup.max', Math.max(...setupValues), 'ms'));
    }
    const dnsOriginMs = engine.sameOriginDnsHint();
    if (dnsOriginMs !== null) {
      findings.push(addInfo('dns.origin', dnsOriginMs, 'ms'));
    }

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
    let downloadDetail = null;
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
      downloadDetail = { ...download, loadedLatency };
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
    const relayNote = cloud === 'gov' ? null : verdict.relayGeographyNote(regionResults);
    const govShortpath = verdict.cloudShortpathNote(cloud);
    const hasTeams = wlPacks.some((p) => p.id === 'teams');
    const browser = browserDetails();
    const run = {
      pack,
      cloud,
      workloads,
      hasTeams,
      govShortpath,
      webClient,
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
      hostResults,
      jitterDetail: jitter,
      downloadDetail,
      dnsOriginMs,
      lite,
      regionResults,
      targetRegionDetail: phased.targetRegionResult,
      fullRegions: false
    };
    if (targetRegion) setTargetRegionResult(run, targetRegion.id);
    lastRun = run;
    renderRun(run, 'Check complete. Nothing was shared.');
    progress.value = progress.max;
    runButton.disabled = false;
    if (cloudSelect) cloudSelect.disabled = false;
    packSelect.disabled = false;
    regionSelect.disabled = false;
    document.querySelectorAll('input[name="workload-id"], input[name="region-geo"]').forEach((input) => { input.disabled = false; });
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
    const wlPacks = activeWorkloadPacks();
    const hasRegionalProbe = wlPacks.some((p) => p.regionalProbe) || run.pack.regionalProbe;
    if (!regionId) {
      if (hasRegionalProbe) run.notTested.push('target-region');
      return;
    }
    const detail = run.targetRegionDetail && run.targetRegionDetail.regionId === regionId
      ? run.targetRegionDetail.result
      : run.regionResults.find((entry) => entry.region.id === regionId)?.result;
    const medianMs = detail && detail.status === 'reached' ? detail.median : null;
    const thresholds = run.pack.thresholds && run.pack.thresholds.length
      ? run.pack.thresholds
      : (wlPacks.find((p) => p.thresholds && p.thresholds.length)?.thresholds || []);
    if (thresholds.length) {
      run.findings.push(verdict.rttFinding(medianMs, thresholds, { id: 'target-region', required: true }));
    } else {
      run.findings.push(addInfo('target-region', medianMs, 'ms'));
    }
    if (!detail || detail.status !== 'reached') run.notTested.push('target-region');
  }

  function renderRun(run, statusMessage) {
    lastExport = exporter.makeExport(run);
    const overall = verdict.overallVerdict(run.findings, { vantage: run.vantage === 'likely-session-host' ? 'likely-session-host' : 'device' });
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

    const govEl = $('gov-shortpath-note');
    if (govEl) {
      if (run.govShortpath) {
        govEl.hidden = false;
        govEl.textContent = `${run.govShortpath.sentence} (${run.govShortpath.claim})`;
      } else {
        govEl.hidden = true;
        govEl.textContent = '';
      }
    }

    const teamsNoteEl = $('teams-vdi-note');
    if (teamsNoteEl) {
      teamsNoteEl.hidden = !run.hasTeams && run.pack.id !== 'teams';
    }

    renderConnectionMetrics(run);
    renderFindings(run.findings.filter((finding) => !finding.id.startsWith('region.')));
    renderWebClientReadiness(run.webClient);
    renderNotTested(run.notTested);
    renderRegionRanking(run);
    runState.textContent = statusMessage;
    renderSteps();
  }

  function renderConnectionMetrics(run) {
    const panel = $('connection-metrics');
    if (!panel || typeof verdict.summarizeMetrics !== 'function') return;
    const summary = verdict.summarizeMetrics(run);
    panel.hidden = false;
    if ($('toggle-metrics')) {
      $('toggle-metrics').setAttribute('aria-expanded', 'true');
      $('toggle-metrics').textContent = 'Hide connection details & metrics';
    }
    const cardsEl = $('metric-cards');
    if (cardsEl) {
      cardsEl.replaceChildren(...summary.cards.map((card) => {
        const box = el('div', { className: 'metric-card', role: 'listitem' });
        box.dataset.status = card.status;
        box.append(
          el('p', { className: 'metric-label', textContent: card.label }),
          el('p', { className: 'metric-val', textContent: card.value }),
          el('p', { className: 'metric-sub', textContent: card.detail })
        );
        return box;
      }));
    }
    const detailsBody = $('connection-details-rows');
    if (detailsBody) {
      detailsBody.replaceChildren(...summary.connectionDetails.map((item) => {
        const tr = document.createElement('tr');
        const th = el('th', { textContent: item.label });
        th.setAttribute('scope', 'row');
        const td = el('td', { textContent: item.value });
        tr.append(th, td);
        return tr;
      }));
    }
    const epBody = $('endpoint-metrics-rows');
    if (epBody) {
      epBody.replaceChildren(...summary.endpoints.map((ep) => {
        const tr = document.createElement('tr');
        const hostCell = document.createElement('td');
        hostCell.append(
          el('code', { textContent: ep.host }),
          document.createTextNode(ep.purpose && ep.purpose !== ep.host ? ` (${ep.purpose})` : '')
        );
        const roleCell = el('td', { textContent: ep.required ? 'Required' : 'Informational' });
        const statusCell = document.createElement('td');
        statusCell.append(el('strong', {
          className: `outcome o-${ep.status}`,
          textContent: statusNames[ep.status] ?? ep.status
        }));
        const warmUpCell = el('td', { textContent: ep.warmUpMs !== null ? `${ep.warmUpMs} ms` : 'n/a' });
        const medianCell = el('td', { textContent: ep.medianMs !== null ? `at most ${ep.medianMs} ms` : 'No answer' });
        const setupCell = el('td', { textContent: ep.setupMs !== null ? `+${ep.setupMs} ms` : 'n/a' });
        const samplesCell = el('td', { textContent: `${ep.sampleCount} ok / ${ep.stalls} stalls${ep.slowSamples ? ` / ${ep.slowSamples} slow` : ''}` });
        tr.append(hostCell, roleCell, statusCell, warmUpCell, medianCell, setupCell, samplesCell);
        return tr;
      }));
    }
  }

  function metricsText(run = lastRun) {
    if (!run || typeof verdict.summarizeMetrics !== 'function') return '';
    const summary = verdict.summarizeMetrics(run);
    const lines = [
      '=== Performance Metrics ===',
      ...summary.cards.map((c) => `${c.label}: ${c.value} (${c.detail})`),
      '',
      '=== Connection & Environment Details ===',
      ...summary.connectionDetails.map((d) => `${d.label}: ${d.value}`),
      '',
      '=== Per-Endpoint Performance Breakdown ===',
      ...summary.endpoints.map((ep) => `${ep.host} [${ep.required ? 'Required' : 'Info'}]: ${statusNames[ep.status] ?? ep.status} | cold=${ep.warmUpMs !== null ? `${ep.warmUpMs}ms` : 'n/a'} | warm=${ep.medianMs !== null ? `<=${ep.medianMs}ms` : 'n/a'} | setup=${ep.setupMs !== null ? `+${ep.setupMs}ms` : 'n/a'} | samples=${ep.sampleCount} ok, ${ep.stalls} stalls`)
    ];
    return lines.join('\n');
  }

  async function copyMetrics() {
    if (!lastRun) return;
    const text = metricsText(lastRun);
    try {
      await navigator.clipboard.writeText(text);
      if ($('baseline-state')) $('baseline-state').textContent = 'Copied connection details & performance metrics to clipboard.';
    } catch {
      if ($('baseline-state')) $('baseline-state').textContent = 'Could not copy automatically. Use Share in Step 4.';
    }
  }

  function renderWebClientReadiness(webClient) {
    const box = $('webclient-readiness');
    const list = $('webclient-list');
    if (!box || !list || !webClient) {
      if (box) box.hidden = true;
      return;
    }
    box.hidden = false;
    const items = [
      `WebCodecs H.264 decode: ${webClient.h264 ? 'Supported' : 'Not detected'}`,
      `WebCodecs AV1 decode: ${webClient.av1 ? 'Supported' : 'Not detected'}`,
      `Async Clipboard API: ${webClient.clipboard ? 'Supported' : 'Not detected'}`,
      `Window Management API (multi-monitor): ${webClient.multiScreen ? 'Supported' : 'Not detected'}`
    ];
    list.replaceChildren(...items.map((text) => el('li', { textContent: text })));
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
      picker.disabled = result.status !== 'reached' || (
        run.pack.id === 'avd' && !packData.regionMap.avdTargetRegionIds.includes(region.id)
      ) || (
        run.pack.id === 'avd-gov' && !(packData.regionMap.avdGovTargetRegionIds || []).includes(region.id)
      );
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
    for (const pack of Object.values(packData.packs)) {
      const host = pack.hosts.find((item) => item.id === id);
      if (host) return `${host.host} (${host.purpose})`;
    }
    const regionId = id.replace(/^region\./, '');
    const allRegions = [...packData.regionMap.regions, ...(packData.regionMap.govRegions || [])];
    const region = allRegions.find((item) => item.id === regionId);
    if (region) return `${region.name} regional timing`;
    return ({
      'site.origin': 'This page',
      'target-region': (currentPack().id === 'avd' || currentPack().id === 'avd-gov' || currentPack().id === 'w365') ? 'Selected host pool region, measured from this browser' : 'Selected region, measured from this browser',
      'jitter.primary': 'Jitter to the primary host',
      'slow-samples': 'Slow samples',
      'stalls.primary': 'Timed-out jitter samples',
      'setup.max': 'Highest cold connection setup overhead (DNS, TCP, TLS)',
      'dns.origin': 'Same-origin DNS lookup hint for this site',
      download: 'Download sufficiency from this site',
      'loaded-latency': 'Latency while downloading',
      upload: 'Upload speed',
      udp: 'UDP reachability',
      'session-transport': 'Transport used by your desktop session',
      'session-host': 'Session host connectivity',
      'wildcard-endpoints': 'Wildcard service endpoints the browser cannot probe',
      'gov.wvd': '*.wvd.azure.us (US Government feed, broker, and gateway wildcard)',
      'gov.service': '*.service.windows.cloud.microsoft (US Government service wildcard)',
      'gov.relay': 'UDP 3478 STUN Shortpath (TURN relay is Commercial-only)',
      'teams.media-udp': 'UDP 3478-3481 media relays for Teams VDI SlimCore and WebRTC',
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
      const setupSuffix = Number.isFinite(finding.setupMs)
        ? ` (cold setup +${Math.round(finding.setupMs)} ms)`
        : '';
      const valText = Number.isFinite(finding.value)
        ? finding.unit === 'ms' && finding.id !== 'jitter.primary' && finding.id !== 'dns.origin' && finding.id !== 'setup.max'
          ? ` - at most ${Math.round(finding.value)} ms${setupSuffix}`
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
      if (finding.id.startsWith('teams.')) {
        const help = el('p');
        const link1 = el('a', { href: 'steps/index.html?step=teams.vdi-optimization', textContent: 'Verify Teams VDI optimization' });
        const link2 = el('a', { href: 'steps/index.html?step=teams.logs.windows', textContent: 'Collect Teams support logs' });
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
      const result = exporter.parseSharedResult($('paste-input').value, packData ? packData.packs : currentPack());
      const tone = result.overall.status === 'pass' ? 'good' : (result.overall.status === 'warn' || result.overall.status === 'blocked') ? 'ok' : result.overall.status === 'fail' ? 'poor' : '';
      $('paste-state').className = `bl run-state${tone ? ` ${tone}` : ''}`;
      $('paste-state').textContent = `${result.overall.label} (${result.pack.id}). ${result.sentencesAvailable
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
      $('paste-state').textContent = 'This result is not valid for the shipped packs.';
      $('paste-note').textContent = '';
    }
  }

  function keepAsBaseline() {
    if (!lastExport) return;
    baselineExport = lastExport;
    $('baseline-state').textContent = `Baseline kept (${baselineExport.createdAt}). Run a second check or open Share to compare.`;
    $('clear-baseline').hidden = false;
  }

  function clearBaseline() {
    baselineExport = null;
    $('baseline-state').textContent = '';
    $('clear-baseline').hidden = true;
    $('compare-reply').hidden = true;
    $('compare-list').replaceChildren();
  }

  function runCompare() {
    $('compare-list').replaceChildren();
    $('compare-reply').hidden = false;
    try {
      const pastedText = $('compare-input').value.trim();
      const pasted = pastedText
        ? exporter.parseSharedResult(pastedText, packData ? packData.packs : currentPack())
        : null;
      let before = null;
      let after = null;
      if (baselineExport && lastExport && baselineExport !== lastExport && !pasted) {
        before = baselineExport;
        after = lastExport;
      } else if (baselineExport && pasted) {
        before = baselineExport;
        after = pasted;
      } else if (pasted && lastExport) {
        before = pasted;
        after = lastExport;
      } else if (baselineExport && lastExport) {
        before = baselineExport;
        after = lastExport;
      } else {
        throw new Error('Need two runs');
      }
      const diff = exporter.compareResults(before, after);
      $('compare-state').className = 'bl run-state';
      $('compare-state').textContent = `Verdict: ${before.overall.status} -> ${after.overall.status}`;
      const lines = [];
      if (diff.rttDeltaMs !== null) {
        const sign = diff.rttDeltaMs > 0 ? `+${diff.rttDeltaMs}` : String(diff.rttDeltaMs);
        lines.push(`RTT change: ${diff.baseRttMs} ms -> ${diff.currRttMs} ms (${sign} ms)`);
      }
      if (diff.jitterDeltaMs !== null) {
        const sign = diff.jitterDeltaMs > 0 ? `+${diff.jitterDeltaMs}` : String(diff.jitterDeltaMs);
        lines.push(`Jitter change: ${diff.baseJitterMs} ms -> ${diff.currJitterMs} ms (${sign} ms)`);
      }
      if (diff.blockedCleared.length) {
        lines.push(`Blocked checks cleared: ${diff.blockedCleared.map(labelFor).join(', ')}`);
      }
      if (diff.newlyBlocked.length) {
        lines.push(`Newly blocked checks: ${diff.newlyBlocked.map(labelFor).join(', ')}`);
      }
      if (diff.caveatsCleared.length) {
        lines.push(`Proxy or tunnel caveats cleared: ${diff.caveatsCleared.join(', ')}`);
      }
      if (diff.caveatsAdded.length) {
        lines.push(`Proxy or tunnel caveats added: ${diff.caveatsAdded.join(', ')}`);
      }
      if (!lines.length) {
        lines.push('No RTT, jitter, block, or caveat changes detected between the two results.');
      }
      $('compare-list').replaceChildren(...lines.map((text) => el('li', { textContent: text })));
      shareDone = true;
      renderSteps();
    } catch {
      $('compare-state').className = 'bl run-state poor';
      $('compare-state').textContent = 'Keep a baseline run in step 2 or paste a valid result JSON to compare against the current run.';
    }
  }

  function populateHelpdeskRegions() {
    if (!packData || !$('hd-region')) return;
    const cloud = $('hd-cloud').value;
    const packId = $('hd-pack').value;
    const prior = $('hd-region').value;
    const regions = cloud === 'gov' || packId === 'avd-gov'
      ? (packData.regionMap.govRegions || [])
      : (packId === 'avd' || packId === 'w365')
        ? packData.regionMap.regions.filter((r) => packData.regionMap.avdTargetRegionIds.includes(r.id))
        : packData.regionMap.regions;
    $('hd-region').replaceChildren(new Option('No region selected', ''));
    for (const region of regions) {
      $('hd-region').append(new Option(`${region.name} (${region.geo})`, region.id));
    }
    if (regions.some((r) => r.id === prior)) $('hd-region').value = prior;
  }

  function updateHelpdeskLinks() {
    if (!packData) return;
    const step1Url = engine.buildHelpdeskUrl({
      baseUrl: location.href,
      cloud: currentCloud(),
      pack: packSelect.value,
      workloads: selectedWorkloads(),
      region: regionSelect.value,
      lite: $('lite-mode').checked
    });
    if ($('helpdesk-url-step1')) $('helpdesk-url-step1').value = step1Url;

    if ($('hd-cloud') && $('hd-pack') && $('hd-region') && $('hd-lite')) {
      populateHelpdeskRegions();
      const step4Url = engine.buildHelpdeskUrl({
        baseUrl: location.href,
        cloud: $('hd-cloud').value,
        pack: $('hd-pack').value,
        workloads: [],
        region: $('hd-region').value,
        lite: $('hd-lite').checked
      });
      if ($('helpdesk-url-step4')) $('helpdesk-url-step4').value = step4Url;
    }
  }

  function initHelpdeskControls() {
    if ($('hd-cloud')) {
      $('hd-cloud').value = currentCloud();
      $('hd-cloud').addEventListener('change', () => {
        if ($('hd-cloud').value === 'gov' && $('hd-pack').value === 'avd') $('hd-pack').value = 'avd-gov';
        else if ($('hd-cloud').value === 'commercial' && $('hd-pack').value === 'avd-gov') $('hd-pack').value = 'avd';
        updateHelpdeskLinks();
      });
    }
    if ($('hd-pack')) {
      $('hd-pack').value = packSelect.value;
      $('hd-pack').addEventListener('change', () => {
        if ($('hd-pack').value === 'avd-gov' && $('hd-cloud')) $('hd-cloud').value = 'gov';
        else if ($('hd-pack').value === 'avd' && $('hd-cloud') && $('hd-cloud').value === 'gov') $('hd-cloud').value = 'commercial';
        updateHelpdeskLinks();
      });
    }
    if ($('hd-region')) {
      $('hd-region').addEventListener('change', updateHelpdeskLinks);
    }
    if ($('hd-lite')) {
      $('hd-lite').checked = $('lite-mode').checked || true;
      $('hd-lite').addEventListener('change', updateHelpdeskLinks);
    }
    const copyUrl = async (inputId, stateId) => {
      const val = $(inputId)?.value || '';
      if (!val) return;
      try {
        await navigator.clipboard.writeText(val);
        $(stateId).textContent = 'Copied helpdesk link.';
      } catch {
        $(inputId)?.select();
        $(stateId).textContent = 'Press Ctrl+C or Command+C to copy.';
      }
    };
    if ($('copy-helpdesk-step1')) {
      $('copy-helpdesk-step1').addEventListener('click', () => copyUrl('helpdesk-url-step1', 'helpdesk-state-step1'));
    }
    if ($('copy-helpdesk-step4')) {
      $('copy-helpdesk-step4').addEventListener('click', () => copyUrl('helpdesk-url-step4', 'helpdesk-state-step4'));
    }
  }

  init().catch(() => {
    runButton.disabled = true;
    runState.textContent = 'The check could not load its local pack files.';
  });
})();
