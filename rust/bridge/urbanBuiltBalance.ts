/** Compact/cold reconciliation reads actual outcomes, never preview or allocation
 * capacity. Only scalar identity/status state survives a native chunk. */
import type { Partition, UrbanProgramme } from './urban';
import type { PlacementBatch } from './urbanArchitecture';
import { surfaceArea } from './houseRender';

export interface BuiltOutcomeBalance {
  version: 'built-outcomes-1';
  source: string;
  allocations: string;
  demands: { id: string; admittedUnknown: number; refused: number; openDeficits: number; missing: number }[];
}
export const balanceAllocationKey = (p: UrbanProgramme): string => JSON.stringify(p.allocations.map(a =>
  [a.parcelId, a.demandId, a.function, a.role ?? null, a.households ?? null, a.unit]));

export function builtOutcomeSource(scene: PlacementBatch): string {
  return JSON.stringify([scene.generator_version, scene.buildings.map(b => [b.id,b.parcel_id,b.function,b.recipe_id,b.variant_id]),
    scene.refusals.map(r => [r.parcel_id,r.message]), scene.open_spaces.map(s => [s.parcel_id,s.deficit?.message ?? null])]);
}

export function createBuiltOutcomeBalance(partitions: readonly Partition[]) {
  const result = partitions.map(p => ({ ...p, ...(p.programme ? { programme: { ...p.programme,
    demands: p.programme.demands.map(d => ({ ...d, builtCapacity: 0, openCapacity: 0, deficit: d.requested,
      reasons: (d.reasons ?? []).filter(r => !['Built outcome: ', 'Building refusal: ', 'Architectural deficit: '].some(prefix=>r.startsWith(prefix))) })) } } : {}) }));
  const byParcel = new Map<string, { allocation: UrbanProgramme['allocations'][number]; demand: UrbanProgramme['demands'][number]; count: BuiltOutcomeBalance['demands'][number] }>();
  const reports = new Map<UrbanProgramme, BuiltOutcomeBalance>();
  const seen = new Set<string>();
  for (const partition of result) if (partition.programme) {
    const p = partition.programme, parcels = new Set(partition.parcels.map(v => v.id));
    const demands = new Map(p.demands.map(d => [d.id, d]));
    const report: BuiltOutcomeBalance = { version: 'built-outcomes-1', source: '', allocations: balanceAllocationKey(p),
      demands: p.demands.map(d => ({ id: d.id, admittedUnknown: 0, refused: 0, openDeficits: 0, missing: 0 })) };
    reports.set(p, report);
    for (const allocation of p.allocations) {
      const demand = demands.get(allocation.demandId), count = report.demands.find(d => d.id === allocation.demandId);
      if (!parcels.has(allocation.parcelId) || !demand || !count || byParcel.has(allocation.parcelId)
        || demand.function !== allocation.function || demand.unit !== allocation.unit) throw new Error('Invalid built balance allocation.');
      byParcel.set(allocation.parcelId, { allocation, demand, count });
    }
  }
  const outcome = (id: string) => {
    const found = byParcel.get(id);
    if (!found || seen.has(id)) throw new Error('Built balance outcome is unallocated or duplicated.');
    seen.add(id); return found;
  };
  let finished = false;
  return {
    /** Actual authenticated parent headers only. Function, floors and members
     * are deliberately not capacity inputs; no surrogate building is created. */
    appendUncertified(outcomes: readonly { parcel_id: string; kind: 'admitted' | 'refusal' | 'open'; message?: string }[]): void {
      if (finished) throw new Error('Built balance already completed.');
      for (const record of outcomes) {
        const { allocation, demand, count }=outcome(record.parcel_id);
        if (record.kind==='admitted') {
          count.admittedUnknown++;
          demand.reasons.push(`Built outcome: ${record.parcel_id}: admitted native parent; function, useful and household capacity unverified.`);
        } else if (record.kind==='refusal') {
          count.refused++; demand.reasons.push(`Built outcome: ${record.parcel_id}: refusal: ${record.message ?? 'reason unavailable'}`);
        } else {
          if (allocation.function==='market'||allocation.function==='common') count.missing++; else count.openDeficits++;
          demand.reasons.push(`Built outcome: ${record.parcel_id}: native open outcome; capacity unverified: ${record.message ?? 'reason unavailable'}`);
        }
      }
    },
    append(scene: PlacementBatch): void {
      if (finished) throw new Error('Built balance already completed.');
      if (!scene.generator_version.startsWith('architectural-plans-')) throw new Error('Built outcome balance requires compact native plans.');
      for (const b of scene.buildings) {
        const { allocation, demand, count } = outcome(b.parcel_id);
        if (b.function !== allocation.function || b.simplification !== 'architectural_plan') throw new Error('Built balance function or plan differs.');
        count.admittedUnknown++;
        demand.reasons.push(`Built outcome: ${b.parcel_id}: admitted native plan; useful and household capacity unknown.`);
      }
      for (const r of scene.refusals) {
        const { demand, count } = outcome(r.parcel_id); count.refused++;
        demand.reasons.push(`Built outcome: ${r.parcel_id}: refusal: ${r.message}`);
      }
      for (const space of scene.open_spaces) {
        const { allocation, demand, count } = outcome(space.parcel_id);
        if (allocation.function === 'market' || allocation.function === 'common') {
          // Open land has its own native geometric reconciliation. This compact
          // hook deliberately leaves it unknown until that proof is available.
          count.missing++;
          demand.reasons.push(`Built outcome: ${space.parcel_id}: native open land ${surfaceArea(space.surface).toFixed(3)}m2; open capacity unverified.`);
        } else {
          const d=space.deficit;
          if (d && (d.version!=='architectural-deficit-1' || d.request_id!==space.id || d.demand_id!==allocation.demandId
            || d.original_function!==allocation.function || d.role!==allocation.role || d.households!==allocation.households))
            throw new Error('Built balance deficit differs from its applied request.');
          count.openDeficits++;
          demand.reasons.push(`Built outcome: ${space.parcel_id}: open deficit: ${space.deficit?.message ?? 'native open outcome; reason unavailable'}`);
        }
      }
    },
    complete(source: string): Partition[] {
      if (finished) throw new Error('Built balance already completed.'); finished = true;
      for (const [id, { demand, count }] of byParcel) if (!seen.has(id)) {
        count.missing++; demand.reasons.push(`Built outcome: ${id}: native outcome unavailable; capacity unknown.`);
      }
      for (const [p, report] of reports) { report.source = source; p.builtBalance = report; }
      return result;
    },
  };
}

export function hasBuiltOutcomeBalance(p: UrbanProgramme, source: string): boolean {
  const b = p.builtBalance;
  return b?.version === 'built-outcomes-1' && b.source === source && b.allocations === balanceAllocationKey(p)
    && b.demands.length === p.demands.length && p.demands.every(d => {
      const count = b.demands.find(v => v.id === d.id);
      return count && [count.admittedUnknown, count.refused, count.openDeficits, count.missing].every(v => Number.isSafeInteger(v) && v >= 0)
        && count.admittedUnknown + count.refused + count.openDeficits + count.missing === p.allocations.filter(a => a.demandId === d.id).length
        && d.builtCapacity === 0 && (d.openCapacity ?? 0) === 0 && d.deficit === d.requested;
    });
}
