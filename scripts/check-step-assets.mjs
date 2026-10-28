/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_STILL_BYTES = 150 * 1024;
const MAX_VIDEO_BYTES = 1024 * 1024;
const FORBIDDEN_PNG_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
const FORBIDDEN_RIFF_CHUNKS = new Set(['EXIF', 'XMP ']);

export function scanImageMetadata(buffer, ext = '') {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const normalizedExt = String(ext || '').toLowerCase();
  const findings = [];

  if (normalizedExt === '.gif' || (bytes.length >= 6 && bytes.subarray(0, 6).toString('ascii').startsWith('GIF8'))) {
    findings.push('GIF format is forbidden (use WebP/PNG stills or muted MP4/WebM video; spec 18.3)');
    return { clean: false, findings };
  }

  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
      if (FORBIDDEN_PNG_CHUNKS.has(type)) {
        findings.push(`PNG carries metadata chunk ${type}`);
      }
      offset += 12 + length;
      if (type === 'IEND') break;
    }
  }

  // JPEG signature: FF D8
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break; // SOS or EOI
      const segLength = bytes.readUInt16BE(offset + 2);
      if (segLength < 2) break;
      if (marker === 0xe1) findings.push('JPEG carries APP1 (EXIF/XMP) metadata segment');
      if (marker === 0xed) findings.push('JPEG carries APP13 (IPTC) metadata segment');
      if (marker === 0xfe) findings.push('JPEG carries COM (comment) metadata segment');
      offset += 2 + segLength;
    }
  }

  // WebP RIFF container: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const fourCC = bytes.subarray(offset, offset + 4).toString('ascii');
      const chunkSize = bytes.readUInt32LE(offset + 4);
      if (FORBIDDEN_RIFF_CHUNKS.has(fourCC)) {
        findings.push(`WebP carries ${fourCC.trim()} metadata chunk`);
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
  }

  return {
    clean: findings.length === 0,
    findings
  };
}

export function validateStepsManifest(manifest, stepsDir) {
  const errors = [];
  if (!manifest || !Array.isArray(manifest.steps)) {
    return { ok: false, errors: ['steps.json must contain a steps array'] };
  }

  for (const step of manifest.steps) {
    if (!step.id) errors.push('Step is missing id');
    if (step.reviewed !== true || !step.reviewer) {
      errors.push(`${step.id}: step must have reviewed: true and a reviewer`);
    }
    if (!step.source || !step.source.url || !step.source.checkedAt) {
      errors.push(`${step.id}: step is missing source.url or source.checkedAt`);
    }
    const assets = Array.isArray(step.assets) ? step.assets : [];
    for (const asset of assets) {
      const label = `${step.id} (${asset.src || 'unnamed'})`;
      if (!asset.src) {
        errors.push(`${label}: asset is missing src`);
        continue;
      }
      if (!asset.alt || !String(asset.alt).trim()) {
        errors.push(`${label}: asset is missing alt text`);
      }
      if (asset.reviewed !== true || !asset.reviewer) {
        errors.push(`${label}: asset must have reviewed: true and a reviewer`);
      }
      if (!asset.clientVersion) {
        errors.push(`${label}: asset must record clientVersion`);
      }
      if (!asset.checkedAt) {
        errors.push(`${label}: asset must record checkedAt`);
      }
      const ext = extname(asset.src).toLowerCase();
      if (ext === '.gif') {
        errors.push(`${label}: animated GIFs are forbidden (spec 18.3)`);
      }
      if (stepsDir) {
        const fullPath = join(stepsDir, asset.src);
        if (!existsSync(fullPath)) {
          errors.push(`${label}: asset file not found at ${fullPath}`);
          continue;
        }
        const st = statSync(fullPath);
        const isVideo = ext === '.mp4' || ext === '.webm';
        const limit = isVideo ? MAX_VIDEO_BYTES : MAX_STILL_BYTES;
        if (st.size > limit) {
          errors.push(`${label}: asset size ${st.size} exceeds budget ${limit}`);
        }
        if (!isVideo) {
          const meta = scanImageMetadata(readFileSync(fullPath), ext);
          if (!meta.clean) {
            errors.push(`${label}: ${meta.findings.join('; ')}`);
          }
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const stepsDir = join(root, 'site', 'steps');
  const manifest = JSON.parse(readFileSync(join(stepsDir, 'steps.json'), 'utf8'));
  const result = validateStepsManifest(manifest, stepsDir);
  if (!result.ok) {
    for (const err of result.errors) console.error(err);
    process.exit(1);
  }
  console.log(`Checked ${manifest.steps.length} guided steps: all manifest entries and assets valid.`);
}
