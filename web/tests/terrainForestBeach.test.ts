import { describe, it, expect } from 'vitest';
import { forestBeachGrid, shoreRingGrid } from '../../rust/bridge/terrainForestBeach';

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

describe('shoreRingGrid', () => {
  const l = layer(), g = shoreRingGrid(l, 64);
  it('sees the sea from the shore, nothing inland', () => {
    expect(g.data.length).toBe(64 * 64 * 2);
    const at = (i: number) => [g.data[(10 * 64 + i) * 2], g.data[(10 * 64 + i) * 2 + 1]];
    // x = 0.4 of the width: beach strip about 800 m from the sea edge (r = 300 m)
    expect(at(60)).toEqual([65000, 0]);
    const near = at(19); // just east of the sea edge (x=.3)
    expect(near[0]).toBeLessThanOrEqual(300); expect(near[1]).toBeGreaterThan(0);
    expect(at(2)[1]).toBe(1); // deep in the sea every ring sample is below 0
  });
});

describe('shoreRingGrid timing', () => {
  it('bakes 1024^2 over 16 km with a coast', () => {
    const n = 1024, data = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = 60 * Math.sin(i / 60) + 40 * Math.cos(j / 90) - 10 + (i - 512) / 8;
    const t = performance.now();
    shoreRingGrid({ x: 0, y: 0, width: 16000, n, data }, 1024);
    console.log('shoreRingGrid ms', Math.round(performance.now() - t));
  });
});
