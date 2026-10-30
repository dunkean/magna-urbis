import { validateProceduralRecipe } from '../../../rust/bridge/terrainGenerationRecipe';
/** V2 recipes use the bench's names and units. This module never loads WASM. */
import type { TerrainSettings, NeuralTuning, NeuralClimate } from '../../../rust/bridge/terrain';
import type { HydrologySettings } from '../../../rust/bridge/hydrology';
import type { ForestSettings } from '../../../rust/bridge/terrainForest';
import { CLIMATE_ZONES, CLIMATE_ZONE_VALUES, CLIMATE_ZONE_BASE, LEGACY_CLIMATE_ZONES, climateZoneOf } from '../../../rust/bridge/terrainClimate';
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { DEFAULT_FRACTAL_DETAIL } from '../../../rust/bridge/terrainAdjust';
import type { FractalDetail } from '../../../rust/bridge/terrainAdjust';
import type { ClimateValues } from '../../../rust/bridge/terrainClimate';
import { parseTerrainSketch } from '../../../rust/bridge/terrainSketch';
import { parseTerrainZones } from '../../../rust/bridge/terrainZones';
import type { V2Settings } from './contracts';

export type V2TerrainSettings = Partial<Omit<TerrainSettings,
  'seed' | 'width' | 'source' | 'climate' | 'neuralAssets' | 'neuralServer' | 'hydrology' | 'neuralTuning' | 'climateValues' | 'detailNoise'>> & {
  hydrology?: Partial<HydrologySettings>;
  neuralTuning?: Partial<NeuralTuning>;
  forest?: Partial<ForestSettings>;
  /** A climate zone; legacy preset names (oceanic, arid, cold) are accepted on load and migrated. */
  climate?: ClimateZone | NeuralClimate;
  climateValues?: Partial<ClimateValues>;
  detailNoise?: Partial<FractalDetail>;
};
export const TERRAIN_RELIEFS = ['flat', 'hills', 'valley', 'canyon', 'mountains', 'mixed', 'plateau', 'high-mountains', 'volcano', 'caldera', 'cavern'] as const;
export const TERRAIN_ENVIRONMENTS = ['flat', 'hills', 'mixed', 'mountains', 'high-mountains'] as const;
export const TERRAIN_COAST_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export const TERRAIN_CLIMATES = CLIMATE_ZONES;
const BIOME_CLIMATE_ZONE: Record<string, ClimateZone> = { desert: 'desert', tropical: 'tropical', tundra: 'arctic', steppe: 'steppe', forest: 'continental' };
/** Rewrite a former preset name (oceanic, arid, cold) to its closest zone. */
export function migrateTerrainClimate(terrain: { climate?: unknown } | undefined): void {
  const zone = terrain && typeof terrain.climate === 'string' ? LEGACY_CLIMATE_ZONES[terrain.climate] : undefined;
  if (terrain && zone) terrain.climate = zone;
}
export const TERRAIN_EXTENT_MIN = 500, TERRAIN_EXTENT_MAX = 100000;
export const DEFAULT_NEURAL_TUNING: NeuralTuning = {
  landScale: 1, steps: 4, noiseTemperature: .5, noiseTemperatureStd: .5, noisePrecipitation: .5, noisePrecipitationCv: .5,
  reliefMode: 'auto', reliefScale: 1, reliefFixed: 50, histogram: [0, 0, 0, 0, 0], detail: 1,
};
/** Mirrored from hydrology.ts; type checked here without importing the WASM bridge. */
export const DEFAULT_HYDROLOGY: HydrologySettings = {
  enabled: true, main: 'auto', density: 1, wetness: 1, coastalStreams: 1, lakes: 'auto', meanders: 'natural', meanderIntensity: 1,
  estuary: 'auto', widthScale: 1, incision: 1, minLakeArea: 100000, minLakeDepth: 1,
  lakeAbundance: .5, lakeCoverage: .05, maxLakeArea: .02, depressionPolicy: 'auto', maxBreachDepth: 12, maxBreachLength: 1000,
  resolution: 512, compute: 'auto', engine: 'rust', erosionEnabled: true, showErosion: true,
  condMode: 'both', condStrength: 2, condDepth: 30, condLength: 3000, riverArea: 0, lakeDepth: 1, lakeArea: 10, riverMode: 'vector',
  flatSlope: 1, sinuosity: 1.8, vectorWidth: 3, vectorResolution: 1024, balance: true, braiding: 1,
  anabranching: true, terrainInfluence: true, avulsions: true, confluence: 'climate', deltas: true,
};
export const DEFAULT_FOREST_SETTINGS: ForestSettings = { enabled: true, density: 1, clearings: .45 };
export function defaultTerrainSettings(): V2TerrainSettings {
  return { motifSize: 3000, environment: 'mixed', islandMode: 'island', mountainMix: .5, erosion: 1, resolution: 512,
    fidelity: .05, neuralTuning: { ...DEFAULT_NEURAL_TUNING, histogram: [...DEFAULT_NEURAL_TUNING.histogram] },
    neuralFit: 'crop', neuralSlopes: true, refine: true, detailNoise: { ...DEFAULT_FRACTAL_DETAIL }, erosionTuning: {},
    hydrology: { ...DEFAULT_HYDROLOGY }, forest: { ...DEFAULT_FOREST_SETTINGS } };
}
export type EffectiveTerrainSettings = TerrainSettings & { forest: ForestSettings };
/** Defaults merge nested knobs. Runtime selection owns source, endpoints and auto compute. */
export function effectiveTerrainSettings(settings: V2Settings, width: number): EffectiveTerrainSettings {
  const t = settings.terrain ?? {}, runtime = settings.runtime;
  const zone: ClimateZone = climateZoneOf(t.climate) ?? BIOME_CLIMATE_ZONE[String(settings.options.biome)] ?? 'temperate';
  const masks = { none: 0, N: 1, E: 4, S: 16, W: 64, random: 255 };
  return { ...defaultTerrainSettings(), ...t,
    // Climate-driven landform shaping is on unless the recipe turns it off.
    procedural: { biome: true, ...t.procedural },
    ...(runtime?.source === 'procedural-phasor' || t.procedural?.preset==='compact' || t.procedural?.enabled?.phasor ? { phasor: { quality: 'balanced' as const, intensity: 1, ...t.phasor } } : {}),
    ...(!['procedural','procedural-phasor'].includes(runtime?.source??'procedural') || ['plateau','volcano','caldera','cavern'].includes(t.relief??settings.options.relief) ? {procedural:undefined} : {}),
    seed: settings.options.seed, width, source: runtime?.source ?? 'procedural',
    motifSize: t.motifSize ?? 3000, relief: t.relief ?? settings.options.relief, mountainMix: t.mountainMix ?? .5,
    coastMask: t.coastMask ?? masks[settings.options.coast], erosion: t.erosion ?? runtime?.erosion ?? 1,
    resolution: t.resolution ?? runtime?.resolution ?? 512,
    climateZone: zone, climate: CLIMATE_ZONE_BASE[zone], climateValues: { ...CLIMATE_ZONE_VALUES[zone], ...t.climateValues },
    detailNoise: { ...DEFAULT_FRACTAL_DETAIL, ...t.detailNoise },
    neuralTuning: { ...DEFAULT_NEURAL_TUNING, ...t.neuralTuning, histogram: [...(t.neuralTuning?.histogram ?? DEFAULT_NEURAL_TUNING.histogram)] },
    hydrology: { ...DEFAULT_HYDROLOGY, main: settings.options.river, lakes: (settings.options as typeof settings.options & { lakes?: HydrologySettings['lakes'] }).lakes ?? 'auto', ...t.hydrology },
    forest: { ...DEFAULT_FOREST_SETTINGS, ...t.forest },
    // Browser and Rust neural servers load one pinned profile; only Python honours checkpoint IDs.
    coarseModel: runtime?.source === 'neural-python' ? t.coarseModel : undefined,
    baseModel: runtime?.source === 'neural-python' ? t.baseModel : undefined,
    decoderModel: runtime?.source === 'neural-python' ? t.decoderModel : undefined,
  } as EffectiveTerrainSettings;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function numeric(value: unknown, name: string, min: number, max: number, integer = false): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)))
    throw new Error(`terrain.${name}: expected ${integer ? 'an integer' : 'a number'} in ${min}–${max}.`);
}
function enumeration(value: unknown, values: readonly unknown[], name: string): void {
  if (value !== undefined && !values.includes(value)) throw new Error(`terrain.${name}: unknown value.`);
}
/** Reject typos and out-of-range recipes instead of silently dropping customisation. */
export function validateTerrainSettings(value: unknown): asserts value is V2TerrainSettings {
  if (!record(value)) throw new Error('Invalid terrain settings.');
  const allowed = ['zones', 'motifSize', 'relief', 'environment', 'coastMask', 'islandMode', 'erosion', 'mountainMix', 'resolution', 'compute', 'generationCompute', 'hydrology', 'climate', 'climateZone', 'fidelity', 'sketch', 'climateValues', 'neuralTuning', 'coarseModel', 'baseModel', 'decoderModel', 'neuralFit', 'neuralSlopes', 'refine', 'detailNoise', 'erosionTuning', 'forest', 'phasor', 'procedural'];
  if(value.procedural!==undefined)validateProceduralRecipe(value.procedural as import('../../../rust/bridge/terrainGenerationRecipe').ProceduralRecipe);
  if (value.phasor !== undefined) {
    if (!record(value.phasor) || Object.keys(value.phasor).some(key => !['quality', 'intensity'].includes(key))) throw new Error('Invalid compact Phasor settings.');
    enumeration(value.phasor.quality, ['fast', 'balanced', 'detailed'], 'phasor.quality');
    numeric(value.phasor.intensity, 'phasor.intensity', 0, 2);
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown terrain parameter: ${key}.`);
  enumeration(value.relief, TERRAIN_RELIEFS, 'relief'); enumeration(value.environment, TERRAIN_ENVIRONMENTS, 'environment');
  enumeration(value.islandMode, ['island', 'archipelago', 'peninsula', 'random'], 'islandMode'); enumeration(value.climate, [...CLIMATE_ZONES, ...Object.keys(LEGACY_CLIMATE_ZONES)], 'climate');
  enumeration(value.compute, ['wasm', 'gpu-f32'], 'compute'); enumeration(value.generationCompute, ['cpu', 'gpu', 'gpu-all', 'gpu-erosion', 'native'], 'generationCompute');
  enumeration(value.neuralFit, ['crop', 'scale'], 'neuralFit');
  for (const key of ['neuralSlopes', 'refine']) enumeration(value[key], [true, false], key);
  numeric(value.motifSize, 'motifSize', 250, 50000); numeric(value.coastMask, 'coastMask', 0, 255, true);
  numeric(value.erosion, 'erosion', 0, 2); numeric(value.mountainMix, 'mountainMix', 0, 1); numeric(value.resolution, 'resolution', 64, 2048, true);
  numeric(value.fidelity, 'fidelity', .001, 2);
  for (const key of ['coarseModel', 'baseModel', 'decoderModel']) if (value[key] !== undefined && (typeof value[key] !== 'string' || (value[key] as string).length > 300)) throw new Error(`Invalid terrain.${key}.`);
  const ranges: Record<string, Record<string, readonly [number, number]>> = {
    erosionTuning: { iterations: [1, 200], incision: [0, 10], incisionSlope: [.01, 2], fill: [0, 10], carve: [0, 1], finalCarve: [0, 1], talus: [.01, 3], thermal: [0, 10], diffusion: [0, 3], detail: [0, .5], warp: [0, 4], surfaceIterations: [0, 100], surfaceIncision: [0, 10], surfaceCarve: [0, 1], surfaceRouted: [0, 1], surfaceThermal: [0, 10], surfaceDiffusion: [0, 10] },
    climateValues: { temperature: [-30, 40], temperatureStd: [0, 3000], precipitation: [0, 6000], precipitationCv: [0, 200] },
    detailNoise: { amplitude: [0, 2], hurst: [0, 1.5], lacunarity: [1.2, 4], octaves: [1, 12], start: [.25, 8], slope: [0, 2], flat: [0, .5], shore: [0, 50] },
    neuralTuning: { landScale: [0, 5], steps: [1, 32], noiseTemperature: [.001, 10], noiseTemperatureStd: [.001, 10], noisePrecipitation: [.001, 10], noisePrecipitationCv: [.001, 10], reliefScale: [0, 5], reliefFixed: [0, 5000], detail: [0, 5] },
    forest: { density: [0, 2], clearings: [0, 1] },
  };
  for (const [group, fields] of Object.entries(ranges)) if (value[group] !== undefined) {
    const object = value[group]; if (!record(object)) throw new Error(`Invalid terrain.${group}.`);
    for (const [key, entry] of Object.entries(object)) {
      if (fields[key]) numeric(entry, `${group}.${key}`, ...fields[key], ['steps', 'iterations', 'surfaceIterations', 'surfaceRouted', 'octaves'].includes(key));
      else if (group === 'neuralTuning' && key === 'reliefMode') enumeration(entry, ['auto', 'scale', 'fixed'], `${group}.${key}`);
      else if (group === 'neuralTuning' && key === 'histogram') {
        if (!Array.isArray(entry) || entry.length !== 5) throw new Error('Neural histogram needs five values.');
        entry.forEach(v => numeric(v, 'neuralTuning.histogram', -Number.MAX_VALUE, Number.MAX_VALUE));
      } else if (group === 'forest' && key === 'enabled') enumeration(entry, [true, false], `${group}.${key}`);
      else throw new Error(`Unknown terrain parameter: ${group}.${key}.`);
    }
  }
  if (value.hydrology !== undefined) {
    if (!record(value.hydrology)) throw new Error('Invalid hydrology settings.');
    const enums: Record<string, readonly unknown[]> = { main: ['auto', 'none', 'stream', 'river', 'major'], lakes: ['auto', 'none', 'some'], meanders: ['natural', 'reduced', 'none'], estuary: ['auto', 'simple', 'widening', 'funnel', 'tidal'], depressionPolicy: ['auto', 'fill'], resolution: [256, 512, 1024], compute: ['auto', 'cpu', 'gpu'], engine: ['vector', 'rust'], condMode: ['none', 'erosion', 'breach', 'both'], riverMode: ['vector', 'grid'], vectorResolution: [512, 1024], confluence: ['climate', 'drainage'] };
    const limits: Record<string, readonly [number, number]> = { density: [0, 2], coastalStreams: [0, 2], wetness: [.1, 2], lakeAbundance: [0, 2], lakeCoverage: [0, 1], maxLakeArea: [0, 1], minLakeArea: [0, 1e8], minLakeDepth: [0, 100], meanderIntensity: [0, 2], widthScale: [.5, 2], incision: [0, 2], maxBreachDepth: [0, 200], maxBreachLength: [0, 100000], condStrength: [0, 3], condDepth: [0, 500], condLength: [0, 100000], riverArea: [0, 5000], lakeDepth: [0, 500], lakeArea: [0, 100000], flatSlope: [0, 50], sinuosity: [1, 3.5], vectorWidth: [.1, 10], braiding: [0, 2] };
    for (const [key, entry] of Object.entries(value.hydrology)) {
      if (!(key in DEFAULT_HYDROLOGY)) throw new Error(`Unknown hydrology parameter: ${key}.`);
      if (enums[key]) enumeration(entry, enums[key], `hydrology.${key}`);
      else if (typeof DEFAULT_HYDROLOGY[key as keyof HydrologySettings] === 'boolean') enumeration(entry, [true, false], `hydrology.${key}`);
      else if (limits[key]) numeric(entry, `hydrology.${key}`, ...limits[key]);
      else throw new Error(`Missing bounds for hydrology parameter: ${key}.`);
    }
  }
  if (value.sketch !== undefined) parseTerrainSketch(value.sketch, false);
  if (value.zones !== undefined) parseTerrainZones(value.zones, false);
}
