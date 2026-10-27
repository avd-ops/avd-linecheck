/* avd-ops portal engine v1.1.0: probe.js. Personal project, not for production, as is; not affiliated with the author's employer or Microsoft. MIT.
   The one engine file that makes requests: timing no-cors requests to the hosts a portal gives it (avd-landing-zone
   decision 0003). The response is opaque; only the elapsed time is used. fetch, the clock, timers, Date.now and
   Math.random are injected (opts.env), so tests run it on a scripted network. Defaults are the deployment portal's:
   a warm-up, then 5 GET samples one after another, 4 seconds each, and any rejected request means no answer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.AvdOpsEngine.probe = factory(root.AvdOpsEngine.core);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const DEFAULTS = { samples: 5, timeoutMs: 4000, method: 'GET', param: 'avdlz', warmUp: true, countStalls: false, slowMs: null, concurrency: 3 };
  const G = typeof globalThis !== 'undefined' ? globalThis : {};

  // Public DNS names only: no IP literal, no localhost and no private or single-label name (linecheck spec 4.6).
  const NAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  const PRIVATE = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa|localdomain)$/;
  function checkHost(host) {
    const h = typeof host === 'string' ? host.toLowerCase() : '';
    if (!NAME.test(h) || PRIVATE.test(h)) throw new Error('A probe target must be a public DNS name.');
    return h;
  }
  // The exact connect-src origins for a set of targets, in order, once each, so a portal can test its CSP.
  function connectSrc(hosts) {
    const out = [];
    for (const h of [].concat(hosts || [])) { const o = `https://${checkHost(h)}`; if (!out.includes(o)) out.push(o); }
    return out;
  }

  function settings(opts) {
    const o = Object.assign({}, DEFAULTS, opts || {}), env = Object.assign({}, (opts && opts.env) || {});
    if (o.method !== 'GET' && o.method !== 'HEAD') throw new Error('The probe sends GET or HEAD.');
    core.check(o.param, /^[a-z][a-z0-9]{0,15}$/, 'The cache-buster name');
    env.fetch = env.fetch || (G.fetch && G.fetch.bind(G));
    env.now = env.now || (G.performance && (() => G.performance.now()));
    env.dateNow = env.dateNow || Date.now;
    env.random = env.random || Math.random;
    // Bound to the global: a browser refuses window.setTimeout called on another object.
    env.setTimeout = env.setTimeout || (G.setTimeout && ((fn, ms) => G.setTimeout(fn, ms)));
    env.clearTimeout = env.clearTimeout || (G.clearTimeout && ((id) => G.clearTimeout(id)));
    env.AbortController = env.AbortController || G.AbortController;
    for (const k of ['fetch', 'now', 'setTimeout', 'clearTimeout', 'AbortController']) if (typeof env[k] !== 'function') throw new Error(`The probe needs ${k}.`);
    return { o, env };
  }

  // One timed request to https://<host>/ with a cache-busting query. Resolves with the elapsed milliseconds;
  // rejects on DNS, TLS, a block or the timeout.
  function timeOnce(host, opts) {
    const h = checkHost(host), { o, env } = settings(opts);
    // A deadline shortens the last request, so a run ends near its deadline, not a whole timeout after it.
    const left = o.deadlineAt === undefined ? o.timeoutMs : Math.max(0, Math.min(o.timeoutMs, o.deadlineAt - env.now()));
    const ctrl = new env.AbortController(), timer = env.setTimeout(() => ctrl.abort(), left);
    const url = `https://${h}/?${o.param}=${env.dateNow()}${env.random().toString(36).slice(2)}`;
    const init = { mode: 'no-cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl.signal };
    if (o.method === 'HEAD') init.method = 'HEAD';
    const t0 = env.now();
    let sent;
    try { sent = Promise.resolve(env.fetch(url, init)); } catch (e) { sent = Promise.reject(e); }
    return sent.then(() => env.now() - t0).finally(() => env.clearTimeout(timer));
  }

  // The median the deployment portal has always used: the upper middle of the sorted samples.
  function median(xs) { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; }
  // Jitter: the median of the differences between consecutive samples, in the order they were taken.
  function jitter(xs) {
    const d = [];
    for (let i = 1; i < xs.length; i++) d.push(Math.abs(xs[i] - xs[i - 1]));
    return d.length ? median(d) : null;
  }

  // { samples, median, jitter, stalls, slow, deadline }. median is null for no answer: a rejected warm-up, any
  // rejected sample (unless opts.countStalls, which counts it and keeps going), no sample at all, or the deadline
  // (opts.deadlineAt, a value of the injected clock) reached before the last sample. A host cut short is not
  // measured (fail closed); the samples it took are still returned.
  function measure(host, opts) {
    const { o, env } = settings(opts), samples = [];
    let stalls = 0, failed = false, deadline = false;
    const past = () => o.deadlineAt !== undefined && env.now() >= o.deadlineAt;
    const result = () => {
      const none = failed || deadline || !samples.length;
      return { samples: samples.slice(), median: none ? null : median(samples), jitter: none ? null : jitter(samples), stalls,
        slow: o.slowMs === null ? 0 : samples.filter((t) => t > o.slowMs).length, deadline };
    };
    if (past()) { deadline = true; return Promise.resolve(result()); }
    const warm = o.warmUp ? timeOnce(host, opts).then(() => true, () => false) : Promise.resolve(true);
    return warm.then((ok) => {
      if (!ok) { failed = true; if (past()) deadline = true; return result(); }
      let chain = Promise.resolve();
      for (let i = 0; i < o.samples; i++) {
        chain = chain.then(() => {
          if (failed || deadline) return undefined;
          if (past()) { deadline = true; return undefined; }
          return timeOnce(host, opts).then((t) => { samples.push(t); }, () => {
            if (past()) deadline = true;
            else if (o.countStalls) stalls++;
            else failed = true;
          });
        });
      }
      return chain.then(result);
    });
  }

  // phases: [{ targets: [host], concurrency, deadlineMs, opts }], run one after another, so a phase is measured
  // with nothing else running. Each phase's results are in target order: { host, ...measure() }, or
  // { host, median: null, notTested: true } for a target not started before its phase's or the run's deadline.
  function run(phases, runOpts) {
    const list = [].concat(phases || []), ro = runOpts || {};
    const clock = settings(ro).env.now, start = clock();
    const results = [];
    let chain = Promise.resolve();
    list.forEach((p) => {
      chain = chain.then(() => {
        const targets = [].concat(p.targets || []).map(checkHost), out = new Array(targets.length);
        const t0 = clock(), ends = [];
        if (ro.deadlineMs !== undefined) ends.push(start + ro.deadlineMs);
        if (p.deadlineMs !== undefined) ends.push(t0 + p.deadlineMs);
        const deadlineAt = ends.length ? Math.min.apply(null, ends) : undefined;
        const opts = Object.assign({}, p.opts || {}, ro.env ? { env: ro.env } : {}, deadlineAt === undefined ? {} : { deadlineAt });
        const width = Math.max(1, Math.floor(p.concurrency || DEFAULTS.concurrency));
        let next = 0;
        const worker = () => {
          if (next >= targets.length) return Promise.resolve();
          const i = next++;
          if (deadlineAt !== undefined && clock() >= deadlineAt) { out[i] = { host: targets[i], median: null, notTested: true }; return worker(); }
          return measure(targets[i], opts).then((m) => { out[i] = Object.assign({ host: targets[i] }, m); }).then(worker);
        };
        const pool = [];
        for (let w = 0; w < width; w++) pool.push(worker());
        return Promise.all(pool).then(() => { results.push(out); });
      });
    });
    return chain.then(() => results);
  }

  return { DEFAULTS, checkHost, connectSrc, timeOnce, median, jitter, measure, run };
});
