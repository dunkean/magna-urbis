import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerrainData } from '../../rust/bridge/terrain';
import type { HydrologyData } from '../../rust/bridge/hydrology';
import type { TerrainLayer } from '../src/gen/types';
import { defaultSettings, adaptedExtent } from '../src/v2/settings';
import { effectiveTerrainSettings, validateTerrainSettings } from '../src/v2/terrainSettings';
import { generateEngineHeight } from '../src/v2/platform';
import { generateTerrain, terrainCacheKey, retainedTerrainMatchesSettings } from '../src/v2/engine';
import { projectEngineTerrain, type V2TerrainLayer } from '../src/v2/terrainProjection';
import { parseProject, serializeProject } from '../src/v2/project';
import { TerrainCache, type TerrainStore } from '../src/v2/cache';

const bridge = vi.hoisted(() => ({ sampleRustTerrain: vi.fn() }));
vi.mock('../../rust/bridge/terrain', () => bridge);
class Store implements TerrainStore {
  values = new Map<string, TerrainLayer>();
  async get(key: string) { return this.values.get(key); }
  async put(key: string, value: TerrainLayer) { this.values.set(key, structuredClone(value)); }
  async clear() { this.values.clear(); }
}
function native(n = 64, width = 2400): TerrainData {
  const len = n * n, height = new Float32Array(len).fill(20);
  const integers = () => new Uint32Array(len), floats = () => new Float32Array(len);
  const hydro: HydrologyData = { width, resolution: n, receivers: integers().fill(0xffffffff), accumulation: new Float32Array(len).fill((width / n) ** 2), basins: integers(),
    rawReceivers: integers().fill(0xffffffff), rawAccumulation: floats(), rawBasins: integers(), flatLabels: integers(), flatRank: integers(), externalInflowArea: 0,
    rawFilled: height.slice(), rawDrainageHeight: height.slice(), breachCount: 0, breachCutVolumeM3: 0, avoidedFillVolumeM3: 0,
    filled: height.slice(), lakeDepth: floats(), lakeLabels: integers(), baseHeight: height.slice(), drainageHeight: height.slice(), surfaceHeight: height.slice(), adjustedHeight: height.slice(),
    riverPoints: Float32Array.from([123, 210, 5, 18, 456, 789, 7, 14]), riverOffsets: Uint32Array.from([0, 2]), riverMeta: Uint32Array.from([42, 0, 1, 0, 3, 0]),
    lakePoints: Float32Array.from([800, 800, 900, 800, 900, 900, 800, 900]), lakeOffsets: Uint32Array.from([0, 4]), lakeMeta: Float32Array.from([1, 22, 10000, 2, 800, 900]), lakeRingMeta: Uint32Array.from([1, 0]),
    lakeClosed: Uint32Array.from([0]), waterField: floats(), closedLakeCount: 0, nodePoints: new Float32Array(4), nodeMeta: new Uint32Array(6),
    riverCount: 1, lakeCount: 1, basinCount: 1, lakeFraction: .01, incision: 1, backend: 'cpu', drainageMs: 3, vectorMs: 4, generationMs: 7, seaMask: new Uint8Array(len) };
  hydro.lakeLabels[22 * n + 22] = 1; hydro.lakeDepth[22 * n + 22] = 2;
  return { x: 0, y: 0, width, resolution: n, minHeight: 20, maxHeight: 20, globalMinHeight: 20, globalMaxHeight: 20, motifSize: 3000,
    height, caveMask: new Uint8Array(0), normalX: floats(), normalY: floats(), normalZ: new Float32Array(len).fill(1), generationMs: 10,
    backend: 'wasm', generationBackend: 'cpu', hydrology: hydro, field: { n, data: height.slice(), exact: true, floor: 0 } };
}
beforeEach(() => bridge.sampleRustTerrain.mockReset().mockResolvedValue(native()));
afterEach(() => vi.unstubAllGlobals());

