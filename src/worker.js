const REPO = 'https://api.github.com/repos/SagerNet/sing-geosite';
const RAW = 'https://raw.githubusercontent.com/SagerNet/sing-geosite';
const SNAPSHOT = 'https://raw.githubusercontent.com/Fiatnorm/geosite-explorer/main/public/catalog.json';
const TTL = 300;
const NAME = /^[a-z0-9][a-z0-9@!._-]{0,180}$/;
const SHA = /^[a-f0-9]{40}$/;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function upstream(url, env) {
  const headers = { 'User-Agent': 'GeoSite-Explorer', Accept: 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN && url.startsWith(REPO + '/')) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const error = new Error(response.status === 403 || response.status === 429
      ? 'Upstream rate limit reached. Please try again later.' : `Upstream is unavailable (HTTP ${response.status}). Please try again.`);
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  return response;
}

export function catalogFromTree(tree) {
  if (tree.truncated || !SHA.test(tree.sha) || !Array.isArray(tree.tree)) throw new Error('The upstream directory is incomplete. Please try again later.');
  const entries = tree.tree.filter(item => item.type === 'blob' && /^geosite-.+\.srs$/.test(item.path)).map(item => {
    const name = item.path.slice(8, -4);
    if (!NAME.test(name) || !SHA.test(item.sha)) throw new Error('Unsupported upstream rule file format.');
    return { name, size: item.size, sha: item.sha };
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (!entries.length) throw new Error('The upstream directory is empty. Please try again later.');
  return { revision: tree.sha, checkedAt: new Date().toISOString(), entries };
}

export async function officialCatalog(env) {
  const head = await (await upstream(`${REPO}/commits/rule-set`, env)).json();
  const treeSha = head.commit?.tree?.sha;
  const updatedAt = head.commit?.committer?.date;
  if (!SHA.test(head.sha) || !SHA.test(treeSha) || !updatedAt || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('Upstream commit metadata is incomplete. Please try again later.');
  }
  const tree = await (await upstream(`${REPO}/git/trees/${treeSha}`, env)).json();
  if (tree.sha !== treeSha) throw new Error('Upstream directory version mismatch. Please try again later.');
  return { ...catalogFromTree(tree), commit: head.sha, updatedAt };
}

export function validateCatalog(data) {
  if (!SHA.test(data?.revision) || !SHA.test(data?.commit) || !Number.isFinite(Date.parse(data?.updatedAt)) ||
      !Number.isFinite(Date.parse(data?.checkedAt)) || !Array.isArray(data?.entries) || !data.entries.length) {
    throw new Error('Invalid catalog snapshot.');
  }
  const names = new Set();
  for (const item of data.entries) {
    if (!NAME.test(item.name) || !SHA.test(item.sha) || !Number.isSafeInteger(item.size) || item.size < 0 || names.has(item.name)) {
      throw new Error('Invalid catalog snapshot entry.');
    }
    names.add(item.name);
  }
  return data;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET') return json({ error: 'Only GET requests are supported.' }, 405, { Allow: 'GET' });
    try {
      const cache = globalThis.caches?.default;
      if (url.pathname === '/api/catalog') {
        const key = new Request(`${url.origin}/api/catalog?schema=4`);
        const hit = await cache?.match(key);
        if (hit) return hit;
        let data;
        try {
          data = validateCatalog(await (await upstream(SNAPSHOT, {})).json());
        } catch {
          // A bundled official snapshot keeps first visits usable during CDN outages.
          const bundled = await env.ASSETS.fetch(new Request(`${url.origin}/catalog.json`));
          if (!bundled.ok) throw new Error('Catalog sync is unavailable. Please try again later.');
          data = { ...validateCatalog(await bundled.json()), warning: 'Live catalog sync is unavailable. Showing the bundled snapshot; check its timestamp.' };
        }
        const response = json(data, 200, { 'Cache-Control': `public, max-age=0, s-maxage=${TTL}` });
        if (cache) ctx.waitUntil(cache.put(key, new Response(response.clone().body, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
        })));
        return response;
      }
      if (url.pathname === '/api/ruleset') {
        const name = url.searchParams.get('name') || '';
        const revision = url.searchParams.get('revision') || '';
        if (!NAME.test(name) || !SHA.test(revision)) return json({ error: 'Invalid rule name or revision.' }, 400);
        const key = new Request(`${url.origin}/api/ruleset?name=${encodeURIComponent(name)}&revision=${revision}`);
        const hit = await cache?.match(key);
        if (hit) return hit;
        const source = await upstream(`${RAW}/${revision}/geosite-${encodeURIComponent(name)}.srs`, env);
        const response = new Response(source.body, { headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff'
        } });
        if (cache) ctx.waitUntil(cache.put(key, response.clone()));
        return response;
      }
      return json({ error: 'API endpoint not found.' }, 404);
    } catch (error) {
      return json({ error: error.message || 'Loading failed. Please try again later.' }, error.status || 502);
    }
  }
};
