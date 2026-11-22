import type { Options } from '../gen/options';
import type { V2Settings } from './contracts';
import { seedRoot, seedSubset, stepSeed } from '../../../rust/bridge/generationSeed';
import { generationRegion } from './regionSettings';
import { REGIONAL_POPULATION_VERSION } from './regionalPopulation';

/** Recipe keys of the placement a world was built from (`v2.planKey`, `v2.placementKey`). The page reads them too:
 * a direct placement edit (an added settlement) records the recipe its world now matches. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map(key => [key, item[key]]),
        )
      : item,
  );
}
/** Only parameters that can move the regional sites require replanning. Town morphology remains local. */
export function regionKey(settings: V2Settings): string {
  const o = settings.options;
  return stableStringify([
    o.population,
    o.culture,
    o.siteType,
    o.sitePrefs,
    o.center,
    o.roads,
    o.settlements,
    o.workflow,
    settings.runtime?.backend,
    generationRegion(settings.region),
    settings.settlementCount,
    Object.entries(settings.local)
      .filter(([key, o]) => o.center !== undefined || o.siteType !== undefined || o.sitePrefs !== undefined || (key === 'main' && o.roads !== undefined))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, o]) => [key, o.center, o.siteType, o.sitePrefs, key === 'main' ? o.roads : undefined]),
    ...(stepSeed(o.seed, 'settle-sites') !== seedRoot(o.seed) || stepSeed(o.seed, 'settle-roads') !== seedRoot(o.seed) ? [stepSeed(o.seed, 'settle-sites'), stepSeed(o.seed, 'settle-roads')] : []),
    REGIONAL_POPULATION_VERSION,
  ]);
}
/** The placement recipe without its roads: a route-only run keeps the sites of this key. */
export function placementKey(settings: V2Settings): string {
  const recipe = { ...settings, options: { ...settings.options }, local: { ...settings.local }, ...(settings.region ? { region: { ...settings.region } } : {}) };
  delete (recipe.options as Partial<Options>).roads;
  if (recipe.region) {
    delete recipe.region.roads;
    delete recipe.region.resolution;
    if (!Object.keys(recipe.region).length) delete recipe.region;
  }
  if (recipe.local.main) {
    recipe.local.main = { ...recipe.local.main };
    delete recipe.local.main.roads;
  }
  recipe.options.seed = seedSubset(recipe.options.seed, key => key !== 'settle-roads');
  return regionKey(recipe);
}
