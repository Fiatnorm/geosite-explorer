import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { catalogFromTree, officialCatalog, validateCatalog } from '../src/worker.js';

const revision = 'a'.repeat(40), sha = 'b'.repeat(40);
const tree = { sha: revision, truncated: false, tree: [
  { type: 'blob', path: 'geosite-openai.srs', size: 200, sha },
  { type: 'blob', path: 'geosite-category-ai-!cn.srs', size: 300, sha },
  { type: 'blob', path: 'geosite-google@cn.srs', size: 100, sha },
  { type: 'blob', path: 'README.md', size: 10, sha }
] };
const ctx = { waitUntil() {} };
const snapshot = { ...catalogFromTree(tree), commit: 'c'.repeat(40), updatedAt: '2026-10-23T02:03:04Z' };
const updatedAt = '2026-10-23T02:03:04Z';
const head = { sha: 'c'.repeat(40), commit: { tree: { sha: revision }, committer: { date: updatedAt } } };

test('complete tree catalog, original names and pinned revision', () => {
  const result = catalogFromTree(tree);
  assert.equal(result.revision, revision);
  assert.deepEqual(result.entries.map(x => x.name), ['category-ai-!cn', 'google@cn', 'openai']);
  assert.throws(() => catalogFromTree({ ...tree, truncated: true }));
  assert.throws(() => catalogFromTree({ ...tree, tree: [] }));
});

test('reject traversal, invalid revision, unknown API and writes before upstream fetch', async () => {
  const env = {};
  for (const query of ['name=../secret&revision=' + revision, 'name=openai&revision=rule-set', 'name=x%2Fy&revision=' + revision]) {
    assert.equal((await worker.fetch(new Request('https://example.com/api/ruleset?' + query), env, ctx)).status, 400);
  }
  assert.equal((await worker.fetch(new Request('https://example.com/api/nope'), env, ctx)).status, 404);
  assert.equal((await worker.fetch(new Request('https://example.com/api/catalog', { method: 'POST' }), env, ctx)).status, 405);
});

test('upstream errors are visible and not reported as empty success', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 429 });
  try {
    await assert.rejects(officialCatalog({}), /rate limit/);
  } finally { globalThis.fetch = original; }
});

test('catalog API fetches complete tree and SRS API pins the requested immutable tree', async () => {
  const original = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push([url, options]);
    if (url.endsWith('/commits/rule-set')) return Response.json(head);
    return url.includes('/git/trees/') ? Response.json(tree) : new Response('SRS bytes');
  };
  try {
    const catalog = await officialCatalog({ GITHUB_TOKEN: 'test-token' });
    assert.equal(catalog.entries.length, 3);
    assert.equal(catalog.updatedAt, updatedAt);
    assert.equal(catalog.commit, head.sha);
    const file = await worker.fetch(new Request(`https://example.com/api/ruleset?name=google%40cn&revision=${head.sha}`), { GITHUB_TOKEN: 'test-token' }, ctx);
    assert.equal(await file.text(), 'SRS bytes');
    assert.equal(requests[0][0], 'https://api.github.com/repos/SagerNet/sing-geosite/commits/rule-set');
    assert.equal(requests[1][0], `https://api.github.com/repos/SagerNet/sing-geosite/git/trees/${revision}`);
    assert.match(requests[2][0], new RegExp('/' + head.sha + '/geosite-google%40cn.srs$'));
    assert.equal(requests[0][1].headers.Authorization, 'Bearer test-token');
    assert.equal(requests[2][1].headers.Authorization, undefined);
  } finally { globalThis.fetch = original; }
});

test('missing commit timestamp and mismatched tree cannot produce a successful catalog', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ ...head, commit: { ...head.commit, committer: {} } });
    await assert.rejects(officialCatalog({}), /metadata/);
    globalThis.fetch = async url => Response.json(url.endsWith('/commits/rule-set') ? head : { ...tree, sha: 'd'.repeat(40) });
    await assert.rejects(officialCatalog({}), /mismatch/);
  } finally { globalThis.fetch = original; }
});


test('runtime catalog uses CDN snapshot without REST API or credentials', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://raw.githubusercontent.com/Fiatnorm/geosite-explorer/main/public/catalog.json');
    assert.equal(options.headers.Authorization, undefined);
    return Response.json(snapshot);
  };
  try {
    const response = await worker.fetch(new Request('https://example.com/api/catalog'), { GITHUB_TOKEN: 'must-not-leak' }, ctx);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), snapshot);
  } finally { globalThis.fetch = original; }
});

test('CDN failure uses bundled snapshot and preserves timestamp with a visible warning', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 429 });
  try {
    const env = { ASSETS: { async fetch(request) {
      assert.equal(new URL(request.url).pathname, '/catalog.json');
      return Response.json(snapshot);
    } } };
    const response = await worker.fetch(new Request('https://example.com/api/catalog'), env, ctx);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.checkedAt, snapshot.checkedAt);
    assert.equal(result.commit, snapshot.commit);
    assert.match(result.warning, /bundled snapshot/);
    const failure = await worker.fetch(new Request('https://example.com/api/catalog'), { ASSETS: {fetch: async () => new Response('', {status:404})} }, ctx);
    assert.equal(failure.status, 502);
    assert.equal(failure.headers.get('Cache-Control'), 'no-store');
  } finally { globalThis.fetch = original; }
});

test('snapshot validator rejects incomplete, duplicate and unsafe metadata', () => {
  assert.equal(validateCatalog(snapshot), snapshot);
  for (const patch of [{entries:[]}, {checkedAt:'bad'}, {commit:'rule-set'}, {entries:[...snapshot.entries, snapshot.entries[0]]},
    {entries:[{...snapshot.entries[0],name:'../secret'}]}, {entries:[{...snapshot.entries[0],size:-1}]}]) {
    assert.throws(() => validateCatalog({...snapshot,...patch}));
  }
});
