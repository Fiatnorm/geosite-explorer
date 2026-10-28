import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('Pages output includes exact assets, API worker and API-only routing', async () => {
  const root = new URL('../', import.meta.url);
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: fileURLToPath(root) });
  const sourceFiles = await readdir(new URL('public/', root));
  const outputFiles = await readdir(new URL('dist/', root));
  assert.deepEqual(outputFiles.sort(), [...sourceFiles, '_worker.js', '_routes.json'].sort());
  for (const name of sourceFiles) {
    assert.deepEqual(await readFile(new URL(`dist/${name}`, root)), await readFile(new URL(`public/${name}`, root)));
  }
  assert.deepEqual(await readFile(new URL('dist/_worker.js', root)), await readFile(new URL('src/worker.js', root)));
  assert.deepEqual(JSON.parse(await readFile(new URL('dist/_routes.json', root))), {
    version: 1, include: ['/api/*'], exclude: []
  });
});
