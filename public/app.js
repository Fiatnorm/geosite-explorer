const $ = id => document.getElementById(id);
const timestampFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
function formatTimestamp(value) { return timestampFormatter.format(new Date(value)); }
const types = { domain: 'Exact domain', domain_suffix: 'Domain suffix', domain_keyword: 'Keyword', domain_regex: 'Regex' };
let catalog, timer, loading = false, taskId = 0, toastTimer;
const pending = new Map();
let parser;
let lastCatalogAttempt = 0;
const rows = new Map();
const parsedCache = new Map();

function resetParser(message) {
  parser?.terminate(); parser = null;
  for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(new Error(message)); }
  pending.clear();
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}

function parse(url) {
  if (!parser) {
    parser = new Worker('/parser-worker.js', { type: 'module' });
    parser.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task) return;
      clearTimeout(task.timeout); pending.delete(data.id);
      if (data.error) task.reject(new Error(data.error)); else task.resolve(data);
    };
    parser.onerror = () => resetParser('The parser could not run. Please retry.');
    parser.onmessageerror = () => resetParser('The parser returned an unreadable result. Please retry.');
  }
  return new Promise((resolve, reject) => {
    const id = ++taskId;
    const timeout = setTimeout(() => resetParser('Rule parsing timed out. Please retry.'), 45000);
    pending.set(id, { resolve, reject, timeout });
    try { parser.postMessage({ id, url }); }
    catch { resetParser('The parser could not start. Please retry.'); }
  });
}

// Keep only a small working set; searching the catalog must not retain every decoded file.
async function ruleData(url) {
  if (parsedCache.has(url)) {
    const data = parsedCache.get(url); parsedCache.delete(url); parsedCache.set(url, data);
    return data;
  }
  const data = await parse(url);
  parsedCache.set(url, data);
  if (parsedCache.size > 8) parsedCache.delete(parsedCache.keys().next().value);
  return data;
}

function displayDomains(body, entries, item) {
  body.replaceChildren();
  const search = node('input', 'domain-search');
  search.type = 'search'; search.placeholder = 'Search domains or expressions';
  search.setAttribute('aria-label', `Search domains in ${item.name}`);
  const note = node('p', 'domain-note');
  note.setAttribute('role', 'status');
  const list = node('ul', 'domain-list');
  const domainRows = entries.map(entry => {
    const row = node('li', 'domain-row');
    row.append(node('span', 'rule-type', types[entry.type]), node('code', '', entry.value));
    return { row, text: entry.value.toLowerCase() };
  });
  let searchTimer;
  function render() {
    const query = search.value.trim().toLowerCase();
    const matches = domainRows.filter(entry => entry.text.includes(query));
    const fragment = document.createDocumentFragment();
    for (const entry of matches) fragment.append(entry.row);
    list.replaceChildren(fragment); list.hidden = !matches.length;
    note.textContent = `${matches.length.toLocaleString('en-US')} / ${entries.length.toLocaleString('en-US')} rules · Suffixes include subdomains; a leading dot matches subdomains only. Keywords and regex are shown as stored.`;
    if (!matches.length) note.textContent = entries.length ? 'No matching domains or expressions.' : 'This rule set contains no domain entries.';
  }
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (body.isConnected) render(); }, 80); });
  body.append(search, note, list); render();
}

const icons = {
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  view: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  source: '<path d="M15 4h5v5M20 4 10 14M18 13v7H4V6h7"/>'
};
function action(tag, icon, label, name) {
  const element = node(tag, 'row-action');
  // Only static icon markup; upstream values are assigned through textContent.
  element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon]}</svg>`;
  element.append(node('span', 'action-label', label));
  element.setAttribute('aria-label', `${label} ${name}`); element.title = `${label} ${name}`;
  return element;
}

function ruleItem(item, revision) {
  const row = node('div', 'rule');
  const symbol = node('span', 'rule-symbol'); symbol.setAttribute('aria-hidden', 'true');
  symbol.innerHTML = '<svg class="globe" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 17.93A8 8 0 0 1 4 12c0-.62.08-1.21.21-1.79L9 15v1a2 2 0 0 0 2 2v1.93Zm6.9-2.54A2 2 0 0 0 16 16h-1v-3a1 1 0 0 0-1-1H8v-2h2a1 1 0 0 0 1-1V7h2a2 2 0 0 0 2-2v-.41A8 8 0 0 1 20 12a7.96 7.96 0 0 1-2.1 5.39Z"/></svg>';
  const actions = node('div', 'row-actions');
  const copy = action('button', 'copy', 'Copy', item.name);
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(item.name); toast(`Copied ${item.name}`); }
    catch { toast('Copy failed. Please copy the rule name manually.'); }
  });
  const view = action('button', 'view', 'View domains', item.name);
  let request;
  view.addEventListener('click', () => {
    const body = node('div');
    $('domain-content').replaceChildren(body); $('dialog-title').textContent = item.name;
    $('domains').showModal();
    async function load() {
      body.setAttribute('aria-busy', 'true');
      body.replaceChildren(node('p', 'loading', 'Loading and parsing official rules…'));
      try {
        request ??= ruleData(`/api/ruleset?name=${encodeURIComponent(item.name)}&revision=${revision}`).finally(() => { request = null; });
        const data = await request;
        if (body.isConnected) displayDomains(body, data.entries, item);
      } catch (error) {
        if (!body.isConnected) return;
        const message = node('p', 'notice error', error.message);
        const retry = node('button', 'pill', 'Retry'); retry.addEventListener('click', load);
        body.replaceChildren(message, retry);
      } finally { body.setAttribute('aria-busy', 'false'); }
    }
    load();
  });
  const source = action('a', 'source', 'Official file', item.name);
  source.href = `https://github.com/SagerNet/sing-geosite/blob/${revision}/geosite-${encodeURIComponent(item.name)}.srs`;
  source.target = '_blank'; source.rel = 'noopener noreferrer';
  actions.append(copy, view, source);
  row.append(symbol, node('span', 'rule-name', item.name), actions); return row;
}

