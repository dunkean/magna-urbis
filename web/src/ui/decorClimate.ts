import { CLIMATE_VALUES, type ClimateValues } from '../../../rust/bridge/terrainClimate';
import type { DecorMeta } from './decor';

/** The retained recipe owns the climate, including custom numerical values. */
export function decorClimate(meta: Pick<DecorMeta, 'query' | 'tags'>): ClimateValues {
  const query = new URLSearchParams(meta.query), name = query.get('climate') ?? meta.tags.climate ?? 'temperate';
  const climate = { ...(CLIMATE_VALUES[name as keyof typeof CLIMATE_VALUES] ?? CLIMATE_VALUES.temperate) };
  const fields = { temperature: 'climTemperature', temperatureStd: 'climTemperatureStd', precipitation: 'climPrecipitation', precipitationCv: 'climPrecipitationCv' } as const;
  for (const key of Object.keys(fields) as (keyof ClimateValues)[]) {
    const raw = query.get(key) ?? query.get(fields[key]), value = Number(raw);
    if (raw !== null && Number.isFinite(value)) climate[key] = value;
  }
  return climate;
}
