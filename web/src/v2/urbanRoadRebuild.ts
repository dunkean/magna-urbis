import type { World } from '../gen/types';
import type { Layout, Partition, UrbanProgramme } from '../../../rust/bridge/urban';
import type { RustTownSnapshot, RustTownResult } from './rustUrban';
import { generateRustTown, mergeHouseDelta, projectRustTown } from './rustUrban';
import type { V2Settings, ProgressCallback } from './contracts';
import { roadBlockScope } from './urbanRoadBlocks';
import { mpArea } from '../gen/geo/bool';
import { editableUrbanRoads } from './urbanRoadEditing';

export type Scope = { original: Layout; layout: Layout; rebuilt: Layout; affected: Set<number>; indices: number[] };
type Generate = typeof generateRustTown;
function localProgramme(p: UrbanProgramme | undefined, scope: Scope): UrbanProgramme | undefined {
  if (!p) return;
  const ids = new Map(scope.indices.map((id, i) => [id, i]));
  const full = mpArea(scope.original.blocks.map(b => b.shape)),
    area = mpArea(scope.layout.blocks.map(b => b.shape)),
    ratio = Math.min(1, area / Math.max(1, full));
  return {
    ...p,
    population: Math.max(1, Math.round(p.population * ratio)),
    builtBalance: undefined,
    housingCapacity: undefined,
    demands: p.demands.map(d => ({ ...d, requested: d.requested * ratio, targetArea: d.targetArea * ratio, parcelCapacity: 0, builtCapacity: 0, openCapacity: 0, deficit: d.requested * ratio })),
    allocations: [],
    adjacency: [],
    environment: p.environment.filter(e => ids.has(e.block)).map(e => ({ ...e, block: ids.get(e.block)! })),
    reservations: p.reservations.filter(r => ids.has(r.block)).map(r => ({ ...r, block: ids.get(r.block)! })),
  };
}
function mergeProgramme(old: UrbanProgramme | undefined, delta: UrbanProgramme | undefined, scope: Scope, removed: Set<string>): UrbanProgramme | undefined {
  if (!old) return delta;
  delta ??= { ...old, allocations: [], adjacency: [], environment: [], reservations: [], warnings: [], demands: old.demands.map(d => ({ ...d, builtCapacity: 0, parcelCapacity: 0 })) };
  const allocations = [...old.allocations.filter(a => !removed.has(a.parcelId)), ...delta.allocations];
  return {
    ...old,
    builtBalance: undefined,
    allocations,
    adjacency: [...old.adjacency.filter(a => !removed.has(a.a) && !removed.has(a.b)), ...delta.adjacency],
    environment: [...old.environment.filter(e => !scope.affected.has(e.block)), ...delta.environment.map(e => ({ ...e, block: scope.indices[e.block] }))],
    reservations: [...old.reservations.filter(r => !scope.affected.has(r.block)), ...delta.reservations.map(r => ({ ...r, block: scope.indices[r.block] }))],
    demands: old.demands.map(d => {
      const priorLocal = old.allocations.filter(a => a.demandId === d.id && removed.has(a.parcelId)).reduce((n, a) => n + a.capacity, 0),
        newLocal = delta.allocations.filter(a => a.demandId === d.id).reduce((n, a) => n + a.capacity, 0),
        parcelCapacity = Math.max(0, d.parcelCapacity - priorLocal + newLocal);
      return { ...d, parcelCapacity, builtCapacity: Math.max(0, d.builtCapacity - priorLocal + (delta.demands.find(n => n.id === d.id)?.builtCapacity ?? 0)), deficit: Math.max(0, d.requested - parcelCapacity) };
    }),
    warnings: [...new Set([...old.warnings, ...delta.warnings])],
  };
}
function mergePartitions(old: Partition[] | undefined, delta: Partition[] | undefined, scopes: Scope[]): Partition[] | undefined {
  // Scoped partitions index the blocks of their sub-layout: without the retained stage there is nothing to complete.
  if (!old) return undefined;
  return old.map(partition => {
    const scope = scopes.find(s => s.layout.key === partition.key),
      fresh = delta?.find(p => p.key === partition.key);
    if (!scope) return partition;
    const removed = new Set(partition.parcels.filter(p => scope.affected.has(p.block)).flatMap(p => (p.id ? [p.id] : [])));
    return {
      ...partition,
      parcels: [...partition.parcels.filter(p => !scope.affected.has(p.block)), ...(fresh?.parcels ?? []).map(p => ({ ...p, block: scope.indices[p.block] }))],
      programme: mergeProgramme(partition.programme, fresh?.programme, scope, removed),
      diagnostics: undefined,
      warnings: [...new Set([...partition.warnings, ...(fresh?.warnings ?? [])])],
    };
  });
}

/** Scope of the blocks `affected` of `original` (indices of `rebuilt`, its retained or road-cut plan): the sub-layout of
 * these blocks alone, with a programme scaled to their area. */
export function blockScope(original: Layout, rebuilt: Layout, affected: Set<number>): Scope {
  const indices = [...affected].filter(i => (rebuilt.blocks[i]?.shape.outer.length ?? 0) > 2);
  const scope: Scope = { original, rebuilt, affected, indices, layout: { ...rebuilt, blocks: indices.map(i => rebuilt.blocks[i]) } };
  const programme = localProgramme(original.programme, scope);
  // Keep all streets as frontage constraints, while making unedited land unavailable to native placement.
  scope.layout = { ...scope.layout, programme, claim: undefined, structure: scope.layout.structure ? { ...scope.layout.structure, allocated: scope.layout.blocks.map(b => b.shape), reserve: [], quays: [], waterways: scope.layout.structure.waterways } : undefined };
  return scope;
}

