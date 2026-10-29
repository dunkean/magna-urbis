import type { UrbanProgramme } from '../../../rust/bridge/urban';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import { surfaceArea } from '../../../rust/bridge/houseRender';
import { builtOutcomeSource, hasBuiltOutcomeBalance } from '../../../rust/bridge/urbanBuiltBalance';

export type ProgrammeBalanceEvidence = 'not_calculated' | 'unverified' | 'scene_consistent' | 'outcomes_reconciled';
const same = (a: number | undefined, b: number): boolean => typeof a === 'number' && Number.isFinite(a)
  && a >= 0 && Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));

/** The native programme has no reconciliation marker. A zero alone is never
 * evidence. Recognize only complete eager-scene outcomes whose reported totals
 * agree with the programme; this is consistency, not certified habitation.
 * Index once per scene, not once per demand or programme. Detail-cache objects
 * are deliberately not an input: realizing an exterior cannot change a plan's
 * capacity status. */
export function programmeBalanceEvidence(scene?: PlacementBatch): (programme: UrbanProgramme) => ProgrammeBalanceEvidence {
  if (!scene) return programme => programme.demands.some(d => d.builtCapacity > 0 || (d.openCapacity ?? 0) > 0) ? 'unverified' : 'not_calculated';
  if (scene.generator_version === 'silhouette' || scene.generator_version.startsWith('architectural-plans-')
    || scene.buildings.some(b => b.simplification !== 'recipe_volumes' || b.cartographic?.validation === 'plan_only')) {
    const source = builtOutcomeSource(scene);
    return p => hasBuiltOutcomeBalance(p,source) ? 'outcomes_reconciled' : 'not_calculated';
  }
  if (!['houses-2', 'houses-3'].includes(scene.generator_version)) return () => 'unverified';
  const outcomes = new Map<string, { kind: 'building' | 'refusal' | 'open'; function?: string; useful?: number; units?: number; area?: number }>();
  let duplicate = false;
  const put = (id: string, value: typeof outcomes extends Map<string, infer V> ? V : never): void => {
    if (outcomes.has(id)) duplicate = true;
    outcomes.set(id, value);
  };
  for (const b of scene.buildings) put(b.parcel_id, { kind: 'building', function: b.function, useful: b.useful_area_m2, units: b.domestic_units });
  for (const r of scene.refusals) put(r.parcel_id, { kind: 'refusal' });
  for (const s of scene.open_spaces) put(s.parcel_id, { kind: 'open', area: surfaceArea(s.surface) });
  return programme => {
    if (duplicate || !programme.allocations.length) return 'unverified';
    const totals = new Map(programme.demands.map(d => [d.id, { built: 0, open: 0, unit: d.unit }]));
    for (const allocation of programme.allocations) {
      const outcome = outcomes.get(allocation.parcelId), total = totals.get(allocation.demandId);
      if (!outcome || !total) return 'unverified';
      if (outcome.kind === 'building') {
        const amount = total.unit === 'domesticUnits' ? outcome.units : outcome.useful;
        if (outcome.function !== allocation.function || amount === undefined || !Number.isFinite(amount) || amount < 0) return 'unverified';
        total.built += amount;
      } else if (outcome.kind === 'open') {
        if (!['market', 'common'].includes(allocation.function) || outcome.area === undefined || !Number.isFinite(outcome.area) || outcome.area < 0) return 'unverified';
        total.open += outcome.area;
      }
    }
    return programme.demands.every(d => {
      const total = totals.get(d.id)!;
      return same(d.builtCapacity, total.built) && same(d.openCapacity ?? 0, total.open)
        && same(d.deficit, Math.max(0, d.requested - total.built - total.open));
    }) ? 'scene_consistent' : 'unverified';
  };
}
