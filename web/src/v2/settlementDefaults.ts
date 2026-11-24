import type { V2Settings } from './contracts';
import { cultureEnvironment } from './environmentCultures';
import { regionalPopulation } from './regionalPopulation';

/** UI suggestions only: explicit recipes and the generation engines keep their own contract. */
export function settlementEnvironment(settings: V2Settings): string {
  return [settings.extent, settings.options.culture, JSON.stringify(cultureEnvironment(settings))].join('|');
}
/** The automatic list of places: it follows the map size, biome and culture; a density only resizes
 * those places (zero empties the region). */
export function recommendedCounts(settings: V2Settings, density = 1): Record<string, number> {
  const baseline = regionalPopulation(settings);
  return regionalPopulation({ ...settings, region: { ...settings.region, placement: { ...settings.region?.placement, counts: undefined }, demography: { density: baseline.defaultDensity * Math.max(0, density) } } }).counts;
}
