/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LinecheckSteps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STALE_MS = 180 * 24 * 60 * 60 * 1000;

  function detectStepPlatform(nav) {
    const n = nav || (typeof navigator !== 'undefined' ? navigator : {});
    const uaPlatform = (n.userAgentData && n.userAgentData.platform) || n.platform || '';
    const ua = n.userAgent || '';
    const touchPoints = Number(n.maxTouchPoints || 0);
    if (/iPad|iPhone|iPod/i.test(ua) || /iOS|iPadOS/i.test(uaPlatform)) {
      return { platform: 'iPadOS / iOS', ipadAmbiguous: false };
    }
    if (/Android/i.test(ua) || /Android/i.test(uaPlatform)) {
      return { platform: 'Android', ipadAmbiguous: false };
    }
    if (/Mac/i.test(uaPlatform) || /Macintosh|Mac OS X/i.test(ua)) {
      if (touchPoints > 1) {
        return { platform: 'macOS', ipadAmbiguous: true };
      }
      return { platform: 'macOS', ipadAmbiguous: false };
    }
    if (/Win/i.test(uaPlatform) || /Windows/i.test(ua)) {
      return { platform: 'Windows', ipadAmbiguous: false };
    }
    if (/CrOS|Linux/i.test(ua) || /Chrome OS|Linux/i.test(uaPlatform)) {
      return { platform: 'Browser', ipadAmbiguous: false };
    }
    return { platform: '', ipadAmbiguous: false };
  }

  function filterSteps(allSteps, filters = {}) {
    const { platform = '', client = '', where = '' } = filters;
    const filtered = allSteps.filter((step) => {
      if (platform && step.platform !== platform) return false;
      if (client && client !== 'remote-desktop-retired' && step.client && step.client !== client) return false;
      if (where && step.where && step.where !== where) return false;
      return true;
    });
    return filtered.length ? filtered : allSteps;
  }

  function isStepStale(step, nowIso) {
    if (!step || !step.source) return false;
    if (step.sourceChangedAt) return true;
    const checked = Date.parse(step.source.checkedAt);
    const now = nowIso ? Date.parse(nowIso) : Date.now();
    if (!Number.isFinite(checked) || !Number.isFinite(now)) return false;
    return (now - checked) > STALE_MS;
  }

  function freshnessNotice(step, nowIso) {
    if (!isStepStale(step, nowIso)) return null;
    const date = (step && step.source && step.source.checkedAt) || 'an earlier date';
    return `These steps were last checked against the vendor documentation on ${date}. If the screen in front of you looks different, follow the linked vendor page.`;
  }

  function initBrowser() {
    if (typeof document === 'undefined') return;
    const $ = (id) => document.getElementById(id);
    if (!$('step-select')) return;

    let allSteps = [];
    let steps = [];
    let current = 0;

    function syncUrl(stepId) {
      const url = new URL(location.href);
      const platform = $('platform-select').value;
      const client = $('client-select').value;
      const where = $('where-select').value;
      if (platform) url.searchParams.set('platform', platform);
      else url.searchParams.delete('platform');
      if (client) url.searchParams.set('client', client);
      else url.searchParams.delete('client');
      if (where) url.searchParams.set('where', where);
      else url.searchParams.delete('where');
      if (stepId) url.searchParams.set('step', stepId);
      history.replaceState(null, '', url);
    }

    function show(index, updateUrl = true) {
      if (!steps.length) return;
      current = Math.max(0, Math.min(index, steps.length - 1));
      const step = steps[current];
      $('step-select').value = step.id;
      const locationLabel = step.where === 'session' ? 'Inside the remote session' : 'On your own device';
      $('step-count').textContent = `Step ${current + 1} of ${steps.length} (${step.platform} \u00b7 ${locationLabel})`;
      $('guide-title').textContent = step.title;
      const actions = $('guide-actions');
      actions.replaceChildren(...step.actions.map((action) => {
        const item = document.createElement('li');
        item.textContent = action;
        return item;
      }));
      $('guide-see').textContent = step.whatYouShouldSee;
      $('guide-done').textContent = step.done;
      const source = $('guide-source');
      source.href = step.source.url;
      source.textContent = `Open official instructions: ${step.source.title} (checked ${step.source.checkedAt})`;
      const staleText = freshnessNotice(step);
      const freshBanner = $('freshness-banner');
      if (staleText) {
        freshBanner.hidden = false;
        freshBanner.textContent = staleText;
      } else {
        freshBanner.hidden = true;
        freshBanner.textContent = '';
      }
      $('step-back').disabled = current === 0;
      $('step-next').disabled = current === steps.length - 1;
      if (updateUrl) syncUrl(step.id);
    }

    function rebuildList(requestedStepId, updateUrl = true) {
      const client = $('client-select').value;
      $('retired-banner').hidden = client !== 'remote-desktop-retired';
      steps = filterSteps(allSteps, {
        platform: $('platform-select').value,
        client,
        where: $('where-select').value
      });
      const select = $('step-select');
      select.replaceChildren(...steps.map((step) => new Option(`${step.platform}: ${step.title}`, step.id)));
      select.disabled = false;
      const idx = requestedStepId ? steps.findIndex((s) => s.id === requestedStepId) : 0;
      show(idx >= 0 ? idx : 0, updateUrl);
    }

    async function load() {
      const response = await fetch('steps.json', { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('Guide list unavailable');
      const manifest = await response.json();
      allSteps = manifest.steps;
      const url = new URL(location.href);
      const requestedStep = url.searchParams.get('step');
      const requestedPlatform = url.searchParams.get('platform');
      const requestedClient = url.searchParams.get('client');
      const requestedWhere = url.searchParams.get('where');

      const detected = detectStepPlatform(navigator);
      if (requestedPlatform !== null) {
        $('platform-select').value = requestedPlatform;
      } else if (!requestedStep && detected.platform) {
        $('platform-select').value = detected.platform;
      }
      if (requestedClient) $('client-select').value = requestedClient;
      if (requestedWhere) $('where-select').value = requestedWhere;

      if (detected.ipadAmbiguous && !requestedPlatform) {
        $('ipad-mac-prompt').hidden = false;
      }
      $('choose-ipad').addEventListener('click', () => {
        $('platform-select').value = 'iPadOS / iOS';
        $('ipad-mac-prompt').hidden = true;
        rebuildList(null, true);
      });
      $('choose-mac').addEventListener('click', () => {
        $('platform-select').value = 'macOS';
        $('ipad-mac-prompt').hidden = true;
        rebuildList(null, true);
      });

      for (const id of ['platform-select', 'client-select', 'where-select']) {
        $(id).addEventListener('change', () => rebuildList($('step-select').value, true));
      }
      $('step-select').addEventListener('change', () => {
        show(steps.findIndex((s) => s.id === $('step-select').value), true);
      });
      $('step-back').addEventListener('click', () => show(current - 1, true));
      $('step-next').addEventListener('click', () => show(current + 1, true));

      rebuildList(requestedStep, !requestedStep);
    }

    load().catch(() => {
      $('guide-title').textContent = 'Guides could not be loaded';
      $('guide-actions').replaceChildren();
    });
  }

  initBrowser();

  return Object.freeze({
    detectStepPlatform,
    filterSteps,
    isStepStale,
    freshnessNotice
  });
});
