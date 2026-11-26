import { describe, expect, it } from 'vitest';
import { ROAD_GRID, roadTerrain } from '../src/render/roadTerrain';
import { roadFeather } from '../src/render/roadStyle';

describe('satellite road materials', () => {
  it('darkens a low bank, dries above a cliff and exposes stone on its face', () => {
    const n = 64,
      width = 640,
      height = new Float32Array(n * n),
      water = new Uint8Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        water[y * n + x] = x === 10 ? 3 : 0;
        height[y * n + x] = x >= 15 ? 24 : 0;
      }
    const raster = { n, width, height, water };
    const field = roadTerrain(raster);
    const value = (x: number) => field.exposure[ROAD_GRID * (ROAD_GRID >> 1) + Math.floor(((x + 0.5) * ROAD_GRID) / n)];
    expect(value(11)).toBeLessThan(value(13));
    expect(value(13)).toBeLessThan(0);
    expect(value(15)).toBeGreaterThan(0);
    expect(value(17)).toBe(0);
    expect(roadTerrain(raster)).toBe(field);
    expect(roadTerrain({ ...raster, rock: water }).exposure.some(v => v < 0)).toBe(false);
  });

  it('reserves a continuous core and only opens the verge when its width resolves', () => {
    for (const metres of [1.35, 2.7, 4.05, 8]) {
      expect(roadFeather('path', metres, 1 / metres)).toBe(0);
      const margin = roadFeather('path', metres, 4);
      expect(margin).toBeGreaterThan(0);
      expect(metres - margin * 2).toBeGreaterThan(0.4 * metres);
    }
  });
});
