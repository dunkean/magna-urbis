import { describe, expect, it } from 'vitest';
import { TerrainCache, type TerrainStore } from '../src/v2/cache';
import { defaultSettings, adaptedExtent } from '../src/v2/settings';
import { terrainCacheKey, retainedTerrainMatchesSettings, generateTerrain, planRegion, generateTown, generateTowns } from '../src/v2/engine';
import { parseProject, serializeProject } from '../src/v2/project';
import type { V2Settings } from '../src/v2/contracts';
import type { TerrainLayer } from '../src/gen/types';

class RetainedStore implements TerrainStore {
  readonly data = new Map<string, TerrainLayer>();
  async get(key: string): Promise<TerrainLayer | undefined> { const value = this.data.get(key); return value ? structuredClone(value) : undefined; }
  async put(key: string, value: TerrainLayer): Promise<void> { this.data.set(key, structuredClone(value)); }
  async clear(): Promise<void> { this.data.clear(); }
}
function settings(): V2Settings {
  const settings = defaultSettings();
  settings.runtime = { backend: 'typescript', compute: 'cpu', source: 'procedural' };
  settings.extent = 1200;
  settings.settlementCount = 1;
  settings.options = { ...settings.options, population: 80, size: 'hamlet', coast: 'none', river: 'none', relief: 'flat', walls: 'none', castle: 'no',
    importedHeight: { w: 8, h: 8, rgba: new Uint8Array(0), elevations: Float32Array.from({ length: 64 }, (_, i) => 20 + i % 8 * .1) } };
  return settings;
}
// Captured historical .2 layout and its original 64-bit FP32-pixel fingerprint.
const OLD_BENCH_KEY = '["mu-v2-bench-terrain-2026-10-28.2","procedural","magna-urbis-v2",1200,"flat","none","none",0,"auto",{"backend":"typescript","compute":"cpu","erosion":1,"resolution":512,"source":"procedural"},null,[8,8,"256:3226455237:1318026841",120,0]]';

