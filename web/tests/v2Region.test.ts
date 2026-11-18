import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { World } from '../src/gen/types';
import type { RoadOutput, SettlementOutput, SettlementRaster } from '../../rust/bridge/settlements';
import { defaultSettings } from '../src/v2/settings';
import { effectiveRegion, regionSpec, validateRegionSettings } from '../src/v2/regionSettings';
import { projectEngineTerrain } from '../src/v2/terrainProjection';
import type { TerrainData } from '../../rust/bridge/terrain';
import { suggestRegionalExits, effectiveRegionalExits, regionalExitResults } from '../src/v2/regionalExits';
import { settlementStageValidityKeys } from '../src/v2/stageValidity';
import { rerollSeed, stepSeed } from '../../rust/bridge/generationSeed';

const bridge = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn(), dispose: vi.fn(), raster: vi.fn(), fallback: vi.fn() }));
vi.mock('../../rust/bridge/settlementEngine', () => ({ createSettlementEngine: bridge.create }));
vi.mock('../../rust/bridge/settlements', () => ({ settlementRaster: bridge.raster }));
vi.mock('../src/v2/rustUrban', () => ({ rustSettlementRaster: bridge.fallback }));
function raster(n = 64, width = 2400): SettlementRaster {
  return { n, width, height: new Float32Array(n * n).fill(20), water: new Uint8Array(n * n), waterLevel: new Float32Array(n * n), riverWidth: new Float32Array(n * n), riverIds: new Int32Array(n * n).fill(-1) };
}
function native(): TerrainData {
  const r = raster();
  return {
    x: 0,
    y: 0,
    width: 2400,
    resolution: 64,
    minHeight: 20,
    maxHeight: 20,
    globalMinHeight: 20,
    globalMaxHeight: 20,
    motifSize: 3000,
    height: r.height,
    normalX: r.riverWidth,
    normalY: r.riverWidth,
    normalZ: new Float32Array(4096).fill(1),
    caveMask: new Uint8Array(0),
    generationMs: 1,
    field: { n: 64, data: r.height.slice(), exact: true, floor: 0 },
  };
}
function output(): SettlementOutput {
  return {
    settlements: [
      { ...regionSpec('main', 80), center: { x: 1000, y: 1000 }, cls: 'hamlet', archetype: 'plain', radius: 100, scores: { manual: true } },
      { ...regionSpec('village:1', 40), center: { x: 1800, y: 1700 }, cls: 'hamlet', archetype: 'plain', radius: 80, scores: { manual: false } },
    ] as SettlementOutput['settlements'],
    activities: [],
    warnings: ['A source diagnostic'],
    requested: 2,
    usableKm2: 5,
    ms: 4,
  };
}
function roads(): RoadOutput {
  return {
    segments: [
      {
        class: 'main',
        surface: 'paved',
        profile: 'roman',
        width: 6,
        a: 0,
        b: 1,
        path: [
          { x: 1000, y: 1000 },
          { x: 1800, y: 1700 },
        ],
        crossings: [
          {
            kind: 'bridge',
            path: [
              { x: 1200, y: 1200 },
              { x: 1300, y: 1300 },
            ],
          },
        ],
        length: 1060,
        grade: 0.02,
        importance: 40,
      },
    ],
    junctions: [],
    warnings: [],
    unreachable: [],
    routes: 1,
    lengthByClass: { main: 1060 },
    lengthBySurface: { paved: 1060 },
    ms: 2,
  };
}
function setup() {
  const settings = defaultSettings();
  settings.extent = 2400;
  settings.options.population = 80;
  settings.settlementCount = 2;
  settings.runtime = { backend: 'native', compute: 'cpu', source: 'procedural', localServer: 'http://127.0.0.1:18791' };
  settings.region = { resolution: 64, placement: { density: 1.3, clustering: 0.7, siteWeights: { plain: 2 } }, roads: { culture: 'roman', maxGrade: 0.08, crossingCost: 1.7, sharing: 0.9 } };
  const terrain = projectEngineTerrain(native());
  const world: World = { seed: settings.options.seed, options: settings.options, mapSize: 2400, terrain, stats: { 'v2.terrainKey': 'exact-native-terrain' } };
  return { settings, world };
}
beforeEach(() => {
  vi.resetModules();
  bridge.create.mockReset().mockResolvedValue({ run: bridge.run, dispose: bridge.dispose });
  bridge.dispose.mockReset();
  bridge.run.mockReset().mockImplementation(async request => ({ id: request.id, ...(request.place ? { settlements: output() } : {}), roads: request.roads ? roads() : null }));
  bridge.raster.mockReset().mockReturnValue(raster());
  bridge.fallback.mockReset().mockReturnValue(raster());
});
describe('V2 regional Rust forwarding and retained sessions', () => {
  it('records regional-road variation in the general seed while preserving placed sites and their draw', async () => {
    const { settings, world } = setup(),
      { planRustRegion } = await import('../src/v2/region');
    await planRustRegion(world, settings);
    const placed = world.settlements;
    const original = settings.options.seed;
    settings.options.seed = rerollSeed(original, ['settle-roads']);
    await planRustRegion(world, settings, undefined, true);
    expect(world.settlements).toBe(placed);
    expect(bridge.run.mock.calls[2][0].seed).toBe(stepSeed(settings.options.seed, 'settle-roads'));
    expect(stepSeed(settings.options.seed, 'settle-sites')).toBe(original);
    bridge.run.mockClear();
    const fresh = setup().world;
    await planRustRegion(fresh, settings);
    expect(bridge.run.mock.calls).toHaveLength(2);
    expect(bridge.run.mock.calls[0][0]).toMatchObject({ seed: original, roads: null });
    expect(bridge.run.mock.calls[1][0].sites).toEqual(placed!.map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius })));
    expect(fresh.roads).toEqual(world.roads);
  });
  it('forwards the complete placement and road recipe and retains the native output and exact terrain input', async () => {
    const { settings, world } = setup(),
      { planRustRegion } = await import('../src/v2/region');
    await planRustRegion(world, settings);
    expect(bridge.raster).toHaveBeenCalledWith((world.terrain as { v2NativeTerrain?: unknown }).v2NativeTerrain, 64);
    expect(bridge.fallback).not.toHaveBeenCalled();
    expect(bridge.create).toHaveBeenCalledWith({ profile: 'local', server: 'http://127.0.0.1:18791' });
    expect(bridge.run.mock.calls[0][0]).toMatchObject({ seed: settings.options.seed, place: { mode: 'list', density: 1.3, clustering: 0.7, siteWeights: { plain: 2 } }, roads: null });
    expect(bridge.run.mock.calls[1][0].roads).toMatchObject({ culture: 'roman', maxGrade: 0.08, crossingCost: 1.7, sharing: 0.9 });
    expect(world.settlements?.map(s => s.center)).toEqual([
      { x: 1000, y: 1000 },
      { x: 1800, y: 1700 },
    ]);
    expect(world.site?.center).toEqual(world.settlements![0].center);
    expect(world.debug?.v2RustRegion).toEqual({ placement: output(), roads: roads() });
    expect(world.bridges).toEqual([{ a: { x: 1200, y: 1200 }, b: { x: 1300, y: 1300 }, width: 6 }]);
  });
  it('reroutes between retained sites without placement, raster resampling or a second native upload', async () => {
    const { settings, world } = setup(),
      { planRustRegion } = await import('../src/v2/region');
    await planRustRegion(world, settings);
    const sites = world.settlements;
    settings.region!.roads = { density: 0.8, exits: { main: 4 } };
    await planRustRegion(world, settings, undefined, true);
    const request = bridge.run.mock.calls[2][0];
    expect(request.place).toBeUndefined();
    expect(request.raster).toBeUndefined();
    expect(request.sites).toEqual(sites!.map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius })));
    expect(request.roads).toMatchObject({ density: 0.8, exits: { main: 4 } });
    expect(world.settlements).toBe(sites);
    expect(bridge.create).toHaveBeenCalledTimes(1);
    expect(bridge.raster).toHaveBeenCalledTimes(1);
    expect(world.debug?.v2RustRegion).toMatchObject({ placement: output() });
  });
  it('invalidates the raster only on resolution/terrain changes and disposes obsolete WASM handles on runtime changes', async () => {
    const { settings, world } = setup(),
      { planRustRegion } = await import('../src/v2/region');
    await planRustRegion(world, settings);
    settings.region!.resolution = 128;
    await planRustRegion(world, settings, undefined, true);
    expect(bridge.run.mock.calls[2][0].raster.n).toBe(128);
    expect(bridge.create).toHaveBeenCalledTimes(1);
    settings.runtime!.backend = 'rust';
    await planRustRegion(world, settings, undefined, true);
    expect(bridge.dispose).toHaveBeenCalledTimes(1);
    expect(bridge.create).toHaveBeenCalledTimes(2);
  });
  it('validates loopback addresses and forwards backend failures without corrupting retained sites', async () => {
    const { settings, world } = setup(),
      { planRustRegion } = await import('../src/v2/region');
    settings.runtime!.localServer = 'https://external.invalid';
    await expect(planRustRegion(world, settings)).rejects.toThrow('loopback');
    expect(bridge.run).not.toHaveBeenCalled();
    settings.runtime!.localServer = 'http://localhost:8791';
    bridge.run.mockResolvedValue({ id: 1, error: 'Native placement refused the slope constraint.' });
    await expect(planRustRegion(world, settings)).rejects.toThrow('slope constraint');
    expect(world.settlements).toBeUndefined();
  });
  it('validates all native ranges, duplicate/partial positions and uses a positive automatic population', () => {
    const { settings } = setup();
    settings.options.population = 0;
    expect(effectiveRegion(settings).placement.main.population).toBeGreaterThan(0);
    for (const invalid of [
      { placement: { unknown: 1 } },
      { roads: { density: 2 } },
      { roads: { crossingCost: 0 } },
      { roads: { level: 'railway' } },
      { placement: { populationJitter: 1.1 } },
      { placement: { edgeMargin: 0.4 } },
      { placement: { counts: { village: 700, hamlet: 700 } } },
      { placement: { main: { position: { x: 100 } } } },
      { placement: { list: [regionSpec('same'), regionSpec('same')] } },
    ])
      expect(() => validateRegionSettings(invalid)).toThrow();
    expect(() => validateRegionSettings({ placement: { main: { position: { x: 1200, y: 300 } } } }, 1200)).toThrow('inside');
    expect(() => validateRegionSettings({ roads: { density: 1, maxGrade: 1, crossingCost: 0.05, exits: { main: 16 } }, placement: { populationJitter: 1, zipfExponent: 0.3, edgeMargin: 0.3 } })).not.toThrow();
  });
  it('uses a finer bounded regional planning grid beyond 40 km unless explicitly set', () => {
    const { settings } = setup();
    delete settings.region!.resolution;
    settings.extent = 200_000;
    expect(effectiveRegion(settings).resolution).toBe(1024);
    settings.region!.resolution = 512;
    expect(effectiveRegion(settings).resolution).toBe(512);
  });
  it('applies local main and listed-settlement placement preferences over their global recipes', () => {
    const { settings } = setup();
    settings.region!.placement = { main: { ...regionSpec('main', 200), position: { x: 900, y: 900 } }, list: [regionSpec('secondary', 50)] };
    settings.local.main = { center: { x: 1000, y: 1100 }, population: 80, siteType: 'plain', sitePrefs: { weights: { hilltop: 2 } } };
    settings.local.secondary = { center: { x: 1600, y: 1700 }, culture: 'medina', population: 70, siteType: 'harbor', sitePrefs: { mountainFace: 0.8, weights: { harbor: 3 } } };
    const config = effectiveRegion(settings).placement;
    expect(config.main).toMatchObject({ population: 80, position: { x: 1000, y: 1100 }, siteType: 'plain', sitePrefs: { weights: { hilltop: 2 } } });
    expect(config.list[0]).toMatchObject({ key: 'secondary', population: 70, culture: 'medina', position: { x: 1600, y: 1700 }, siteType: 'harbor', sitePrefs: { mountainFace: 0.8, weights: { harbor: 3 } } });
  });
});

