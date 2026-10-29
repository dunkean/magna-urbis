import { beforeAll, describe, expect, it } from 'vitest';
import { composeTerrain, composeUrbanRecipe } from '../src/v2/compose';
import { defaultSettings } from '../src/v2/settings';
import { generateTerrain, planRegion, generateTown, terrainCacheKey } from '../src/v2/engine';
import { TerrainCache, V2_ENGINE_VERSION, type TerrainStore } from '../src/v2/cache';
import { generateNaturalCover } from '../src/gen/landuse/natural';
import { Rng } from '../src/gen/core/rng';
import { parseProject, serializeProject } from '../src/v2/project';
import type { V2Project, V2Settings } from '../src/v2/contracts';
import type { TerrainLayer, World } from '../src/gen/types';

class MemoryStore implements TerrainStore {
  readonly entries = new Map<string, TerrainLayer>();
  async get(key: string) { const result = this.entries.get(key); return result ? structuredClone(result) : undefined; }
  async put(key: string, terrain: TerrainLayer) { this.entries.set(key, structuredClone(terrain)); }
  async clear() { this.entries.clear(); }
}
function recipe(seed: string): V2Settings {
  const settings = defaultSettings();
  settings.runtime = { backend: 'typescript', compute: 'cpu', source: 'procedural' };
  settings.extent = 1200;
  settings.settlementCount = 1;
  settings.options = { ...settings.options, seed, size: 'hamlet', population: 80, biome: 'forest', coast: 'S', river: 'none', relief: 'flat',
    walls: 'none', castle: 'no', importedHeight: { w: 8, h: 8, rgba: new Uint8Array(0),
      elevations: Float32Array.from({ length: 64 }, (_, i) => Math.floor(i / 8) > 5 ? -8 : 25 + (i % 8) * .1) } };
  return settings;
}
function expectExactArray(actual: ArrayBufferView, expected: ArrayBufferView) {
  const a = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
  const b = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
  expect(a.length).toBe(b.length);
  expect(a.every((value, index) => value === b[index])).toBe(true);
}
function expectPhysicalEquality(actual: TerrainLayer, expected: TerrainLayer) {
  expectExactArray(actual.height.data, expected.height.data);
  expectExactArray(actual.slope.data, expected.slope.data);
  expectExactArray(actual.flow.data, expected.flow.data);
  expectExactArray(actual.water, expected.water);
  expectExactArray(actual.receiver, expected.receiver);
  expectExactArray(actual.filled, expected.filled);
  expect(actual.coastline).toEqual(expected.coastline);
  expect(actual.islands).toEqual(expected.islands);
  // Regional naming may change to match the imported city culture; physical reaches do not.
  const physicalRivers = (terrain: TerrainLayer) => terrain.rivers.map(({ name: _name, ...river }) => river);
  expect(physicalRivers(actual)).toEqual(physicalRivers(expected));
  expect(actual.lakes).toEqual(expected.lakes);
}
function expectTerrainOnly(world: World) {
  for (const field of ['site', 'roads', 'bridges', 'settlements', 'urban', 'megaDetail', 'names', 'debug'] as const) expect(world[field]).toBeUndefined();
  expect(world.stats['v2.stage']).toBe('terrain');
  expect(world.stats['v2.planKey']).toBeUndefined();
  expect(world.landuse!.farmsteads).toHaveLength(0);
}

