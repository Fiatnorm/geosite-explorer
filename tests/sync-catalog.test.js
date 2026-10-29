import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('Actions sync publishes the validated catalog to main without skipping Pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-sync-'));
  const originalFetch = globalThis.fetch;
  const keys = ['GITHUB_ACTIONS', 'GITHUB_REPOSITORY', 'GITHUB_TOKEN'];
  const originalEnv = keys.map(key => process.env[key]);
  const sha = 'a'.repeat(40);
  const requests = [];
  try {
    for (const folder of ['scripts', 'src', 'public']) await mkdir(join(root, folder));
    await copyFile(new URL('../scripts/sync-catalog.mjs', import.meta.url), join(root, 'scripts/sync-catalog.mjs'));
    await copyFile(new URL('../src/worker.js', import.meta.url), join(root, 'src/worker.mjs'));
    // The temporary directory has no package.json, so use an explicit module extension.
    const { writeFile } = await import('node:fs/promises');
    const script = join(root, 'scripts/sync-catalog.mjs');
    await writeFile(script, (await readFile(script, 'utf8')).replace('../src/worker.js', '../src/worker.mjs'));
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';
    globalThis.fetch = async (url, options) => {
      requests.push([url, options]);
      if (url.endsWith('/commits/rule-set')) return Response.json({ sha, commit: { tree: { sha }, committer: { date: '2026-10-29T00:00:00Z' } } });
      if (url.includes('/git/trees/')) return Response.json({ sha, tree: [{ type: 'blob', path: 'geosite-openai.srs', sha, size: 100 }] });
      if (options.method === 'PUT') return Response.json({});
      return Response.json({ sha: 'previous-blob' });
    };
    await import(pathToFileURL(script).href);
    assert.equal(requests[2][0], 'https://api.github.com/repos/owner/repo/contents/public/catalog.json?ref=main');
    assert.equal(requests[3][0], 'https://api.github.com/repos/owner/repo/contents/public/catalog.json');
    const body = JSON.parse(requests[3][1].body);
    assert.equal(body.branch, 'main');
    assert.equal(body.sha, 'previous-blob');
    assert.equal(body.message, 'Sync official SagerNet catalog');
    assert.equal(Buffer.from(body.content, 'base64').toString(), await readFile(join(root, 'public/catalog.json'), 'utf8'));
    assert.equal(JSON.parse(Buffer.from(body.content, 'base64')).commit, sha);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (originalEnv[index] === undefined) delete process.env[key]; else process.env[key] = originalEnv[index]; });
    await rm(root, { recursive: true, force: true });
  }
});
