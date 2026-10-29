import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { generateTerrain } from '../src/v2/engine';
import { TerrainCache, type TerrainStore } from '../src/v2/cache';
import type { TerrainLayer } from '../src/gen/types';

const platform = vi.hoisted(() => ({ generateEngineHeight: vi.fn() }));
vi.mock('../src/v2/platform', () => platform);
class Store implements TerrainStore {
  async get(): Promise<TerrainLayer | undefined> { return undefined; }
  async put(): Promise<void> {}
  async clear(): Promise<void> {}
}
function output() {
  const height = new Float32Array(64).fill(20);
  return { importedHeight: { w: 8, h: 8, rgba: new Uint8Array(0), elevations: new Float32Array(64).fill(20) },
    heightScale: 20, importSeaLevel: 0, backend: 'rust-webgpu', generationBackend: 'gpu-erosion',
    terrain: { x: 0, y: 0, width: 1200, resolution: 8, minHeight: 20, maxHeight: 20, globalMinHeight: 20, globalMaxHeight: 20,
      motifSize: 3000, height, caveMask: new Uint8Array(0), normalX: new Float32Array(64), normalY: new Float32Array(64), normalZ: new Float32Array(64).fill(1), generationMs: 1 },
    stats: { backend: 'rust-webgpu', generationBackend: 'gpu-erosion' } };
}
function setup() {
  const settings = defaultSettings();
  settings.extent = 1200; settings.settlementCount = 1;
  settings.options = { ...settings.options, population: 80, river: 'none', coast: 'none', relief: 'flat' };
  settings.runtime = { backend: 'rust', source: 'procedural', compute: 'gpu', resolution: 64 };
  return { settings, cache: new TerrainCache(new Store()) };
}
beforeEach(() => platform.generateEngineHeight.mockReset().mockResolvedValue(output()));
afterEach(() => vi.unstubAllGlobals());

describe('V2 engine hardware orchestration (mocked hardware, retained native water)', () => {
  it('lets local neural GPU services select their device without probing the browser driver',async()=>{
    const requestAdapter=vi.fn(()=>new Promise(()=>{}));vi.stubGlobal('navigator',{gpu:{requestAdapter}});
    const {settings,cache}=setup();settings.generation='neural';settings.runtime!.compute='auto';settings.runtime!.source='neural-python';
    await generateTerrain(settings,undefined,cache,'https://example.test/v2/');expect(requestAdapter).not.toHaveBeenCalled();expect(platform.generateEngineHeight.mock.calls[0][0].compute).toBe('gpu');
  });
  it('uses CPU for automatic procedural work on a software GPU, while retaining a forced GPU choice',async()=>{
    vi.stubGlobal('navigator',{gpu:{requestAdapter:vi.fn().mockResolvedValue({info:{isFallbackAdapter:true}})}});
    const {settings,cache}=setup();settings.runtime!.compute='auto';const messages:string[]=[];
    await generateTerrain(settings,event=>messages.push(event.label),cache);
    expect(platform.generateEngineHeight.mock.calls[0][0].compute).toBe('cpu');expect(messages).toContain('WebGPU logiciel détecté · sélection du CPU pour le procédural');
    settings.options.seed='forced-gpu';settings.runtime!.compute='gpu';await generateTerrain(settings,undefined,cache);expect(platform.generateEngineHeight.mock.calls[1][0].compute).toBe('gpu');
    settings.options.seed='forced-gpu-terrain';settings.runtime!.compute='auto';settings.terrain={...settings.terrain,generationCompute:'gpu-erosion'};messages.length=0;
    await generateTerrain(settings,event=>messages.push(event.label),cache);expect(platform.generateEngineHeight.mock.calls[2][0].compute).toBe('gpu');expect(messages).not.toContain('WebGPU logiciel détecté · sélection du CPU pour le procédural');
  });
  it('runs the requested Rust adapter once, retains provenance, and reuses terrain from cache', async () => {
    const { settings, cache } = setup();
    const terrain = await generateTerrain(settings, undefined, cache);
    expect(platform.generateEngineHeight).toHaveBeenCalledTimes(1);
    expect(platform.generateEngineHeight.mock.calls[0][0]).toMatchObject({ compute: 'gpu', source: 'procedural', width: 1200, resolution: 64 });
    expect(terrain.stats.backend).toBe('rust-webgpu');
    expect(terrain.stats.generationBackend).toBe('gpu-erosion');
    expect(terrain.terrain.height.data[0]).toBe(20);
    const reused = await generateTerrain(settings, undefined, cache);
    expect(reused.stats['v2.cache']).toBe('memory');
    expect(reused.stats.backend).toBe('rust-webgpu');
    expect(platform.generateEngineHeight).toHaveBeenCalledTimes(1);
  });
  it('falls back from automatic GPU to procedural CPU and propagates forced GPU failures', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue({}) } });
    const { settings, cache } = setup(); settings.runtime!.compute = 'auto';
    platform.generateEngineHeight.mockRejectedValueOnce(new Error('GPU perdu'));
    await generateTerrain(settings, undefined, cache);
    expect(platform.generateEngineHeight.mock.calls.map(call => call[0].compute)).toEqual(['gpu', 'cpu']);
    settings.runtime!.compute = 'gpu';
    platform.generateEngineHeight.mockRejectedValueOnce(new Error('GPU perdu'));
    await expect(generateTerrain(settings, undefined, new TerrainCache(new Store()))).rejects.toThrow('GPU perdu');
  });
  it('never silently replaces a failed neural generation with procedural terrain', async () => {
    const { settings, cache } = setup();
    settings.generation = 'neural'; settings.runtime!.source = 'neural-wasm';
    settings.runtime!.compute = 'auto';
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue({}) } });
    platform.generateEngineHeight.mockRejectedValueOnce(new Error('Poids du modèle absents'));
    await expect(generateTerrain(settings, undefined, cache, 'https://example.test/magna-urbis/v2/index.html')).rejects.toThrow('Poids du modèle absents');
    expect(platform.generateEngineHeight).toHaveBeenCalledTimes(1);
    expect(platform.generateEngineHeight.mock.calls[0][0].neuralAssets).toBe('https://example.test/magna-urbis/v2/neural/');
    expect(settings.runtime!.neuralAssets).toBeUndefined();
  });
});