describe('V2 bench terrain contract', () => {
  it('starts new recipes at a 10 km procedural scale with vector hydrology, without sharing nested defaults', () => {
    const settings = defaultSettings(), independent = defaultSettings();
    expect(settings.terrain).toEqual({ motifSize: 10000, hydrology: { engine: 'vector' } });
    expect(effectiveTerrainSettings(settings, 6000)).toMatchObject({ motifSize: 10000, hydrology: { engine: 'vector' } });
    settings.terrain!.motifSize = 15000;
    settings.terrain!.hydrology!.engine = 'rust';
    expect(independent.terrain).toEqual({ motifSize: 10000, hydrology: { engine: 'vector' } });
  });
  it('preserves historical absent terrain controls on project import instead of applying new-project defaults', () => {
    const legacy = defaultSettings(); delete legacy.terrain; legacy.extent = 'auto';
    const originalKey = terrainCacheKey(legacy);
    const loaded = parseProject(serializeProject(legacy)).settings;
    expect(loaded.terrain).toBeUndefined();
    expect(loaded.extent).toBe('auto');
    expect(effectiveTerrainSettings(loaded, 6000)).toMatchObject({ motifSize: 3000, hydrology: { engine: 'rust' } });
    expect(terrainCacheKey(loaded)).toBe(originalKey);
    // Partial historical controls also retain their original scale and implicit hydrology engine.
    legacy.terrain = { hydrology: { density: .75 } };
    const partial = parseProject(serializeProject(legacy)).settings;
    expect(partial.terrain).toEqual({ hydrology: { density: .75 } });
    expect(effectiveTerrainSettings(partial, 6000)).toMatchObject({ motifSize: 3000, hydrology: { engine: 'rust', density: .75 } });
  });
  it('forwards the vector water recipe while generating only terrain, without any settlement or urban stage', async () => {
    const settings = defaultSettings(); settings.extent = 2400; settings.runtime!.compute = 'cpu';
    settings.settlementCount = 9; settings.options.population = 200000;
    settings.terrain = { ...settings.terrain, resolution: 64,
      hydrology: { ...settings.terrain!.hydrology, density: 1.7, riverArea: 9, vectorWidth: 4, vectorResolution: 512, sinuosity: 2 } };
    const world = await generateTerrain(settings, undefined, new TerrainCache(new Store()));
    expect(bridge.sampleRustTerrain).toHaveBeenCalledTimes(1);
    expect(bridge.sampleRustTerrain.mock.calls[0][0].settings).toMatchObject({ motifSize: 10000,
      hydrology: { engine: 'vector', density: 1.7, riverArea: 9, vectorWidth: 4, vectorResolution: 512, sinuosity: 2 } });
    expect(world.stats['v2.stage']).toBe('terrain');
    expect(world.options.workflow).toBe('environment');
    for (const key of ['site', 'roads', 'bridges', 'settlements', 'urban', 'names']) expect(Object.hasOwn(world, key)).toBe(false);
    expect(Object.keys(world.stats).filter(key => /settlement|population|urban|town|building|road/i.test(key))).toEqual([]);
  });
  it('rejects a forced GPU-generation fallback even when final sampling succeeds on the GPU',async()=>{
    const result=native();result.backend='gpu-f32';result.generationBackend='cpu';result.generationReason='GPU generation unavailable: shader rejected';bridge.sampleRustTerrain.mockResolvedValue(result);
    const request={seed:'gpu-provenance',width:2400,relief:'hills' as const,compute:'gpu' as const,source:'procedural' as const,resolution:64,terrain:{generationCompute:'gpu-erosion' as const}};
    await expect(generateEngineHeight(request)).rejects.toThrow('La génération GPU demandée a échoué : GPU generation unavailable: shader rejected');
    result.generationBackend='gpu-erosion-f32';await expect(generateEngineHeight(request)).resolves.toMatchObject({generationBackend:'gpu-erosion-f32'});
  });
  it('forwards all relief/coast/erosion/water/conditioning controls without replacing their values', async () => {
    const controls = { relief: 'caldera' as const, motifSize: 17500, environment: 'high-mountains' as const, mountainMix: .73, coastMask: 169,
      islandMode: 'archipelago' as const, erosion: 1.7, resolution: 64, compute: 'wasm' as const, generationCompute: 'cpu' as const,
      erosionTuning: { iterations: 17, incision: 2.5, incisionSlope: .11, fill: .1, carve: .2, finalCarve: .3, talus: 1.2, thermal: .4, diffusion: .5, detail: .06, warp: .7, surfaceIterations: 8, surfaceIncision: .9, surfaceCarve: .4, surfaceRouted: 0, surfaceThermal: 1.1, surfaceDiffusion: 1.2 },
      hydrology: { engine: 'rust' as const, main: 'major' as const, density: 1.7, wetness: .8, coastalStreams: 2, condMode: 'breach' as const, condDepth: 31, condLength: 1700,
        lakeCoverage: .1, maxLakeArea: .09, maxBreachDepth: 22, resolution: 256 as const, compute: 'cpu' as const },
      climateValues: { temperature: 13, temperatureStd: 420, precipitation: 1250, precipitationCv: 22 }, refine: true,
      detailNoise: { amplitude: .1, hurst: .8, lacunarity: 2, octaves: 5, start: 2, slope: .5, flat: .02, shore: 4 } };
    const out = await generateEngineHeight({ seed: 'parity', width: 2400, relief: 'flat', compute: 'cpu', source: 'procedural', terrain: controls });
    const request = bridge.sampleRustTerrain.mock.calls[0][0];
    expect(request.settings).toMatchObject(controls);
    expect(request.settings.seed).toBe('parity'); expect(request.settings.width).toBe(2400);
    expect(request).toMatchObject({ retainField: true, display: 'svg', region: { resolution: 64 } });
    expect(out.terrain.hydrology?.riverMeta[0]).toBe(42);
  });
  it('forwards Python checkpoints, histogram and fit, while native Rust retains its installed model profile', async () => {
    const out = native(); out.neural = { backend: 'rust-wgpu', totalMs: 1, coarseMs: 1, baseMs: 1, decoderMs: 1, reconstructionMs: 1, requestMs: 1, evaluations: [4, 1, 1], profile: 'native', land: 1 };
    bridge.sampleRustTerrain.mockResolvedValue(out);
    const terrain = { relief: 'mixed' as const, mountainMix: .8, coastMask: 255, islandMode: 'random' as const, resolution: 64,
      fidelity: .013, neuralFit: 'scale' as const, neuralSlopes: false, coarseModel: 'coarse-checkpoint', baseModel: 'base-checkpoint', decoderModel: 'decoder-checkpoint',
      neuralTuning: { landScale: 4.5, steps: 12, noiseTemperature: 7, noiseTemperatureStd: 6, noisePrecipitation: 5, noisePrecipitationCv: 4,
        reliefMode: 'fixed' as const, reliefFixed: 315, reliefScale: 1.2, histogram: [20, -30, 40, -50, 60], detail: 2.1 } };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'HEAD' ? new Response('', { status: 200 }) : Response.json({ backend: 'python-cuda', loaded: true, state: 'ready' })));
    await generateEngineHeight({ seed: 'neural', width: 2400, relief: 'flat', compute: 'gpu', source: 'neural-python', pythonServer: 'http://localhost:18793', neuralAssets: 'https://models.example.test/', terrain });
    expect(bridge.sampleRustTerrain.mock.calls[0][0].settings).toMatchObject({ ...terrain, source: 'neural-python', neuralServer: 'http://localhost:18793' });
    const { coarseModel: _c, baseModel: _b, decoderModel: _d, ...pinned } = terrain;
    await generateEngineHeight({ seed: 'neural', width: 2400, relief: 'flat', compute: 'gpu', source: 'neural', neuralServer: 'http://localhost:18792', terrain: pinned });
    expect(bridge.sampleRustTerrain.mock.calls[1][0].settings).toMatchObject({ source: 'neural', neuralServer: 'http://localhost:18792' });
  });
  it('keys every typed terrain recipe, omits transport, and reuses expensive terrain after forest changes', () => {
    const settings = defaultSettings(), key = terrainCacheKey(settings);
    const patches = [{ relief: 'volcano' }, { motifSize: 8500 }, { coastMask: 85 }, { islandMode: 'random' }, { resolution: 1024 }, { mountainMix: .9 },
      { erosionTuning: { incision: 2 } }, { hydrology: { condStrength: 3 } }, { neuralTuning: { detail: 3 } }, { climateValues: { temperature: 8, temperatureStd: 600, precipitation: 1000, precipitationCv: 35 } },
      { neuralFit: 'scale' }, { neuralSlopes: false }, { refine: false }];
    for (const patch of patches) expect(terrainCacheKey({ ...settings, terrain: { ...settings.terrain, ...patch } as never })).not.toBe(key);
    expect(terrainCacheKey({ ...settings, terrain: { ...settings.terrain, forest: { density: 0 } } })).toBe(key);
    expect(terrainCacheKey({ ...settings, runtime: { ...settings.runtime!, neuralServer: 'http://localhost:18792' } })).toBe(key);
    const python = { ...settings, runtime: { ...settings.runtime!, source: 'neural-python' as const } };
    expect(terrainCacheKey({ ...python, terrain: { coarseModel: 'other' } })).not.toBe(terrainCacheKey(python));
  });
  it('supports the selected physical extent beyond 40 km and validates rich controls instead of silently clamping', () => {
    const settings = defaultSettings(); settings.extent = 100000;
    expect(adaptedExtent(settings)).toBe(100000);
    expect(effectiveTerrainSettings(settings, adaptedExtent(settings)).width).toBe(100000);
    expect(() => validateTerrainSettings({ coastMask: 256 })).toThrow();
    expect(() => validateTerrainSettings({ hydrology: { unknown: 3 } })).toThrow('Unknown');
    expect(() => validateTerrainSettings({ neuralTuning: { noiseTemperature: 10, histogram: [20, 30, 40, 50, 60] } })).not.toThrow();
  });
  it('projects the retained native water, never regenerates TS rivers, and round trips raw fields and topology', async () => {
    const input = native(), projected = projectEngineTerrain(input);
    expect(projected.rivers[0]).toMatchObject({ id: 42, path: [{ x: 123, y: 210 }, { x: 456, y: 789 }], width: [5, 7], main: true, edgeFed: true });
    expect(projected.receiver[0]).toBe(-1); expect(projected.flow.data[0]).toBe(1);
    expect(projected.lakes[0][0]).toEqual({ x: 800, y: 800 });
    const settings = defaultSettings(); settings.extent = 2400; settings.runtime!.compute = 'cpu'; settings.terrain = { resolution: 64 };
    const store = new Store(); const world = await generateTerrain(settings, undefined, new TerrainCache(store));
    expect(world.terrain.rivers[0].id).toBe(42);
    expect((world.terrain as V2TerrainLayer).v2NativeTerrain?.field?.exact).toBe(true);
    const loaded = parseProject(serializeProject(settings, world)).world!.terrain as V2TerrainLayer;
    expect(loaded.v2NativeTerrain?.hydrology?.rawReceivers).toBeInstanceOf(Uint32Array);
    expect(loaded.v2NativeTerrain?.hydrology?.riverPoints).toEqual(input.hydrology!.riverPoints);
    const reused = await generateTerrain(settings, undefined, new TerrainCache(store));
    expect(reused.landuse).toEqual(world.landuse);
    expect(reused.stats['v2.cache']).toBe('disk'); expect(bridge.sampleRustTerrain).toHaveBeenCalledTimes(1);
    settings.terrain.forest = { enabled: false };
    const cleared = await generateTerrain(settings, undefined, new TerrainCache(store));
    expect(cleared.stats['v2.cache']).toBe('disk'); expect(bridge.sampleRustTerrain).toHaveBeenCalledTimes(1);
    expect((cleared.terrain as V2TerrainLayer).v2NaturalForest?.every(v => v === 0)).toBe(true);
    expect(cleared.landuse?.areas.some(a => a.kind === 'forest')).toBe(false);
  });
  it('recognises a coherent .2 native recipe with uncompressed sketch/zones and rejects changed native drafts', async () => {
    const settings = defaultSettings(); settings.extent = 2400; settings.runtime!.compute = 'cpu';
    settings.terrain = { resolution: 64, coastMask: 169, sketch: { version: 1, resolution: 8, heights: new Array(64).fill(20) },
      zones: { version: 1, resolution: 8, weights: new Array(64 * 5).fill(0) }, hydrology: { density: .7 } };
    const world = await generateTerrain(settings, undefined, new TerrainCache(new Store()));
    // .2 stored these complete numeric arrays where .3 stores their fingerprints.
    const historical = JSON.parse(terrainCacheKey(settings)); historical[0] = 'mu-v2-bench-terrain-2026-10-28.2';
    historical[10].sketch.heights = settings.terrain.sketch!.heights;
    historical[10].zones.weights = settings.terrain.zones!.weights;
    const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    world.stats['v2.terrainKey'] = canonical(historical);
    const originalKey = world.stats['v2.terrainKey'], snapshot = structuredClone((world.terrain as V2TerrainLayer).v2NativeTerrain);
    expect(retainedTerrainMatchesSettings(world, settings)).toBe(true);
    expect(retainedTerrainMatchesSettings(world, settings)).toBe(true); // Verified memo, still no mutation.
    const loaded = parseProject(serializeProject(settings, world)).world!;
    expect(retainedTerrainMatchesSettings(loaded, settings)).toBe(true);
    expect((loaded.terrain as V2TerrainLayer).v2NativeTerrain).toEqual(snapshot);
    for (const edit of [
      (draft: typeof settings) => { draft.options.seed += '-other'; },
      (draft: typeof settings) => { draft.extent = 4800; },
      (draft: typeof settings) => { draft.terrain!.hydrology!.density = .8; },
      (draft: typeof settings) => { draft.terrain!.sketch!.heights[63] += .001; },
      (draft: typeof settings) => { draft.terrain!.zones!.weights[0] = 1; },
    ]) { const draft = structuredClone(settings); edit(draft); expect(retainedTerrainMatchesSettings(loaded, draft)).toBe(false); }
    expect(world.stats['v2.terrainKey']).toBe(originalKey); expect(loaded.stats['v2.terrainKey']).toBe(originalKey);
  });
});
