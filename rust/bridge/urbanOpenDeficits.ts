/** Carry an ACTUAL Core declaration through an ACTUAL Houses open result.
 * Requires the applied allocation/demand too. No geometry/amount is recomputed,
 * no marker is inferred at restore, and the input scene is never mutated. */
import type { Partition, UrbanAllocation, UrbanDemand } from './urban';
import type { ArchitecturalDeficit, PlacementBatch, PlacementRequest } from './urbanArchitecture';
const error = (message: string): never => { throw new Error('Déficit architectural : ' + message); };
const buildingFunctions = new Set(['domestic', 'mixed', 'workshop', 'warehouse', 'collective']);
/** One index per actual run, not once per page. Owns no geometry copies and
 * is never cached globally or shared with a replacement programme revision. */
export function prepareUrbanOpenDeficits(partitions: readonly Partition[]):
  (scene: PlacementBatch, requests: readonly PlacementRequest[]) => PlacementBatch {
  const applied = new Map<string, { allocation: UrbanAllocation; demand?: UrbanDemand }>();
  for (const partition of partitions) if (partition.programme) {
    const parcels = new Set(partition.parcels.map(parcel => parcel.id));
    const demands = new Map<string, UrbanDemand>();
    for (const demand of partition.programme.demands) if (!demands.has(demand.id)) demands.set(demand.id, demand);
    for (const allocation of partition.programme.allocations) {
      if (!parcels.has(allocation.parcelId) || applied.has(allocation.parcelId)) error('allocation absente du cadastre ou dupliquée.');
      applied.set(allocation.parcelId, { allocation, demand: demands.get(allocation.demandId) });
    }
  }
  return (scene, requests) => {
    if (!scene.open_spaces.length) return scene;
    // Only this page's actual requests are indexed for a bounded streamed join.
    const sources = new Map<string, PlacementRequest>();
    for (const request of requests) {
      if (!request || typeof request.parcel_id !== 'string' || sources.has(request.parcel_id)) error('requête source absente ou dupliquée.');
      sources.set(request.parcel_id, request);
    }
    let changed = false;
    const open_spaces = scene.open_spaces.map(space => {
      const origin = applied.get(space.parcel_id); if (!origin) return error('issue ouverte sans allocation retenue.');
      const { allocation, demand } = origin;
      if (allocation.function === 'market' || allocation.function === 'common') {
        if (space.deficit != null) error('un espace ouvert voulu ne peut pas porter un déficit architectural.');
        return space;
      }
      const request = sources.get(space.parcel_id), p = request?.programme, d = p?.deficit;
      if (!request || !request.id || request.function !== 'open_space' || space.id !== request.id
        || p?.role !== allocation.role || !d) return error('l’issue ouverte ne correspond pas à sa vraie requête Core déficitaire.');
      if (!buildingFunctions.has(allocation.function) || !allocation.role || !demand
        || demand.role !== allocation.role || demand.function !== allocation.function || demand.unit !== allocation.unit
        || !['pente', 'forme', 'source_absente'].includes(d.cause) || typeof d.message !== 'string' || !d.message.trim()
        || !Number.isFinite(d.households) || d.households < 0
        || typeof allocation.households !== 'number' || !Number.isFinite(allocation.households) || allocation.households < 0
        || d.households !== allocation.households) return error('demande, fonction, rôle ou quantité incompatibles avec l’allocation.');
      if (d.cause === 'source_absente') {
        const c = p?.source_coverage;
        if (!c || c.version !== 'functional-source-coverage-1' || c.status !== 'missing'
          || c.role !== allocation.role || c.function !== allocation.function || c.functional_footing_tested !== false
          || c.residential_fallback_is_functional_source !== false) error('déclaration de couverture fonctionnelle manquante.');
      }
      const deficit: ArchitecturalDeficit = { version: 'architectural-deficit-1', request_id: request.id,
        demand_id: allocation.demandId, original_function: allocation.function, role: allocation.role,
        cause: d.cause, households: d.households, message: d.message };
      if (space.deficit != null) {
        const old = space.deficit, keys = Object.keys(deficit) as (keyof ArchitecturalDeficit)[];
        if (Object.keys(old).length !== keys.length || keys.some(key => old[key] !== deficit[key])) error('marqueur conservé différent de la vraie requête.');
        return space;
      }
      changed = true; return { ...space, deficit };
    });
    return changed ? { ...scene, open_spaces } : scene;
  };
}
/** Compatibility convenience for an already bounded one-shot caller. Real
 * worker/fallback streams retain prepareUrbanOpenDeficits once per run. */
export function carryUrbanOpenDeficits(partitions: readonly Partition[], scene: PlacementBatch,
  requests: readonly PlacementRequest[]): PlacementBatch {
  return scene.open_spaces.length ? prepareUrbanOpenDeficits(partitions)(scene, requests) : scene;
}
