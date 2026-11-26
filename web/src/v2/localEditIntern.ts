/**
 * Identity across a local town edit (`updateLocalTown`: one town rebuilt, everything else kept). The result crosses
 * the worker boundary as new objects; the display caches its products per object (render scene revisions, the native
 * city map's towns, the forest occupation). Re-attaching the previous objects for what the edit did not change keeps
 * the other towns, the countryside and the map products as they are, so only the edited town is displayed again.
 */
import type { Settlement, UrbanLayer, World } from '../gen/types';
import type { RustTownSnapshot } from './rustUrban';
import { nativeCityRecords } from './nativeProducts';
import { sameContent } from './terrainIntern';

/** The geometry of a native town's urban layer: a projection of its snapshot, the same when the snapshot is kept. */
const PROJECTED = new Set(['footprint', 'openEdgeGround', 'blocks', 'parcels', 'buildings', 'masses', 'backLand', 'footprintH', 'ruralReserve', 'blockInfo', 'phases', 'squares']);
const BUDGET = 16e6;

/** A town the edit did not rebuild comes back with the same recipe keys, stage and part counts (top-level fields only). */
function sameSnapshot(previous: RustTownSnapshot, next: RustTownSnapshot): boolean {
  const a = previous as unknown as Record<string, unknown>,
    b = next as unknown as Record<string, unknown>;
  for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[field],
      y = b[field];
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
    } else if ((x === null || typeof x !== 'object') && x !== y) return false;
  }
  return true;
}

function sameUrban(previous: UrbanLayer | undefined, next: UrbanLayer | undefined, projected: boolean, budget: { left: number }): boolean {
  if (!previous || !next) return previous === next;
  if (!projected) return sameContent(previous, next, budget);
  const a = previous as unknown as Record<string, unknown>,
    b = next as unknown as Record<string, unknown>;
  return Object.keys(b).every(field => PROJECTED.has(field) || sameContent(a[field], b[field], budget));
}

/** `next` (the result of a local edit of town `key` made from `previous`) with `previous`'s objects wherever their
 * content is the same: the terrain and the land use always (the edit keeps them), every other town's snapshot,
 * settlement and urban layer, the roads, bridges, names and debug products when unchanged. */
export function internLocalEdit(previous: World, next: World, key: string): World {
  const started = performance.now(),
    budget = { left: BUDGET };
  const before = nativeCityRecords(previous) ?? {},
    after = nativeCityRecords(next);
  const kept = new Set<string>();
  let cities: Record<string, RustTownSnapshot> | undefined;
  if (after) {
    cities = {};
    for (const [town, snapshot] of Object.entries(after)) {
      const old = before[town];
      if (town !== key && old && sameSnapshot(old, snapshot)) {
        cities[town] = old;
        kept.add(town);
      } else cities[town] = snapshot;
    }
  }
  // The edited town comes back whole: its buildings the edit did not change take their previous objects, so the
  // per-building products (the tilted view's meshes, worldVolumes.ts) and the blocks holding them are kept.
  const edited = after?.[key]?.scene?.buildings,
    held = before[key]?.scene?.buildings;
  if (edited && held?.length) {
    const byId = new Map(held.map(building => [building.id, building])),
      own = { left: BUDGET };
    for (let i = 0; i < edited.length; i++) {
      const old = byId.get(edited[i].id);
      if (old && sameContent(old, edited[i], own)) edited[i] = old;
    }
  }
  const native = (town: string): boolean => !!after?.[town];
  const keptTown = (town: string): boolean => town !== key && (native(town) ? kept.has(town) : !before[town]);
  const byKey = new Map(previous.settlements?.map(place => [place.key, place]));
  const sameOrNew = <T>(old: T, value: T): T => (sameContent(old, value, budget) ? old : value);
  let settlementsKept = previous.settlements?.length === next.settlements?.length;
  const settlements = next.settlements?.map((place, i): Settlement => {
    const old = byKey.get(place.key);
    const { urban: oldUrban, ...oldRest } = old ?? ({} as Settlement),
      { urban, ...rest } = place;
    const same = !!old && keptTown(place.key) && sameContent(oldRest, rest, budget) && sameUrban(oldUrban, urban, native(place.key), budget);
    settlementsKept &&= same && previous.settlements![i] === old;
    return same ? old! : place;
  });
  const main = next.settlements?.find(place => place.main);
  const urban = main && settlements?.find(place => place.key === main.key) === byKey.get(main.key) && sameUrban(previous.urban, next.urban, native(main.key), budget) ? previous.urban : next.urban;
  let debug = next.debug;
  if (debug) {
    debug = { ...debug };
    for (const [field, value] of Object.entries(debug)) if (field !== 'v2RustCities' && previous.debug && field in previous.debug) debug[field] = sameOrNew(previous.debug[field], value);
    if (cities) debug.v2RustCities = cities;
  }
  const world: World = {
    ...next,
    terrain: previous.terrain,
    landuse: previous.landuse,
    roads: sameOrNew(previous.roads, next.roads),
    bridges: sameOrNew(previous.bridges, next.bridges),
    names: sameOrNew(previous.names, next.names),
    site: sameOrNew(previous.site, next.site),
    options: sameOrNew(previous.options, next.options),
    settlements: settlementsKept ? previous.settlements : settlements,
    urban,
    ...(debug ? { debug } : {}),
  };
  performance.measure('v2:local-edit-intern', { start: started });
  return world;
}
