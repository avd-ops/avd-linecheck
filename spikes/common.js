// Shared helpers for the spike pages: browser name, timeouts, result output and copy.
// Personal project, research and learning only, not for production, as is.
'use strict';

window.spike = (() => {
  const ua = navigator.userAgent;
  // iPadOS Safari reports a Mac user agent; a Mac with touch points is an iPad.
  const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const browser = () => (navigator.userAgentData
    ? navigator.userAgentData.brands.map((x) => `${x.brand} ${x.version}`).join(', ')
    : ua);
  const mobile = () => (navigator.userAgentData ? navigator.userAgentData.mobile : isIpad || /Mobi|iPhone|Android/.test(ua));
  const header = (name) => ({ spike: name, schemaVersion: 1, at: new Date().toISOString().slice(0, 10), browser: browser(), mobile: mobile(), ipad: isIpad });

  // Every request ends: a hang becomes a timeout row, never a page stuck on "Sampling...".
  const fetchWithin = (url, options, ms) => fetch(url, { ...options, signal: AbortSignal.timeout(ms) });

  function wire(run) {
    const out = document.getElementById('out');
    const copy = document.getElementById('copy');
    const runButton = document.getElementById('run');
    runButton.addEventListener('click', async () => {
      runButton.disabled = true; copy.disabled = true;
      try { out.textContent = JSON.stringify(await run((msg) => { out.textContent = msg; }), null, 2); copy.disabled = false; }
      catch (e) { out.textContent = `The run failed: ${e}`; }
      finally { runButton.disabled = false; }
    });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(out.textContent); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Copy failed: select the text and copy it by hand'; }
    });
  }

  return { browser, mobile, header, fetchWithin, wire };
})();
