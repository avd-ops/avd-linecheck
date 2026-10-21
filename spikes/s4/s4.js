// avd-linecheck spike S4: five downloads of the same 8 MiB file from this page's own origin.
// The browser cache is bypassed (no-store); the CDN edge cache is not, so the run shows cold and warm edges.
// Personal project, research and learning only, not for production, as is.
'use strict';

const URL_BLOB = new URL('8m.bin', location.href).href;
const BYTES = 8388608;
const RUNS = 5;
const TIMEOUT_MS = 60000;

// Resource timing entries arrive asynchronously; wait for the one this run added.
function entryNumber(n) {
  return new Promise((resolve) => {
    const found = () => performance.getEntriesByName(URL_BLOB)[n - 1];
    if (found()) return resolve(found());
    const obs = new PerformanceObserver(() => { if (found()) { obs.disconnect(); resolve(found()); } });
    obs.observe({ type: 'resource', buffered: true });
    setTimeout(() => { obs.disconnect(); resolve(found() || null); }, 2000);
  });
}

async function once(i) {
  const t0 = performance.now();
  const res = await spike.fetchWithin(URL_BLOB, { cache: 'no-store' }, TIMEOUT_MS);
  const buf = await res.arrayBuffer();
  const totalMs = performance.now() - t0;
  if (!res.ok || buf.byteLength !== BYTES) return { run: i + 1, error: `status ${res.status}, ${buf.byteLength} bytes, not the 8 MiB test file` };
  const e = await entryNumber(i + 1);
  // Throughput from first byte to last byte, so latency and time to first byte are not mixed in.
  const bodyMs = e && e.responseStart && e.responseEnd > e.responseStart ? e.responseEnd - e.responseStart : null;
  return {
    run: i + 1, status: res.status, totalMs: Math.round(totalMs),
    firstByteMs: e && e.responseStart && e.requestStart ? Math.round(e.responseStart - e.requestStart) : null,
    bodyMs: bodyMs === null ? null : Math.round(bodyMs),
    mbitPerS: bodyMs ? +((BYTES * 8) / (bodyMs / 1000) / 1e6).toFixed(1) : null,
    transferSize: e ? e.transferSize : null,
    edge: res.headers.get('x-cache'), age: res.headers.get('age'),
  };
}

spike.wire(async (status) => {
  performance.clearResourceTimings();
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    status(`Download ${i + 1} of ${RUNS}...`);
    try { runs.push(await once(i)); } catch (e) { runs.push({ run: i + 1, error: e && e.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS} ms` : String(e) }); }
  }
  const speeds = runs.map((r) => r.mbitPerS).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return {
    ...spike.header('S4'),
    connection: navigator.connection ? { type: navigator.connection.effectiveType, downlinkMbit: navigator.connection.downlink } : null,
    medianMbitPerS: speeds.length ? speeds[Math.floor(speeds.length / 2)] : null,
    spreadMbitPerS: speeds.length ? +(speeds[speeds.length - 1] - speeds[0]).toFixed(1) : null,
    runs,
  };
});
