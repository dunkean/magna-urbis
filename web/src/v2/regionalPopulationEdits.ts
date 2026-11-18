import type { V2Settings } from './contracts';
import { POPULATION_CLASSES, regionalPopulation, type PopulationClass } from './regionalPopulation';

export type RegionalPopulationField = PopulationClass | 'population' | 'density' | 'isolatedCount' | 'isolatedDensity';

/** The list of places is primary. A class edit pins that class and changes the population by the
 * inhabitants of the places added or removed; a population or density edit resizes the places and
 * keeps their number. */
export function editRegionalPopulation(settings: V2Settings, key: RegionalPopulationField, value: number | undefined): void {
  const region = (settings.region ??= {}),
    d = (region.demography ??= {});
  if (region.placement?.mode === 'list' || (!region.placement?.mode && region.placement?.list?.length)) {
    region.placement.mode = 'auto';
    delete region.placement.list;
  }
  if (POPULATION_CLASSES.includes(key as PopulationClass)) {
    const id = key as PopulationClass,
      counts = (d.counts ??= {}),
      before = regionalPopulation(settings);
    if (value === undefined) {
      delete counts[id];
      if (region.placement?.counts) delete region.placement.counts[id];
      if (!Object.keys(counts).length) delete d.counts;
    } else counts[id] = value;
    // A typed population or density follows the places: without one, the plan derives it itself.
    if (d.population !== undefined || d.density !== undefined) {
      const after = regionalPopulation({ ...settings, region: { ...region, demography: { ...d, population: undefined, density: undefined } } });
      const delta = (after.counts[id] - before.counts[id]) * before.classSizes[id];
      if (d.population !== undefined) d.population = Math.max(0, d.population + delta);
      else if (before.areaKm2) d.density = Math.max(0, d.density! + delta / before.areaKm2);
    }
    return;
  }
  if (value !== undefined && (key === 'population' || key === 'density')) {
    // Population and density describe the same total. The most recently edited value wins.
    delete d[key === 'population' ? 'density' : 'population'];
  }
  if (value !== undefined && key === 'isolatedDensity') delete d.isolatedCount;
  const field = key as 'population' | 'density' | 'isolatedCount' | 'isolatedDensity';
  if (value === undefined) delete d[field];
  else d[field] = value;
}

/** Drops every chosen count, population and density (and a manual list): the automatic list from the map
 * size, biome and culture applies again, with its floor. The culture-follow choice is kept. */
export function followEnvironmentPopulation(settings: V2Settings): void {
  const region = (settings.region ??= {}),
    followCulture = region.demography?.followCulture;
  region.demography = followCulture === undefined ? {} : { followCulture };
  if (region.placement) {
    delete region.placement.counts;
    delete region.placement.list;
    region.placement.mode = 'auto';
  }
  for (const local of Object.values(settings.local)) delete local.population;
}

/** No settlement at all: every class count and the regional population are 0. Adding a place afterwards
 * adds its inhabitants to that population, as for any typed population. */
export function clearRegionalPopulation(settings: V2Settings): void {
  followEnvironmentPopulation(settings);
  const d = settings.region!.demography!;
  d.counts = Object.fromEntries(POPULATION_CLASSES.map(id => [id, 0]));
  d.population = 0;
}
