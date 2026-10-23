import type { ClimateValues, NeuralClimate } from '../../../../rust/bridge/terrain';
import type { ClimateInput } from '../model';

/** Exact legacy terrain.ts presets, kept here to allow Node/offline consumers
 * without importing the browser WASM/WebGPU runtime. Units: T degC, sigmaT
 * centidegrees C, annual rain mm/year, precipitation CV percent. */
export const MAGNA_CLIMATE_PRESETS: Record<NeuralClimate, ClimateValues> = {
  temperate: { temperature: 18, temperatureStd: 600, precipitation: 1000, precipitationCv: 35 },
  oceanic: { temperature: 11, temperatureStd: 450, precipitation: 1300, precipitationCv: 25 },
  mediterranean: { temperature: 16, temperatureStd: 550, precipitation: 600, precipitationCv: 60 },
  arid: { temperature: 23, temperatureStd: 800, precipitation: 150, precipitationCv: 85 },
  cold: { temperature: 1, temperatureStd: 1100, precipitation: 550, precipitationCv: 35 },
  tropical: { temperature: 26, temperatureStd: 150, precipitation: 2300, precipitationCv: 50 },
};
export function magnaClimateToSurface(values: ClimateValues, version: string): ClimateInput {
  return { version, meanAnnualTempC: values.temperature, annualPrecipMm: values.precipitation,
    // Approximation: a sinusoidal seasonal signal with the supplied standard
    // deviation has peak amplitude sqrt(2)*sigma. No measured monthly curve is claimed.
    seasonalAmplitudeC: Math.SQRT2 * values.temperatureStd / 100,
    referenceElevationM: 0, lapseRateCPerKm: 6.5, elevationCorrected: false };
}
export function climateFromMagnaQuery(query: string): ClimateInput {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const presetName = params.get('climate') ?? 'temperate';
  const values = { ...(MAGNA_CLIMATE_PRESETS[presetName as NeuralClimate] ?? MAGNA_CLIMATE_PRESETS.temperate) };
  for (const key of Object.keys(values) as (keyof ClimateValues)[]) {
    if (!params.has(key)) continue;
    const value = Number(params.get(key));
    if (!Number.isFinite(value) || (key !== 'temperature' && value < 0)) throw new Error(`Invalid source climate value: ${key}`);
    values[key] = value;
  }
  return magnaClimateToSurface(values, `magna-query-climate:${presetName}:${JSON.stringify(values)}`);
}
