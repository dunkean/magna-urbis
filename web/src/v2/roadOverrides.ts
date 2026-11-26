import type { Polyline, World } from '../gen/types';
import type { ExitReport, RoadClass } from '../../../rust/bridge/settlements';
import { replaceRoadPieces, roadClassOf, roadSource, samePath } from './networkEdits';
import { refreshRoadExitConnections, roadExitReports, roadOutput, withRoadExitReports } from './roadEditing';
import type { UrbanStreetEdit } from './urbanRoadEditing';
import type { RustTownSnapshot } from './rustUrban';

export interface RoadPiece {
  path: Polyline;
  width: number;
  cls: RoadClass;
  controls?: Polyline;
  routingVariant?: number;
  sites?: [string | null, string | null];
}
export interface RoadOverrides {
  /** Source road before the editor split it at junctions. An empty list removes it. */
  routes?: Record<string, RoadPiece[]>;
  towns?: Record<string, UrbanStreetEdit[]>;
  exits?: Record<string, { report: ExitReport; present: boolean }>;
  /** The exit editor can enable roads on a formerly roadless map. */
  fromDisabled?: boolean;
}

const sources = new WeakMap<World, World>();
/** Tag the unsplit roads once, before the editor inserts rural junctions or town streets. */
export function withRoadSources(world: World): World {
  const cached = sources.get(world);
  if (cached) return cached;
  const roads = world.roads;
  const next = roads?.some(r => !r.urban && !r.editorSource) ? { ...world, roads: roads.map(r => (r.urban || r.editorSource ? r : { ...r, editorSource: roadSource(r.path) })) } : world;
  sources.set(world, next);
  sources.set(next, next);
  return next;
}

function groups(world: World): Map<string, RoadPiece[]> {
  const result = new Map<string, RoadPiece[]>(),
    output = roadOutput(world);
  world.roads?.forEach((r, index) => {
    if (r.urban) return;
    const source = r.editorSource ?? roadSource(r.path),
      list = result.get(source) ?? [];
    const edge = output?.segments[index];
    const a = edge && output?.junctions[edge.a]?.site,
      b = edge && output?.junctions[edge.b]?.site;
    list.push({ path: r.path, width: r.width, cls: roadClassOf(world, index), ...(r.controls ? { controls: r.controls } : {}), ...(r.routingVariant ? { routingVariant: r.routingVariant } : {}), ...(a || b ? { sites: [a ?? null, b ?? null] } : {}) });
    result.set(source, list);
  });
  return result;
}
const samePieces = (a: RoadPiece[], b: RoadPiece[]): boolean =>
  a.length === b.length &&
  a.every((p, i) => {
    const q = b[i];
    return p.width === q.width && p.cls === q.cls && p.routingVariant === q.routingVariant && p.sites?.[0] === q.sites?.[0] && p.sites?.[1] === q.sites?.[1] && (p.path === q.path || samePath(p.path, q.path)) && (p.controls === q.controls || samePath(p.controls, q.controls));
  });
const exitKey = (e: ExitReport): string => JSON.stringify([e.requested, e.class, e.gateway, e.point?.x, e.point?.y]);

