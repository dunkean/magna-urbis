import { describe, expect, it } from 'vitest';
import { buildForestField, DEFAULT_FOREST_SETTINGS, type ForestField } from '../../rust/bridge/terrainForest';
import './vectorWaterWasm'; // adopts the built single-thread WASM package (beforeAll)

// The field is Rust (magna_urbis_terrain::forest), here through the WASM package of the web profile.
const WEB = { profile: 'web', server: '' } as const;

// Render's rock/treeline eligibility reaches the canonical field: cover and
// potential height (which gates the woods prior and open-land trees).
describe('forest field follows Render tree eligibility', () => {
  const n = 64, width = 4000, settings = { ...DEFAULT_FOREST_SETTINGS, clearings: 0 };
  const build = (profile: (x: number) => number) => {
    const data = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = profile((i + .5) * width / n);
    return buildForestField({ seed: 428019, climate: [18, 1000], height: { x: 0, y: 0, width, n, data } }, settings, WEB);
  };
  const band = (field: ForestField, x0: number, x1: number) => {
    let cover = 0, height = 0, count = 0;
    for (let j = 8; j < field.n - 8; j++) for (let i = 0; i < field.n; i++) {
      const x = (i + .5) * width / field.n;
      if (x < x0 || x > x1) continue;
      const o = (j * field.n + i) * 4;
      cover = Math.max(cover, field.rgba[o]); height = Math.max(height, field.rgba[o + 1]); count++;
    }
    expect(count).toBeGreaterThan(0);
    return { cover: cover / 255, height: height / 255 * 50 };
  };
  const ramp = (grade: number) => (x: number) => 300 + grade * Math.min(Math.max(x - 1500, 0), 1000);

  it('clears rock-steep slopes the old slope-only gate kept wooded', async () => {
    // Grade 1 (45°): Render shows outcrop; the former gate kept 58 % of cover.
    const field = await build(ramp(1)), slope = band(field, 1750, 2250);
    expect(slope.cover).toBeLessThan(.02);
    expect(slope.height).toBeLessThan(1);
    expect(band(field, 200, 1200).cover).toBeGreaterThan(.3);
    expect(Array.from(field.rgba)).toEqual(Array.from((await build(ramp(1))).rgba));
  });

  it('keeps moderate forested slopes', async () => {
    const slope = band(await build(ramp(.4)), 1750, 2250);
    expect(slope.cover).toBeGreaterThan(.3);
    expect(slope.height).toBeGreaterThan(8);
  });

  it('leaves no potential height above the treeline for planted woods', async () => {
    // 3.5 km in the temperate preset: summer ≈ 1 °C, far above Render's tree limit.
    const high = band(await build(() => 3500), 0, width);
    expect(high.cover).toBe(0);
    expect(high.height).toBe(0);
  });
});