describe('V2 retained generation pipeline', () => {
  it('starts with a 6 km region independent of later settlement settings and their terrain cache key', () => {
    const settings = defaultSettings(), originalKey = terrainCacheKey(settings);
    expect(settings.extent).toBe(6000);
    settings.options.population = 100000; settings.settlementCount = 12;
    settings.options.culture = 'medina'; settings.options.sprawl = 2;
    expect(adaptedExtent(settings)).toBe(6000);
    expect(terrainCacheKey(settings)).toBe(originalKey);
  });
  it('retains the optional automatic extent recommendation and accepts a fixed extent', () => {
    const small = defaultSettings(); small.extent = 'auto';
    const large = structuredClone(small);
    large.options.population = 100000; large.settlementCount = 12;
    expect(adaptedExtent(large)).toBeGreaterThan(adaptedExtent(small));
    large.extent = 4000;
    expect(adaptedExtent(large)).toBe(4000);
    small.generation = 'neural';
    expect(adaptedExtent(small)).toBe(40000);
  });
  it('keys only the terrain dependencies, including FP32 content and generation runtime', () => {
    const a = settings(), b = structuredClone(a);
    b.options.style = 'atlas'; b.options.culture = 'medina'; b.options.biome = 'desert';
    b.appearance = { style: 'night', contours: false, landuse: false, labels: true };
    b.local.main = { sprawl: 1.5 };
    expect(terrainCacheKey(b)).toBe(terrainCacheKey(a));
    b.options.importedHeight!.elevations![0] += .001;
    expect(terrainCacheKey(b)).not.toBe(terrainCacheKey(a));
    b.options.importedHeight!.elevations!.set(a.options.importedHeight!.elevations!);
    b.runtime = { backend: 'rust', source: 'procedural', compute: 'cpu' };
    expect(terrainCacheKey(b)).not.toBe(terrainCacheKey(a));
    const transport = structuredClone(b);
    transport.runtime!.localServer = 'http://127.0.0.1:18791'; transport.runtime!.pythonServer = 'http://127.0.0.1:18793';
    expect(terrainCacheKey(transport)).toBe(terrainCacheKey(b));
    b.generation = transport.generation = 'neural';
    b.runtime!.source = transport.runtime!.source = 'neural-wasm';
    b.runtime!.neuralAssets = './neural/'; transport.runtime!.neuralAssets = 'https://models.example.test/custom-neural/';
    expect(terrainCacheKey(transport)).not.toBe(terrainCacheKey(b));
  });
  it('restores persistent terrain across cache instances and protects cached arrays from callers', async () => {
    const store = new RetainedStore(), first = new TerrainCache(store), s = settings();
    const generated = await generateTerrain(s, undefined, first);
    expect(generated.stats['v2.cache']).toBe('miss');
    const original = generated.terrain.height.data[0];
    const originalCover = structuredClone(generated.landuse);
    generated.terrain.height.data[0] = 12345;
    if (generated.landuse?.areas[0]?.poly[0]) generated.landuse.areas[0].poly[0].x += 12345;
    const memory = await generateTerrain(s, undefined, first);
    expect(memory.stats['v2.cache']).toBe('memory');
    expect(memory.terrain.height.data[0]).toBe(original);
    expect(memory.landuse).toEqual(originalCover);
    const freshInstance = await generateTerrain(s, undefined, new TerrainCache(store));
    expect(freshInstance.stats['v2.cache']).toBe('disk');
    expect(freshInstance.terrain.height.data).toEqual(memory.terrain.height.data);
    s.options.biome = 'desert';
    const biome = await generateTerrain(s, undefined, first);
    expect(biome.stats['v2.cache']).toBe('memory');
    expect(biome.terrain.height.data).toEqual(memory.terrain.height.data);
  });
  it('creates sites and routes without urban plans, then generates a town deterministically without changing terrain', async () => {
    const s = settings(), t = await generateTerrain(s, undefined, new TerrainCache(new RetainedStore()));
    const region = await planRegion(t, s);
    expect(region.site).toBeDefined();
    expect(region.settlements).toHaveLength(1);
    expect(region.urban).toBeUndefined();
    expect(region.settlements?.every(place => !place.urban)).toBe(true);
    const individual = await generateTown(region, s, 'main');
    const all = await generateTowns(region, s);
    expect(individual.urban?.buildings.length).toBeGreaterThan(0);
    expect(individual.urban).toEqual(all.urban);
    expect(individual.terrain.height.data).toEqual(t.terrain.height.data);
    expect(individual.roads).toEqual(region.roads);
    expect(region.urban).toBeUndefined();
    const changed = structuredClone(s); changed.options.relief = 'mountains';
    await expect(generateTown(region, changed, 'main')).rejects.toThrow('topographie');
    changed.options.relief = s.options.relief; changed.options.population = 500;
    await expect(generateTown(region, changed, 'main')).rejects.toThrow('implantation');
  });
  it('round trips complete worlds, FP32 imports, costs with Infinity and a seed-only recipe', async () => {
    const s = settings(), t = await generateTerrain(s, undefined, new TerrainCache(new RetainedStore()));
    s.appearance = { style: 'cadastre', contours: false, landuse: true, labels: false };
    const region = await planRegion(t, s);
    region.site!.cost.data[0] = Infinity;
    const mods = [{ settlementKey: 'main', buildingIndex: 0, patch: { storeys: 3 } }];
    const loaded = parseProject(serializeProject(s, region, mods));
    expect(loaded.settings.options.importedHeight!.elevations).toBeInstanceOf(Float32Array);
    expect(loaded.world!.terrain.height.data).toEqual(region.terrain.height.data);
    expect(loaded.world!.terrain.receiver).toBeInstanceOf(Int32Array);
    expect(loaded.world!.site!.cost.data[0]).toBe(Infinity);
    expect(loaded.mods).toEqual(mods);
    expect(loaded.settings.appearance).toEqual(s.appearance);
    expect(parseProject(serializeProject(s)).world).toBeUndefined();
  });
  it('keeps an already created auto-sized terrain when the requested composition changes', async () => {
    const s = settings();
    s.extent = 'auto'; s.options.mapSize = 1200;
    const t = await generateTerrain(s, undefined, new TerrainCache(new RetainedStore()));
    delete s.options.mapSize; s.options.population = 500; s.settlementCount = 2;
    expect(adaptedExtent(s)).toBeGreaterThan(t.mapSize);
    const region = await planRegion(t, s);
    expect(region.mapSize).toBe(t.mapSize);
    expect(region.terrain.height.data).toEqual(t.terrain.height.data);
  });
  it('applies local morphology without replanning and retains local metadata on the generated town', async () => {
    const s = settings(), terrain = await generateTerrain(s, undefined, new TerrainCache(new RetainedStore()));
    const region = await planRegion(terrain, s);
    s.local.main = { sprawl: 1.5, walls: 'none', language: 'japanese' };
    const town = await generateTown(region, s, 'main');
    expect(town.settlements![0].options!.sprawl).toBe(1.5);
    expect(town.settlements![0].options!.language).toBe('japanese');
    expect(town.site!.center).toEqual(region.site!.center);
    expect(town.roads).toEqual(region.roads);
    expect(town.terrain.height.data).toEqual(terrain.terrain.height.data);
  });
  it('rejects malformed dimensions, unknown formats, nonfinite parameters and unavailable neural paths', async () => {
    const s = settings();
    expect(() => parseProject('{"format":"other"}')).toThrow('Format');
    s.options.importedHeight!.w = 7;
    expect(() => serializeProject(s)).toThrow('dimensions');
    s.options.importedHeight!.w = 8;
    s.options.center = { x: NaN, y: 1 };
    expect(() => serializeProject(s)).toThrow('non fini');
    delete s.options.center;
    s.generation = 'neural'; delete s.options.importedHeight;
    await expect(generateTerrain(s)).rejects.toThrow('modèle neuronal');
  });
  it('continues a coherent saved .2 project without changing historical keys, terrain or complete geometry', async () => {
    const s = settings(), terrain = await generateTerrain(s, undefined, new TerrainCache(new RetainedStore()));
    const region = await planRegion(terrain, s);
    region.stats['v2.terrainKey'] = OLD_BENCH_KEY; region.stats['v2.engine'] = 'mu-v2-bench-terrain-2026-10-28.2';
    const loaded = parseProject(serializeProject(s, region, [{ type: 'note', value: 'Keep all geometry.' }]));
    const oldStats = structuredClone(loaded.world!.stats), oldHeight = loaded.world!.terrain.height.data.slice(), oldRoads = structuredClone(loaded.world!.roads);
    expect(retainedTerrainMatchesSettings(loaded.world!, loaded.settings)).toBe(true);
    const town = await generateTown(loaded.world!, loaded.settings, 'main');
    expect(town.urban?.buildings.length).toBeGreaterThan(0);
    expect(town.terrain.height.data).toEqual(oldHeight); expect(town.roads).toEqual(oldRoads);
    expect(town.stats['v2.terrainKey']).toBe(OLD_BENCH_KEY); expect(loaded.world!.stats).toEqual(oldStats);
    expect(loaded.mods).toEqual([{ type: 'note', value: 'Keep all geometry.' }]);
    for (const change of [
      (draft: V2Settings) => { draft.options.seed = 'different'; },
      (draft: V2Settings) => { draft.extent = 2400; },
      (draft: V2Settings) => { draft.options.relief = 'mountains'; },
      (draft: V2Settings) => { draft.options.importedHeight!.elevations![0] += .001; },
    ]) {
      const draft = structuredClone(s); change(draft);
      expect(retainedTerrainMatchesSettings(loaded.world!, draft)).toBe(false);
      await expect(generateTown(loaded.world!, draft, 'main')).rejects.toThrow('topographie');
    }
  });
  it('accepts the identical .1 TypeScript retained pipeline but does not relabel the old mixed Rust/TS pipeline', async () => {
    const s = settings(), terrain = await generateTerrain(s, undefined, new TerrainCache(new RetainedStore()));
    const region = await planRegion(terrain, s), key = JSON.parse(OLD_BENCH_KEY);
    key[0] = 'mu-v2-ts-2026-10-28.1'; key.splice(10, 1); region.stats['v2.terrainKey'] = JSON.stringify(key);
    const oldPlan = JSON.parse(String(region.stats['v2.planKey'])); oldPlan.splice(8, 2); region.stats['v2.planKey'] = JSON.stringify(oldPlan);
    expect(retainedTerrainMatchesSettings(region, s)).toBe(true);
    const town = await generateTown(region, s, 'main'); expect(town.urban?.buildings.length).toBeGreaterThan(0);
    expect(town.stats['v2.terrainKey']).toBe(region.stats['v2.terrainKey']);
    const mixed = structuredClone(s); mixed.runtime!.backend = 'rust';
    expect(retainedTerrainMatchesSettings(region, mixed)).toBe(false);
  });
});
