// avd-linecheck spike S1: the landing zone portal's method (one warm-up, then timed no-cors requests, median),
// against this page's own origin and two Microsoft hosts, to compare with ping on the same network.
// The two roots answered HEAD with 200 and no redirect on 2026-10-21; a redirect to another host would be
// blocked by the CSP and show as "blocked or unreachable", never as a number.
// Personal project, research and learning only, not for production, as is.
'use strict';

const TARGETS = [
  { name: 'this site', url: new URL('ping.txt', location.href).href },
  { name: 'login.microsoftonline.com', url: 'https://login.microsoftonline.com/' },
  { name: 'windows.cloud.microsoft', url: 'https://windows.cloud.microsoft/' },
];
const SAMPLES = 10;
const TIMEOUT_MS = 5000;

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function timeOnce(url) {
  const t0 = performance.now();
  await spike.fetchWithin(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', redirect: 'follow' }, TIMEOUT_MS);
  return performance.now() - t0;
}

async function sample(t) {
  try {
    await timeOnce(t.url); // warm-up: pays for DNS, TCP and TLS
    const ms = [];
    for (let i = 0; i < SAMPLES; i++) ms.push(await timeOnce(t.url));
    return { target: t.name, medianMs: Math.round(median(ms)), minMs: Math.round(Math.min(...ms)), maxMs: Math.round(Math.max(...ms)), samples: ms.length };
  } catch (e) {
    return { target: t.name, error: e && e.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS} ms` : 'blocked or unreachable' };
  }
}

spike.wire(async (status) => {
  const rows = [];
  for (const t of TARGETS) { status(`Sampling ${t.name}...`); rows.push(await sample(t)); }
  return {
    ...spike.header('S1'),
    connection: navigator.connection ? navigator.connection.effectiveType : null,
    note: 'each number is at most the round trip plus server time: an upper bound, never the round trip itself',
    rows,
  };
});
