import { writeFile } from 'node:fs/promises';
import { officialCatalog, validateCatalog } from '../src/worker.js';

const data = validateCatalog(await officialCatalog({ GITHUB_TOKEN: process.env.GITHUB_TOKEN }));
await writeFile(new URL('../public/catalog.json', import.meta.url), JSON.stringify(data) + '\n');
if (process.env.GITHUB_ACTIONS === 'true') {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository.');
  const endpoint = `https://api.github.com/repos/${repository}/contents/catalog.json`;
  const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'GeoSite-Explorer-Sync' };
  const existing = await fetch(`${endpoint}?ref=catalog-data`, { headers, signal: AbortSignal.timeout(20000) });
  if (!existing.ok) throw new Error(`Cannot read catalog-data branch: HTTP ${existing.status}`);
  const previous = await existing.json();
  const response = await fetch(endpoint, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '[CF-Pages-Skip] Sync official SagerNet catalog', branch: 'catalog-data', sha: previous.sha,
      content: Buffer.from(JSON.stringify(data) + '\n').toString('base64') }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Cannot publish catalog snapshot: HTTP ${response.status}`);
}
console.log(`Checked ${data.entries.length} official rule sets at ${data.checkedAt}; commit ${data.commit}`);
