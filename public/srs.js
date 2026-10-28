// SRS domain-only decoder. Format references and compatibility scope: see README.
const decoder = new TextDecoder('utf-8', { fatal: true });
const LIMIT = 64 * 1024 * 1024;

class Reader {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  take(length) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) throw new Error('The SRS file is truncated.');
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  byte() { return this.take(1)[0]; }
  uint() {
    let value = 0, scale = 1;
    for (let i = 0; i < 8; i++, scale *= 128) {
      const byte = this.byte();
      value += (byte & 127) * scale;
      if (!Number.isSafeInteger(value) || value > LIMIT) throw new Error('SRS length exceeds the limit.');
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid SRS length.');
  }
  strings() {
    const count = this.uint(), result = [];
    if (count > this.bytes.length - this.offset) throw new Error('Invalid SRS string count.');
    for (let i = 0; i < count; i++) result.push(decoder.decode(this.take(this.uint())));
    return result;
  }
  bool() {
    const value = this.byte();
    if (value > 1) throw new Error('Invalid SRS boolean value.');
    return value === 1;
  }
}

// Serialized uint64 words are big endian; bits within each word are LSB first.
function bit(bytes, index) {
  const offset = Math.floor(index / 64) * 8 + 7 - Math.floor(index % 64 / 8);
  return ((bytes[offset] || 0) >> (index % 8)) & 1;
}

function readDomains(reader) {
  if (reader.byte() !== 0) throw new Error('Unsupported domain trie version.');
  const leaves = reader.take(reader.uint() * 8);
  const bitmap = reader.take(reader.uint() * 8);
  const labels = reader.take(reader.uint());
  const nodes = labels.length + 1;
  const starts = new Uint32Array(nodes + 1);
  let edge = 0, node = 0;
  for (let i = 0; i < bitmap.length * 8 && node < nodes; i++) {
    if (bit(bitmap, i)) starts[++node] = edge;
    else edge++;
  }
  if (node !== nodes || edge !== labels.length) throw new Error('The SRS domain trie is corrupted.');
  const exact = new Set(), suffix = new Set(), legacy = new Set();
  const path = [], stack = [{ node: 0, next: starts[0] }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.next === starts[frame.node + 1]) { stack.pop(); path.pop(); continue; }
    const index = frame.next++, child = index + 1;
    if (child <= frame.node || child >= nodes) throw new Error('Invalid SRS domain trie link.');
    path.push(labels[index]);
    if (bit(leaves, child)) {
      const key = Array.from(decoder.decode(Uint8Array.from(path))).reverse().join('');
      if (key[0] === '\n') suffix.add(key.slice(1));
      else if (key[0] === '\r') legacy.add(key.slice(1));
      else exact.add(key);
    }
    stack.push({ node: child, next: starts[child] });
  }
  for (const value of legacy) {
    if (value.startsWith('.') && exact.has(value.slice(1))) {
      exact.delete(value.slice(1)); suffix.add(value.slice(1));
    } else suffix.add(value);
  }
  return { domain: [...exact].sort(), domain_suffix: [...suffix].sort() };
}

export function parsePayload(bytes, version) {
  const reader = new Reader(bytes);
  const count = reader.uint(), rules = [];
  for (let i = 0; i < count; i++) {
    // sing-geosite emits default, non-inverted domain rules. Reject other
    // semantics rather than silently presenting them as unconditional domains.
    if (reader.byte() !== 0) throw new Error('Logical rules are not supported by this viewer.');
    const rule = {};
    while (true) {
      const type = reader.byte();
      if (type === 255) {
        if (reader.bool()) throw new Error('Inverted rules are not supported by this viewer.');
        break;
      }
      if (type === 2) {
        if ('domain' in rule) throw new Error('Duplicate SRS domain field.');
        Object.assign(rule, readDomains(reader));
      } else if (type === 3 || type === 4) {
        const field = type === 3 ? 'domain_keyword' : 'domain_regex';
        if (field in rule) throw new Error('Duplicate SRS field.');
        rule[field] = reader.strings();
      } else throw new Error(`Unsupported SRS rule field (${type}). Please update the viewer.`);
    }
    rules.push(rule);
  }
  if (reader.offset !== bytes.length) throw new Error('The SRS file contains unparsed content.');
  const entries = rules.flatMap(rule => Object.entries(rule).flatMap(([type, values]) => values.map(value => ({ type, value }))));
  return { version, rules, entries };
}

export async function parseSRS(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 6 || bytes[0] !== 83 || bytes[1] !== 82 || bytes[2] !== 83) throw new Error('Not a valid SRS file.');
  const version = bytes[3];
  if (version < 1 || version > 3) throw new Error(`Unsupported SRS version ${version}. Please update the viewer.`);
  const stream = new Blob([bytes.subarray(4)]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > LIMIT) { await reader.cancel(); throw new Error('Decompressed SRS content exceeds the limit.'); }
    chunks.push(value);
  }
  const payload = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.length; }
  return parsePayload(payload, version);
}
