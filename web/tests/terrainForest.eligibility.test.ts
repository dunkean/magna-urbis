import { describe, expect, it } from 'vitest';
import { buildForestField, DEFAULT_FOREST_SETTINGS, type ForestField } from '../../rust/bridge/terrainForest';
import './vectorWaterWasm'; // adopts the built single-thread WASM package (beforeAll)

// The field is Rust (magna_urbis_terrain::forest), here through the WASM package of the web profile.
const WEB = { profile: 'web', server: '' } as const;

// Render's rock/treeline eligibility reaches the canonical field: cover and
// potential height (which gates the woods prior and open-land trees).
describe('forest field follows Render tree eligibility', () => {
  const n = 64,
    width = 4000,
    settings = { ...DEFAULT_FOREST_SETTINGS, clearings: 0 };
  const build = (profile: (x: number) => number) => {
    const data = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = profile(((i + 0.5) * width) / n);
    return buildForestField({ seed: 428019, climate: [18, 1000], height: { x: 0, y: 0, width, n, data } }, settings, WEB);
  };
  const band = (field: ForestField, x0: number, x1: number) => {
    let cover = 0,
      height = 0,
      count = 0;
    for (let j = 8; j < field.n - 8; j++)
      for (let i = 0; i < field.n; i++) {
        const x = ((i + 0.5) * width) / field.n;
        if (x < x0 || x > x1) continue;
        const o = (j * field.n + i) * 4;
        cover = Math.max(cover, field.rgba[o]);
        height = Math.max(height, field.rgba[o + 1]);
        count++;
      }
    expect(count).toBeGreaterThan(0);
    return { cover: cover / 255, height: (height / 255) * 50 };
  };
  const ramp = (grade: number) => (x: number) => 300 + grade * Math.min(Math.max(x - 1500, 0), 1000);

  it('clears rock-steep slopes the old slope-only gate kept wooded', async () => {
    // Grade 1 (45°): Render shows outcrop; the former gate kept 58 % of cover.
    const field = await build(ramp(1)),
      slope = band(field, 1750, 2250);
    expect(slope.cover).toBeLessThan(0.02);
    expect(slope.height).toBeLessThan(1);
    expect(band(field, 200, 1200).cover).toBeGreaterThan(0.3);
    expect(Array.from(field.rgba)).toEqual(Array.from((await build(ramp(1))).rgba));
  });

  it('keeps moderate forested slopes', async () => {
    const slope = band(await build(ramp(0.4)), 1750, 2250);
    expect(slope.cover).toBeGreaterThan(0.3);
    expect(slope.height).toBeGreaterThan(8);
  });

  it('leaves no potential height above the treeline for planted woods', async () => {
    // 4.5 km in the temperate preset, far above the tree line of any massif.
    const high = band(await build(() => 4500), 0, width);
    expect(high.cover).toBe(0);
    expect(high.height).toBe(0);
  });

  it('carries alpine forest to a ragged line near 2,000 m, open in its upper belt', async () => {
    const alpine = async (z: number) => {
      const data = new Float32Array(n * n).fill(z);
      const field = await buildForestField({ seed: 428019, climate: [9, 1500], height: { x: 0, y: 0, width, n, data } }, settings, WEB);
      let sum = 0;
      for (let o = 0; o < field.rgba.length; o += 4) sum += field.rgba[o] / 255;
      return sum / (field.rgba.length / 4);
    };
    const [closed, belt, above] = [await alpine(1300), await alpine(1800), await alpine(2600)];
    expect(closed).toBeGreaterThan(0.35);
    expect(belt).toBeGreaterThan(0.03);
    expect(belt).toBeLessThan(closed * 0.8);
    expect(above).toBeLessThan(0.02);
  });
});
