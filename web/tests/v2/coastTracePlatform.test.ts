import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateEngineHeight } from '../../src/v2/platform';
import { effectiveTerrainSettings, validateTerrainSettings } from '../../src/v2/terrainSettings';
import { defaultSettings } from '../../src/v2/settings';
import { coastTraceMode, lineFromStroke } from '../../src/v2/coastTrace';

const bridge = vi.hoisted(() => ({ sample: vi.fn() }));
vi.mock('../../../rust/bridge/terrain', () => ({ sampleRustTerrain: bridge.sample }));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('coast trace execution boundary', () => {
  it('keeps normalized traces valid through source, relief, size, resolution, seed and compass changes', async () => {
    const s = defaultSettings();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    const trace = { version: 1 as const, lines: [lineFromStroke([0.25, 0.1, 0.25, 0.9])!] };
    s.terrain = { coastTrace: trace, relief: 'hills', resolution: 64, hydrology: { enabled: false } };
    bridge.sample.mockImplementation(async ({ region, settings }: { region: { resolution: number }; settings: { source?: string } }) => ({
      resolution: region.resolution,
      height: new Float32Array(region.resolution ** 2).fill(12),
      maxHeight: 12,
      minHeight: 12,
      generationMs: 1,
      backend: 'gpu-f32',
      generationBackend: settings.source === 'procedural-phasor' ? 'compact-gpu-f32' : 'cpu',
    }));
    for (const source of ['procedural', 'procedural-phasor', 'neural-wasm', 'neural-python', 'neural'] as const) {
      s.runtime!.source = source;
      for (const relief of ['flat', 'hills', 'mountains'] as const)
        for (const size of [2400, 12000]) {
          s.terrain.relief = relief;
          s.terrain.motifSize = size / 2;
          s.terrain.resolution = size === 2400 ? 64 : 128;
          s.terrain.coastMask = size === 2400 ? 0 : 4;
          s.options.seed = `trace-${size}`;
          const { seed, width, source: engineSource, forest, neuralAssets, neuralServer, reliefClimate, ...terrain } = effectiveTerrainSettings(s, size);
          expect(terrain.islandMode).toBe(coastTraceMode(trace));
          const { sourceNativeResolution, generalSeed, ...recipe } = terrain;
          expect(() => validateTerrainSettings(recipe, true)).not.toThrow();
          await generateEngineHeight({ seed, width, source: engineSource!, terrain, relief, compute: 'gpu', neuralAssets: 'https://example.invalid/neural/' });
          expect(bridge.sample.mock.lastCall![0].settings.islandMode).toBe(coastTraceMode(trace));
          expect(s.terrain.coastTrace).toBe(trace);
        }
    }
    s.runtime!.source = 'procedural';
    s.terrain.zones = { version: 1, resolution: 8, weights: Array(8 * 8 * 5).fill(0) };
    const { seed, width, source, forest, neuralAssets, neuralServer, reliefClimate, ...symbolic } = effectiveTerrainSettings(s, 6000);
    await generateEngineHeight({ seed, width, source: source!, terrain: symbolic, relief: 'hills', compute: 'cpu' });
    // Zoned relief runs on the 'hills' carrier, as in effectiveTerrainSettings (platform.ts now matches it).
    expect(bridge.sample.mock.lastCall![0].settings).toMatchObject({ relief: 'hills', islandMode: coastTraceMode(trace) });
    delete s.terrain.zones;
    for (const unsupported of ['heightmap', 'image', 'decor', 'classic', 'underdark', 'cavern'] as const) {
      const copy = structuredClone(s);
      copy.runtime!.source = 'procedural';
      if (unsupported === 'heightmap') copy.terrain!.sketch = { version: 1, resolution: 8, heights: Array(64).fill(12), processing: 'surface' };
      if (unsupported === 'image') copy.options.importedHeight = { w: 8, h: 8, rgba: new Uint8ClampedArray(8 * 8 * 4) };
      if (unsupported === 'decor') copy.decor = {} as NonNullable<typeof copy.decor>;
      if (unsupported === 'classic') copy.runtime!.backend = 'typescript';
      if (unsupported === 'underdark') copy.options.biome = 'underdark';
      if (unsupported === 'cavern') copy.terrain!.relief = 'cavern' as never;
      const { seed, width, source, forest, neuralAssets, neuralServer, reliefClimate, ...terrain } = effectiveTerrainSettings(copy, 6000);
      expect(terrain.islandMode).not.toMatch(/^traced:/);
      const { sourceNativeResolution, generalSeed, ...recipe } = terrain;
      expect(() => validateTerrainSettings(recipe, true)).not.toThrow();
      expect(copy.terrain!.coastTrace).toEqual(trace);
    }
  });
  it('preserves traced settings through platform validation and the bridge merge', async () => {
    const s = defaultSettings();
    s.terrain = { resolution: 64, coastMask: 0, coastTrace: { version: 1, lines: [lineFromStroke([0.25, 0.1, 0.25, 0.9])!] }, hydrology: { enabled: false } };
    const { seed, width, source, forest, neuralAssets, neuralServer, reliefClimate, ...terrain } = effectiveTerrainSettings(s, 2400);
    bridge.sample.mockResolvedValue({ resolution: 64, height: new Float32Array(64 ** 2).fill(12), maxHeight: 12, minHeight: 12, generationMs: 1, backend: 'wasm', generationBackend: 'cpu' });
    await generateEngineHeight({ seed, width, source: source!, terrain, relief: 'hills', coast: 'none', compute: 'cpu' });
    const settings = bridge.sample.mock.calls[0][0].settings;
    expect(settings.coastMask).toBe(255);
    expect(settings.islandMode).toBe(coastTraceMode(s.terrain.coastTrace!));
    expect(settings).not.toHaveProperty('coastTrace');
  });
  it('rejects encoded modes in public recipes and accepts them at neural execution boundaries', async () => {
    const mode = coastTraceMode({ version: 1, lines: [lineFromStroke([0.25, 0.1, 0.25, 0.9])!] })!;
    expect(() => validateTerrainSettings({ islandMode: mode })).toThrow(/islandMode/);
    expect(() => validateTerrainSettings({ islandMode: mode }, true)).not.toThrow();
    expect(() => validateTerrainSettings({ islandMode: mode.slice(0, -2) }, true)).toThrow(/islandMode/);
    bridge.sample.mockResolvedValue({ resolution: 64, height: new Float32Array(64 ** 2).fill(12), maxHeight: 12, minHeight: 12, generationMs: 1, backend: 'gpu-f32', generationBackend: 'cpu' });
    await generateEngineHeight({ seed: 'trace', width: 2400, source: 'neural-wasm', neuralAssets: 'https://example.invalid/neural/', compute: 'gpu', relief: 'hills', terrain: { resolution: 64, islandMode: mode as `traced:${string}` } });
    expect(bridge.sample.mock.calls[0][0].settings.islandMode).toBe(mode);
  });
});
