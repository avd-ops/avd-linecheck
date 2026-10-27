/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const { connectOrigins } = createRequire(import.meta.url)('../site/engine.js');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const htmlPath = join(root, 'site', 'index.html');
const readJson = (path) => JSON.parse(readFileSync(join(root, 'site', 'packs', path), 'utf8'));
const [generic, avd, avdGov, w365, teams, m365, endpointMap, regionMap] = [
  readJson('generic.json'),
  readJson('avd.json'),
  readJson('avd-gov.json'),
  readJson('w365.json'),
  readJson('teams.json'),
  readJson('m365.json'),
  readJson('endpoints.json'),
  readJson('regions.json')
];
const html = readFileSync(htmlPath, 'utf8');
const origins = connectOrigins([generic, avd, avdGov, w365, teams, m365], endpointMap, regionMap);
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
