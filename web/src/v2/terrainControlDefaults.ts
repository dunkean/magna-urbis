/** Read the Rust plan without generating a landscape. Defaults stay tied to the selected relief. */
import type { TerrainSettings } from '../../../rust/bridge/terrain';
import { configureCompactPlan } from '../../../rust/bridge/terrainPhasor';
import { erosionBiome, isCompactProcedural, posteriorSettings, windSettings } from '../../../rust/bridge/terrainGenerationRecipe';

export async function loadTerrainControlDefaults() {
  const { EROSION_SETTINGS } = await import('../../../rust/bridge/terrain');
  const wasm = await import('../../../rust/bridge/wasmRuntime');
  await wasm.loadSingleWasm();
  let key = '', values: Record<string, unknown> = {};
  return (settings: TerrainSettings): Record<string, unknown> => {
    const next = JSON.stringify([settings.relief, settings.width, settings.motifSize, settings.mountainMix, settings.erosion, settings.climateZone, settings.climateValues, settings.procedural, settings.phasor]);
    if (key === next) return values;
    key = next;
    const compact = isCompactProcedural(settings), recipe = settings.procedural ?? {};
    const relief = ['hills', 'valley', 'mountains', 'mixed', 'high-mountains', 'canyon'].includes(settings.relief) ? settings.relief : 'hills';
    const plan = wasm.GenerationNoisePlan.erosion(settings.seed, settings.width, relief, settings.erosion, settings.motifSize, settings.mountainMix);
    let original: Float32Array;
    try { original = plan.parameters(); } finally { plan.free(); }
    const { parameters, surface } = compact ? configureCompactPlan(original, settings) : { parameters: original, surface: original.slice(24, 32) };
    const erosion = Object.fromEntries(Array.from(wasm.erosion_defaults(settings.relief, settings.width, settings.motifSize, settings.mountainMix), (value, i) => [EROSION_SETTINGS[i], value]));
    if (compact) Object.assign(erosion, { iterations: parameters[13], warp: 0, surfaceIterations: recipe.enabled?.surface === true || settings.relief === 'canyon' && recipe.enabled?.surface !== false ? 12 : 0 });
    const biome = recipe.biome ? erosionBiome(settings) : undefined;
    const posterior = posteriorSettings(settings), wind = windSettings(settings);
    values = {
      ...Object.fromEntries(Object.entries(erosion).map(([name, value]) => [`terrain.erosionTuning.${name}`, recipe.erosionTuning?.[name as keyof typeof recipe.erosionTuning] ?? value])),
      'terrain.procedural.regionalN': parameters[2], 'terrain.procedural.surfaceN': surface[0] - 24,
      'terrain.procedural.noiseScale': biome?.noise ?? 1, 'terrain.procedural.crest': biome?.crest ?? parameters[32], 'terrain.procedural.uplift': 1,
      'terrain.procedural.regionalThermal': true, 'terrain.procedural.regionalDiffusion': true,
      'terrain.procedural.reconstruction': 'default',
      ...Object.fromEntries(Object.entries(posterior).map(([name, value]) => [`terrain.procedural.posterior.${name}`, value])),
      ...Object.fromEntries(Object.entries(wind).map(([name, value]) => [`terrain.procedural.wind.${name}`, value])),
      'terrain.procedural.coastIterations': compact ? 2 : 12,
      ...Object.fromEntries(['coastIncision', 'coastThermal', 'coastDiffusion'].map(name => [`terrain.procedural.${name}`, 1])),
    };
    return values;
  };
}
