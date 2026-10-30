import type { NeuralClimate } from './terrain';

/** Shared simulation presets, independent of the terrain engine and its WASM. */
export interface ClimateValues { temperature: number; temperatureStd: number; precipitation: number; precipitationCv: number }
export const CLIMATE_VALUES: Record<NeuralClimate, ClimateValues> = {
  temperate: { temperature: 18, temperatureStd: 600, precipitation: 1000, precipitationCv: 35 },
  oceanic: { temperature: 11, temperatureStd: 450, precipitation: 1300, precipitationCv: 25 },
  mediterranean: { temperature: 16, temperatureStd: 550, precipitation: 600, precipitationCv: 60 },
  arid: { temperature: 23, temperatureStd: 800, precipitation: 150, precipitationCv: 85 },
  cold: { temperature: 1, temperatureStd: 1100, precipitation: 550, precipitationCv: 35 },
  tropical: { temperature: 26, temperatureStd: 150, precipitation: 2300, precipitationCv: 50 },
};

/** V2 climate zones. Engines receive the zone's values (and its nearest legacy
 *  name where a name is parsed), so V1 presets and neural servers are unchanged. */
export const CLIMATE_ZONES = ['temperate', 'mediterranean', 'continental', 'nordic', 'alpine', 'arctic', 'steppe', 'desert', 'savanna', 'tropical', 'wetland'] as const;
export type ClimateZone = typeof CLIMATE_ZONES[number];
/** Sea-level annual means (°C), seasonality (WorldClim bio4, °C × 100), rain (mm) and its CV (%). */
export const CLIMATE_ZONE_VALUES: Record<ClimateZone, ClimateValues> = {
  temperate: { temperature: 11, temperatureStd: 520, precipitation: 800, precipitationCv: 18 },
  mediterranean: { temperature: 15.5, temperatureStd: 620, precipitation: 620, precipitationCv: 55 },
  continental: { temperature: 8, temperatureStd: 850, precipitation: 620, precipitationCv: 32 },
  nordic: { temperature: 4.5, temperatureStd: 720, precipitation: 850, precipitationCv: 22 },
  alpine: { temperature: 9, temperatureStd: 650, precipitation: 1500, precipitationCv: 20 },
  arctic: { temperature: -2, temperatureStd: 850, precipitation: 550, precipitationCv: 25 },
  steppe: { temperature: 9.5, temperatureStd: 1050, precipitation: 380, precipitationCv: 42 },
  desert: { temperature: 24, temperatureStd: 780, precipitation: 70, precipitationCv: 95 },
  savanna: { temperature: 28, temperatureStd: 380, precipitation: 600, precipitationCv: 115 },
  tropical: { temperature: 27, temperatureStd: 130, precipitation: 2500, precipitationCv: 55 },
  wetland: { temperature: 10.5, temperatureStd: 560, precipitation: 750, precipitationCv: 16 },
};
/** Nearest legacy preset, sent where an engine parses a climate name before reading the values. */
export const CLIMATE_ZONE_BASE: Record<ClimateZone, NeuralClimate> = {
  temperate: 'oceanic', mediterranean: 'mediterranean', continental: 'cold', nordic: 'cold', alpine: 'oceanic', arctic: 'cold',
  steppe: 'arid', desert: 'arid', savanna: 'arid', tropical: 'tropical', wetland: 'oceanic',
};
/** Saved V2 recipes with a former preset open on the closest zone. */
export const LEGACY_CLIMATE_ZONES: Readonly<Record<string, ClimateZone>> = { oceanic: 'temperate', arid: 'desert', cold: 'nordic' };
export const climateZoneOf = (value: unknown): ClimateZone | undefined =>
  (CLIMATE_ZONES as readonly unknown[]).includes(value) ? value as ClimateZone : typeof value === 'string' ? LEGACY_CLIMATE_ZONES[value] : undefined;
