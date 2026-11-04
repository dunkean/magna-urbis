import { describe, expect, it } from 'vitest';
import { resolveAppearance, type AppearanceInput } from '../src/render/appearanceRecipe';
import { PASS_ORDER, PASSES, PassState, ResourceCache, passKeys, type PassName } from '../src/v2/passes/pass';

const revisions = { terrain: 1, roads: 2, landuse: 3, settlements: 4, names: 5, cities: { main: 6 } };
const base = { mapStyle: 'parchment' as const };
const keysOf = (a: AppearanceInput, v = revisions, mode: 'gpu' | 'cpu' = 'gpu', layers = {}) =>
  passKeys({ r: resolveAppearance(a, base, { nativeCities: true }, 'view2d'), revisions: v, layers, mode, effective: 'e', forestEffective: 'f', worldSig: 'w' });
/** Passes a PassState would run when moving from appearance `a` to `b`. */
async function reruns(a: AppearanceInput, b: AppearanceInput, v2 = revisions, mode: 'gpu' | 'cpu' = 'gpu'): Promise<PassName[]> {
  const state = new PassState(), runners = Object.fromEntries(PASS_ORDER.map(name => [name, () => undefined])) as Record<PassName, () => void>;
  await state.run(() => keysOf(a), runners);
  return state.run(() => keysOf(b, v2, mode), runners);
}
const v2: AppearanceInput = { style: 'parchment', terrainStyle: 'render-v2', renderer: 'bench' };

describe('render passes', () => {
  it('declares a contract for every pass', () => {
    expect(Object.keys(PASSES).sort()).toEqual([...PASS_ORDER].sort());
    for (const spec of Object.values(PASSES)) expect(spec.inputs.length).toBeGreaterThan(0);
  });
  it('a season or lighting change re-runs only the terrain look', async () => {
    expect(await reruns(v2, { ...v2, season: .9 })).toEqual(['terrainLook']);
    expect(await reruns(v2, { ...v2, lighting: { azimuth: 200 } as never })).toEqual(['terrainLook']);
  });
  it('water colours re-run the look (shared uniform) and the water pass, never the upload, forest or cartography', async () => {
    const map: AppearanceInput = { style: 'parchment', terrainStyle: 'engraving', renderer: 'bench' };
    const ran = await reruns(map, { ...map, colors: { river: '#123456' } });
    expect(ran).toEqual(expect.arrayContaining(['terrainLook', 'water']));
    for (const other of ['terrainData', 'forest', 'cartography', 'overlays']) expect(ran).not.toContain(other);
  });
  it('labels and legend only touch the overlays pass', async () => {
    expect(await reruns(v2, { ...v2, labels: false })).toEqual(['overlays']);
    expect(await reruns(v2, { ...v2, legend: true })).toEqual(['overlays']);
  });
  it('land use, roads and painted rebuild the cartography only', async () => {
    expect(await reruns(v2, { ...v2, landuse: false })).toEqual(['cartography']);
    expect(await reruns(v2, { ...v2, roads: false })).toEqual(['cartography']);
  });
  it('city appearance re-runs the city pass only', async () => {
    expect(await reruns(v2, { ...v2, city: { palette: 'ink' } })).toEqual(['city']);
  });
  it('a new World with the same revisions re-runs nothing; a new terrain re-runs the terrain passes', async () => {
    expect(await reruns(v2, v2, { ...revisions })).toEqual([]);
    const ran = await reruns(v2, v2, { ...revisions, terrain: 9 });
    expect(ran).toEqual(expect.arrayContaining(['terrainData', 'terrainLook', 'forest', 'water', 'cartography']));
  });
  it('the CPU raster is the terrain look pass; the GPU look has no raster inputs', () => {
    expect(keysOf(v2, revisions, 'gpu').terrainLook).not.toBe(keysOf(v2, revisions, 'cpu').terrainLook);
    expect(keysOf(v2, revisions, 'gpu').forest).not.toBe(keysOf(v2, revisions, 'cpu').forest);
  });
  it('a failed pass keeps its key so it runs again', async () => {
    const state = new PassState(), runners = Object.fromEntries(PASS_ORDER.map(name => [name, () => undefined])) as Record<PassName, () => void>;
    let fail = true; runners.water = () => { if (fail) throw new Error('boom'); };
    await expect(state.run(() => keysOf(v2), runners)).rejects.toThrow('boom');
    fail = false;
    expect(await state.run(() => keysOf(v2), runners)).toEqual(['water', 'frame', 'cartography', 'overlays', 'city']);
  });
  it('the resource cache reuses by key and evicts the oldest', () => {
    const cache = new ResourceCache(2); let made = 0;
    expect(cache.get('a', () => ++made)).toBe(1); expect(cache.get('a', () => ++made)).toBe(1);
    cache.get('b', () => ++made); cache.get('c', () => ++made);
    expect(cache.get('a', () => ++made)).toBe(4);
  });
});
