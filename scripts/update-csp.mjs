import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { connectOrigins } from '../site/lib/packs.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const htmlPath = join(root, 'site', 'index.html');
const readJson = (path) => JSON.parse(readFileSync(join(root, 'site', 'packs', path), 'utf8'));
const [generic, avd, endpointMap, regionMap] = [
  readJson('generic.json'), readJson('avd.json'), readJson('endpoints.json'), readJson('regions.json')
];
const html = readFileSync(htmlPath, 'utf8');
const origins = connectOrigins([generic, avd], endpointMap, regionMap);
const policy = html.match(/connect-src 'self'[^;"]*/);
if (!policy) throw new Error('Could not find connect-src in site/index.html');
const expected = `connect-src 'self' ${origins.join(' ')}`;
const updated = html.replace(policy[0], expected);

if (process.argv.includes('--check')) {
  if (updated !== html) throw new Error('CSP is out of date; run node scripts/update-csp.mjs');
} else if (updated !== html) {
  writeFileSync(htmlPath, updated);
  console.log('Updated the page CSP from the shipped packs.');
}
