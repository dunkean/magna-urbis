/** Deterministic 128-bit, non-cryptographic identity for retained generation rasters. */
class Fingerprint {
  private a = 0x811c9dc5; private b = 0x9e3779b9; private c = 0x85ebca6b; private d = 0xc2b2ae35;
  word(value: number, index: number): void {
    this.a = Math.imul(this.a ^ value, 0x01000193);
    this.b = Math.imul(this.b ^ value ^ index, 0x85ebca6b);
    this.c = Math.imul(this.c ^ (value >>> 16 | value << 16), 0xc2b2ae35);
    this.d = Math.imul(this.d ^ value ^ Math.imul(index, 0x9e3779b9), 0x27d4eb2d);
  }
  finish(length: number): string {
    this.word(length, 0x7fffffff);
    const avalanche = (value: number) => { value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b); value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35); return ((value ^ value >>> 16) >>> 0).toString(16).padStart(8, '0'); };
    return `${length}:${[this.a, this.b, this.c, this.d].map(avalanche).join('')}`;
  }
}
/** Byte offsets and tails are significant; explicit little endian makes the result portable. */
export function fingerprintBytes(bytes: Uint8Array | Uint8ClampedArray): string {
  const state = new Fingerprint(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0; for (; i + 4 <= bytes.length; i += 4) state.word(view.getUint32(i, true), i);
  let tail = 0; for (let shift = 0; i < bytes.length; i++, shift += 8) tail |= bytes[i] << shift;
  if (bytes.length % 4) state.word(tail, i);
  return state.finish(bytes.length);
}
/** Hash exact JS numbers without decimal expansion or a second raster-sized allocation. */
export function fingerprintNumbers(values: readonly number[]): string {
  const state = new Fingerprint(), bits = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < values.length; i++) {
    bits.setFloat64(0, values[i], true);
    state.word(bits.getUint32(0, true), i * 2); state.word(bits.getUint32(4, true), i * 2 + 1);
  }
  return state.finish(values.length);
}
