import { describe, expect, it } from 'vitest';
import { fingerprintBytes, fingerprintNumbers } from '../src/v2/terrainFingerprint';
import { terrainCacheKey } from '../src/v2/engine';
import { defaultSettings } from '../src/v2/settings';
import { cloneV2WorldForGeneration } from '../src/v2/worldState';
import { applyHydrologyHeight, applyHydrologySurface } from '../../rust/bridge/hydrologySurface';
import type { HydrologyData } from '../../rust/bridge/hydrology';
import type { World } from '../src/gen/types';

const bytes = (value: ArrayBufferView) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
function world(): World {
  const settings = defaultSettings(), n = 8, grid = () => ({ w: n, h: n, cell: 150, data: new Float32Array(n * n).fill(20) });
  return { seed: 'immutable', options: { ...settings.options, importedHeight: { w: n, h: n, elevations: new Float32Array(n * n), rgba: new Uint8Array(0) } }, mapSize: 1200,
    terrain: { height: grid(), slope: grid(), flow: grid(), water: new Uint8Array(n * n), receiver: new Int32Array(n * n).fill(-1), filled: new Float32Array(n * n).fill(20),
      rivers: [{ path: [{ x: 0, y: 0 }, { x: 100, y: 100 }], width: [3, 4], name: 'Original' }], lakes: [], coastline: [], seaLevel: 0, seaFraction: 0, downSide: 'S', seaSide: null },
    landuse: { areas: [], farmsteads: [], reserve: [] }, stats: { retained: 1 },
    debug: { v2RustCities: { main: Object.freeze({ immutableArchive: new Float32Array(1024 * 1024) }) }, v2TownBridges: {} },
    settlements: [{ key: 'main', index: 0, main: true, cls: 'hamlet', population: 80, culture: 'european-organic', center: { x: 600, y: 600 }, archetype: 'plain', radius: 100, extent: [], region: [], detail: 'main' }] };
}
function hydro(n: number): HydrologyData {
  const size = n * n, base = new Float32Array(size).fill(20), surface = base.slice();
  for (let y = 2; y < n - 2; y++) surface[y * n + Math.floor(n / 2)] += 2;
  return { width: 80, resolution: n, baseHeight: base, surfaceHeight: surface, drainageHeight: base.slice(), rawDrainageHeight: base.slice(), basins: new Uint32Array(size).fill(1),
    riverPoints: Float32Array.from([12, 16, 6, 17, 65, 69, 8, 15]), riverOffsets: Uint32Array.from([0, 2]), riverMeta: new Uint32Array(6), incision: 1,
  } as HydrologyData;
}
describe('V2 terrain optimisation invariants', () => {
  it('uses deterministic byte-offset aware 128-bit fingerprints and notices exact scalar edits', () => {
    expect(fingerprintBytes(Uint8Array.from([9, 8, 1, 2, 3, 4, 5]).subarray(2))).toBe(fingerprintBytes(Uint8Array.from([1, 2, 3, 4, 5])));
    expect(fingerprintBytes(Uint8Array.from([1, 2, 3, 4, 5]))).not.toBe(fingerprintBytes(Uint8Array.from([1, 2, 3, 4, 6])));
    expect(fingerprintNumbers([0, .1, 12.345])).toBe(fingerprintNumbers(structuredClone([0, .1, 12.345])));
    expect(fingerprintNumbers([1])).not.toBe(fingerprintNumbers([1.0000000000000002]));
    expect(fingerprintNumbers([0])).not.toBe(fingerprintNumbers([-0]));
    expect(fingerprintNumbers([1, 2])).not.toBe(fingerprintNumbers([2, 1]));
  });
  it('keeps million-cell recipes compact while retaining in-place edits, processing mode and zone identity', () => {
    const settings = defaultSettings();
    settings.terrain = { sketch: { version: 1, resolution: 1024, processing: 'surface', heights: new Array(1024 ** 2).fill(123.456789) },
      zones: { version: 1, resolution: 8, weights: new Array(8 * 8 * 5).fill(0) } };
    const original = terrainCacheKey(settings); expect(original.length).toBeLessThan(5000);
    settings.terrain.sketch!.heights[900000] += .000000001; expect(terrainCacheKey(settings)).not.toBe(original);
    settings.terrain.sketch!.heights[900000] = 123.456789;
    expect(terrainCacheKey(settings)).toBe(original);
    settings.terrain.zones!.weights[0] = 255; expect(terrainCacheKey(settings)).not.toBe(original);
    settings.terrain.zones!.weights[0] = 0; settings.terrain.sketch!.processing = 'erosion'; expect(terrainCacheKey(settings)).not.toBe(original);
    settings.runtime!.backend = 'typescript'; const classic = terrainCacheKey(settings); delete settings.terrain;
    expect(terrainCacheKey(settings)).toBe(classic);
  });
  it('shares immutable physical data and archives while detaching mutable labels, settings, town maps and centres', () => {
    const source = world(), copy = cloneV2WorldForGeneration(source);
    expect(copy.terrain.height).toBe(source.terrain.height); expect(copy.terrain.water).toBe(source.terrain.water);
    expect(copy.options.importedHeight).toBe(source.options.importedHeight); expect(copy.landuse).toBe(source.landuse);
    const sourceCities = source.debug!.v2RustCities as Record<string, unknown>, cities = copy.debug!.v2RustCities as Record<string, unknown>;
    expect(cities).not.toBe(sourceCities); expect(cities.main).toBe(sourceCities.main);
    copy.terrain.rivers[0].name = 'New'; copy.options.population = 321; copy.settlements![0].center.x = 700; cities.secondary = {};
    copy.stats.retained = 2; expect(source.stats.retained).toBe(1);
    expect(source.terrain.rivers[0].name).toBe('Original'); expect(source.options.population).not.toBe(321);
    expect(source.settlements![0].center.x).toBe(600); expect(sourceCities.secondary).toBeUndefined();
  });
  it('produces byte-identical hydrology heights and extrema without computing discarded normals', () => {
    for (const n of [8, 32, 64]) {
      const water = hydro(n), height = Float32Array.from({ length: n * n }, (_, i) => 20 + Math.sin(i * .2));
      const full = { x: 0, y: 0, width: 80, resolution: n, height: height.slice(), normalX: new Float32Array(n * n), normalY: new Float32Array(n * n), normalZ: new Float32Array(n * n).fill(1), minHeight: 19, maxHeight: 21 };
      const slim = { x: 0, y: 0, width: 80, resolution: n, height: height.slice(), minHeight: 19, maxHeight: 21 };
      applyHydrologySurface(full, water); applyHydrologyHeight(slim, water);
      expect(bytes(slim.height)).toEqual(bytes(full.height)); expect(slim.minHeight).toBe(full.minHeight); expect(slim.maxHeight).toBe(full.maxHeight);
      expect(full.normalX.some(v => v !== 0)).toBe(true);
    }
  });
});
