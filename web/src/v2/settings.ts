import { makeOptions } from '../gen/options';
import type { V2Settings } from './contracts';
import { TERRAIN_EXTENT_MIN, TERRAIN_EXTENT_MAX } from './terrainSettings';
import { presetComposition } from '../render/composition';

export function defaultSettings(): V2Settings {
  return { options: makeOptions({ seed: 'magna-urbis', population: 2500, biome: 'temperate', relief: 'hills', coast: 'S' }),
    extent: 6000, settlementCount: 0, local: {}, generation: 'procedural',
    // Explicit defaults belong to new recipes; absent fields in saved recipes keep their historical defaults.
    terrain: { motifSize: 10000, hydrology: { engine: 'vector' } },
    appearance: { style: 'parchment', composition: presetComposition('satellite') },
    runtime: { backend: 'rust', compute: 'auto', source: 'procedural' } };
}

/** Preserve the optional automatic countryside recommendation used by historical recipes. */
export function adaptedExtent(settings: V2Settings): number {
  if (settings.extent !== 'auto') return Math.round(settings.extent);
  if (settings.options.mapSize !== undefined) return Math.round(settings.options.mapSize);
  // Automatic size recommends 40 km; conventional neural generation also accepts explicit extents.
  if (settings.generation === 'neural') return 40000;
  return Math.min(TERRAIN_EXTENT_MAX, Math.max(TERRAIN_EXTENT_MIN, 40000));
}
