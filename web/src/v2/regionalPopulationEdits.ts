import type { V2Settings } from './contracts';
import { POPULATION_CLASSES, type PopulationClass } from './regionalPopulation';

export type RegionalPopulationField = PopulationClass | 'population' | 'density' | 'isolatedCount' | 'isolatedDensity';

/** A parent budget change recomputes its distribution; a class edit pins that class alone. */
export function editRegionalPopulation(settings: V2Settings, key: RegionalPopulationField, value: number | undefined): void {
  const region = settings.region ??= {}, d = region.demography ??= {};
  if (region.placement?.mode === 'list' || !region.placement?.mode && region.placement?.list?.length) {
    region.placement.mode = 'auto'; delete region.placement.list;
  }
  if (POPULATION_CLASSES.includes(key as PopulationClass)) {
    const id = key as PopulationClass, counts = d.counts ??= {};
    if (value === undefined) {
      delete counts[id]; if (region.placement?.counts) delete region.placement.counts[id];
      if (!Object.keys(counts).length) delete d.counts;
    } else counts[id] = value;
    return;
  }
  if (value !== undefined && (key === 'population' || key === 'density')) {
    delete d.counts; delete d.isolatedCount;
    if (region.placement) { delete region.placement.counts; region.placement.mode = 'auto'; }
    // Population and density describe the same budget. The most recently edited value wins.
    delete d[key === 'population' ? 'density' : 'population'];
  }
  if (value !== undefined && key === 'isolatedDensity') delete d.isolatedCount;
  const field = key as 'population' | 'density' | 'isolatedCount' | 'isolatedDensity';
  if (value === undefined) delete d[field]; else d[field] = value;
}
