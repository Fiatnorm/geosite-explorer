import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// dist is generated exclusively by this script; never place source files here.
const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('../public/', import.meta.url), output, { recursive: true });
await cp(new URL('../src/worker.js', import.meta.url), new URL('_worker.js', output));
await writeFile(new URL('_routes.json', output), JSON.stringify({
  version: 1,
  include: ['/api/*'],
  exclude: []
}, null, 2) + '\n');
console.log(`Cloudflare Pages output: ${fileURLToPath(output)}`);