describe('V2 project composition', () => {
  let source: V2Project;
  beforeAll(async () => {
    const settings = recipe('compose-source');
    const terrain = await generateTerrain(settings, undefined, new TerrainCache(new MemoryStore()));
    const region = await planRegion(terrain, settings);
    const world = await generateTown(region, settings, 'main');
    source = { format: 'magna-urbis-v2', version: 1, engine: V2_ENGINE_VERSION, settings, world,
      mods: [{ type: 'building', settlement: 'main', index: 0, signature: 'source-building', patch: { storeys: 3 } }] };
  });

  it('imports the exact territory, keeps the current city recipe, and removes source city geometry', async () => {
    const current = recipe('different-city-world');
    current.options.culture = 'medina'; current.options.population = 400; current.options.biome = 'desert';
    current.local.main = { sprawl: 1.4, castle: 'yes' };
    current.urban = { backend: 'rust', layout: { density: .8 }, local: { main: { houses: { floors: 2 } } } };
    const original = structuredClone(source.world!), cache = new TerrainCache(new MemoryStore());
    const result = await composeTerrain(source, current, cache);
    expectPhysicalEquality(result.world!.terrain, original.terrain);
    expect(result.world!.terrain.rivers).toEqual(original.terrain.rivers);
    expectTerrainOnly(result.world!);
    expect(result.settings.options.seed).toBe(source.world!.seed);
    expect(result.settings.options.biome).toBe('forest');
    expect(result.settings.options.culture).toBe('medina');
    expect(result.settings.options.population).toBe(400);
    expect(result.settings.local).toEqual(current.local);
    expect(result.settings.urban).toEqual(current.urban);
    expect(result.settings.extent).toBe(source.world!.mapSize);
    expect(result.mods).toHaveLength(0);
    expect(result.world!.landuse).toEqual(generateNaturalCover(original.terrain, 'forest', new Rng('magna-urbis:' + original.seed)));
    expect(result.world!.stats['v2.urbanBackend']).toBeUndefined();
    const planned = await planRegion(result.world!, result.settings);
    expect(planned.settlements).toHaveLength(1);
    expectPhysicalEquality(planned.terrain, result.world!.terrain);
    result.world!.terrain.height.data[0] = 999;
    expectPhysicalEquality(source.world!.terrain, original.terrain);
    expect(current.options.seed).toBe('different-city-world');
  });

  it('seeds persistent terrain storage so a fresh engine cache restores imported physical arrays', async () => {
    const store = new MemoryStore();
    const result = await composeTerrain(source, recipe('current'), new TerrainCache(store));
    expect(result.world!.stats['v2.persisted']).toBe(1);
    expect(result.world!.stats['v2.terrainKey']).toBe(terrainCacheKey(result.settings));
    const restored = await generateTerrain(result.settings, undefined, new TerrainCache(store));
    expect(restored.stats['v2.cache']).toBe('disk');
    expectPhysicalEquality(restored.terrain, source.world!.terrain);
    const roundTrip = parseProject(serializeProject(result.settings, result.world, result.mods));
    expectPhysicalEquality(roundTrip.world!.terrain, result.world!.terrain);
  });

  it('uses the displayed snapshot when source draft parameters no longer describe that territory', async () => {
    const changed = structuredClone(source);
    changed.settings.options.seed = 'unbuilt-next-draft';
    changed.settings.options.relief = 'mountains';
    changed.settings.options.biome = 'desert';
    changed.settings.generation = 'neural';
    changed.settings.runtime = { backend: 'rust', compute: 'gpu', source: 'neural-wasm' };
    const result = await composeTerrain(changed, recipe('current'), new TerrainCache(new MemoryStore()));
    expect(result.world!.stats['v2.snapshotInput']).toBe(1);
    expect(result.settings.options.seed).toBe(source.world!.seed);
    expect(result.settings.options.biome).toBe(source.world!.options.biome);
    expectExactArray(result.settings.options.importedHeight!.elevations!, source.world!.terrain.height.data);
    expect(result.settings.runtime).toEqual(changed.settings.runtime);
    expectPhysicalEquality(result.world!.terrain, source.world!.terrain);
    expect(changed.settings.options.seed).toBe('unbuilt-next-draft');
  });

  it('imports an urban recipe while retaining the current territory and invalidating all previous geometry', async () => {
    const current = recipe('kept-territory');
    current.extent = 3600;
    current.options.biome = 'desert'; current.options.style = 'atlas';
    current.runtime = { backend: 'typescript', compute: 'cpu', source: 'procedural' };
    const currentWorld = await generateTerrain(current, undefined, new TerrainCache(new MemoryStore()));
    const urbanSource = structuredClone(source);
    delete urbanSource.world;
    urbanSource.settings.options.culture = 'medina'; urbanSource.settings.options.population = 300;
    urbanSource.settings.options.center = { x: 450, y: 450 };
    urbanSource.settings.settlementCount = 2;
    urbanSource.settings.local.main = { sprawl: 1.2 };
    urbanSource.settings.urban = { backend: 'rust', houses: { floors: 3 } };
    const result = await composeUrbanRecipe(urbanSource, currentWorld, current, [{ type: 'drawn-geometry' }], new TerrainCache(new MemoryStore()));
    expectPhysicalEquality(result.world!.terrain, currentWorld.terrain);
    expectTerrainOnly(result.world!);
    expect(result.settings.options.seed).toBe('kept-territory');
    expect(result.settings.options.biome).toBe('desert');
    expect(result.settings.options.style).toBe('atlas');
    expect(result.settings.runtime).toEqual(current.runtime);
    expect(result.settings.options.culture).toBe('medina');
    expect(result.settings.options.population).toBe(300);
    expect(result.settings.options.center).toEqual({ x: 450, y: 450 });
    expect(result.settings.local).toEqual(urbanSource.settings.local);
    expect(result.settings.urban).toEqual(urbanSource.settings.urban);
    expect(result.mods).toHaveLength(0);
    expect(String(result.world!.stats['v2.compositionNotice'])).toContain('2 modification');
    const region = await planRegion(result.world!, result.settings);
    expect(region.settlements).toHaveLength(2);
  });

  it('preserves the effective urban backend when the imported terrain changes the implicit runtime', async () => {
    const current = recipe('current');
    current.runtime = { backend: 'native', compute: 'cpu', source: 'procedural', localServer: 'http://127.0.0.1:8791' };
    const result = await composeTerrain(source, current, new TerrainCache(new MemoryStore()));
    expect(result.settings.runtime).toEqual(source.settings.runtime);
    expect(result.settings.urban?.backend).toBe('native');
  });

  it('requires a complete valid physical snapshot for territory composition', async () => {
    const recipeOnly = { ...source, world: undefined };
    await expect(composeTerrain(recipeOnly, recipe('current'))).rejects.toThrow('sans territoire');
    const malformed = structuredClone(source);
    malformed.world!.terrain.water = new Uint8Array(1);
    await expect(composeTerrain(malformed, recipe('current'))).rejects.toThrow('water');
  });
});
