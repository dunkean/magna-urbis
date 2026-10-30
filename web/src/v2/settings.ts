import { makeOptions, SIZE_SHORTCUT } from '../gen/options';
import type { V2Settings } from './contracts';
import { TERRAIN_EXTENT_MIN, TERRAIN_EXTENT_MAX } from './terrainSettings';

export function defaultSettings(): V2Settings {
  return { options: makeOptions({ seed: 'magna-urbis-v2', population: 2500, biome: 'temperate', relief: 'valley', coast: 'S' }),
    extent: 6000, settlementCount: 4, local: {}, generation: 'procedural',
    // Explicit defaults belong to new recipes; absent fields in saved recipes keep their historical defaults.
    terrain: { motifSize: 10000, hydrology: { engine: 'vector' } },
    runtime: { backend: 'rust', compute: 'auto', source: 'procedural' } };
}

/** Preserve the optional automatic countryside recommendation used by historical recipes. */
export function adaptedExtent(settings: V2Settings): number {
  if (settings.extent !== 'auto') return Math.round(settings.extent);
  if (settings.options.mapSize !== undefined) return Math.round(settings.options.mapSize);
  // Existing finite neural models produce a 40 km window (rust/bridge/terrain.ts: NEURAL_EXTENT).
  // Keep this pure setting module independent from the WASM/GPU implementation.
  if (settings.generation === 'neural') return 40000;
  const population = settings.options.population || SIZE_SHORTCUT[settings.options.size];
  const main = 1400 + Math.sqrt(population) * 26 * Math.max(.7, settings.options.sprawl ?? 1);
  const count = settings.settlementCount || 4;
  return Math.min(TERRAIN_EXTENT_MAX, Math.max(TERRAIN_EXTENT_MIN, 2400, Math.ceil((main + Math.sqrt(count - 1) * 1800) / 200) * 200));
}
