// avd-linecheck spike S4: five downloads of the same 8 MiB file from this page's own origin.
// The browser cache is bypassed (no-store); the CDN edge cache is not, so the run shows cold and warm edges.
// Personal project, research and learning only, not for production, as is.
'use strict';

const URL_BLOB = '8m.bin';
const RUNS = 5;

async function once(i) {
  const t0 = performance.now();
  const res = await fetch(URL_BLOB, { cache: 'no-store' });
  const buf = await res.arrayBuffer();
  const ms = performance.now() - t0;
  const entries = performance.getEntriesByName(new URL(URL_BLOB, location.href).href);
  const e = entries[entries.length - 1] || {};
  return {
    run: i + 1, status: res.status, bytes: buf.byteLength, ms: Math.round(ms),
    mbitPerS: +((buf.byteLength * 8) / (ms / 1000) / 1e6).toFixed(1),
    transferSize: e.transferSize ?? null,
    firstByteMs: e.responseStart && e.requestStart ? Math.round(e.responseStart - e.requestStart) : null,
    edge: res.headers.get('x-cache'), age: res.headers.get('age'),
  };
}

async function run() {
  const out = document.getElementById('out');
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    out.textContent = `Download ${i + 1} of ${RUNS}...`;
    try { runs.push(await once(i)); } catch (e) { runs.push({ run: i + 1, error: String(e) }); }
  }
  const speeds = runs.map((r) => r.mbitPerS).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const result = {
    spike: 'S4', schemaVersion: 1, at: new Date().toISOString().slice(0, 10),
    browser: navigator.userAgentData ? navigator.userAgentData.brands.map((x) => `${x.brand} ${x.version}`).join(', ') : navigator.userAgent,
    connection: navigator.connection ? { type: navigator.connection.effectiveType, downlinkMbit: navigator.connection.downlink } : null,
    medianMbitPerS: speeds.length ? speeds[Math.floor(speeds.length / 2)] : null,
    spreadMbitPerS: speeds.length ? +(speeds[speeds.length - 1] - speeds[0]).toFixed(1) : null,
    runs,
  };
  out.textContent = JSON.stringify(result, null, 2);
  document.getElementById('copy').disabled = false;
}

document.getElementById('run').addEventListener('click', run);
document.getElementById('copy').addEventListener('click', () => navigator.clipboard.writeText(document.getElementById('out').textContent));
