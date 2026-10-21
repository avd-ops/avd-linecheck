// avd-linecheck spike S1: the landing zone portal's method (one warm-up, then timed no-cors requests, median),
// against this page's own origin and two Microsoft hosts, to compare with ping on the same network.
// Personal project, research and learning only, not for production, as is.
'use strict';

const TARGETS = [
  { name: 'this site', url: new URL('ping.txt', location.href).href },
  { name: 'login.microsoftonline.com', url: 'https://login.microsoftonline.com/' },
  { name: 'windows.cloud.microsoft', url: 'https://windows.cloud.microsoft/' },
];
const SAMPLES = 10;

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function timeOnce(url) {
  const t0 = performance.now();
  await fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', redirect: 'follow' });
  return performance.now() - t0;
}

async function sample(t) {
  try {
    await timeOnce(t.url); // warm-up: pays for DNS, TCP and TLS
    const ms = [];
    for (let i = 0; i < SAMPLES; i++) ms.push(await timeOnce(t.url));
    return { target: t.name, medianMs: Math.round(median(ms)), minMs: Math.round(Math.min(...ms)), maxMs: Math.round(Math.max(...ms)), samples: ms.length };
  } catch (e) {
    return { target: t.name, error: 'blocked or unreachable' };
  }
}

async function run() {
  const out = document.getElementById('out');
  const rows = [];
  for (const t of TARGETS) { out.textContent = `Sampling ${t.name}...`; rows.push(await sample(t)); }
  const result = {
    spike: 'S1', schemaVersion: 1, at: new Date().toISOString().slice(0, 10),
    browser: navigator.userAgentData ? navigator.userAgentData.brands.map((x) => `${x.brand} ${x.version}`).join(', ') : navigator.userAgent,
    connection: navigator.connection ? navigator.connection.effectiveType : null,
    note: 'each number is at most the round trip plus server time: an upper bound, never the round trip itself',
    rows,
  };
  out.textContent = JSON.stringify(result, null, 2);
  document.getElementById('copy').disabled = false;
}

document.getElementById('run').addEventListener('click', run);
document.getElementById('copy').addEventListener('click', () => navigator.clipboard.writeText(document.getElementById('out').textContent));
