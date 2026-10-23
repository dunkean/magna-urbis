/** MUFSURF1: a small JSON manifest followed by aligned little-endian typed arrays.
 * Numeric fields never become millions of decimal JSON strings. */
const MAGIC = 'MUFSURF1';
const TYPES = {
  f32: Float32Array, f64: Float64Array, i32: Int32Array,
  u32: Uint32Array, u16: Uint16Array, u8: Uint8Array,
} as const;
type Dtype = keyof typeof TYPES;
type NumericArray = InstanceType<(typeof TYPES)[Dtype]>;
interface ArrayDescriptor { path: Array<string | number>; dtype: Dtype; offset: number; length: number }
interface Manifest { format: 'magna-surface-binary'; version: 1; value: unknown; arrays: ArrayDescriptor[] }
const align = (n: number) => Math.ceil(n / 8) * 8;
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const safeKey = (key: string | number) => typeof key === 'number' ? Number.isSafeInteger(key) && key >= 0 : !['__proto__', 'prototype', 'constructor'].includes(key);

function dtypeOf(value: ArrayBufferView): Dtype {
  for (const [name, Ctor] of Object.entries(TYPES)) if (value instanceof Ctor) return name as Dtype;
  throw new Error('Unsupported binary numeric array');
}
export function encodeSurfaceBinary(value: unknown, options: { maxBytes?: number } = {}): Uint8Array {
  const arrays: ArrayDescriptor[] = [], blocks: Array<{ offset: number; value: NumericArray }> = [];
  const seenArrays = new Map<ArrayBufferView, number>(), parents = new Set<object>();
  let payloadLength = 0;
  const walk = (node: unknown, path: Array<string | number>): unknown => {
    if (ArrayBuffer.isView(node)) {
      const dtype = dtypeOf(node), typed = node as NumericArray;
      let offset = seenArrays.get(node);
      if (offset === undefined) { offset = align(payloadLength); payloadLength = offset + typed.byteLength; blocks.push({ offset, value: typed }); seenArrays.set(node, offset); }
      arrays.push({ path, dtype, offset, length: typed.length }); return null;
    }
    if (typeof node === 'number' && !Number.isFinite(node)) throw new Error(`Non-finite metadata at ${path.join('.')}; place numeric fields in typed arrays`);
    if (node && typeof node === 'object') {
      if (parents.has(node)) throw new Error('Cyclic surface metadata'); parents.add(node);
      let result: unknown;
      if (Array.isArray(node)) result = node.map((entry, i) => walk(entry, [...path, i]));
      else {
        const record: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(node)) {
          if (!safeKey(key)) throw new Error('Unsafe surface metadata key');
          if (entry !== undefined) record[key] = walk(entry, [...path, key]);
        }
        result = record;
      }
      parents.delete(node); return result;
    }
    if (['function', 'symbol', 'bigint'].includes(typeof node)) throw new Error('Unsupported surface metadata');
    return node;
  };
  const manifest: Manifest = { format: 'magna-surface-binary', version: 1, value: walk(value, []), arrays };
  const header = new TextEncoder().encode(JSON.stringify(manifest));
  if (header.length > 16 * 1024 * 1024) throw new RangeError('Surface metadata exceeds 16 MiB; encode numeric source layers as typed arrays');
  const start = align(16 + header.length), total = start + payloadLength;
  if (total > (options.maxBytes ?? 1024 ** 3) || total > 0xffffffff) throw new RangeError('Surface binary exceeds memory budget');
  const bytes = new Uint8Array(total), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(MAGIC)); view.setUint32(8, header.length, true); view.setUint32(12, payloadLength, true); bytes.set(header, 16);
  for (const block of blocks) {
    const source = new Uint8Array(block.value.buffer, block.value.byteOffset, block.value.byteLength);
    bytes.set(source, start + block.offset);
    if (!littleEndian && block.value.BYTES_PER_ELEMENT > 1) {
      const size = block.value.BYTES_PER_ELEMENT;
      for (let i = 0; i < source.length; i += size) bytes.subarray(start + block.offset + i, start + block.offset + i + size).reverse();
    }
  }
  return bytes;
}
export function isSurfaceBinary(bytes: Uint8Array): boolean {
  return bytes.length >= 16 && new TextDecoder().decode(bytes.subarray(0, 8)) === MAGIC;
}
export function decodeSurfaceBinary<T = unknown>(bytes: Uint8Array, options: { maxBytes?: number } = {}): T {
  if (!isSurfaceBinary(bytes)) throw new Error('Expected MUFSURF1 binary surface');
  if (bytes.byteLength > (options.maxBytes ?? 1024 ** 3)) throw new RangeError('Surface binary exceeds read memory budget');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), manifestLength = view.getUint32(8, true), payloadLength = view.getUint32(12, true);
  const start = align(16 + manifestLength);
  if (manifestLength > 16 * 1024 * 1024 || start > bytes.length || start + payloadLength !== bytes.length) throw new Error('Invalid surface binary lengths');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, 16 + manifestLength))) as Manifest;
  if (manifest.format !== 'magna-surface-binary' || manifest.version !== 1 || !Array.isArray(manifest.arrays) || manifest.arrays.length > 4096) throw new Error('Unsupported surface binary manifest');
  const paths = new Set<string>();
  let allocated = 0;
  for (const item of manifest.arrays) {
    if (!item || !Object.hasOwn(TYPES, item.dtype) || !Array.isArray(item.path) || !item.path.length || item.path.length > 32 || !item.path.every(safeKey)) throw new Error('Invalid surface array descriptor');
    const Ctor = TYPES[item.dtype], length = item.length, offset = item.offset, count = length * Ctor.BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset) || offset < 0 || offset % Ctor.BYTES_PER_ELEMENT || offset + count > payloadLength) throw new Error('Surface array outside payload');
    allocated += count;
    if (allocated > (options.maxBytes ?? 1024 ** 3)) throw new RangeError('Decoded surface arrays exceed memory budget');
    const key = JSON.stringify(item.path); if (paths.has(key)) throw new Error('Duplicate surface array path'); paths.add(key);
    let parent: any = manifest.value;
    for (const segment of item.path.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, segment)) throw new Error('Surface array path missing');
      parent = parent[segment];
    }
    const last = item.path.at(-1)!;
    if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, last) || parent[last] !== null) throw new Error('Surface array target is not an empty slot');
    const data = bytes.slice(start + offset, start + offset + count);
    if (!littleEndian && Ctor.BYTES_PER_ELEMENT > 1) for (let i = 0; i < data.length; i += Ctor.BYTES_PER_ELEMENT) data.subarray(i, i + Ctor.BYTES_PER_ELEMENT).reverse();
    parent[last] = new Ctor(data.buffer, data.byteOffset, length);
  }
  return manifest.value as T;
}
