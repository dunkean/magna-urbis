import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildForestField, DEFAULT_FOREST_SETTINGS, type ForestFieldInput, type ForestSettings } from '../../rust/bridge/terrainForest';
import './vectorWaterWasm'; // adopts the built single-thread WASM package (beforeAll)

// The field is Rust (magna_urbis_terrain::forest), here through the WASM package of the web profile.
const WEB = { profile: 'web', server: '' } as const;
const build = (input: ForestFieldInput, settings: ForestSettings = DEFAULT_FOREST_SETTINGS) => buildForestField(input, settings, WEB);

describe('V2 clearing profile stays separate from Render3D', () => {
  const input: ForestFieldInput = { seed: 42, climate: [11, 1300], height: { x: 0, y: 0, width: 4000, n: 32, data: new Float32Array(32 * 32).fill(100) } };
  const stats = (rgba: Uint8Array) => {
    let cover = 0, empty = 0;
    for (let i = 0; i < rgba.length; i += 4) { cover += rgba[i] / 255; if (rgba[i] < 3) empty++; }
    return { cover: cover / (rgba.length / 4), empty: empty / (rgba.length / 4) };
  };

  it('retains more wet natural canopy without changing legacy bytes or other channels', async () => {
    const legacy = await build(input), progressive = await build({ ...input, clearingProfile: 'progressive' });
    expect(createHash('sha256').update(legacy.rgba).digest('hex')).toBe('b6ea6f0b94281fa91d961fc32cd12e41171d3e0d988e6b9386b82c027b154dbc');
    expect(progressive.key).not.toBe(legacy.key);
    expect(stats(progressive.rgba).cover).toBeGreaterThan(stats(legacy.rgba).cover);
    expect(stats(progressive.rgba).empty).toBeLessThan(stats(legacy.rgba).empty);
    let changedOther = 0;
    for (let i = 0; i < legacy.rgba.length; i++) if (i % 4 && progressive.rgba[i] !== legacy.rgba[i]) changedOther++;
    expect(changedOther).toBe(0);
    expect((await build(input)).rgba).toEqual(legacy.rgba);
    expect((await build({ ...input, clearingProfile: 'progressive' })).rgba).toEqual(progressive.rgba);
  });

  it('preserves historical zero-clearing bytes and sea exclusions with the separate optical base', async () => {
    const settings = { ...DEFAULT_FOREST_SETTINGS, clearings: 0 };
    const optical = await build({ ...input, clearingProfile: 'progressive' }, settings);
    expect(createHash('sha256').update((await build(input, settings)).rgba).digest('hex')).toBe('86250c13749d87b6bb473e9741de51820a8a45ae3a4101fc44f3a6811f5e6ce5');
    expect((await build({ ...input, clearingProfile: 'progressive' }, settings)).rgba).toEqual(optical.rgba);
    const sea = await build({ ...input, height: { ...input.height, data: new Float32Array(32 * 32).fill(-10) }, clearingProfile: 'progressive' });
    expect(stats(sea.rgba).cover).toBe(0);
  });

  it('never turns a disturbance into an empty eligible stand, including at maximum clearing control', async () => {
    const local: ForestFieldInput = { ...input, climate: [11, 450], clearingProfile: 'progressive' };
    const settings = { ...DEFAULT_FOREST_SETTINGS, clearings: 1 };
    const potential = await build(local, { ...settings, clearings: 0 }), thinned = await build(local, settings);
    let belowBound = 0, atCap = 0;
    for (let i = 0; i < potential.rgba.length; i += 4) {
      if (thinned.rgba[i] + 1 < .45 * potential.rgba[i]) belowBound++;
      if (potential.rgba[i] > 50 && thinned.rgba[i] <= .46 * potential.rgba[i]) atCap++;
    }
    expect(belowBound).toBe(0);
    expect(atCap).toBeGreaterThan(0);
  });
});
