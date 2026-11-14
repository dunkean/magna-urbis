import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildForestField } from '../../rust/bridge/terrainForest';
import { v2DisplayForestAsync } from '../src/v2/displayForest';
import { defaultSettings } from '../src/v2/settings';
import { resolveSettingsAppearance } from '../src/v2/appearance';
import { presetComposition } from '../src/render/composition';
import type { World } from '../src/gen/types';

vi.mock('../../rust/bridge/terrainForest', async importOriginal => ({
  ...await importOriginal<typeof import('../../rust/bridge/terrainForest')>(),
  buildForestField: vi.fn(async () => ({ x: 0, y: 0, width: 100, n: 2, rgba: new Uint8Array(16), key: 'display-forest' })),
}));
const world = () => ({ seed: 'forest-import', mapSize: 100, roads: [], settlements: [],
  terrain: { height: { w: 2, h: 2, cell: 50, data: new Float32Array([3, 6, 9, 12]) }, water: new Uint8Array(4), rivers: [], lakes: [] } }) as unknown as World;
const settings = () => ({ ...defaultSettings(), appearance: { style: 'parchment' as const, composition: presetComposition('satellite') } });
beforeEach(() => vi.mocked(buildForestField).mockClear());

describe('forests of imported retained terrain', () => {
  it('rebuilds a missing display forest once and shares the cached result without modifying heights', async () => {
    const w = world(), s = settings(), heights = w.terrain.height.data.slice(), r = resolveSettingsAppearance(s, w, 'view3d');
    const [a, b] = await Promise.all([v2DisplayForestAsync(w, s, r), v2DisplayForestAsync(w, s, r)]);
    expect(a).toBe(b); expect(a).toBeDefined();
    expect(await v2DisplayForestAsync(w, s, r)).toBe(a);
    expect(buildForestField).toHaveBeenCalledOnce();
    expect(w.terrain.height.data).toEqual(heights);
  });
  it('reuses an existing retained forest without starting a new display job', async () => {
    const w = world(), s = settings(), retained = { x: 0, y: 0, width: 100, n: 2, rgba: new Uint8Array(16), key: 'retained' };
    Object.assign(w.terrain, { v2ForestField: retained });
    expect(await v2DisplayForestAsync(w, s, resolveSettingsAppearance(s, w, 'view3d'))).toBe(retained);
    expect(buildForestField).not.toHaveBeenCalled();
  });
  it('starts no forest work when the style has no procedural vegetation', async () => {
    const w = world(), s = settings(); s.appearance.composition = presetComposition('cadastre');
    expect(await v2DisplayForestAsync(w, s, resolveSettingsAppearance(s, w, 'view3d'))).toBeUndefined();
    expect(buildForestField).not.toHaveBeenCalled();
  });
});
