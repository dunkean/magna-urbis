import { describe, expect, it } from 'vitest';
import { resolveAppearance, resolvedValues, applyAppearancePatch, type AppearanceInput, type RenderTarget } from '../src/render/appearanceRecipe';
import { presetComposition } from '../src/render/composition';
import { renderScene } from '../src/v2/renderScene';
import type { World } from '../src/gen/types';

const base = { mapStyle: 'parchment' as const };
const resolve = (a: AppearanceInput | undefined, nativeCities = false, target: RenderTarget = 'view2d') => resolveAppearance(a, base, { nativeCities }, target);

describe('appearance recipe', () => {
  it('decides the render path with one rule', () => {
    expect(resolve(undefined).path).toBe('classic');
    expect(resolve({ style: 'parchment', terrainStyle: 'engraving' }).path).toBe('composite');
    expect(resolve({ style: 'engraving' }).path).toBe('classic');
    expect(resolve({ style: 'parchment', terrainStyle: 'render-v2' }).path).toBe('composite');
    expect(resolve({ style: 'parchment', diagnostic: 'elevation' }).path).toBe('composite');
    expect(resolve({ style: 'parchment' }, true).path).toBe('composite');
    expect(resolve({ style: 'parchment', terrainStyle: 'render-v2', renderer: 'classic' }, true).path).toBe('classic');
    expect(resolve({ style: 'parchment', renderer: 'bench' }).path).toBe('composite');
    expect(resolveAppearance({ style: 'parchment' }, base, { nativeCities: false }, 'view2d', { preview: true })).toMatchObject({ path: 'composite', diagnostic: 'elevation', cartography: { labels: false } });
  });
  it('shares the city defaults between 2D, 3D and export when unifiedDefaults is on', () => {
    for (const base of [{ style: 'parchment' as const }, { style: 'parchment' as const, terrainStyle: 'render-v2' as const }]) {
      const a = { ...base, unifiedDefaults: true }, city = resolve(a).city;
      expect(city).toMatchObject({ view: 'buildings', palette: 'parchment', buildingStyle: 'cartographic', opacity: .8 });
      // 2D relief styles paint their houses (shadows, bevels); the 3D view draws volumes instead.
      expect({ ...resolve(a, false, 'view3d').city, painted: city.painted }).toEqual(city);
      expect(resolve(a, false, 'export').city).toEqual(city);
    }
    expect(resolvedValues(resolve(undefined, false, 'view3d')).city?.painted).toBe(false);
  });
  it('keeps the previous 3D and classic defaults while unifiedDefaults is off', () => {
    expect(resolve(undefined, false, 'view3d').city).toMatchObject({ view: 'parcels', palette: 'terrain', opacity: 1 });
    expect(resolve(undefined).vegetation.symbols).toBe('classic');
    expect(resolve(undefined, false, 'export').vegetation.symbols).toBe('canopy');
  });
  it('keeps cadastre flat in 3D while topographic retains its perspective architecture', () => {
    for (const preset of ['cadastre', 'topographic'] as const) {
      const composition = presetComposition(preset), input: AppearanceInput = { style: 'parchment', composition };
      for (const target of ['view2d', 'export'] as const) {
        expect(resolve(input, true, target).city.buildingStyle).toBe('silhouette');
        expect(resolve(input, true, target).composition.buildings.meshes).toBe('none');
      }
      const perspective = resolve(input, true, 'view3d');
      expect(perspective.city.buildingStyle).toBe(preset === 'cadastre' ? 'silhouette' : 'cartographic');
      expect(perspective.composition.buildings).toMatchObject(preset === 'cadastre'
        ? { visible: true, look: 'footprints', meshes: 'none' }
        : { visible: true, look: 'detailed-volumes', meshes: 'detailed' });
      composition.buildings.visible = false;
      expect(resolve(input, true, 'view3d').composition.buildings.visible).toBe(false);
    }
  });
  it('keys each pass on the fields it reads only', () => {
    const a: AppearanceInput = { style: 'parchment', terrainStyle: 'render-v2' }, before = resolve(a).keys;
    const composition = presetComposition('satellite'), seasonal = presetComposition('satellite'); seasonal.effects.season = .9;
    const base = resolve({ ...a, composition }).keys, season = resolve({ ...a, composition: seasonal }).keys;
    expect(season.terrainLook).not.toBe(base.terrainLook);
    for (const pass of ['terrainBase', 'water', 'forest', 'cartography', 'city'] as const) expect(season[pass]).toBe(base[pass]);
    const recolored = resolve({ ...a, colors: { river: '#112233', waterShore: '#445566' } }).keys;
    expect(recolored.water).toBe(before.water);
    const map = resolve({ style: 'atlas' }).keys;
    expect(resolve({ style: 'atlas', colors: { river: '#112233' } }).keys.water).not.toBe(map.water);
    expect(resolve({ ...a, city: { opacity: .3 } }).keys.city).not.toBe(before.city);
    expect(resolve({ ...a, city: { opacity: .3 } }).keys.cartography).toBe(before.cartography);
  });
  it('explains what a target cannot show and merges view patches', () => {
    const fantasy = resolveAppearance({ style: 'parchment', terrainStyle: 'fantasy-ink', painted: true }, base, { nativeCities: false }, 'view3d');
    expect(fantasy.incompatibilities.map(item => item.field)).not.toContain('terrainStyle');
    expect(resolve({ style: 'parchment', terrainStyle: 'render-v2', colors: { river: '#112233' } }).incompatibilities.map(item => item.field)).toContain('colors.river');
    const original: AppearanceInput = { style: 'parchment', city: { opacity: .4 } };
    const next = applyAppearancePatch(original, 'parchment', { terrainStyle: 'render-v2', renderer: 'bench', city: { plan: false } });
    expect(next).toMatchObject({ terrainStyle: 'render-v2', renderer: 'bench', city: { opacity: .4, plan: false } });
    expect(original).toEqual({ style: 'parchment', city: { opacity: .4 } });
  });
});

describe('render scene', () => {
  const native = { width: 1000, resolution: 4 } as never, city = { layouts: [{}], stage: 'layout' } as never;
  const make = (): World => ({ seed: 's', options: {}, mapSize: 1000, stats: {}, terrain: { height: { cell: 25 }, v2NativeTerrain: native }, roads: [], debug: { v2RustCities: { a: city } } } as unknown as World);
  it('keeps products by reference with stable revisions across a shallow copy', () => {
    const world = make(), copy = { ...world };
    const a = renderScene(world), b = renderScene(copy);
    expect(renderScene(world)).toBe(a);
    expect(b).not.toBe(a);
    expect(b.nativeTerrain).toBe(native); expect(b.cities[0]).toBe(city);
    expect(b.revisions).toEqual(a.revisions);
    expect(a.revisions.terrain).toBeGreaterThan(0); expect(a.revisions.cities.a).toBeGreaterThan(0);
    expect(a.capabilities).toMatchObject({ nativeTerrain: true, nativeCities: true, vectorWater: false });
    const bare = renderScene({ ...world, terrain: { height: { cell: 25 } }, debug: undefined } as unknown as World);
    expect(bare.nativeTerrain).toBeUndefined(); expect(bare.cities).toHaveLength(0); expect(bare.capabilities.nativeCities).toBe(false);
    expect(bare.revisions.terrain).not.toBe(a.revisions.terrain);
  });
});
