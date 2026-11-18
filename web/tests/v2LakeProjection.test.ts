import { describe, expect, it } from 'vitest';
import type { TerrainData } from '../../rust/bridge/terrain';
import type { VectorWater } from '../src/ui/vectorWater';
import { lakeSample } from '../src/ui/lakeGeometry';
import { lakeShores } from '../src/ui/vectorWaterRender';
import { waterRings } from '../../rust/bridge/urbanGeography';
import { settlementRaster } from '../../rust/bridge/settlements';
import { projectEngineTerrain } from '../src/v2/terrainProjection';

describe('retained vector lakes in planning', () => {
  it('uses the drawn shoreline for lake polygons, land-use cells and settlement/road cells', () => {
    const n = 32,
      width = 3200,
      size = n * n,
      cell = width / n;
    const height = new Float32Array(size).fill(20),
      lake = new Uint8Array(size);
    const values = new Float32Array(size),
      distance = new Float32Array(size);
    // The continuous shore extends beyond the raw submerged-cell mask, as a
    // depth-aware shore can. Planning must consume that field without refitting.
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        lake[i] = x >= 10 && x <= 20 && y >= 10 && y <= 20 ? 1 : 0;
        values[i] = distance[i] = Math.min(x - 9.2, 21.2 - x, y - 9.2, 21.2 - y);
      }
    const water = {
      lake,
      lakeField: { n, values, distance },
      lakeLevel: new Float32Array(size).fill(42),
      riverArea: 100,
      hydro: { n, width, height, filled: height.slice(), sea: new Uint8Array(size), receiver: new Int32Array(size).fill(-1), accumulation: new Float32Array(size) },
    } as VectorWater;
    const data = { x: 0, y: 0, width, resolution: n, height, water, caveMask: new Uint8Array(0) } as TerrainData;
    const terrain = projectEngineTerrain(data),
      planning = settlementRaster(data, n);
    expect(terrain.lakes).toEqual(waterRings(`<path d="${lakeShores(water)}"/>`).flat());
    expect(terrain.lakes.length).toBeGreaterThan(0);
    expect(planning.water).toEqual(terrain.water);
    let shoreExtension = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x,
          wet = lakeSample(water.lakeField, width, (x + 0.5) * cell, (y + 0.5) * cell) >= 0;
        expect(terrain.water[i]).toBe(wet ? 2 : 0);
        if (wet) {
          expect(terrain.filled[i]).toBe(42);
          expect(planning.waterLevel[i]).toBe(42);
          if (!lake[i]) shoreExtension++;
        }
      }
    expect(shoreExtension).toBeGreaterThan(0);
  });
});
