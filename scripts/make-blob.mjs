import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = join(root, 'site', 'blobs');
const packPaths = ['generic.json', 'avd.json'].map((name) => join(root, 'site', 'packs', name));
const packs = packPaths.map((path) => JSON.parse(readFileSync(path, 'utf8')));
const activePaths = new Set(packs.map((pack) => pack.download.path));
if (activePaths.size !== 1) throw new Error('Both shipped packs must use the same download blob');
if (packs.some((pack) => pack.download.bytes !== 8 * 1024 * 1024) ||
    !/^blobs\/8m-[0-9a-f]{64}\.bin$/.test(packs[0].download.path)) {
  throw new Error('Pack download paths must use the hash-named 8 MiB blob format');
}

mkdirSync(directory, { recursive: true });
const activePath = join(directory, packs[0].download.path.slice('blobs/'.length));
if (existsSync(activePath)) {
  const bytes = readFileSync(activePath);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== 8 * 1024 * 1024 || !activePath.endsWith(`8m-${hash}.bin`)) {
    throw new Error('The active download blob does not match its size or hash');
  }
  console.log(`Verified ${activePath}`);
  process.exit(0);
}

const bytes = randomBytes(8 * 1024 * 1024);
const hash = createHash('sha256').update(bytes).digest('hex');
const filename = `8m-${hash}.bin`;
const file = join(directory, filename);
writeFileSync(file, bytes, { flag: 'wx' });
console.log(`Created ${file}`);
for (let index = 0; index < packs.length; index++) {
  packs[index].download.path = `blobs/${filename}`;
  writeFileSync(packPaths[index], `${JSON.stringify(packs[index], null, 2)}\n`);
}
console.log('Updated both shipped pack paths. Existing inactive blobs were left untouched.');
