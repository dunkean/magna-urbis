import { describe, expect, it } from 'vitest';
import { heightFromElevations, importedHeightfield } from '../src/gen/terrain/import';
import { makeOptions, generationUid } from '../src/gen/options';

describe('V2 FP32 terrain handoff', () => {
  it('preserves metre precision and underwater elevation without RGBA quantization', () => {
    const values = Float32Array.from([-123.456, -0.001, 0.0001, 987.654]);
    const result = importedHeightfield({ w: 2, h: 2, rgba: new Uint8Array(0), elevations: values }, 400, 2);
    expect(Array.from(result.height.data)).toEqual(Array.from(values));
    expect(result.height.data).not.toBe(values);
  });
  it('resamples at pixel centres and rejects invalid source rasters', () => {
    const source = Float32Array.from([0, 10, 20, 30]);
    const result = heightFromElevations(source, 2, 2, 400, 1);
    expect(result.data[0]).toBe(15); expect(result.cell).toBe(400);
    expect(() => heightFromElevations(Float32Array.from([NaN]), 1, 1, 400, 1)).toThrow();
    expect(() => heightFromElevations(source, 2, 3, 400, 2)).toThrow();
  });
  it('gives different FP32 sources distinct generation identities', () => {
    const importedHeight = { w: 2, h: 2, rgba: new Uint8Array(0), elevations: Float32Array.from([0, 1, 2, 3]) };
    const first = generationUid({ ...makeOptions(), importedHeight });
    const second = generationUid({ ...makeOptions(), importedHeight: { ...importedHeight, elevations: Float32Array.from([0, 1, 2, 3.001]) } });
    expect(first).not.toBe(second);
  });
});
