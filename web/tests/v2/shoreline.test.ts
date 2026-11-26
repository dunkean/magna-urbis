import { describe, expect, it } from 'vitest';
import { SHORE_DETAIL_REACH, shoreOffset } from '../../src/render/shoreDetail';
import { shoreRegions, splineSample } from '../../src/v2/shoreline';
import { rasterizeSea } from '../../src/v2/terrainProjection';
import { TerrainHeights } from '../../src/render/world/heights';

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
    rasterizeSea(shoreRegions(field, width, sea, n), n, width / n, planned, water);
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