describe('regional road exit requests', () => {
  it('requests non-zero automatic exits with the V2 roads=0 default', () => {
    const settings = defaultSettings();
    expect(settings.options.roads).toBe(0);
    const exits = effectiveRegion(settings).roads!.exits;
    expect(Object.keys(exits).sort()).toEqual(['highway', 'local', 'main', 'track']);
    expect(Object.values(exits).reduce((n, count) => n + count, 0)).toBeGreaterThan(0);
    expect(() => validateRegionSettings({ roads: effectiveRegion(settings).roads })).not.toThrow();
  });
  it('pins each explicit class, including zero, and resets absent classes to context', () => {
    const { settings } = setup(),
      suggested = suggestRegionalExits(settings);
    settings.region!.roads = { exits: { main: 0, track: 3 } };
    expect(effectiveRegion(settings).roads!.exits).toEqual({ ...suggested, main: 0, track: 3 });
    delete settings.region!.roads.exits!.main;
    expect(effectiveRegion(settings).roads!.exits.main).toBe(suggested.main);
    settings.region!.roads = null;
    expect(effectiveRegion(settings).roads).toBeNull();
  });
  it('validates integer class counts and a combined limit of 16, rejecting the old scalar form', () => {
    for (const exits of [2, { main: -1 }, { local: 0.5 }, { track: 17 }, { highway: NaN }, { trail: 1 }, { highway: 8, main: 9 }]) expect(() => validateRegionSettings({ roads: { exits } })).toThrow();
    expect(() => validateRegionSettings({ roads: { exits: { highway: 4, main: 4, local: 4, track: 4 } } })).not.toThrow();
    expect(() => validateRegionSettings({ roads: { exits: {} } })).not.toThrow();
  });
  it('uses tracks for primitive regions and highways for large imperial regions', () => {
    const settings = defaultSettings();
    settings.extent = 40000;
    settings.region = { demography: { population: 100000 }, roads: { level: 'primitive' } };
    expect(suggestRegionalExits(settings)).toEqual({ highway: 0, main: 0, local: 0, track: 7 });
    settings.region.roads!.level = 'rural';
    expect(suggestRegionalExits(settings)).toEqual({ highway: 0, main: 2, local: 4, track: 1 });
    settings.region.roads!.level = 'developed';
    expect(suggestRegionalExits(settings)).toEqual({ highway: 1, main: 3, local: 3, track: 0 });
    settings.region.roads!.level = 'imperial';
    expect(suggestRegionalExits(settings)).toEqual({ highway: 2, main: 3, local: 2, track: 0 });
    settings.extent = 2400;
    expect(suggestRegionalExits(settings).highway).toBe(0);
    expect(Object.values(suggestRegionalExits(settings)).reduce((n, count) => n + count, 0)).toBe(3);
    settings.extent = 40000;
    settings.region.demography!.population = 100;
    expect(suggestRegionalExits(settings).highway).toBe(0);
  });
  it('leaves the automatic classes only the budget remaining after overrides', () => {
    const settings = defaultSettings();
    settings.region = { roads: { exits: { highway: 16 } } };
    expect(effectiveRegionalExits(settings)).toEqual({ highway: 16, main: 0, local: 0, track: 0 });
    expect(() => validateRegionSettings({ roads: effectiveRegion(settings).roads })).not.toThrow();
    settings.region.roads!.exits = { highway: 0, main: 0, local: 0, track: 0 };
    expect(effectiveRegionalExits(settings)).toEqual({ highway: 0, main: 0, local: 0, track: 0 });
  });
  it('invalidates regional roads while keeping placement and hierarchy valid', () => {
    const settings = defaultSettings(),
      before = settlementStageValidityKeys(settings, 'terrain');
    settings.region = { roads: { exits: { main: 3 } } };
    const after = settlementStageValidityKeys(settings, 'terrain');
    expect(after.get('settle-sites')).toBe(before.get('settle-sites'));
    expect(after.get('settle-hierarchy')).toBe(before.get('settle-hierarchy'));
    expect(after.get('settle-roads')).not.toBe(before.get('settle-roads'));
  });
  it('retains successes, substitutions, failures and Rust warnings after routing and rerouting', async () => {
    const { settings, world } = setup(),
      { planRustRegion } = await import('../src/v2/region');
    const report: NonNullable<RoadOutput['exits']> = [
      { requested: 'highway', class: 'main', gateway: 'village:1', point: { x: 0, y: 1700 }, reason: null },
      { requested: 'main', class: 'main', gateway: 'main', point: { x: 1000, y: 0 }, reason: null },
      { requested: 'local', class: null, gateway: null, point: null, reason: 'No viable gateway' },
    ];
    bridge.run.mockImplementation(async request => ({ id: request.id, ...(request.place ? { settlements: output() } : {}), roads: request.roads ? { ...roads(), exits: report, warnings: ['A requested exit could not be routed.'] } : null }));
    await planRustRegion(world, settings);
    expect((world.debug?.v2RustRegion as { roads: RoadOutput }).roads.exits).toEqual(report);
    expect(world.stats['settlements.warning']).toBe('A source diagnostic | A requested exit could not be routed.');
    expect(regionalExitResults(report)).toEqual({ highway: { obtained: 0, requested: 1 }, main: { obtained: 2, requested: 1 }, local: { obtained: 0, requested: 1 }, track: { obtained: 0, requested: 0 } });
    await planRustRegion(world, settings, undefined, true);
    expect((world.debug?.v2RustRegion as { roads: RoadOutput }).roads.exits).toEqual(report);
  });
});