/** A road transaction replaces just the edited sources. The settings and undo records share immutable geometry. */
export function recordRoadOverrides(previous: RoadOverrides | undefined, before: World, next: World, wasDisabled = false): RoadOverrides | undefined {
  const routes = { ...previous?.routes },
    a = groups(before),
    b = groups(next);
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(key) ?? [],
      parts = b.get(key) ?? [];
    if (samePieces(old, parts)) continue;
    if (!parts.length && key.startsWith('draw:')) delete routes[key];
    else routes[key] = parts;
  }
  const towns = { ...previous?.towns },
    native = next.debug?.v2RustCities as Record<string, RustTownSnapshot> | undefined;
  const legacy = next.debug?.v2LegacyStreetEdits as Record<string, UrbanStreetEdit[]> | undefined;
  for (const [town, edits] of [...Object.entries(legacy ?? {}), ...Object.entries(native ?? {}).map(([key, s]) => [key, s.streetEdits] as const)]) {
    if (edits?.length) towns[town] = edits;
  }
  const exits = { ...previous?.exits };
  const oldExits = new Map(roadExitReports(before).map(e => [exitKey(e), e])),
    newExits = new Map(roadExitReports(next).map(e => [exitKey(e), e]));
  for (const key of new Set([...oldExits.keys(), ...newExits.keys()])) {
    const present = newExits.has(key);
    if (oldExits.has(key) === present) continue;
    if (exits[key] && exits[key].present !== present) delete exits[key];
    else exits[key] = { report: (newExits.get(key) ?? oldExits.get(key))!, present };
  }
  const result: RoadOverrides = {};
  if (Object.keys(routes).length) result.routes = routes;
  if (Object.keys(towns).length) result.towns = towns;
  if (Object.keys(exits).length) {
    result.exits = exits;
    if (previous?.fromDisabled || wasDisabled) result.fromDisabled = true;
  }
  return Object.keys(result).length ? result : undefined;
}

function applyRoutes(world: World, routes: Record<string, RoadPiece[]>): World {
  if (!Object.keys(routes).length) return world;
  const remove: number[] = [];
  world.roads?.forEach((r, i) => {
    if (!r.urban && Object.hasOwn(routes, r.editorSource ?? roadSource(r.path))) remove.push(i);
  });
  const parts = Object.entries(routes).flatMap(([source, pieces]) => pieces.map(p => ({ ...p, source })));
  return replaceRoadPieces(world, remove, parts);
}

/** Apply the recipe to a freshly routed graph, before generation consumes its roads. */
export function replayRegionalRoads(world: World, edits?: RoadOverrides): World {
  if (!edits?.routes && !edits?.exits) return world;
  const routes = edits.routes ?? {};
  let next = applyRoutes(world, routes);
  if (Object.keys(routes).some(key => key.startsWith('rural:'))) next = clearReplacedDrives(next, routes);
  if (edits.exits) {
    const exits = roadExitReports(next).filter(e => !Object.hasOwn(edits.exits!, exitKey(e)));
    next = withRoadExitReports(next, [
      ...exits,
      ...Object.values(edits.exits)
        .filter(ex => ex.present)
        .map(ex => ex.report),
    ]);
  }
  return next === world ? world : refreshRoadExitConnections(next);
}

/** Edited farm drives and field lanes now live in the road graph. Remove their regenerated originals. */
export function replayRuralRoads(world: World, saved: NonNullable<RoadOverrides['routes']>): void {
  const routes = Object.fromEntries(Object.entries(saved).filter(([key]) => key.startsWith('rural:')));
  if (!Object.keys(routes).length) return;
  // A town-only build may retain the already edited graph while regenerating farm geometry.
  const installed = world.roads?.some(r => r.editorSource?.startsWith('rural:')) ? groups(world) : new Map<string, RoadPiece[]>();
  const changed = Object.fromEntries(Object.entries(routes).filter(([key, parts]) => !samePieces(installed.get(key) ?? [], parts)));
  Object.assign(world, clearReplacedDrives(applyRoutes(world, changed), routes));
}

function clearReplacedDrives(world: World, routes: Record<string, RoadPiece[]>): World {
  const land = world.landuse;
  if (!land) return world;
  const edited = (path?: Polyline) => !!path && path.length > 1 && Object.hasOwn(routes, roadSource(path, 'rural'));
  if (!land.ways?.some(edited) && !land.farmsteads.some(farm => edited(farm.drive))) return world;
  return { ...world, landuse: { ...land, ways: land.ways?.filter(path => !edited(path)), farmsteads: land.farmsteads.map(farm => (edited(farm.drive) ? { ...farm, drive: [] } : farm)) } };
}
