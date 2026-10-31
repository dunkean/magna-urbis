import { generationStageActive, isCompactProcedural, posteriorSettings, windSettings, type GenerationStage } from './terrainGenerationRecipe';
import type { TerrainSettings } from './terrain';

export const CORE_STAGES = ['initialize', 'regional', 'regionalFinish', 'reconstruct', 'amplitude', 'ridged', 'surface', 'normalize'] as const;
export const COAST_POSITIONS = ['initialize', 'regionalFinish', 'amplitude', 'ridged', 'surface', 'normalize'] as const;
export type CoastPosition = typeof COAST_POSITIONS[number];
export function coreOperations(s: TerrainSettings): GenerationStage[] {
  const result: GenerationStage[] = [...CORE_STAGES];
  result.splice(result.indexOf(s.procedural?.coastAfter ?? 'initialize') + 1, 0, 'coastCut');
  return result;
}
export function stableKey(value: unknown): string {
  return JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
}
/** Computational dependencies, independent of control ownership in the UI.
 * Surface settings and wind never expire regional erosion. */
export function proceduralSignatures(s: TerrainSettings): Map<GenerationStage, string> {
  const r = s.procedural ?? {}, t = { ...s.erosionTuning, ...r.erosionTuning };
  const pick = (...names: (keyof typeof t)[]) => names.map(k => t[k] ?? null);
  const climate = [s.climate, s.climateZone, s.climateValues];
  const own: Partial<Record<GenerationStage, unknown>> = {
    initialize: [s.seed, s.width, s.source, s.relief, s.environment, s.motifSize, s.mountainMix, s.erosion,
      isCompactProcedural(s), isCompactProcedural(s) ? s.phasor?.quality ?? 'balanced' : null,
      r.regionalN, r.noiseScale, r.crest, r.biome && climate, s.generationCompute, s.compute],
    regional: [r.uplift, r.regionalThermal, r.regionalDiffusion, pick('iterations', 'incision', 'incisionSlope', 'fill', 'carve', 'talus', 'thermal', 'diffusion')],
    regionalFinish: [r.regionalThermal, r.regionalDiffusion, pick('finalCarve', 'thermal', 'talus', 'fill')],
    reconstruct: [r.reconstruction, pick('warp')], amplitude: [],
    ridged: [pick('detail')],
    surface: [r.surfaceN, pick('talus', 'surfaceIterations', 'surfaceIncision', 'surfaceCarve', 'surfaceRouted', 'surfaceThermal', 'surfaceDiffusion')],
    normalize: [], phasor: [s.phasor, climate], posterior: posteriorSettings(s), wind: windSettings(s),
    coastCut: [s.coastMask ?? 0, s.islandMode ?? 'island', r.coastAfter ?? 'initialize'],
    coasts: [s.coastMask ?? 0, s.islandMode ?? 'island', r.surfaceN, r.coastIterations, r.coastIncision, r.coastThermal, r.coastDiffusion,
      pick('surfaceIncision', 'surfaceThermal', 'surfaceDiffusion', 'surfaceCarve', 'talus')],
    sampling: [s.resolution, s.refine, s.detailNoise], hydrology: [s.hydrology, climate],
  };
  const keys = new Map<GenerationStage, string>(); const prefix: unknown[] = [];
  for (const stage of [...coreOperations(s), 'phasor', 'posterior', 'wind', 'coasts', 'sampling', 'hydrology'] as GenerationStage[]) {
    const active = generationStageActive(s, stage);
    prefix.push([stage, active, active ? own[stage] : null]);
    keys.set(stage, stableKey(prefix));
  }
  keys.set('grids', stableKey([s.seed, s.width, s.procedural?.regionalN, s.resolution]));
  return keys;
}

/** One active recipe's fields, isolated at both boundaries. */
export class TerrainFieldCheckpoints {
  private fields = new Map<GenerationStage, { key: string; height: Float32Array }>();
  get(stage: GenerationStage, key: string): Float32Array | undefined {
    const saved = this.fields.get(stage); return saved?.key === key ? saved.height.slice() : undefined;
  }
  put(stage: GenerationStage, key: string, height: Float32Array): void { this.fields.set(stage, { key, height: height.slice() }); }
  clear(): void { this.fields.clear(); }
}
