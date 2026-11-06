import { describe, expect, it } from 'vitest';
import { settlementRaster, validatePhysicalTerrain } from '../../rust/bridge/settlements';
import type { TerrainData } from '../../rust/bridge/terrain';
import type { VectorWater } from '../src/ui/vectorWater';

const terrain = (n = 32): TerrainData => ({
  x: 0, y: 0, width: 3200, resolution: n, minHeight: 30, maxHeight: 30, globalMinHeight: 30, globalMaxHeight: 30, motifSize: 3000,
  height: new Float32Array(n * n).fill(30), caveMask: new Uint8Array(), normalX: new Float32Array(n * n), normalY: new Float32Array(n * n), normalZ: new Float32Array(n * n).fill(1), generationMs: 0,
});
describe('completed terrain adapter for Rust settlements', () => {
  it('uses canonical physical heights and sea without mutating the terrain', () => {
    const t = terrain(); t.physical = { n: 32, height: new Float32Array(1024).fill(42) };
    t.physical.height[0] = -3;
    const result = settlementRaster(t);
    expect(result.height[1]).toBe(42); expect(result.water[0]).toBe(1); expect(result.waterLevel[0]).toBe(0);
    expect(result.water[1]).toBe(0); expect(result.riverIds[1]).toBe(-1); expect(t.height[1]).toBe(30);
  });
  it('reserves cavern rock and leaves cavern floor available', () => {
    const t = terrain(); t.caveMask = new Uint8Array(1024); t.caveMask[100] = 1;
    const result = settlementRaster(t); expect(result.water[100]).toBe(2); expect(result.water[101]).toBe(0);
  });
  it('adapts displayed lake shores and channel widths, keeping sea and lakes blocked', () => {
    const t = terrain(), n = 32, sea = new Uint8Array(n * n), lake = new Uint8Array(n * n);
    sea.fill(1, 0, n);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) lake[y * n + x] = 1;
    t.water = {
      hydro: { n, width: t.width, height: t.height, filled: new Float32Array(n * n).fill(35), sea }, lake,
      widthScale: 3, rivers: { rivers: [{ points: [1550, 150, 1550, 3050], area: [1e6, 1e6], level: [30, 28], kind: [0, 0], id: 7 }], braids: [], distributaries: [], oxbows: [] },
    } as unknown as VectorWater;
    const result = settlementRaster(t);
    expect(result.water[0]).toBe(1);
    expect(result.water[15 * n + 15]).toBe(2); expect(result.waterLevel[15 * n + 15]).toBe(35);
    expect(result.water[5 * n + 15]).toBe(3); expect(result.riverWidth[5 * n + 15]).toBe(9); expect(result.riverIds[5 * n + 15]).toBe(7);
    expect(result.waterLevel[5 * n + 15]).toBeLessThan(30);
  });
  it('bounds the routing grid while retaining world dimensions', () => {
    const t = terrain(1024); const result = settlementRaster(t);
    expect(result.n).toBe(512); expect(result.width).toBe(3200); expect(result.height.length).toBe(512 ** 2);
    expect(result.physical).toEqual({ n: 1024, height: t.height });
    expect(settlementRaster(t, 8192).n).toBe(1024);
  });
  it('keeps cell-centred physical metres while the planning raster is resampled', () => {
    const t = terrain(32), source = new Float32Array(64 * 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) source[y * 64 + x] = 10 + x * 2 + y;
    t.physical = { n: 64, height: source };
    const controls = Float32Array.from(source, value => value + 100);
    t.field = { n: 64, data: controls, exact: true, floor: .3 };
    const result = settlementRaster(t, 32);
    expect(result.n).toBe(32);
    expect(result.physical).toEqual({ n: 64, height: controls, interpolation: 'bspline', floor: .3 });
    expect(result.height[0]).toBeCloseTo((source[0] + source[1] + source[64] + source[65]) / 4);
    expect(result.height[0]).not.toBe(source[0]);
  });
  it('rejects malformed physical dimensions before upload', () => {
    expect(() => validatePhysicalTerrain({ n: 64, height: new Float32Array(32) })).toThrow('Invalid physical');
    expect(() => validatePhysicalTerrain({ n: 2, height: new Float32Array([1, 2, Number.NaN, 4]) })).toThrow('Invalid physical');
  });
  it('adapts the native Rust water arrays to the same passability classes', () => {
    const t = terrain(), n = 32, seaMask = new Uint8Array(n * n), lakeLabels = new Uint32Array(n * n), lakeDepth = new Float32Array(n * n);
    seaMask[0] = 1; lakeLabels[500] = 1; lakeDepth[500] = 3;
    t.hydrology = { resolution: n, seaMask, lakeLabels, lakeDepth, filled: new Float32Array(n * n).fill(33),
      riverOffsets: new Uint32Array([0, 2]), riverPoints: new Float32Array([350, 450, 8, 29, 2850, 450, 10, 28]),
    } as TerrainData['hydrology'];
    const result = settlementRaster(t);
    expect(result.water[0]).toBe(1); expect(result.water[500]).toBe(2); expect(result.waterLevel[500]).toBe(33);
    expect(result.water[4 * n + 10]).toBe(3); expect(result.riverWidth[4 * n + 10]).toBe(10); expect(result.riverIds[4 * n + 10]).toBe(0);
  });
});
