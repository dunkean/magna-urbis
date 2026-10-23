/** Hash includes content and shape, not merely source labels (edit-safe cache invalidation). */
export function fingerprint(value: unknown): string {
  // Four seeded 32-bit lanes give a 128-bit output format. This is a fast cache
  // fingerprint, not a claim of 128-bit collision resistance or authentication.
  const hashes = [2166136261, 3335557771, 1597334677, 3812015801];
  const feedByte = (byte: number) => { for (let lane = 0; lane < 4; lane++) hashes[lane] = Math.imul(hashes[lane] ^ byte, 16777619 + lane * 2); };
  const feed = (text: string) => { for (let j = 0; j < text.length; j++) { const c = text.charCodeAt(j); feedByte(c & 255); feedByte(c >>> 8); } };
  const walk = (v: unknown): void => {
    if (ArrayBuffer.isView(v)) {
      feed(v.constructor.name + ':' + v.byteLength + ':');
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      for (let j = 0; j < bytes.length; j++) feedByte(bytes[j]);
    } else if (Array.isArray(v)) { feed('['); for (const x of v) walk(x); feed(']'); }
    else if (v && typeof v === 'object') {
      feed('{'); for (const key of Object.keys(v).filter(key => (v as Record<string, unknown>)[key] !== undefined).sort()) { feed(key + ':'); walk((v as Record<string, unknown>)[key]); } feed('}');
    } else feed(typeof v + ':' + String(v) + ';');
  };
  walk(value);
  return hashes.map(hash => (hash >>> 0).toString(16).padStart(8, '0')).join('');
}