/** Regenerate the scoped blocks of one town (parcels, programme, sites, houses) through `through`, every other lot and
 * house retained. `settings` are those of the regeneration; the population is scaled to the scoped area. */
export async function rebuildTownBlocks(
  source: World,
  settings: V2Settings,
  key: string,
  previous: RustTownSnapshot,
  scopes: Scope[],
  through: RustTownSnapshot['stage'],
  onProgress?: ProgressCallback,
  generate: Generate = generateRustTown,
): Promise<{ snapshot: RustTownSnapshot; result?: RustTownResult; removed: Set<string> }> {
  const place = source.settlements?.find(t => t.key === key);
  if (!place) throw new Error(`Unknown place: ${key}`);
  const active = scopes.filter(s => s.affected.size);
  const removed = new Set<string>();
  for (const partition of previous.partitions ?? []) {
    const scope = active.find(s => s.layout.key === partition.key);
    if (scope) for (const parcel of partition.parcels) if (scope.affected.has(parcel.block) && parcel.id) removed.add(parcel.id);
  }
  // Native silhouette scenes may retain only site ids; these always identify their cadastral parcel.
  const localPopulation = Math.max(
    1,
    active.reduce((n, s) => n + (s.layout.programme?.population ?? Math.round((place.population * mpArea(s.layout.blocks.map(b => b.shape))) / Math.max(1, mpArea(s.original.blocks.map(b => b.shape))))), 0),
  );
  const localSettings: V2Settings = { ...settings, local: { ...settings.local, [key]: { ...settings.local[key], population: localPopulation } } };
  const available = active.filter(s => s.layout.blocks.length).map(s => s.layout);
  let result: RustTownResult | undefined;
  if (available.length) result = await generate(source, localSettings, key, onProgress, through, undefined, [], available);
  const fresh = result?.snapshot;
  const retain = <T extends { parcel_id: string }>(old: T[] | undefined, delta: T[] | undefined): T[] | undefined => (old || delta ? [...(old ?? []).filter(x => !removed.has(x.parcel_id)), ...(delta ?? [])] : undefined);
  let scene = previous.scene;
  if (scene && fresh?.scene) scene = mergeHouseDelta(scene, fresh.scene, removed);
  else if (scene) scene = { ...scene, buildings: scene.buildings.filter(b => !removed.has(b.parcel_id)), refusals: scene.refusals.filter(b => !removed.has(b.parcel_id)), open_spaces: scene.open_spaces.filter(b => !removed.has(b.parcel_id)) };
  else scene = fresh?.scene;
  const snapshot: RustTownSnapshot = {
    ...previous,
    layouts: scopes.map(s => s.rebuilt),
    scene,
    partitions: mergePartitions(previous.partitions, fresh?.partitions, active),
    // A cadastre the regeneration left in the engine (handle only) cannot be completed here.
    cadastralPartitions: fresh && !fresh.cadastralPartitions ? undefined : mergePartitions(previous.cadastralPartitions, fresh?.cadastralPartitions, active),
    programmePartitions: mergePartitions(previous.programmePartitions, fresh?.programmePartitions, active),
    sites: retain(previous.sites, fresh?.sites)?.map((site, offset) => ({ ...site, offset })),
    requests: retain(previous.requests, fresh?.requests),
    siteQuery: undefined,
    pendingRoadChanges: undefined,
    houseBaseline: undefined,
    capacityKey: undefined,
    lastBuildingRequests: fresh?.lastBuildingRequests ?? 0,
    warnings: [...new Set([...previous.warnings, ...(fresh?.warnings ?? [])])],
  };
  return { snapshot, result, removed };
}

/** Regenerate only road-touched native blocks. Quarters, streets and every other parcel/house are retained. */
export async function rebuildRoadBlocks(source: World, settings: V2Settings, keys: readonly string[], onProgress?: ProgressCallback, generate: Generate = generateRustTown): Promise<World> {
  const cities = { ...(source.debug?.v2RustCities ?? {}) } as Record<string, RustTownSnapshot>,
    updated = new Map<string, RustTownResult>();
  let count = 0;
  for (const key of keys) {
    const previous = cities[key],
      place = source.settlements?.find(t => t.key === key);
    if (!previous || !place) continue;
    const changes = previous.pendingRoadChanges;
    if (!changes) continue;
    const scopes = previous.layouts.map(original => {
      const scoped = roadBlockScope(original, changes);
      return blockScope(original, scoped.layout, scoped.affected);
    });
    const active = scopes.filter(s => s.affected.size);
    if (!active.length) {
      cities[key] = { ...previous, pendingRoadChanges: undefined };
      continue;
    }
    count += active.reduce((n, s) => n + s.affected.size, 0);
    const { snapshot, result } = await rebuildTownBlocks(source, settings, key, previous, scopes, previous.stage, onProgress, generate);
    const urban = projectRustTown(snapshot, place.population, place.culture);
    cities[key] = snapshot;
    updated.set(key, { snapshot, urban, stats: result?.stats ?? {} });
  }
  const main = source.settlements?.find(t => t.main),
    world: World = {
      ...source,
      debug: { ...source.debug, v2RustCities: cities },
      settlements: source.settlements?.map(t => (updated.has(t.key) ? { ...t, urban: updated.get(t.key)!.urban } : t)),
      ...(main && updated.has(main.key) ? { urban: updated.get(main.key)!.urban } : {}),
      stats: { ...source.stats, ...Object.assign({}, ...Array.from(updated.values(), r => r.stats)), 'v2.roadRebuiltBlocks': count },
    };
  delete world.debug!.v2UrbanRoadStamp;
  return editableUrbanRoads(world);
}
