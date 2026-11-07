import { CLIMATE_VALUES, CLIMATE_ZONES, CLIMATE_ZONE_VALUES, climateZoneOf, type ClimateValues, type ClimateZone } from '../../../rust/bridge/terrainClimate';
import { climateZoneBiome, type BiomeName } from '../gen/biomes';
import type { DecorMeta } from './decor';

/** The land-use biome of a retained map. */
export function decorBiome(meta: Pick<DecorMeta, 'query' | 'tags'>): BiomeName {
  return climateZoneBiome[new URLSearchParams(meta.query).get('climate') ?? meta.tags.climate ?? 'temperate'] ?? 'temperate';
}

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

/** The climate zone of a retained map, which sets its year. Maps saved with custom values take the nearest zone. */
export function decorClimateZone(meta: Pick<DecorMeta, 'query' | 'tags'>): ClimateZone {
  const named = climateZoneOf(new URLSearchParams(meta.query).get('climate') ?? meta.tags.climate);
  if (named) return named;
  const climate = decorClimate(meta), gap = (zone: ClimateZone): number => {
    const values = CLIMATE_ZONE_VALUES[zone];
    return Math.abs(values.temperature - climate.temperature) / 5 + Math.abs(Math.log(values.precipitation / climate.precipitation)) + Math.abs(values.temperatureStd - climate.temperatureStd) / 300;
  };
  return CLIMATE_ZONES.reduce((best, zone) => gap(zone) < gap(best) ? zone : best);
}
