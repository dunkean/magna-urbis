import { describe, expect, it } from 'vitest';
import { shoreRegions, splineSample } from '../../src/v2/shoreline';

describe('one coastline: the display spline zero line (v2/shoreline.ts)', () => {
  it('traces the sea on the spline zero line, islands as holes, inland depressions stay land', () => {
    const fn = 256, width = 1024, cell = width / fn, data = new Float32Array(fn * fn);
    for (let j = 0; j < fn; j++) for (let i = 0; i < fn; i++) {
      const x = (i + .5) * cell, y = (j + .5) * cell;
      let h = (x - 400 - 30 * Math.sin(y / 50)) * .05;
      h = Math.max(h, 3 - Math.hypot(x - 150, y - 500) * .1);   // an island 30 m across in the sea
      h = Math.min(h, -2 + Math.hypot(x - 800, y - 300) * .1);  // an inland depression below 0 m, far from the coast
      data[j * fn + i] = h;
    }
    const field = { n: fn, data }, n = 64, sea = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (i + .5) * width / n, y = (j + .5) * width / n; sea[j * n + i] = x < 400 + 30 * Math.sin(y / 50) && Math.hypot(x - 150, y - 500) > 30 ? 1 : 0; }
    const regions = shoreRegions(field, width, sea, n);
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(1);
    for (const ring of [regions[0].outer, ...regions[0].holes]) for (const p of ring) {
      if (p.x <= 0 || p.y <= 0 || p.x >= width || p.y >= width) continue;
      const [v, gx, gy] = splineSample(field, width, p.x, p.y);
      expect(Math.abs(v) / Math.hypot(gx, gy)).toBeLessThan(.05);
    }
  });
});
