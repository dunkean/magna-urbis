/** Population actually reached by a built town, shared by the V2 (Places list, card, report) and City Bench.
 * Reached = households of the domestic allocations whose parcel received an admitted building, times persons per
 * household. It is an allocation-based count of what was built, not a certified habitation capacity. */
import type { UrbanProgramme } from '../../../rust/bridge/urban';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';

export interface ReachedPopulation {
  /** Requested population. */
  target: number;
  /** Inhabitants housed in the buildings actually placed. */
  reached: number;
  /** Households of the need that no placed building houses. */
  shortfallHouseholds: number;
  /** Inhabitants those missing households stand for. */
  shortfall: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** `undefined` until a building scene exists (nothing is built yet: keep showing the target). */
export function cityReachedPopulation(target: number, programmes: readonly (UrbanProgramme | undefined)[], scene?: PlacementBatch): ReachedPopulation | undefined {
  if (!scene || !scene.buildings.length) return undefined;
  const built = new Map<string, string>();
  for (const b of scene.buildings) built.set(b.parcel_id, b.function);
  let need = 0, housed = 0, size: number | undefined;
  for (const programme of programmes) {
    if (!programme) continue;
    for (const d of programme.demands) if (d.unit === 'domesticUnits') {
      need += d.requested;
      for (const p of d.provenance) { const m = /profile:([0-9.]+) persons\/domesticUnit/.exec(p); if (m && size === undefined) size = Number(m[1]); }
    }
    for (const a of programme.allocations) if (a.unit === 'domesticUnits' && built.get(a.parcelId) === a.function) housed += finite(a.households) ? a.households : finite(a.capacity) ? a.capacity : 0;
  }
  if (!need) return undefined;
  const persons = size ?? target / need;
  if (!(persons > 0)) return undefined;
  const missing = Math.max(0, need - housed);
  return { target, reached: Math.round(Math.min(housed, need) * persons), shortfallHouseholds: Math.round(missing), shortfall: Math.round(missing * persons) };
}

/** Display hooks: `t` translates an English template with `{name}` slots (identity = English), `locale` formats numbers. */
export interface PopulationTextOptions { t?: (template: string) => string; locale?: string }
const fill = (template: string, values: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (_m, k: string) => values[k] ?? '');
export const POPULATION_TEMPLATES = ['{count} inh.', '{count} inh. (target {target})', 'Capacity shortfall: {households} households (≈ {people} inh.) not housed.'] as const;

/** "8,640 inh. (target 10,000)" when the figures differ, the bare reached number when equal, the target before building. */
export function populationText(target: number, reached: ReachedPopulation | undefined, o: PopulationTextOptions = {}): string {
  const t = o.t ?? (x => x), g = (v: number): string => Math.round(v).toLocaleString(o.locale ?? 'en-US');
  if (!reached || Math.round(reached.reached) === Math.round(target)) return fill(t('{count} inh.'), { count: g(reached ? reached.reached : target) });
  return fill(t('{count} inh. (target {target})'), { count: g(reached.reached), target: g(target) });
}
/** Short capacity-shortfall line, or '' when the town housed its whole need. */
export function populationShortfallText(reached: ReachedPopulation | undefined, o: PopulationTextOptions = {}): string {
  if (!reached || reached.shortfallHouseholds < 1) return '';
  const t = o.t ?? (x => x), g = (v: number): string => Math.round(v).toLocaleString(o.locale ?? 'en-US');
  return fill(t('Capacity shortfall: {households} households (≈ {people} inh.) not housed.'), { households: g(reached.shortfallHouseholds), people: g(reached.shortfall) });
}
