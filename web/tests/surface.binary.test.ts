import { describe, expect, it } from 'vitest';
import { decodeSurfaceBinary, encodeSurfaceBinary, isSurfaceBinary } from '../src/surface/binary';

describe('Surface binary container', () => {
  it('preserves typed bytes, NaN/Infinity sentinels and opaque feature records', () => {
    const source = { format: 'magna-surface-packet', world: { heights: new Float32Array([0, .1, -42, NaN, Infinity, -Infinity]),
      flags: new Uint8Array([0, 255]), ids: new Uint16Array([0, 65535]), indexes: new Int32Array([-1, 2147483647]),
      colors: new Uint32Array([0xffffffff]), doubles: new Float64Array([1e20, .1]) },
      features: { native: { arrayType: 'opaque-user-tag', values: ['not a numeric array'] } } };
    const bytes = encodeSurfaceBinary(source); expect(isSurfaceBinary(bytes)).toBe(true);
    const copy = decodeSurfaceBinary<typeof source>(bytes);
    expect(copy.features).toEqual(source.features);
    for (const key of Object.keys(source.world) as (keyof typeof source.world)[]) {
      expect(copy.world[key].constructor).toBe(source.world[key].constructor);
      expect(new Uint8Array(copy.world[key].buffer)).toEqual(new Uint8Array(source.world[key].buffer));
    }
  });
  it('keeps a million float samples binary without widening to JSON decimals', () => {
    const values = Float32Array.from({ length: 1024 ** 2 }, (_, i) => Math.sin(i / 127));
    const bytes = encodeSurfaceBinary({ values, metadata: { sourceLOD: -4, nativeSpacingM: .25 } });
    expect(bytes.length).toBeLessThan(values.byteLength + 4096);
    expect(decodeSurfaceBinary<{ values: Float32Array }>(bytes).values).toEqual(values);
  });
  it('rejects truncation, memory overflow, invalid targets and non-finite metadata', () => {
    const bytes = encodeSurfaceBinary({ values: new Float32Array([1, 2]) });
    expect(() => decodeSurfaceBinary(bytes.subarray(0, bytes.length - 1))).toThrow(/length/);
    expect(() => decodeSurfaceBinary(bytes, { maxBytes: 1 })).toThrow(/budget/);
    expect(() => encodeSurfaceBinary({ values: new Uint8Array(200) }, { maxBytes: 100 })).toThrow(/budget/);
    expect(() => encodeSurfaceBinary({ resolution: Infinity })).toThrow(/metadata/);
    const corrupted = bytes.slice(); new DataView(corrupted.buffer).setUint32(8, 0xffffffff, true);
    expect(() => decodeSurfaceBinary(corrupted)).toThrow(/length/);
  });
});
