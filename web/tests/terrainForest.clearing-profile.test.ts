import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildForestField, DEFAULT_FOREST_SETTINGS, type ForestFieldInput, type ForestSettings } from '../../rust/bridge/terrainForest';
import './vectorWaterWasm'; // adopts the built single-thread WASM package (beforeAll)

// The field is Rust (magna_urbis_terrain::forest), here through the WASM package of the web profile.
const WEB = { profile: 'web', server: '' } as const;
const build = (input: ForestFieldInput, settings: ForestSettings = DEFAULT_FOREST_SETTINGS) => buildForestField(input, settings, WEB);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('V2 clearing profile stays separate from Render3D', () => {
  const input: ForestFieldInput = { seed: 42, climate: [11, 1300], height: { x: 0, y: 0, width: 4000, n: 32, data: new Float32Array(32 * 32).fill(100) } };
  const stats = (rgba: Uint8Array) => {
    let cover = 0,
      empty = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      cover += rgba[i] / 255;
      if (rgba[i] < 3) empty++;
    }
    return { cover: cover / (rgba.length / 4), empty: empty / (rgba.length / 4) };
  };

  it('retains more wet natural canopy while preserving historical cover and all other profile channels', async () => {
    const legacy = await build(input),
      progressive = await build({ ...input, clearingProfile: 'progressive' });
    // The treeline climate update changed G/B. Render3D's cover channel still matches the original field.
    expect(digest(legacy.rgba.filter((_, i) => i % 4 === 0))).toBe('d926754b60e2501a7e5850d83844266fac2d0b4014e12a6f8193aff36008c651');
    expect(digest(legacy.rgba)).toBe('9e3f356047baf64ca8ba90724d93acbf36b992df2e17475bd8238f20698548a6');
    expect(progressive.key).not.toBe(legacy.key);
    expect(stats(progressive.rgba).cover).toBeGreaterThan(stats(legacy.rgba).cover);
    expect(stats(progressive.rgba).empty).toBeLessThan(stats(legacy.rgba).empty);
    let changedOther = 0;
    for (let i = 0; i < legacy.rgba.length; i++) if (i % 4 && progressive.rgba[i] !== legacy.rgba[i]) changedOther++;
    expect(changedOther).toBe(0);
    expect(digest((await build(input)).rgba)).toBe(digest(legacy.rgba));
    expect(digest((await build({ ...input, clearingProfile: 'progressive' })).rgba)).toBe(digest(progressive.rgba));
  });

  it('preserves historical zero-clearing cover and sea exclusions with the separate optical base', async () => {
    const settings = { ...DEFAULT_FOREST_SETTINGS, clearings: 0 };
    const optical = await build({ ...input, clearingProfile: 'progressive' }, settings);
    const legacy = (await build(input, settings)).rgba;
    expect(digest(legacy.filter((_, i) => i % 4 === 0))).toBe('f760833fdfb486ca19d49b91d2c49b59542f36f4e26fa965a3e516e857282873');
    expect(digest(legacy)).toBe('93eb02bb5ff1ad348c6bbb916e52879ad7c6b9498269fb37cc8dafad7cc2bbfd');
    expect(digest((await build({ ...input, clearingProfile: 'progressive' }, settings)).rgba)).toBe(digest(optical.rgba));
    const sea = await build({ ...input, height: { ...input.height, data: new Float32Array(32 * 32).fill(-10) }, clearingProfile: 'progressive' });
    expect(stats(sea.rgba).cover).toBe(0);
  });

  it('never turns a disturbance into an empty eligible stand, including at maximum clearing control', async () => {
    const local: ForestFieldInput = { ...input, climate: [11, 450], clearingProfile: 'progressive' };
    const settings = { ...DEFAULT_FOREST_SETTINGS, clearings: 1 };
    const potential = await build(local, { ...settings, clearings: 0 }),
      thinned = await build(local, settings);
    let belowBound = 0,
      atCap = 0;
    for (let i = 0; i < potential.rgba.length; i += 4) {
      if (thinned.rgba[i] + 1 < 0.45 * potential.rgba[i]) belowBound++;
      if (potential.rgba[i] > 50 && thinned.rgba[i] <= 0.46 * potential.rgba[i]) atCap++;
    }
    expect(belowBound).toBe(0);
    expect(atCap).toBeGreaterThan(0);
  });
});
