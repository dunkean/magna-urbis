import { describe, expect, it } from 'vitest';
import { combineV2NativeScenes, sameV2NativeInputs, v2NativeCities, v2WorldDecor, v2Terrain3dSurface, v2Terrain3dGround, v2Terrain3dView, createV2Terrain3dSampler } from '../src/v2/urban3d';
import { makeOptions } from '../src/gen/options';
import type { World } from '../src/gen/types';
import type { RustTownSnapshot } from '../src/v2/rustUrban';
import type { V2Settings } from '../src/v2/contracts';

function town(id: string, stage: RustTownSnapshot['stage'] = 'buildings'): RustTownSnapshot {
  return { backend: 'rust-wasm-cpu', stage, layoutKey: id, layouts: [{ key: id } as RustTownSnapshot['layouts'][number]], buildingIds: [], warnings: [],
    scene: { schema_version: '1', generator_version: 'architectural-plans-2', buildings: [{ id } as NonNullable<RustTownSnapshot['scene']>['buildings'][number]], refusals: [], open_spaces: [], plan_archives: { [id]: `retained-exact-${id}` } } };
}
describe('V2 City Bench 3D retained-scene boundary', () => {
  it('combines only completed building stages and preserves actual retained records and archives', () => {
    const a = town('a'), b = town('b'), upstream = town('hidden', 'layout');
    const scene = combineV2NativeScenes([a, upstream, b])!;
    expect(scene.buildings.map(building => building.id)).toEqual(['a', 'b']);
    expect(scene.buildings[0]).toBe(a.scene!.buildings[0]);
    expect(scene.plan_archives).toEqual({ a: 'retained-exact-a', b: 'retained-exact-b' });
    expect(combineV2NativeScenes([upstream])).toBeUndefined();
  });
  it('refuses mixed generator identities or colliding plan archives instead of synthesising a compatible scene', () => {
    const a = town('a'), b = town('b'); b.scene!.generator_version = 'unknown-future-architecture';
    expect(() => combineV2NativeScenes([a, b])).toThrow(/versions differ/);
    b.scene!.generator_version = a.scene!.generator_version; b.scene!.plan_archives = { a: 'different-bytes' };
    expect(() => combineV2NativeScenes([a, b])).toThrow(/identity collision/);
  });
  it('keeps a complete single native scene and geometry indexes across progress-only snapshot headers', () => {
    const original = town('a'); original.scene!.materials = [];
    expect(combineV2NativeScenes([original])).toBe(original.scene);
    const header = { ...original, warnings: ['updated report'], lastBuildingRequests: 0 };
    expect(sameV2NativeInputs([original], [header], 'scene')).toBe(true);
    expect(sameV2NativeInputs([original], [header], 'layouts')).toBe(true);
    expect(sameV2NativeInputs([original], [{ ...header, stage: 'layout' }], 'scene')).toBe(false);
    expect(sameV2NativeInputs([original], [{ ...header, scene: { ...original.scene! } }], 'scene')).toBe(false);
  });
  it('reuses physical raster samples while retaining real water levels and custom climate', () => {
    const options = makeOptions({ seed: 'retained3d', biome: 'temperate' });
    const height = new Float32Array([5, 7, 9, 11]), water = new Uint8Array([1, 0, 0, 0]);
    const world = { seed: options.seed, options, mapSize: 100,
      terrain: { height: { w: 2, h: 2, cell: 50, data: height }, water, filled: new Float32Array([6, 7, 9, 11]), seaLevel: 6, coastline: [], lakes: [], rivers: [] },
      debug: { v2RustCities: { main: town('a') } } } as unknown as World;
    const settings: V2Settings = { options, extent: 100, settlementCount: 1, local: {}, generation: 'procedural', terrain: { climate: 'arid', climateValues: { temperature: 33 } } };
    const first = v2WorldDecor(world, settings), next = v2WorldDecor(world, settings);
    expect(first.raster).toBe(next.raster); expect(first.raster.height).toBe(height);
    expect(first.raster.water).toBe(water); expect(first.raster.waterLevel[0]).toBe(6);
    expect(new URLSearchParams(first.meta.query).get('temperature')).toBe('33');
    expect(first.meta.stats).toMatchObject({ minHeight: 5, maxHeight: 11, land: .75 });
    expect(v2NativeCities(world)).toHaveLength(1);
  });
  it('shows a terrain-only region from its native control grid and keeps lake levels separate from the bed', () => {
    const options = makeOptions({ seed: 'region-only' }), height = new Float32Array([10, 20, 30, 40]), field = new Float32Array(16).fill(25);
    const world = { seed: options.seed, options, mapSize: 100, terrain: { height: { w: 2, h: 2, cell: 50, data: height },
      water: new Uint8Array([0, 2, 0, 0]), filled: new Float32Array([10, 27, 30, 40]), seaLevel: 0, coastline: [], lakes: [], rivers: [],
      v2NativeTerrain: { width: 100, resolution: 2, field: { n: 4, data: field, exact: true, floor: .3 }, motifSize: 10000, globalMinHeight: 10, globalMaxHeight: 40 } } } as unknown as World;
    const settings: V2Settings = { options, extent: 100, settlementCount: 0, local: {}, generation: 'procedural', appearance: { style: 'parchment', terrainStyle: 'render-v2', city: { refinement: 'source' } } };
    const surface = v2Terrain3dSurface(world, settings);
    expect(surface.height.data).toBe(field); expect(surface.height.n).toBe(4);
    expect(surface.water!.mask).toEqual(new Float32Array([-1, 1, -1, -1])); expect(surface.water!.levels[1]).toBe(27);
    expect(v2WorldDecor(world, settings).meta.terrainDisplay).toMatchObject({ sourceCell: 25, motifSize: 10000, refine: true, floor: .3 });
    const sample = createV2Terrain3dSampler(world, settings, 'render-v2'); expect(sample(50, 50)).toBeCloseTo(25);
    expect(height).toEqual(new Float32Array([10, 20, 30, 40])); expect(field.every(value => value === 25)).toBe(true);
    settings.appearance!.lakes = false; expect(v2Terrain3dSurface(world, settings).water).toBeUndefined();
  });
  it('restores satellite diagnostics, season, lighting and source/noise preferences without requiring cities', () => {
    const options = makeOptions({ seed: 'materials' });
    const world = { seed: options.seed, options, mapSize: 1000, terrain: { height: { cell: 25 } } } as unknown as World;
    const settings: V2Settings = { options, extent: 1000, settlementCount: 0, local: {}, generation: 'procedural', terrain: { climate: 'arid' }, appearance: {
      style: 'parchment', terrainStyle: 'render-v2-snow', season: .125, lighting: { enabled: true, azimuth: 90, elevation: 15, strength: 2, exaggeration: 1 }, terrainLayers: { relief: true, hypsometry: true, frame: false, water: false }, city: { refinement: 'source' } } };
    expect(v2Terrain3dView(settings).ground).toBe('render-v2-snow');
    expect(v2Terrain3dGround(world, settings, 'render-v2-snow')).toMatchObject({ renderV2: 5, v2Season: .125, lighting: settings.appearance!.lighting, waterVisible: false, displacement: false, climate: { temperature: 23, precipitation: 150 } });
    expect(v2Terrain3dGround(world, settings, 'render3d-brush')?.forestBrushes).toBe(true);
    settings.appearance!.city = { ground: 'map', refinement: 'noise' };
    expect(v2Terrain3dView(settings).ground).toBe('map'); expect(v2Terrain3dGround(world, settings, 'map')).toBeUndefined();
  });
});
