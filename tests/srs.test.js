import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { parseSRS } from '../public/srs.js';

const uint = value => {
  const bytes = [];
  do { const byte = value & 127; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return bytes;
};
const strings = values => [uint(values.length), ...values.map(value => { const b = Buffer.from(value); return [...uint(b.length), ...b]; })].flat();
const encode = (payload, version = 1) => Buffer.concat([Buffer.from([83, 82, 83, version]), deflateSync(Buffer.from(payload))]);

// Build a simple BFS trie independently of the decoding implementation.
function matcher(keys) {
  const root = { children: new Map(), leaf: false };
  for (const key of keys) {
    let current = root;
    for (const label of Buffer.from(Array.from(key).reverse().join(''))) {
      if (!current.children.has(label)) current.children.set(label, { children: new Map(), leaf: false });
      current = current.children.get(label);
    }
    current.leaf = true;
  }
  const queue = [root], leaves = [], bitmap = [], labels = [];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]; leaves.push(Number(current.leaf));
    for (const [label, child] of [...current.children].sort((a, b) => a[0] - b[0])) {
      labels.push(label); queue.push(child); bitmap.push(0);
    }
    bitmap.push(1);
  }
  function words(bits) {
    const count = Math.ceil(bits.length / 64), bytes = Buffer.alloc(count * 8);
    bits.forEach((bit, i) => { if (bit) bytes[Math.floor(i / 64) * 8 + 7 - Math.floor(i % 64 / 8)] |= 1 << (i % 8); });
    return [...uint(count), ...bytes];
  }
  return [0, ...words(leaves), ...words(bitmap), ...uint(labels.length), ...labels];
}

test('recover exact, modern suffix, legacy suffix, keyword and regex without changing semantics', async () => {
  const keys = ['example.com', '\nmodern.com', 'legacy.com', '\r.legacy.com', '\r.subonly.com', '你好.example'];
  const payload = [1, 0, 2, ...matcher(keys), 3, ...strings(['needle']), 4, ...strings(['^api\\d+\\.example$']), 255, 0];
  for (const version of [1, 2, 3]) {
    const result = await parseSRS(encode(payload, version));
    assert.deepEqual(result.rules, [{
      domain: ['example.com', '你好.example'], domain_suffix: ['.subonly.com', 'legacy.com', 'modern.com'],
      domain_keyword: ['needle'], domain_regex: ['^api\\d+\\.example$']
    }]);
    assert.equal(result.entries.length, 7);
  }
});

test('empty ruleset is valid', async () => {
  assert.deepEqual((await parseSRS(encode([0]))).entries, []);
});

test('reject corrupt, future or unsupported semantics explicitly', async () => {
  for (const bytes of [Buffer.from('invalid'), encode([0], 4), encode([1, 1]), encode([1, 0, 6]), encode([1, 0, 255, 1]), encode([1, 0, 3, 2]), encode([0, 99])]) {
    await assert.rejects(parseSRS(bytes));
  }
});
