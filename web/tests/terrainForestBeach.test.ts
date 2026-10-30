import { describe, it, expect } from 'vitest';
import { forestBeachGrid } from '../../rust/bridge/terrainForestBeach';

// West half sea, a low beach strip, then high ground.
function layer(n = 64, width = 8000) {
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + .5) / n;
    data[j * n + i] = x < .3 ? -20 : x < .5 ? 1 + (x - .3) * 20 : 300;
  }
  return { x: -4000, y: -4000, width, n, data };
}

describe('forestBeachGrid', () => {
  const l = layer(), g = forestBeachGrid(l, 42, 64), many = [1, 2, 3, 4, 5, 6].map(s => forestBeachGrid(l, s, 64));
  it('has the requested shape', () => {
    expect(g.n).toBe(64); expect(g.data.length).toBe(64 * 64);
    expect([g.x, g.y, g.width]).toEqual([l.x, l.y, l.width]);
  });
  it('is zero underwater and on high ground, within 0..255, and finds a beach', () => {
    let beach = 0;
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const v = g.data[j * 64 + i];
      if (i < 18) expect(v).toBe(0);
      if (i > 40) expect(v).toBe(0);
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(255);
      if (v > 0 || many.some(m => m.data[j * 64 + i] > 0)) beach++;
    }
    expect(beach).toBeGreaterThan(0);
  });
  it('is deterministic for a seed', () => {
    expect(forestBeachGrid(l, 42, 64).data).toEqual(g.data);
  });
});