$('close-dialog').addEventListener('click', () => $('domains').close());
$('domains').addEventListener('click', event => {
  const rect = $('domains').getBoundingClientRect();
  if (event.target === $('domains') && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) $('domains').close();
});
$('domains').addEventListener('close', () => { $('domain-content').replaceChildren(); });

function filteredEntries() {
  const query = $('search').value.trim().toLowerCase().replace(/^geosite[:\-]/, '').replace(/\.srs$/, '');
  return catalog.entries.filter(item => item.name.includes(query));
}

function updateMetadata() {
  $('checked').textContent = `Checked at ${formatTimestamp(catalog.checkedAt)} · 5-minute cache`;
  const date = new Date(catalog.updatedAt);
  $('upstream-updated').textContent = Number.isFinite(date.getTime())
    ? `Last updated: ${formatTimestamp(catalog.updatedAt)}`
    : 'Last updated: Unavailable';
  $('revision').textContent = `Version ${catalog.commit.slice(0, 7)}`;
  $('revision').title = catalog.commit;
}

function render() {
  if (!catalog) return;
  const entries = filteredEntries();
  const fragment = document.createDocumentFragment();
  for (const item of entries) {
    if (!rows.has(item.name)) rows.set(item.name, ruleItem(item, catalog.commit));
    fragment.append(rows.get(item.name));
  }
  $('list').replaceChildren(fragment);
  $('total').textContent = catalog.entries.length.toLocaleString('en-US');
  $('result-count').textContent = `${entries.length.toLocaleString('en-US')} rule sets`;
  $('empty').hidden = entries.length > 0;
  updateMetadata();
}

async function loadCatalog(manual = false) {
  if (loading) return;
  lastCatalogAttempt = Date.now();
  loading = true; $('refresh').disabled = true; $('list').setAttribute('aria-busy', 'true');
  if (manual) { $('notice').textContent = 'Checking for rule updates…'; $('notice').className = 'notice'; $('notice').hidden = false; }
  try {
    const response = await fetch('/api/catalog', { cache: 'no-store', signal: AbortSignal.timeout(45000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load the rule set list.');
    if (!Array.isArray(data.entries) || !/^[a-f0-9]{40}$/.test(data.revision) || !/^[a-f0-9]{40}$/.test(data.commit)) throw new Error('Invalid rule set list format.');
    const changed = catalog && catalog.revision !== data.revision;
    const first = !catalog;
    catalog = data;
    if (first || changed) { rows.clear(); parsedCache.clear(); render(); }
    else {
      updateMetadata();
    }
    $('notice').hidden = true;
    if (manual) toast(changed ? 'Updated to the latest rules.' : 'Showing the latest checked version (cached for up to 5 minutes).');
  } catch (error) {
    $('notice').textContent = `${error.name === 'TimeoutError' ? 'Loading timed out. Please try again.' : error.message}${catalog ? ' Previously loaded rule sets are still available.' : ' Click “Check for updates” to retry.'}`;
    $('notice').className = 'notice error'; $('notice').hidden = false;
    if (!catalog) { $('total').textContent = 'Load failed'; $('result-count').textContent = 'Rule set list is currently unavailable'; $('upstream-updated').textContent = 'Last updated: Unavailable'; }
  } finally {
    loading = false; $('refresh').disabled = false; $('list').setAttribute('aria-busy', 'false');
  }
}

$('search').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => render(), 100); });
$('refresh').addEventListener('click', () => loadCatalog(true));
const media = matchMedia('(prefers-color-scheme: dark)');
function isDark() { return document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : media.matches; }
function updateThemeLabel() { $('theme').setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme'); $('theme').setAttribute('aria-pressed', String(isDark())); }
$('theme').addEventListener('click', () => {
  const theme = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('geosite-theme', theme); } catch {}
  updateThemeLabel();
});
media.addEventListener('change', updateThemeLabel); updateThemeLabel();
document.addEventListener('keydown', event => {
  if (event.key === '/' && !$('domains').open && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('search').focus(); }
});
setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastCatalogAttempt >= 5 * 60 * 1000) loadCatalog(); }, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastCatalogAttempt >= 5 * 60 * 1000) loadCatalog(); });
loadCatalog();
