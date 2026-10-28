import { parseSRS } from './srs.js';

self.onmessage = async ({ data: { id, url } }) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Loading failed (HTTP ${response.status}).`);
    }
    const { entries, version } = await parseSRS(await response.arrayBuffer());
    self.postMessage({ id, entries, version });
  } catch (error) {
    self.postMessage({ id, error: error.message || 'Rule parsing failed. Please try again.' });
  }
};
