import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import defaults from './recipeDefaults.json';
// MU2 body: compression flag, little-endian Adler32 of the transmitted payload,
// then raw/deflated typed values. Object keys index the sorted frozen defaults;
// tag 0 inherits, tag 9 replaces an object, tag 10 patches it, tag 11 deletes a key.
// The checksum covers compressed bytes too, including any appended garbage.
const MAX = 1024 * 1024, MAX_DEPTH = 64;
const words: string[] = defaults.values;
const object = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const equal = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  return object(a) && object(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
};
function checksum(bytes: Uint8Array): number {
  let a = 1, b = 0;
  for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Typed values and recursive deltas. Missing, null, zero and false stay distinct. */
export function encodeCompact(value: unknown, base: unknown, prefix: string): string {
  const out: number[] = [];
  const number = (n: number): void => { do { const b = n % 128; n = Math.floor(n / 128); out.push(b | (n ? 128 : 0)); } while (n); };
  const text = (s: string): void => { const bytes = strToU8(s); number(bytes.length); for (const b of bytes) out.push(b); };
  const write = (v: any, ref: any, depth: number): void => {
    if (depth > MAX_DEPTH || out.length > MAX) throw new Error('Code trop volumineux.');
    if (equal(v, ref)) { out.push(0); return; }
    if (v === null) { out.push(1); return; }
    if (typeof v === 'boolean') { out.push(v ? 3 : 2); return; }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('Nombre invalide.');
      if (Number.isSafeInteger(v) && Math.abs(v) < 2 ** 31) { out.push(4); number(v < 0 ? -v * 2 - 1 : v * 2); }
      else { out.push(5); const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); out.push(...b); }
      return;
    }
    if (typeof v === 'string') {
      const id = words.indexOf(v);
      if (id >= 0) { out.push(7); number(id); }
      else { out.push(6); text(v); }
      return;
    }
    if (Array.isArray(v)) { out.push(8); number(v.length); v.forEach((item, i) => write(item, Array.isArray(ref) ? ref[i] : undefined, depth + 1)); return; }
    if (!object(v)) throw new Error('Valeur invalide.');
    const baseline = object(ref) ? ref : {}, keys = Object.keys(baseline).sort();
    const full = Object.keys(v).sort(), changes = [...new Set([...full, ...keys])].sort().filter(k => !Object.hasOwn(v, k) || !Object.hasOwn(baseline, k) || !equal(v[k], baseline[k]));
    const patch = changes.length < full.length;
    out.push(patch ? 10 : 9); const selected = patch ? changes : full; number(selected.length);
    for (const key of selected) {
      const index = keys.indexOf(key); number(index + 1); if (index < 0) text(key);
      if (!Object.hasOwn(v, key)) out.push(11); else write(v[key], Object.hasOwn(baseline, key) ? baseline[key] : undefined, depth + 1);
    }
  };
  write(value, base, 0);
  if (out.length > MAX) throw new Error('Code trop volumineux.');
  const raw = Uint8Array.from(out), compressed = deflateSync(raw, { level: 9 });
  const zipped = compressed.length < raw.length, body = zipped ? compressed : raw;
  const bytes = new Uint8Array(5 + body.length); bytes[0] = zipped ? 1 : 0;
  new DataView(bytes.buffer).setUint32(1, checksum(body), true); bytes.set(body, 5);
  return prefix + base64(bytes);
}

export function decodeCompact(code: string, base: unknown, prefix: string): unknown {
  code = code.trim().replace(/\s/g, '');
  if (!code.startsWith(prefix)) throw new Error(`Code invalide : collez un code ${prefix}…`);
  try {
    const s = code.slice(prefix.length);
    if (!/^[\w-]+$/.test(s) || s.length % 4 === 1 || s.length > MAX * 1.4) throw new Error();
    const wire = Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    if (wire.length < 6 || wire[0] > 1 || base64(wire) !== s) throw new Error();
    if (checksum(wire.subarray(5)) !== new DataView(wire.buffer).getUint32(1, true)) throw new Error();
    const bytes = wire[0] ? inflateSync(wire.subarray(5), { out: new Uint8Array(MAX + 1) }) : wire.subarray(5);
    if (bytes.length > MAX) throw new Error();
    let pos = 0;
    const byte = (): number => { if (pos >= bytes.length) throw new Error(); return bytes[pos++]; };
    const number = (): number => {
      let n = 0, factor = 1;
      for (let i = 0; i < 8; i++) { const b = byte(); n += (b & 127) * factor; if (!Number.isSafeInteger(n)) throw new Error(); if (!(b & 128)) return n; factor *= 128; }
      throw new Error();
    };
    const take = (length: number): Uint8Array => { if (pos + length > bytes.length) throw new Error(); const b = bytes.subarray(pos, pos + length); pos += length; return b; };
    const text = (): string => strFromU8(take(number()));
    const read = (ref: any, depth: number): any => {
      if (depth > MAX_DEPTH) throw new Error();
      const tag = byte();
      if (tag === 0) { if (ref === undefined) throw new Error(); return structuredClone(ref); }
      if (tag === 1) return null;
      if (tag === 2 || tag === 3) return tag === 3;
      if (tag === 4) { const n = number(); return n % 2 ? -(n + 1) / 2 : n / 2; }
      if (tag === 5) { const b = take(8), n = new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true); if (!Number.isFinite(n)) throw new Error(); return n; }
      if (tag === 6) return text();
      if (tag === 7) { const s = words[number()]; if (s === undefined) throw new Error(); return s; }
      const count = number(); if (count > MAX || count > bytes.length - pos) throw new Error();
      if (tag === 8) return Array.from({ length: count }, (_, i) => read(Array.isArray(ref) ? ref[i] : undefined, depth + 1));
      if (tag !== 9 && tag !== 10) throw new Error();
      const baseline = object(ref) ? ref : {}, keys = Object.keys(baseline).sort();
      const result = Object.assign(Object.create(null), tag === 10 ? structuredClone(baseline) : {}), seen = new Set();
      for (let i = 0; i < count; i++) {
        const index = number(), key = index ? keys[index - 1] : text();
        if (key === undefined || seen.has(key)) throw new Error(); seen.add(key);
        if (bytes[pos] === 11) { if (tag !== 10 || !Object.hasOwn(baseline, key)) throw new Error(); pos++; delete result[key]; }
        else result[key] = read(Object.hasOwn(baseline, key) ? baseline[key] : undefined, depth + 1);
      }
      return result;
    };
    const value = read(base, 0); if (pos !== bytes.length) throw new Error(); return value;
  } catch { throw new Error('Code incomplet, corrompu ou trop volumineux.'); }
}
