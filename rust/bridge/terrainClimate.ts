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
