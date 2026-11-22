/**
 * Display biome: the climate zone the map is painted with (palettes, ground textures, season calendar, snow, tree
 * crowns, road soil). `appearance.biome` repaints a kept relief in another biome; absent, the recipe's own zone paints
 * it. The relief, water, land uses and settlements always keep the generation biome (`options.biome`, `terrain.climate`).
 * Underdark is a generation choice (it carves the relief): it never takes a display biome.
 */
import { CLIMATE_ZONE_BASE, CLIMATE_ZONE_VALUES, climateZoneOf, type ClimateZone } from '../../../rust/bridge/terrainClimate';
import { climateZoneBiome, isUnderdarkBiome, type BiomeName } from '../gen/biomes';
import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import { effectiveTerrainSettings, type EffectiveTerrainSettings } from './terrainSettings';

/** The display zone that replaces the generation climate, if any. */
export function displayClimateOverride(settings: V2Settings, world?: World): ClimateZone | undefined {
  if (isUnderdarkBiome(String(settings.options.biome)) || isUnderdarkBiome(world?.options.biome)) return undefined;
  return climateZoneOf(settings.appearance?.biome);
}

/** Terrain settings as the renderers read them: the display zone replaces the climate, every other field is the recipe's. */
export function displayTerrainSettings(settings: V2Settings, width: number): EffectiveTerrainSettings {
  const effective = effectiveTerrainSettings(settings, width),
    zone = displayClimateOverride(settings);
  return zone ? { ...effective, climateZone: zone, climate: CLIMATE_ZONE_BASE[zone], climateValues: { ...CLIMATE_ZONE_VALUES[zone] } } : effective;
}

/** The biome name the palettes read (vector land, road ground, conifer share): the display zone's, else the generated world's. */
export function displayBiomeName(settings: V2Settings | undefined, world: World | undefined): BiomeName | undefined {
  const zone = settings && displayClimateOverride(settings, world);
  return zone ? climateZoneBiome[zone] : (world?.options.biome ?? settings?.options.biome);
}
