import { describe, expect, it } from 'vitest';
import { SHORE_DETAIL_REACH, shoreOffset } from '../../src/render/shoreDetail';
import { shoreRegions, splineSample } from '../../src/v2/shoreline';
import { projectEngineTerrain, rasterizeSea } from '../../src/v2/terrainProjection';
import { rustSettlementRaster } from '../../src/v2/rustUrban';
import { TerrainHeights } from '../../src/render/world/heights';
import type { TerrainData } from '../../../rust/bridge/terrain';
import type { World } from '../../src/gen/types';

describe('one coastline: the refined zero line of the display spline (v2/shoreline.ts)', () => {
  /** A wavy coast at x ≈ 400 m with an island in the sea and an inland depression, and its 64² planning sea. */
  function coast() {
    const fn = 256,
      width = 1024,
      cell = width / fn,
      data = new Float32Array(fn * fn);
    for (let j = 0; j < fn; j++)
      for (let i = 0; i < fn; i++) {
        const x = (i + 0.5) * cell,
          y = (j + 0.5) * cell;
        let h = (x - 400 - 30 * Math.sin(y / 50)) * 0.05;
        h = Math.max(h, 3 - Math.hypot(x - 150, y - 500) * 0.1); // an island 30 m across in the sea
        h = Math.min(h, -2 + Math.hypot(x - 800, y - 300) * 0.1); // an inland depression below 0 m, far from the coast
        data[j * fn + i] = h;
      }
    const field = { n: fn, data },
      n = 64,
      sea = new Uint8Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) * width) / n,
          y = ((j + 0.5) * width) / n;
        sea[j * n + i] = x < 400 + 30 * Math.sin(y / 50) && Math.hypot(x - 150, y - 500) > 30 ? 1 : 0;
      }
    return { field, width, cell, sea, n };
  }
  it('traces the sea on the refined zero line, islands as holes, inland depressions stay land', () => {
    const { field, width, cell, sea, n } = coast(),
      regions = shoreRegions(field, width, sea, n);
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(1);
    for (const ring of [regions[0].outer, ...regions[0].holes])
      for (const p of ring) {
        if (p.x <= 0 || p.y <= 0 || p.x >= width || p.y >= width) continue;
        const [v, gx, gy] = splineSample(field, width, p.x, p.y),
          slope = Math.hypot(gx, gy),
          refined = v + shoreOffset(p.x, p.y, v, slope, cell);
        expect(Math.abs(refined) / slope).toBeLessThan(0.1);
        // The shore leaves the spline's own line, by less than the reach of the detail.
        expect(Math.abs(v) / slope).toBeLessThan(SHORE_DETAIL_REACH * cell);
      }
  });
  it('plans with the refined coastline at the planning cells: the mask takes the side of the drawn shore', () => {
    const { field, width, cell, sea, n } = coast(),
      planned = sea.slice(),
      water = sea.slice();
    rasterizeSea(
      shoreRegions(field, width, sea, n).flatMap(({ outer, holes }) => [outer, ...holes]),
      n,
      width / n,
      planned,
      water,
    );
    expect(water).toEqual(planned);
    let checked = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) * width) / n,
          y = ((j + 0.5) * width) / n,
          [v, gx, gy] = splineSample(field, width, x, y),
          slope = Math.hypot(gx, gy),
          refined = v + shoreOffset(x, y, v, slope, cell);
        // Planning cells near the coast (the inland depression stays land, as traced); a centre on the line is either side.
        if (Math.hypot(x - 800, y - 300) < 40 || Math.abs(refined) / slope < 0.25) continue;
        if (Math.abs(x - 400) > 120 && Math.hypot(x - 150, y - 500) > 60) continue;
        expect(planned[j * n + i], `cell ${i}, ${j}`).toBe(refined < 0 ? 1 : 0);
        checked++;
      }
    expect(checked).toBeGreaterThan(100);
    expect(planned[Math.floor(500 / 16) * n + Math.floor(150 / 16)]).toBe(0);
  });
  it('plans from the drawn sea when the city raster uses a different side', () => {
    const width = 64000,
      gridSide = 16,
      citySide = 32,
      cell = width / citySide;
    const heights = (n: number) =>
      Float32Array.from({ length: n ** 2 }, (_, i) => {
        const x = ((i % n) + 0.5) / n,
          y = (Math.floor(i / n) + 0.5) / n;
        return (x - 0.5 - (3 / citySide) * Math.cos(2 * Math.PI * y)) * 160;
      });
    const height = heights(gridSide),
      physical = { n: citySide, height: heights(citySide) },
      seaMask = Uint8Array.from(height, (_, i) => (i % gridSide < gridSide / 2 ? 1 : 0)),
      lakeLabels = new Uint32Array(gridSide ** 2),
      lakeDepth = new Float32Array(gridSide ** 2),
      filled = height.slice();
    const lake = 11 * gridSide + 12;
    lakeLabels[lake] = 1;
    lakeDepth[lake] = 2;
    filled[lake] = 49;
    const data: TerrainData = {
      x: 0,
      y: 0,
      width,
      resolution: gridSide,
      height,
      physical,
      field: { n: citySide, data: physical.height, exact: true, floor: -100 },
      minHeight: -100,
      maxHeight: 100,
      globalMinHeight: -100,
      globalMaxHeight: 100,
      motifSize: width,
      caveMask: new Uint8Array(),
      normalX: new Float32Array(),
      normalY: new Float32Array(),
      normalZ: new Float32Array(),
      generationMs: 0,
      hydrology: {
        width,
        resolution: gridSide,
        seaMask,
        lakeLabels,
        lakeDepth,
        filled,
        lakeOffsets: new Uint32Array(),
        riverOffsets: new Uint32Array([0, 2]),
        riverPoints: new Float32Array([15.5 * cell, 16.5 * cell, 8, 10, 22.5 * cell, 16.5 * cell, 8, 15]),
        riverMeta: new Uint32Array(6),
        nodeMeta: new Uint32Array(3),
      } as TerrainData['hydrology'],
    };
    const terrain = projectEngineTerrain(data),
      world = { mapSize: width, terrain } as World,
      raster = rustSettlementRaster(world);
    const newSea = 2 * citySide + 17,
      newLand = 16 * citySide + 14,
      riverMouth = newLand + 1,
      lakeCell = 22 * citySide + 24;
    expect(raster.n).toBe(citySide);
    expect([raster.water[newSea], raster.waterLevel[newSea]]).toEqual([1, 0]);
    expect([raster.water[newLand], raster.waterLevel[newLand]]).toEqual([0, physical.height[newLand]]);
    expect([raster.water[riverMouth], raster.waterLevel[riverMouth], raster.riverIds[riverMouth]]).toEqual([3, 10, 0]);
    expect([raster.water[lakeCell], raster.waterLevel[lakeCell]]).toEqual([2, 49]);
    expect(rustSettlementRaster(world)).toBe(raster);
  });
  it('pins the shore offset on the values its Rust mirror pins (rust/crates/terrain/src/shore_detail.rs)', () => {
    // A plane of slope 0.1 crossing sea level, cells of 30 m: point, spline value, offset.
    for (const [x, y, h, expected] of [
      [955, 700, -0.5, -0.15888651102481158],
      [962.5, 1010, 0.25, -0.10346281897703119],
      [940, 333.3, -2, 0.03680147280996239],
      [1200, 900, 24, 0],
    ])
      expect(shoreOffset(x, y, h, 0.1, 30)).toBeCloseTo(expected, 9);
  });
  it('raises the 3D relief of a coastal map to the drawn shore', () => {
    const { field, width, cell } = coast(),
      relief = new TerrainHeights(field.data, field.n, width, -Infinity, 1, true);
    let moved = 0;
    for (let y = 100; y < 900; y += 7.3) {
      const x = 400 + 30 * Math.sin(y / 50),
        [v, gx, gy] = splineSample(field, width, x, y),
        drawn = v + shoreOffset(x, y, v, Math.hypot(gx, gy), cell);
      expect(relief.naturalMetresAt(x, y)).toBeCloseTo(drawn, 4);
      if (Math.abs(drawn - v) > 1e-3) moved++;
    }
    expect(moved).toBeGreaterThan(10);
  });
});
