/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT. */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STALE_MS = 180 * 24 * 60 * 60 * 1000;

export function extractLearnUpdatedAt(html = '') {
  const text = String(html || '');
  const updatedMatch =
    text.match(/<meta\s+name="updated_at"\s+content="([^"]+)"/i) ||
    text.match(/<meta\s+content="([^"]+)"\s+name="updated_at"/i) ||
    text.match(/<meta\s+name="ms\.date"\s+content="([^"]+)"/i);
  if (!updatedMatch) return null;
  const raw = updatedMatch[1].trim();
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function evaluateStepsFreshness(manifest, options = {}) {
  const nowMs = options.nowIso ? Date.parse(options.nowIso) : Date.now();
  const upstreamDates = options.upstreamDates || {};
  const staleSteps = [];
  const movedSteps = [];

  for (const step of (manifest && manifest.steps) || []) {
    const checkedAt = step.source && step.source.checkedAt;
    const checkedMs = Date.parse(checkedAt);
    const ageExceeded = Number.isFinite(checkedMs) && Number.isFinite(nowMs) && (nowMs - checkedMs) > STALE_MS;
    const upstreamDate = upstreamDates[step.source && step.source.url];
    const upstreamMoved = Boolean(
      step.sourceChangedAt ||
      (upstreamDate && checkedAt && Date.parse(upstreamDate) > Date.parse(checkedAt))
    );

    if (upstreamMoved) {
      movedSteps.push({
        id: step.id,
        url: step.source.url,
        checkedAt,
        upstreamDate: upstreamDate || step.sourceChangedAt
      });
    } else if (ageExceeded) {
      staleSteps.push({
        id: step.id,
        url: step.source.url,
        checkedAt
      });
    }
  }

  return {
    ok: staleSteps.length === 0 && movedSteps.length === 0,
    staleSteps,
    movedSteps
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const manifest = JSON.parse(readFileSync(join(root, 'site', 'steps', 'steps.json'), 'utf8'));
  const nowArgIdx = process.argv.indexOf('--now');
  const nowIso = nowArgIdx >= 0 ? process.argv[nowArgIdx + 1] : undefined;
  const res = evaluateStepsFreshness(manifest, { nowIso });
  if (!res.ok) {
    console.error(JSON.stringify(res, null, 2));
    process.exit(1);
  }
  console.log(`Freshness check passed for ${manifest.steps.length} guided steps.`);
}
