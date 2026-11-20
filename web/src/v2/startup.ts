/** Startup-only landscape choices and the local preference that opts into restoring the previous recipe.
 * Project imports and generation never call this module's randomizer. */
import type { V2Settings } from './contracts';
import type { SavedRecipe } from './autosave';
import { climateZoneBiome } from '../gen/biomes';
import type { Relief } from '../gen/options';
import { UNDERDARK_CULTURES } from './underdarkCultures';
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { isCompactProcedural } from '../../../rust/bridge/terrainGenerationRecipe';
import { terrainReliefAvailable, type V2TerrainSettings } from './terrainSettings';

export const STARTUP_RESTORE_KEY = 'magna-urbis-v2-reload-previous-map';
export function reloadPreviousMapAtStartup(): boolean {
  try {
    return globalThis.localStorage?.getItem(STARTUP_RESTORE_KEY) === 'true';
  } catch {
    return false;
  }
}
export function setReloadPreviousMapAtStartup(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(STARTUP_RESTORE_KEY, String(value));
  } catch {
    /* Startup still works when local preferences cannot be saved. */
  }
}

type TerrainRelief = NonNullable<V2TerrainSettings['relief']>;
const LANDSCAPES: readonly { climate: ClimateZone; reliefs: readonly TerrainRelief[] }[] = [
  { climate: 'temperate', reliefs: ['flat', 'hills', 'valley', 'mixed', 'plateau', 'mountains'] },
  { climate: 'mediterranean', reliefs: ['hills', 'valley', 'mixed', 'plateau', 'mountains'] },
  { climate: 'continental', reliefs: ['flat', 'hills', 'valley', 'mixed', 'mountains'] },
  { climate: 'nordic', reliefs: ['hills', 'valley', 'mixed', 'mountains'] },
  { climate: 'alpine', reliefs: ['valley', 'mountains', 'high-mountains'] },
  { climate: 'arctic', reliefs: ['flat', 'hills', 'mixed', 'mountains', 'high-mountains'] },
  { climate: 'steppe', reliefs: ['flat', 'hills', 'valley', 'plateau', 'mountains'] },
  { climate: 'desert', reliefs: ['flat', 'hills', 'canyon', 'plateau', 'mixed', 'mountains'] },
  { climate: 'savanna', reliefs: ['flat', 'hills', 'valley', 'plateau', 'mixed'] },
  { climate: 'tropical', reliefs: ['flat', 'hills', 'mixed', 'mountains', 'volcano', 'caldera'] },
  { climate: 'wetland', reliefs: ['flat', 'hills', 'valley'] },
];
/** Contiguous sea sectors avoid arbitrary checkerboards of coast directions. */
const COASTS = [
  { mask: 255, mode: 'island' },
  { mask: 255, mode: 'peninsula' },
  { mask: 255, mode: 'archipelago' },
  { mask: 1, mode: 'island' },
  { mask: 7, mode: 'island' },
  { mask: 31, mode: 'island' },
] as const;
const CLASSIC_RELIEFS: readonly Relief[] = ['flat', 'hills', 'valley', 'mountains'];
const pick = <T>(items: readonly T[], random: () => number): T => items[Math.min(items.length - 1, Math.max(0, Math.floor(random() * items.length)))];
const classicRelief = (relief: TerrainRelief): Relief => (CLASSIC_RELIEFS.includes(relief as Relief) ? (relief as Relief) : ['high-mountains', 'volcano', 'caldera'].includes(relief) ? 'mountains' : relief === 'canyon' ? 'valley' : 'hills');

/** Fresh startup keeps general preferences, while removing fixed geography and edits bound to the previous map. */
export function randomInitialSettings(previous: V2Settings, random: () => number = Math.random): V2Settings {
  const settings = structuredClone(previous),
    terrain = (settings.terrain ??= {});
  const landscape = pick(LANDSCAPES, random);
  const classic = settings.runtime?.backend === 'typescript';
  const source = settings.runtime?.source ?? (settings.generation === 'neural' ? 'neural-wasm' : 'procedural');
  const method = source !== 'procedural' && source !== 'procedural-phasor' ? 'neural' : isCompactProcedural({ source, procedural: terrain.procedural }) ? 'compact' : 'procedural';
  const relief = pick(
    landscape.reliefs.filter(r => (classic ? CLASSIC_RELIEFS.includes(r as Relief) : terrainReliefAvailable(r, method))),
    random,
  );
  const coastal = random() >= 0.5,
    coast = coastal ? (classic ? { mask: 1, mode: 'island' as const } : pick(COASTS, random)) : { mask: 0, mode: 'island' as const };
  const rotation = Math.floor(random() * (classic ? 4 : 8)) * (classic ? 2 : 1);
  terrain.coastMask = ((coast.mask << rotation) | (coast.mask >>> (8 - rotation))) & 255;
  terrain.islandMode = coast.mode;
  terrain.relief = relief;
  terrain.climate = landscape.climate;
  settings.options.biome = climateZoneBiome[landscape.climate];
  settings.options.relief = classicRelief(relief);
  settings.options.coast = !coastal ? 'none' : classic ? (['N', 'E', 'S', 'W'] as const)[rotation / 2] : 'random';
  settings.options.seed = `startup-${Math.floor(random() * 0x100000000).toString(36)}-${Math.floor(random() * 0x100000000).toString(36)}`;
  if (UNDERDARK_CULTURES.includes(settings.options.culture)) settings.options.culture = 'european-organic';
  delete settings.options.center;
  delete settings.options.importedHeight;
  delete settings.options.heightScale;
  delete settings.options.importSea;
  delete settings.decor;
  for (const key of ['sketch', 'heightmap', 'zones', 'modification', 'coastTrace', 'climateValues', 'reliefClimate'] as const) delete terrain[key];
  if (terrain.procedural?.enabled) Object.assign(terrain.procedural.enabled, { coasts: true, coastCut: true });
  if (terrain.neuralTuning) {
    delete terrain.neuralTuning.reliefMode;
    delete terrain.neuralTuning.reliefFixed;
    delete terrain.neuralTuning.histogram;
  }
  for (const local of Object.values(settings.local)) {
    delete local.center;
    delete local.seed;
    delete local.biome;
    delete local.relief;
    delete local.coast;
  }
  const placement = settings.region?.placement;
  if (placement?.main) delete placement.main.position;
  for (const place of placement?.list ?? []) delete place.position;
  if (settings.urban) {
    delete settings.urban.local;
    delete settings.urban.buildings;
    delete settings.urban.seed;
    delete settings.urban.seeds;
    if (settings.urban.layout) {
      delete settings.urban.layout.overrides;
      delete settings.urban.layout.blockEdits;
      delete settings.urban.layout.quarterEdits;
    }
    if (settings.urban.parcels) delete settings.urban.parcels.overrides;
  }
  if (settings.naming) for (const key of ['places', 'local', 'features', 'variations', 'labels'] as const) delete settings.naming[key];
  return settings;
}

/** Explicit links and test pages never draw random numbers or restore unrelated local state. */
export function startupPlan(
  current: V2Settings,
  saved: SavedRecipe | undefined,
  options: { explicit: boolean; restore: boolean; random?: () => number },
): { mode: 'explicit'; settings: V2Settings } | { mode: 'restore'; saved: SavedRecipe } | { mode: 'fresh'; settings: V2Settings } {
  if (options.explicit) return { mode: 'explicit', settings: current };
  if (options.restore && saved) return { mode: 'restore', saved };
  return { mode: 'fresh', settings: randomInitialSettings(saved?.settings ?? current, options.random) };
}
