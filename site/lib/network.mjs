export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

export async function probeOnce(host, {
  fetchImpl = globalThis.fetch,
  now = () => globalThis.performance.now(),
  nonce = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  method = 'HEAD',
  timeoutMs = 4000,
  signal: externalSignal,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout
} = {}) {
  const controller = new AbortController();
  const url = new URL('/', `https://${host}`);
  url.searchParams.set('linecheck', nonce());
  const abort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abort, { once: true });
  const started = now();
  const timer = setTimer(() => controller.abort(), timeoutMs);
  try {
    await fetchImpl(url.href, {
      method,
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
      signal: controller.signal
    });
    return Math.max(0, now() - started);
  } finally {
    clearTimer(timer);
    externalSignal?.removeEventListener('abort', abort);
  }
}

export async function measureSamples({ probe, now = () => globalThis.performance.now(), samples = 8, stopOnStall = false }) {
  try {
    await probe();
  } catch {
    return { status: 'blocked', median: null, jitter: null, stalls: 0, slowSamples: 0, samples: [] };
  }

  const timed = new Array(samples).fill(null);
  let stalls = 0;
  for (let index = 0; index < samples; index++) {
    const started = now();
    try {
      await probe();
      timed[index] = Math.max(0, now() - started);
    } catch {
      stalls++;
      if (stopOnStall) return { status: 'blocked', median: null, jitter: null, stalls, slowSamples: 0, samples: timed.filter(Number.isFinite).map(Math.round) };
    }
  }
  const values = timed.filter(Number.isFinite);
  if (!values.length) return { status: 'blocked', median: null, jitter: null, stalls, slowSamples: 0, samples: [] };

  const center = median(values);
  const differences = timed.slice(1).flatMap((value, index) =>
    Number.isFinite(value) && Number.isFinite(timed[index]) ? [Math.abs(value - timed[index])] : []
  );
  return {
    status: 'reached',
    median: center,
    jitter: differences.length ? median(differences) : null,
    stalls,
    slowSamples: values.filter((value) => value > center * 3).length,
    samples: values.map(Math.round)
  };
}

export async function measureParallelSamples({ probe, samples = 8 }) {
  try {
    await probe();
  } catch {
    return { status: 'blocked', median: null, jitter: null, stalls: 0, slowSamples: 0, samples: [] };
  }
  const settled = await Promise.allSettled(Array.from({ length: samples }, () => probe()));
  const values = settled.filter((item) => item.status === 'fulfilled' && Number.isFinite(item.value) && item.value >= 0)
    .map((item) => item.value);
  const stalls = settled.length - values.length;
  if (!values.length) return { status: 'blocked', median: null, jitter: null, stalls, slowSamples: 0, samples: [] };
  const center = median(values);
  const differences = values.slice(1).map((value, index) => Math.abs(value - values[index]));
  return {
    status: 'reached',
    median: center,
    jitter: differences.length ? median(differences) : null,
    stalls,
    slowSamples: values.filter((value) => value > center * 3).length,
    samples: values.map(Math.round)
  };
}

export async function measureUntil({ probe, stop, samples = 8 }) {
  const values = [];
  let stalls = 0;
  let stopped = false;
  const stopPromise = Promise.resolve(stop).then(() => {
    stopped = true;
    return { kind: 'stop' };
  });
  for (let index = 0; index < samples; index++) {
    if (stopped) break;
    const measurement = Promise.resolve().then(probe).then(
      (value) => ({ kind: 'sample', value }),
      () => ({ kind: 'failed' })
    );
    const result = await Promise.race([measurement, stopPromise]);
    if (result.kind === 'stop') break;
    if (result.kind !== 'sample' || !Number.isFinite(result.value) || result.value < 0) stalls++;
    else values.push(result.value);
  }
  return { samples: values, stalls };
}
