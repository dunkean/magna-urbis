import type { ExitCounts, ExitReport } from '../../../rust/bridge/settlements';
import { DEFAULT_ROADS, sizeForPop } from '../gen/options';
import type { V2Settings } from './contracts';
import { regionalPopulation, type RegionalPopulationPlan } from './regionalPopulation';

export const REGIONAL_EXIT_CLASSES = ['highway', 'main', 'local', 'track'] as const;
export const MAX_REGIONAL_EXITS = 16;

/** Regional requests, not a guarantee: Rust chooses gateways across all towns.
 * Automatic classes share the budget left by pinned values, in road-class order. */
export function suggestRegionalExits(settings: V2Settings, plan: RegionalPopulationPlan = regionalPopulation(settings)): ExitCounts {
  const result: ExitCounts = { highway: 0, main: 0, local: 0, track: 0 };
  if (settings.region?.roads === null) return result;
  const level = settings.region?.roads?.level ?? 'rural';
  const largest = plan.places.reduce((n, p) => Math.max(n, p.population), 0);
  const populationCount = plan.population >= 100000 ? 6 : plan.population >= 20000 ? 5 : plan.population >= 2000 ? 4 : plan.population >= 150 ? 3 : 2;
  let total = Math.max(DEFAULT_ROADS[sizeForPop(largest)], populationCount);
  if (plan.areaKm2 >= 1600 && plan.population >= 20000) total++;
  if (plan.areaKm2 < 16) total = Math.min(3, total);
  if (level === 'primitive') result.track = total;
  else {
    const big = plan.areaKm2 >= 100 && plan.population >= 20000;
    result.highway = big && (level === 'developed' || level === 'imperial') ? (level === 'imperial' && plan.population >= 100000 && plan.areaKm2 >= 400 ? 2 : 1) : 0;
    const remaining = total - result.highway;
    result.track = level === 'rural' ? 1 : 0;
    result.main = level === 'rural' ? Math.max(1, Math.floor(remaining / 3)) : Math.ceil(remaining / 2);
    result.local = remaining - result.main - result.track;
  }
  const pinned = settings.region?.roads?.exits ?? {};
  let budget = Math.max(0, MAX_REGIONAL_EXITS - REGIONAL_EXIT_CLASSES.reduce((n, cls) => n + (pinned[cls] ?? 0), 0));
  for (const cls of REGIONAL_EXIT_CLASSES)
    if (pinned[cls] === undefined) {
      result[cls] = Math.min(result[cls], budget);
      budget -= result[cls];
    }
  return result;
}

export function effectiveRegionalExits(settings: V2Settings, plan?: RegionalPopulationPlan): ExitCounts {
  const suggested = suggestRegionalExits(settings, plan),
    pinned = settings.region?.roads?.exits;
  return { highway: pinned?.highway ?? suggested.highway, main: pinned?.main ?? suggested.main, local: pinned?.local ?? suggested.local, track: pinned?.track ?? suggested.track };
}

/** Count actual classes: a downgraded highway appears under the class obtained. */
export function regionalExitResults(report: readonly ExitReport[]) {
  return Object.fromEntries(REGIONAL_EXIT_CLASSES.map(cls => [cls, { requested: report.filter(exit => exit.requested === cls).length, obtained: report.filter(exit => exit.class === cls && exit.point !== null && exit.gateway !== null).length }])) as Record<
    keyof ExitCounts,
    { requested: number; obtained: number }
  >;
}
