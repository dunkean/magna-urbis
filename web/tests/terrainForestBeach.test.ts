import { beforeAll, describe, it, expect } from 'vitest';
import { buildForestField, DEFAULT_FOREST_SETTINGS } from '../../rust/bridge/terrainForest';
import { shoreRingGrid, type ForestBeachGrid } from '../../rust/bridge/terrainForestBeach';
import './vectorWaterWasm'; // adopts the built single-thread WASM package (beforeAll)

// The beach grid is Rust (magna_urbis_terrain::forest_beach), read here as the `beach` plane of the
// V2 (progressive) forest field, through the WASM package of the web profile: about 8 m texels.
const WEB = { profile: 'web', server: '' } as const;

// West half sea, a low beach strip, then high ground.
function layer(n = 64, width = 8000) {
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + .5) / n;
    data[j * n + i] = x < .3 ? -20 : x < .5 ? 1 + (x - .3) * 20 : 300;
  }
  return { x: -4000, y: -4000, width, n, data };
}
const beachGrid = async (height: ReturnType<typeof layer>, seed: number): Promise<ForestBeachGrid> =>
  (await buildForestField({ seed, climate: [11, 800], height, clearingProfile: 'progressive' }, DEFAULT_FOREST_SETTINGS, WEB)).beach!;

describe('forest beach grid', () => {
  const l = layer();
  let g: ForestBeachGrid, many: ForestBeachGrid[];
  beforeAll(async () => { g = await beachGrid(l, 42); many = await Promise.all([1, 2, 3, 4, 5, 6].map(s => beachGrid(l, s))); });
  it('has the field shape', () => {
    expect(g.n).toBe(1024); expect(g.data.length).toBe(1024 * 1024);
    expect([g.x, g.y, g.width]).toEqual([l.x, l.y, l.width]);
  });
  it('is zero underwater and on high ground, and finds a beach', () => {
    let beach = 0;
    for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) {
      const v = g.data[j * g.n + i], x = (i + .5) / g.n;
      // The former 64-texel test bounds: columns < 18 (sea) and > 40 (high ground).
      if (x < 18 / 64) expect(v).toBe(0);
      if (x > 41 / 64) expect(v).toBe(0);
      if (v > 0 || many.some(m => m.data[j * g.n + i] > 0)) beach++;
    }
    expect(beach).toBeGreaterThan(0);
  });
  it('is deterministic for a seed', async () => {
    expect((await beachGrid(l, 42)).data).toEqual(g.data);
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
