/**
 * Direct in-memory edits of the regional network: roads with their native segments, junctions, crossings and
 * bridges, and rivers deleted with every upstream tributary in both the projected and the retained native hydrology.
 *
 * Every edit returns a new World. Unchanged products stay shared by reference. Each rewritten product (roads, native
 * road output, bridges, land use, names, terrain water, native water network) is a new object, so identity-keyed
 * caches see the change: render scene revisions, activity-site lists, forest occupation, settlement rasters and the
 * worker snapshot. A retained pristine world is never mutated. There is no action log: regenerating a stage replaces
 * these edits.
 */
import type { World, Vec2, Polyline, River, TerrainLayer, SiteFields } from '../gen/types';
import type { NameEntry } from '../gen/names/types';
import type { RoadClass, RoadCrossing, RoadOutput, RoadSegment, RoadSurface } from '../../../rust/bridge/settlements';
import type { TerrainData } from '../../../rust/bridge/terrain';
import type { HydrologyData } from '../../../rust/bridge/hydrology';
import type { RiverLine, RiverNetwork } from '../ui/riverVectors';
import type { V2Settings } from './contracts';
import { dist, distToPolyline, polylineLength, resample } from '../gen/core/geom';
import { cellIndex, forCellsNearPolyline } from '../gen/core/field';
import { sampleGrid } from '../gen/core/grid';
import { roadCorridor } from '../render/forestRoom';
import { deleteGridRiver, type GridRiverDeletion } from './gridRiverDeletion';

export type RegionalRoad = NonNullable<World['roads']>[number];
export type Bridge = NonNullable<World['bridges']>[number];
export type { RoadClass };
/** Same order as the Rust `CLASSES`: a class index of 3 or more may ford a brook. */
export const ROAD_CLASS_ORDER: readonly RoadClass[] = ['highway', 'main', 'local', 'track', 'trail'];
/** Fallback widths (m) when the network has no road of that class to copy. */
export const ROAD_CLASS_WIDTH: Readonly<Record<RoadClass, number>> = { highway: 7, main: 5.5, local: 4, track: 3, trail: 1.6 };
export const roadKindOf = (cls: RoadClass): RegionalRoad['kind'] => cls === 'highway' || cls === 'main' ? 'major' : cls === 'local' ? 'minor' : 'track';
const classOfKind = (kind: RegionalRoad['kind']): RoadClass => kind === 'major' ? 'main' : kind === 'minor' ? 'local' : 'track';
const MAX_ROAD_POINTS = 5000;

interface RegionSnapshot { placement?: unknown; roads?: RoadOutput | null }
const regionOf = (world: World): RegionSnapshot | undefined => world.debug?.v2RustRegion as RegionSnapshot | undefined;
type NativeTerrainLayer = TerrainLayer & { v2NativeTerrain?: TerrainData; v2CityGround?: unknown };

/**
 * String-keyed engine caches (settlement routing raster, native urban terrain, resource payloads) key on
 * `v2.terrainKey` plus this revision; the recipe key itself stays unchanged so the edited terrain still matches its settings.
 */
export const WATER_EDIT_REVISION = 'v2.waterEditRevision';

// ---------------------------------------------------------------------------------------------------------------
// Geometry
export interface PolylineHit { distance: number; segment: number; t: number; point: Vec2 }
export function nearestOnPolyline(path: Polyline, p: Vec2): PolylineHit {
  let best: PolylineHit = { distance: Infinity, segment: 0, t: 0, point: path[0] ?? p };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.distance) best = { distance: d, segment: i - 1, t, point: q };
  }
  return best;
}
/** Distance along the path of a hit. */
function along(path: Polyline, hit: Pick<PolylineHit, 'segment' | 't'>): number {
  let s = 0;
  for (let i = 1; i <= hit.segment; i++) s += dist(path[i - 1], path[i]);
  return s + dist(path[hit.segment], path[hit.segment + 1] ?? path[hit.segment]) * hit.t;
}
const samePoint = (a: Vec2, b: Vec2, eps = 1e-6): boolean => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
/** Same polyline geometry; labels and corridors may hold structured-cloned copies of a road or river path. */
export function samePath(a: Polyline | undefined, b: Polyline | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!samePoint(a[i], b[i])) return false;
  return true;
}
const pathMid = (path: Polyline): Vec2 => {
  const total = polylineLength(path);
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const l = dist(path[i - 1], path[i]);
    if (acc + l >= total / 2) { const t = l ? (total / 2 - acc) / l : 0; return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t }; }
    acc += l;
  }
  return { ...path[0] };
};

/** Validated, clamped copy of a user path; consecutive duplicates are dropped. */
export function normalizeRoadPath(path: readonly Vec2[], mapSize: number): Polyline {
  if (!Array.isArray(path) || path.length > MAX_ROAD_POINTS) throw new Error('Invalid road path.');
  const out: Polyline = [];
  for (const p of path) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('Invalid road path.');
    const q = { x: Math.max(0, Math.min(mapSize, p.x)), y: Math.max(0, Math.min(mapSize, p.y)) };
    if (!out.length || !samePoint(out[out.length - 1], q, 1e-3)) out.push(q);
  }
  if (out.length < 2) throw new Error('A road needs two distinct points.');
  return out;
}
/** Insert a control point on the nearest leg of the path. */
export function insertControlPoint(path: Polyline, p: Vec2): { path: Polyline; index: number } {
  const hit = nearestOnPolyline(path, p), index = hit.segment + 1;
  return { path: [...path.slice(0, index), { x: p.x, y: p.y }, ...path.slice(index)], index };
}
export function removeControlPoint(path: Polyline, index: number): Polyline {
  if (path.length <= 2 || index < 0 || index >= path.length) return path.slice();
  return path.filter((_, i) => i !== index);
}
export function moveControlPoint(path: Polyline, index: number, p: Vec2): Polyline {
  return path.map((q, i) => i === index ? { x: p.x, y: p.y } : q);
}
export const translatePath = (path: Polyline, dx: number, dy: number): Polyline => path.map(p => ({ x: p.x + dx, y: p.y + dy }));

// ---------------------------------------------------------------------------------------------------------------
// Picking
export function roadAt(world: World, p: Vec2, tolerance: number): ({ index: number } & PolylineHit) | undefined {
  let best: ({ index: number } & PolylineHit) | undefined;
  const roads = world.roads ?? [];
  for (let index = 0; index < roads.length; index++) {
    const road = roads[index];
    if (road.path.length < 2) continue;
    const hit = nearestOnPolyline(road.path, p), reach = tolerance + road.width / 2;
    if (hit.distance <= reach && (!best || hit.distance < best.distance)) best = { index, ...hit };
  }
  return best;
}
export function riverAt(world: World, p: Vec2, tolerance: number): ({ index: number } & PolylineHit) | undefined {
  let best: ({ index: number } & PolylineHit) | undefined;
  const rivers = world.terrain.rivers;
  for (let index = 0; index < rivers.length; index++) {
    const river = rivers[index];
    if (river.path.length < 2) continue;
    const hit = nearestOnPolyline(river.path, p), w = Math.max(river.width[hit.segment] ?? 0, river.width[hit.segment + 1] ?? 0);
    if (hit.distance <= tolerance + w / 2 && (!best || hit.distance < best.distance)) best = { index, ...hit };
  }
  return best;
}
/** Native class of a road: its segment's class, else the closest class of its world kind. */
export function roadClassOf(world: World, index: number): RoadClass {
  const segments = alignedOutput(world)?.segments;
  return segments?.[index]?.class ?? classOfKind(world.roads?.[index]?.kind ?? 'track');
}
/** Points a road end can snap to: native junctions, or road ends and settlement centres without a native output. */
export function junctionPoints(world: World): { point: Vec2; site: string | null }[] {
  const output = alignedOutput(world);
  if (output) return output.junctions.map(j => ({ point: j.point, site: j.site }));
  return [...(world.roads ?? []).flatMap(road => road.path.length > 1 ? [{ point: road.path[0], site: null }, { point: road.path[road.path.length - 1], site: null }] : []),
    ...(world.settlements ?? []).map(s => ({ point: s.center, site: s.key }))];
}
function alignedOutput(world: World): RoadOutput | undefined {
  const output = regionOf(world)?.roads;
  return output && output.segments.length === (world.roads?.length ?? 0) ? output : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Water sampling, crossings and grades (ported from the Rust router so edited and generated roads agree)
interface WaterSampler { cell: number; water: Uint8Array; riverWidth: Float32Array; index(p: Vec2): number }
const samplers = new WeakMap<object, WaterSampler>();
function waterSampler(terrain: TerrainLayer): WaterSampler {
  const cached = samplers.get(terrain.water);
  if (cached) return cached;
  const grid = terrain.height, riverWidth = new Float32Array(grid.w * grid.h);
  for (const river of terrain.rivers) for (let j = 1; j < river.path.length; j++) {
    const width = Math.max(river.width[j - 1] ?? 1, river.width[j] ?? 1);
    forCellsNearPolyline([river.path[j - 1], river.path[j]], grid.w, grid.h, grid.cell, Math.max(grid.cell * .8, width / 2), i => {
      if (terrain.water[i] === 3 && width > riverWidth[i]) riverWidth[i] = width;
    });
  }
  const sampler = { cell: grid.cell, water: terrain.water, riverWidth, index: (p: Vec2) => cellIndex(grid, p) };
  samplers.set(terrain.water, sampler);
  return sampler;
}
/** Wet runs along a road (lake: causeway; narrow river on a track or trail: ford; else bridge), like Rust `crossings`. */
export function roadCrossings(terrain: TerrainLayer, path: Polyline, cls: RoadClass): RoadCrossing[] {
  const f = waterSampler(terrain), classIndex = ROAD_CLASS_ORDER.indexOf(cls), GAP = 6, out: RoadCrossing[] = [];
  let run: Vec2[] = [], kind = 0, widest = 0, dry = 0, previous = path[0];
  const flush = (): void => {
    run.length -= Math.max(0, dry - 1);
    if (run.length > 1) out.push({ kind: kind === 2 ? 'causeway' : widest < 3.5 && classIndex >= 3 ? 'ford' : 'bridge', path: run });
    run = [];
  };
  for (let s = 1; s < path.length; s++) {
    const a = path[s - 1], b = path[s], steps = Math.max(1, Math.ceil(dist(a, b) / (f.cell * .25)));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, i = f.index(p), w = f.water[i];
      if (w === 2 || w === 3) {
        if (run.length && w !== kind) flush();
        if (!run.length) { run.push(previous); widest = 0; }
        kind = w; widest = Math.max(widest, f.riverWidth[i]); run.push(p); dry = 0;
      } else if (run.length) {
        run.push(p); dry++;
        if (dry > GAP) { flush(); dry = 0; }
      }
      previous = p;
    }
  }
  flush();
  return out;
}
/** Steepest grade between samples about one cell apart, on dry ground. */
export function roadGrade(terrain: TerrainLayer, path: Polyline): number {
  const total = polylineLength(path);
  if (!(total > 0)) return 0;
  const f = waterSampler(terrain), samples = resample(path, terrain.height.cell);
  let grade = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], d = dist(a, b);
    if (d <= 0 || f.water[f.index(a)] || f.water[f.index(b)]) continue;
    grade = Math.max(grade, Math.abs(sampleGrid(terrain.height, b.x, b.y) - sampleGrid(terrain.height, a.x, a.y)) / d);
  }
  return grade;
}
const bridgesOf = (segment: Pick<RoadSegment, 'crossings' | 'width'>): Bridge[] =>
  segment.crossings.filter(c => c.kind === 'bridge').map(c => ({ a: c.path[0], b: c.path[c.path.length - 1], width: segment.width }));

// ---------------------------------------------------------------------------------------------------------------
// Road edits
export interface RoadEditOptions {
  /** Snap distance (m) for changed road ends: junctions, settlement centres, then other roads (split into a T). 0: no snapping. */
  snap?: number;
  cls?: RoadClass;
  width?: number;
}
export interface NetworkEditResult { world: World; road?: number }
interface Change { old?: Polyline; next?: RegionalRoad }
interface Draft {
  world: World;
  roads: RegionalRoad[];
  /** Cloned native output aligned with `roads` (segment i = road i), when the world has one. */
  output?: RoadOutput;
  /** Base bridges for worlds without a native output, maintained per road. */
  baseBridges: Bridge[];
  changes: Change[];
}
function draft(world: World): Draft {
  const source = alignedOutput(world);
  const output = source && { ...source, segments: source.segments.slice(), junctions: source.junctions.map(j => ({ ...j })), warnings: source.warnings.slice(),
    unreachable: source.unreachable.slice(), lengthByClass: { ...source.lengthByClass }, lengthBySurface: { ...source.lengthBySurface }, ...(source.nodes ? { nodes: source.nodes.slice() } : {}) };
  const base = (world.debug?.v2BaseBridges as Bridge[] | undefined) ?? world.bridges ?? [];
  return { world, roads: (world.roads ?? []).slice(), output, baseBridges: base.slice(), changes: [] };
}
function newJunction(d: Draft, point: Vec2, site: string | null = null): number {
  d.output!.junctions.push({ point: { x: point.x, y: point.y }, degree: 0, site });
  return d.output!.junctions.length - 1;
}
/** Bridges on a road without a native segment: those lying on its old centre line. */
function ownsBridge(path: Polyline, width: number, bridge: Bridge, cell: number): boolean {
  const reach = width / 2 + 2 * cell;
  return distToPolyline({ x: (bridge.a.x + bridge.b.x) / 2, y: (bridge.a.y + bridge.b.y) / 2 }, path) <= reach
    && distToPolyline(bridge.a, path) <= reach + width && distToPolyline(bridge.b, path) <= reach + width;
}
/** Split road `k` at a point of its interior; both halves keep the road's class and crossings. Returns the junction (native) or -1. */
function splitRoad(d: Draft, k: number, hit: PolylineHit): number {
  const road = d.roads[k], p = road.path, point = { x: hit.point.x, y: hit.point.y };
  const first = [...p.slice(0, hit.segment + 1), point], second = [point, ...p.slice(hit.segment + 1)];
  d.roads[k] = { ...road, path: first }; d.roads.push({ ...road, path: second });
  d.changes.push({ old: road.path, next: d.roads[k] }, { next: d.roads[d.roads.length - 1] });
  if (!d.output) return -1;
  const segment = d.output.segments[k], cut = along(p, hit), junction = newJunction(d, point);
  const firstCrossings: RoadCrossing[] = [], secondCrossings: RoadCrossing[] = [];
  for (const crossing of segment.crossings) {
    const mid = crossing.path[Math.floor(crossing.path.length / 2)];
    (along(p, nearestOnPolyline(p, mid)) <= cut ? firstCrossings : secondCrossings).push(crossing);
  }
  d.output.segments[k] = { ...segment, b: junction, path: first, length: polylineLength(first), crossings: firstCrossings };
  d.output.segments.push({ ...segment, a: junction, path: second, length: polylineLength(second), crossings: secondCrossings });
  return junction;
}
/** Attach a changed road end: native junction, settlement centre, T on another road, else a new free end. */
function attachEnd(d: Draft, p: Vec2, snap: number, exclude: number): { point: Vec2; junction: number } {
  const free = (): { point: Vec2; junction: number } => ({ point: p, junction: d.output ? newJunction(d, p) : -1 });
  if (!(snap > 0)) return free();
  let best: { point: Vec2; junction: number; distance: number } | undefined;
  if (d.output) for (let index = 0; index < d.output.junctions.length; index++) {
    const j = d.output.junctions[index], distance = dist(j.point, p);
    if (distance <= snap && (!best || distance < best.distance)) best = { point: j.point, junction: index, distance };
  } else for (let index = 0; index < d.roads.length; index++) {
    const road = d.roads[index];
    if (index === exclude || road.path.length < 2) continue;
    for (const end of [road.path[0], road.path[road.path.length - 1]]) { const distance = dist(end, p); if (distance <= snap && (!best || distance < best.distance)) best = { point: end, junction: -1, distance }; }
  }
  if (best) return { point: { ...best.point }, junction: best.junction };
  const place = (d.world.settlements ?? []).filter(s => dist(s.center, p) <= snap).sort((a, b) => dist(a.center, p) - dist(b.center, p))[0];
  if (place) {
    if (!d.output) return { point: { ...place.center }, junction: -1 };
    const existing = d.output.junctions.findIndex(j => j.site === place.key);
    return existing >= 0 ? { point: { ...d.output.junctions[existing].point }, junction: existing } : { point: { ...place.center }, junction: newJunction(d, place.center, place.key) };
  }
  let road: ({ index: number } & PolylineHit) | undefined;
  for (let index = 0; index < d.roads.length; index++) {
    const candidate = d.roads[index];
    if (index === exclude || candidate.path.length < 2) continue;
    const hit = nearestOnPolyline(candidate.path, p);
    if (hit.distance <= snap && (!road || hit.distance < road.distance)) road = { index, ...hit };
  }
  if (road) {
    const path = d.roads[road.index].path, start = path[0], end = path[path.length - 1];
    if (dist(road.point, start) <= snap / 2 || dist(road.point, end) <= snap / 2) {
      const atStart = dist(road.point, start) <= dist(road.point, end), segment = d.output?.segments[road.index];
      return { point: { ...(atStart ? start : end) }, junction: segment ? (atStart ? segment.a : segment.b) : -1 };
    }
    return { point: { ...road.point }, junction: splitRoad(d, road.index, road) };
  }
  return free();
}
function typicalWidth(d: Draft, cls: RoadClass): number {
  const widths = d.output ? d.output.segments.filter(s => s.class === cls).map(s => s.width) : d.roads.filter(r => r.kind === roadKindOf(cls)).map(r => r.width);
  if (!widths.length) return ROAD_CLASS_WIDTH[cls];
  widths.sort((a, b) => a - b);
  return widths[widths.length >> 1];
}
function segmentTemplate(d: Draft, cls: RoadClass): Pick<RoadSegment, 'surface' | 'profile'> {
  const segments = d.output?.segments ?? [], same = segments.filter(s => s.class === cls), pool = same.length ? same : segments;
  const count = <K extends 'surface' | 'profile'>(key: K): RoadSegment[K] | undefined => {
    const tally = new Map<RoadSegment[K], number>();
    for (const s of pool) tally.set(s[key], (tally.get(s[key]) ?? 0) + 1);
    return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const fallback: RoadSurface = cls === 'highway' ? 'paved' : cls === 'main' ? 'gravel' : 'dirt';
  return { surface: count('surface') ?? fallback, profile: count('profile') ?? 'medieval' };
}
/** Write road `index`, or append a new road when `index` is -1, with its native segment, crossings and bridges. Returns its index. */
function writeRoad(d: Draft, index: number, rawPath: Polyline, options: RoadEditOptions): number {
  const terrain = d.world.terrain, old = index >= 0 ? d.roads[index] : undefined, oldSegment = index >= 0 ? d.output?.segments[index] : undefined;
  const cls = options.cls ?? oldSegment?.class ?? (old ? classOfKind(old.kind) : 'local');
  const width = options.width ?? (old && !options.cls ? old.width : oldSegment && options.cls === oldSegment.class ? oldSegment.width : typicalWidth(d, cls));
  if (!(width > 0 && width < 200)) throw new Error('Invalid road width.');
  const snapped = normalizeRoadPath(rawPath, d.world.mapSize), snap = options.snap ?? 0;
  let a = oldSegment?.a ?? -1, b = oldSegment?.b ?? -1;
  // Ends that moved are re-attached (possibly splitting another road into a T); an unchanged end keeps its junction.
  if (!old || !samePoint(old.path[0], snapped[0])) { const end = attachEnd(d, snapped[0], snap, index); snapped[0] = end.point; a = end.junction; }
  const last = snapped.length - 1;
  if (!old || !samePoint(old.path[old.path.length - 1], snapped[last])) { const end = attachEnd(d, snapped[last], snap, index); snapped[last] = end.point; b = end.junction; }
  const path = snapped.filter((p, i) => i === 0 || !samePoint(snapped[i - 1], p, 1e-3));
  if (path.length < 2) throw new Error('A road needs two distinct points.');
  const road: RegionalRoad = { path, kind: roadKindOf(cls), width };
  const crossings = roadCrossings(terrain, path, cls), at = index >= 0 ? index : d.roads.length;
  d.roads[at] = road; d.changes.push({ old: old?.path, next: road });
  if (d.output) {
    d.output.segments[at] = { ...(oldSegment ?? { importance: 0, ...segmentTemplate(d, cls) }), class: cls, width, a, b, path, crossings,
      length: polylineLength(path), grade: roadGrade(terrain, path) } as RoadSegment;
  } else {
    if (old) d.baseBridges = d.baseBridges.filter(bridge => !ownsBridge(old.path, old.width, bridge, terrain.height.cell));
    d.baseBridges.push(...bridgesOf({ crossings, width }));
  }
  return at;
}
function removeRoad(d: Draft, index: number): void {
  const old = d.roads[index];
  if (!old) throw new Error('Unknown road.');
  d.roads.splice(index, 1); d.output?.segments.splice(index, 1);
  if (!d.output) d.baseBridges = d.baseBridges.filter(bridge => !ownsBridge(old.path, old.width, bridge, d.world.terrain.height.cell));
  d.changes.push({ old: old.path });
}
const NODE_REACH = 40;
function commit(d: Draft, extra: { terrain?: TerrainLayer; site?: World['site'] } = {}): World {
  const world = d.world, debug = { ...world.debug };
  let base = d.baseBridges;
  const output = d.output;
  if (output) {
    // Junction degrees, orphan ends (settlement junctions are kept), aggregate lengths and the network nodes left on a removed road.
    const degree = new Array<number>(output.junctions.length).fill(0);
    for (const s of output.segments) { if (s.a >= 0) degree[s.a]++; if (s.b >= 0) degree[s.b]++; }
    const sites = new Set((world.settlements ?? []).map(s => s.key)), remap = new Int32Array(output.junctions.length).fill(-1), junctions: RoadOutput['junctions'] = [];
    output.junctions.forEach((j, i) => { if (degree[i] > 0 || (j.site && sites.has(j.site))) { remap[i] = junctions.length; junctions.push({ ...j, degree: degree[i] }); } });
    output.junctions = junctions;
    output.segments = output.segments.map(s => remap[s.a] === s.a && remap[s.b] === s.b ? s : { ...s, a: remap[s.a], b: remap[s.b] });
    output.lengthByClass = {}; output.lengthBySurface = {};
    for (const s of output.segments) {
      output.lengthByClass[s.class] = (output.lengthByClass[s.class] ?? 0) + s.length;
      output.lengthBySurface[s.surface] = (output.lengthBySurface[s.surface] ?? 0) + s.length;
    }
    const removed = d.changes.flatMap(c => c.old ? [c.old] : []);
    if (output.nodes && removed.length) output.nodes = output.nodes.filter(node => {
      const p = node.access ?? { x: node.x, y: node.y };
      return !removed.some(path => distToPolyline(p, path) <= NODE_REACH) || d.roads.some(road => distToPolyline(p, road.path) <= NODE_REACH);
    });
    base = output.segments.flatMap(bridgesOf);
    debug.v2RustRegion = { ...regionOf(world), roads: output };
  }
  const town = debug.v2TownBridges as Record<string, Bridge[]> | undefined;
  const townBridges = town ? Object.keys(town).sort().flatMap(key => town[key]) : [];
  debug.v2BaseBridges = base;
  const next: World = { ...world, ...extra, roads: d.roads, bridges: [...base, ...townBridges], debug,
    stats: { ...world.stats, 'v2.regionalRoads': d.roads.length, 'v2.baseBridges': base.length } };
  if (world.landuse && d.changes.length) {
    // A new land-use object re-derives the forest room from the edited roads; retained corridors follow the edit.
    const corridors = world.landuse.forestCorridors;
    next.landuse = { ...world.landuse, ...(corridors ? { forestCorridors: [
      ...corridors.filter(c => !d.changes.some(change => change.old && samePath(change.old, c.path))),
      ...d.changes.flatMap(change => change.next ? [roadCorridor(change.next.path, change.next.width)] : []),
    ] } : {}) };
  }
  if (world.names) {
    let names = false;
    const entries = world.names.entries.flatMap((entry): NameEntry[] => {
      if (entry.kind !== 'road' || !entry.path) return [entry];
      const change = d.changes.find(c => c.old && samePath(c.old, entry.path));
      if (!change) return [entry];
      names = true;
      return change.next ? [{ ...entry, path: change.next.path, anchor: pathMid(change.next.path) }] : [];
    });
    if (names) next.names = { ...world.names, entries };
  }
  return next;
}
function roadIndex(world: World, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= (world.roads?.length ?? 0)) throw new Error('Unknown road.');
}
export function addRoad(world: World, path: Polyline, options: RoadEditOptions = {}): NetworkEditResult {
  const d = draft(world), index = writeRoad(d, -1, path, { cls: 'local', ...options });
  return { world: commit(d), road: index };
}
export function setRoadPath(world: World, index: number, path: Polyline, options: RoadEditOptions = {}): NetworkEditResult {
  roadIndex(world, index);
  const d = draft(world);
  writeRoad(d, index, path, options);
  return { world: commit(d), road: index };
}
export function translateRoad(world: World, index: number, dx: number, dy: number, options: RoadEditOptions = {}): NetworkEditResult {
  roadIndex(world, index);
  return setRoadPath(world, index, translatePath(world.roads![index].path, dx, dy), options);
}
export function setRoadClass(world: World, index: number, cls: RoadClass, width?: number): NetworkEditResult {
  roadIndex(world, index);
  if (!ROAD_CLASS_ORDER.includes(cls)) throw new Error('Unknown road class.');
  const d = draft(world);
  writeRoad(d, index, world.roads![index].path, { cls, ...(width !== undefined ? { width } : {}) });
  return { world: commit(d), road: index };
}
export function deleteRoad(world: World, index: number): NetworkEditResult {
  roadIndex(world, index);
  const d = draft(world);
  removeRoad(d, index);
  return { world: commit(d) };
}

// ---------------------------------------------------------------------------------------------------------------
// River deletion
export interface RiverDeletionOptions {
  /** Also follow rivers that reach the deleted course through a lake (Rust lake links). Default true. */
  throughLakes?: boolean;
}
export interface RiverDeletionPlan {
  /** Indices in `world.terrain.rivers` that disappear (the selected course, its upstream network, braids, distributaries, oxbows). */
  rivers: number[];
  /** Deleted stream ids (native ids, or projected ids without a native network). */
  streams: number[];
  selected: number;
  source: 'vector' | 'hydrology' | 'projected' | 'grid';
}
const lineKey = (x0: number, y0: number, x1: number, y1: number, n: number): string => `${x0.toFixed(3)},${y0.toFixed(3)}|${x1.toFixed(3)},${y1.toFixed(3)}|${n}`;
const riverKey = (river: River): string => lineKey(river.path[0].x, river.path[0].y, river.path[river.path.length - 1].x, river.path[river.path.length - 1].y, river.path.length);
const vectorKey = (line: RiverLine): string => { const p = line.points, m = p.length; return lineKey(p[0], p[1], p[m - 2], p[m - 1], m / 2); };
function hydrologyKey(h: HydrologyData, row: number): string {
  const from = h.riverOffsets[row], to = h.riverOffsets[row + 1] - 1, p = h.riverPoints;
  return lineKey(p[from * 4], p[from * 4 + 1], p[to * 4], p[to * 4 + 1], to - from + 1);
}
/** Upstream closure over a `child → parent` relation. */
function upstream(start: number[], parents: { id: number; parent: number }[]): Set<number> {
  const donors = new Map<number, number[]>();
  for (const { id, parent } of parents) { const list = donors.get(parent); if (list) list.push(id); else donors.set(parent, [id]); }
  const set = new Set(start), queue = [...start];
  while (queue.length) for (const donor of donors.get(queue.pop()!) ?? []) if (!set.has(donor)) { set.add(donor); queue.push(donor); }
  return set;
}
interface VectorRemoval { kind: 'vector'; network: RiverNetwork; removed: Set<RiverLine>; streams: Set<number> }
interface HydrologyRemoval { kind: 'hydrology'; data: HydrologyData; rows: Set<number>; streams: Set<number> }
interface GridRemoval { kind:'grid'; deletion:GridRiverDeletion; streams:Set<number> }
type NativeRemoval = VectorRemoval | HydrologyRemoval | GridRemoval | undefined;
function lineDistance(line: RiverLine, p: Vec2): number {
  let best = Infinity;
  const q = line.points;
  for (let k = 2; k < q.length; k += 2) {
    const ax = q[k - 2], ay = q[k - 1], dx = q[k] - ax, dy = q[k + 1] - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - ax - dx * t, p.y - ay - dy * t));
  }
  return best;
}
function planNative(world: World, selected: River, options: RiverDeletionOptions): NativeRemoval {
  const native = (world.terrain as NativeTerrainLayer).v2NativeTerrain, key = riverKey(selected);
  if (native?.water) {
    const network = native.water.rivers;
    if (!network) { const deletion=deleteGridRiver(native.water,world.terrain.rivers,world.terrain.rivers.indexOf(selected),options.throughLakes!==false);return {kind:'grid',deletion,streams:new Set(deletion.streams)}; }
    const groups: [RiverLine[], 'river' | 'braid' | 'distributary' | 'oxbow'][] = [[network.rivers, 'river'], [network.braids, 'braid'], [network.distributaries, 'distributary'], [network.oxbows, 'oxbow']];
    let line: RiverLine | undefined, role: (typeof groups)[number][1] | undefined;
    for (const [lines, kind] of groups) { line = lines.find(l => l.points.length >= 4 && vectorKey(l) === key); if (line) { role = kind; break; } }
    if (!line) throw new Error('The selected river is not part of the retained water network.');
    if (role === 'oxbow' || line.id === undefined) return { kind: 'vector', network, removed: new Set([line]), streams: new Set() };
    // Lake links run from the end of an inflowing course to the course draining the lake.
    const endOf = new Map<string, RiverLine>();
    for (const l of network.rivers) if (l.points.length >= 4) endOf.set(`${l.points[l.points.length - 2]},${l.points[l.points.length - 1]}`, l);
    const sourceOf = (link: RiverLine): RiverLine | undefined => endOf.get(`${link.points[0]},${link.points[1]}`);
    const relation = network.rivers.flatMap(l => l.id !== undefined && l.joins !== undefined && l.joins >= 0 ? [{ id: l.id, parent: l.joins }] : []);
    if (options.throughLakes !== false) for (const link of network.lakeLinks ?? []) {
      const source = sourceOf(link);
      if (source?.id !== undefined && link.joins !== undefined && link.joins >= 0 && source.id !== link.joins) relation.push({ id: source.id, parent: link.joins });
    }
    const streams = upstream([line.id], relation), removed = new Set<RiverLine>();
    for (const l of [...network.rivers, ...network.braids, ...network.distributaries]) if (l.id !== undefined && streams.has(l.id)) removed.add(l);
    for (const link of network.lakeLinks ?? []) { const source = sourceOf(link); if ((source && removed.has(source)) || (link.joins !== undefined && streams.has(link.joins))) removed.add(link); }
    // Oxbows carry no stream id: an abandoned loop belongs to the nearest main course.
    const mains = network.rivers.filter(l => l.points.length >= 4);
    for (const oxbow of network.oxbows) {
      if (oxbow.points.length < 4) continue;
      const k = (oxbow.points.length >> 2) << 1, mid = { x: oxbow.points[k], y: oxbow.points[k + 1] };
      let nearest: RiverLine | undefined, best = Infinity;
      for (const main of mains) { const d = lineDistance(main, mid); if (d < best) { best = d; nearest = main; } }
      if (nearest && removed.has(nearest)) removed.add(oxbow);
    }
    return { kind: 'vector', network, removed, streams };
  }
  const h = native?.hydrology;
  if (h) {
    const rows = h.riverOffsets.length - 1;
    let row = -1;
    for (let r = 0; r < rows; r++) if (h.riverOffsets[r + 1] - h.riverOffsets[r] >= 2 && hydrologyKey(h, r) === key) { row = r; break; }
    if (row < 0) throw new Error('The selected river is not part of the retained water network.');
    const relation: { id: number; parent: number }[] = [];
    for (let r = 0; r < rows; r++) if (h.riverMeta[r * 6 + 3] > 0) relation.push({ id: h.riverMeta[r * 6], parent: h.riverMeta[r * 6 + 3] - 1 });
    const streams = upstream([h.riverMeta[row * 6]], relation), removedRows = new Set<number>([row]);
    for (let r = 0; r < rows; r++) if (streams.has(h.riverMeta[r * 6])) removedRows.add(r);
    return { kind: 'hydrology', data: h, rows: removedRows, streams };
  }
  return undefined;
}
function planRemoval(world: World, index: number, options: RiverDeletionOptions): { plan: RiverDeletionPlan; native: NativeRemoval } {
  const rivers = world.terrain.rivers, selected = rivers[index];
  if (!selected || selected.path.length < 2) throw new Error('Unknown river.');
  const native = planNative(world, selected, options);
  if(native?.kind==='grid')return {plan:{rivers:native.deletion.rivers,streams:native.deletion.streams,selected:index,source:'grid'},native};
  let removed: Set<number>;
  if (native) {
    const keys = new Set<string>();
    if (native.kind === 'vector') for (const line of native.removed) { if (line.points.length >= 4) keys.add(vectorKey(line)); }
    else for (const row of native.rows) keys.add(hydrologyKey(native.data, row));
    removed = new Set(rivers.flatMap((river, i) => river.path.length > 1 && keys.has(riverKey(river)) ? [i] : []));
    removed.add(index);
  } else {
    const streams = selected.id === undefined ? new Set<number>() : upstream([selected.id], rivers.flatMap(r => r.id !== undefined && r.host !== undefined ? [{ id: r.id, parent: r.host }] : []));
    removed = new Set(rivers.flatMap((river, i) => i === index || (river.id !== undefined && streams.has(river.id)) ? [i] : []));
    return { plan: { rivers: [...removed].sort((a, b) => a - b), streams: [...streams], selected: index, source: 'projected' }, native };
  }
  return { plan: { rivers: [...removed].sort((a, b) => a - b), streams: [...native.streams], selected: index, source: native.kind }, native };
}
/** What `deleteRiver` would remove, for a preview before confirming. */
export function planRiverDeletion(world: World, index: number, options: RiverDeletionOptions = {}): RiverDeletionPlan {
  return planRemoval(world, index, options).plan;
}
function nativeAfter(native: TerrainData, removal: NativeRemoval): TerrainData {
  if (!removal) return native;
  if(removal.kind==='grid')return {...native,water:removal.deletion.water};
  if (removal.kind === 'vector') {
    const n = removal.network, keep = (l: RiverLine): boolean => !removal.removed.has(l);
    let km = 0;
    for (const line of removal.removed) if (n.rivers.includes(line) || n.distributaries.includes(line)) for (let k = 2; k < line.points.length; k += 2) km += Math.hypot(line.points[k] - line.points[k - 2], line.points[k + 1] - line.points[k - 1]) / 1000;
    const network: RiverNetwork = { ...n, rivers: n.rivers.filter(keep), braids: n.braids.filter(keep), distributaries: n.distributaries.filter(keep), oxbows: n.oxbows.filter(keep),
      ...(n.lakeLinks ? { lakeLinks: n.lakeLinks.filter(keep) } : {}), lengthKm: Math.max(0, n.lengthKm - km) };
    return { ...native, water: { ...native.water!, rivers: network, editedNetwork:true } };
  }
  const h = removal.data, rows = h.riverOffsets.length - 1;
  let kept = 0, vertices = 0;
  for (let r = 0; r < rows; r++) if (!removal.rows.has(r)) { kept++; vertices += h.riverOffsets[r + 1] - h.riverOffsets[r]; }
  const points = new Float32Array(vertices * 4), offsets = new Uint32Array(kept + 1), meta = new Uint32Array(kept * 6);
  // The mouth gain is one value per river point: it follows the kept points.
  const flare = h.riverFlare ? new Float32Array(vertices) : undefined;
  let row = 0, at = 0;
  for (let r = 0; r < rows; r++) {
    if (removal.rows.has(r)) continue;
    const from = h.riverOffsets[r], to = h.riverOffsets[r + 1];
    points.set(h.riverPoints.subarray(from * 4, to * 4), at * 4); meta.set(h.riverMeta.subarray(r * 6, r * 6 + 6), row * 6);
    if (flare && h.riverFlare) flare.set(h.riverFlare.subarray(from, to), at);
    at += to - from; offsets[++row] = at;
  }
  return { ...native, hydrology: { ...h, riverPoints: points, riverOffsets: offsets, riverMeta: meta, riverFlare: flare, riverCount: kept } };
}
/** Two-pass 3-4 chamfer distance (m) to the cells where `source` holds. */
function chamfer(w: number, h: number, cell: number, source: (i: number) => boolean): Float32Array {
  const d = new Float32Array(w * h), a = cell, b = cell * Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = source(i) ? 0 : Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + a);
    if (y > 0) { v = Math.min(v, d[i - w] + a); if (x > 0) v = Math.min(v, d[i - w - 1] + b); if (x < w - 1) v = Math.min(v, d[i - w + 1] + b); }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + a);
    if (y < h - 1) { v = Math.min(v, d[i + w] + a); if (x < w - 1) v = Math.min(v, d[i + w + 1] + b); if (x > 0) v = Math.min(v, d[i + w - 1] + b); }
    d[i] = v;
  }
  return d;
}
/** Site fields on the planning grid: masks cleared, distances to water and to the main river lengthened where they ran to the deleted river. */
function siteAfter(site: World['site'], terrain: TerrainLayer, cleared: Uint8Array): World['site'] {
  const fields = site?.fields;
  if (!site || !fields || fields.riverMask?.length !== cleared.length) return site;
  const { w, h, cell } = terrain.height, next: SiteFields = { ...fields, riverMask: fields.riverMask.slice(), bridgeZone: fields.bridgeZone.slice(), ...(fields.wide ? { wide: fields.wide.slice() } : {}) };
  const main = new Uint8Array(cleared.length);
  for (let i = 0; i < cleared.length; i++) if (cleared[i]) { if (next.riverMask[i] === 1) main[i] = 1; next.riverMask[i] = 0; next.bridgeZone[i] = 0; if (next.wide) next.wide[i] = 0; }
  const lengthen = (old: Float32Array, removedFrom: Float32Array, remaining: Float32Array): Float32Array => {
    const out = old.slice();
    for (let i = 0; i < out.length; i++) if (removedFrom[i] <= old[i] + 1.5 * cell) out[i] = Math.max(old[i], Math.min(remaining[i], 1e9));
    return out;
  };
  if (fields.dWater?.length === cleared.length) next.dWater = lengthen(fields.dWater, chamfer(w, h, cell, i => !!cleared[i]), chamfer(w, h, cell, i => terrain.water[i] !== 0 && terrain.water[i] !== 4));
  if (fields.dMain?.length === cleared.length && main.some(Boolean)) next.dMain = lengthen(fields.dMain, chamfer(w, h, cell, i => !!main[i]), chamfer(w, h, cell, i => next.riverMask[i] === 1));
  return { ...site, fields: next };
}
/** A crossing or bridge disappears only when it spanned the deleted water and no longer touches any water. */
function stillWet(terrain: TerrainLayer, cleared: Uint8Array, path: Polyline): boolean {
  const f = waterSampler(terrain);
  let touched = false;
  for (let s = 0; s < path.length; s++) {
    const a = path[Math.max(0, s - 1)], b = path[s], steps = Math.max(1, Math.ceil(dist(a, b) / (f.cell * .25)));
    for (let k = 1; k <= steps; k++) {
      const i = f.index({ x: a.x + (b.x - a.x) * k / steps, y: a.y + (b.y - a.y) * k / steps });
      if (terrain.water[i] === 2 || terrain.water[i] === 3) return true;
      if (cleared[i]) touched = true;
    }
  }
  return !touched;
}
export interface RiverDeletionResult { world: World; plan: RiverDeletionPlan }
/**
 * Delete one river with all of its upstream tributaries (by stream `joins`/`host`, optionally through lakes), its
 * braids, distributaries, lake links and oxbows: in the projected rivers and water mask, in the retained native vector
 * network or packed hydrology, in the site fields and in the crossings, bridges and names that relied on that water.
 * Drainage, lakes and heights are unchanged; the retained city ground is dropped so it is rebuilt from the new water.
 */
export function deleteRiver(world: World, index: number, options: RiverDeletionOptions = {}): RiverDeletionResult {
  const { plan, native: removal } = planRemoval(world, index, options);
  const source = world.terrain as NativeTerrainLayer, removed = new Set(plan.rivers);
  const { w, h, cell } = source.height, water = source.water.slice(), touched = new Uint8Array(water.length), cleared = new Uint8Array(water.length);
  const kept = source.rivers.filter((_, i) => !removed.has(i));
  for (const i of plan.rivers) {
    const river = source.rivers[i];
    for (let j = 1; j < river.path.length; j++) {
      const width = Math.max(river.width[j - 1] ?? 1, river.width[j] ?? 1);
      forCellsNearPolyline([river.path[j - 1], river.path[j]], w, h, cell, Math.max(cell * .8, width / 2) + cell * .25, c => { touched[c] = 1; });
    }
  }
  for (let c = 0; c < water.length; c++) if (touched[c] && water[c] === 3) { water[c] = 0; cleared[c] = 1; }
  // Restamp the surviving channels over the touched cells, as the projection stamps the retained network.
  for (const river of kept) for (let j = 1; j < river.path.length; j++) {
    const width = Math.max(river.width[j - 1] ?? 1, river.width[j] ?? 1);
    forCellsNearPolyline([river.path[j - 1], river.path[j]], w, h, cell, Math.max(cell * .6, width / 2), c => { if (touched[c] && !water[c]) { water[c] = 3; cleared[c] = 0; } });
  }
  const { v2CityGround: _ground, ...rest } = source;
  const terrain: NativeTerrainLayer = { ...rest, rivers: kept, water, ...(source.v2NativeTerrain ? { v2NativeTerrain: nativeAfter(source.v2NativeTerrain, removal) } : {}) };
  const site = siteAfter(world.site, terrain, cleared);
  // Roads keep every crossing that still spans water; bridges over the deleted river go.
  const d = draft({ ...world, terrain });
  const droppedBridges: Bridge[] = [];
  if (d.output) d.output.segments = d.output.segments.map(segment => {
    const crossings = segment.crossings.filter(c => stillWet(terrain, cleared, c.path));
    if (crossings.length === segment.crossings.length) return segment;
    droppedBridges.push(...bridgesOf(segment).filter(b => !bridgesOf({ crossings, width: segment.width }).some(k => samePoint(k.a, b.a) && samePoint(k.b, b.b))));
    return { ...segment, crossings };
  });
  else d.baseBridges = d.baseBridges.filter(b => stillWet(terrain, cleared, [b.a, b.b]) || !droppedBridges.push(b));
  const debug = { ...world.debug }, town = debug.v2TownBridges as Record<string, Bridge[]> | undefined;
  if (town) debug.v2TownBridges = Object.fromEntries(Object.entries(town).map(([key, list]) => [key, list.filter(b => stillWet(terrain, cleared, [b.a, b.b]) || !droppedBridges.push(b))]));
  d.world = { ...world, terrain, debug };
  const next = commit(d, { terrain, site });
  next.stats[WATER_EDIT_REVISION] = Number(world.stats[WATER_EDIT_REVISION] ?? 0) + 1;
  if (world.names) {
    const deleted = plan.rivers.map(i => source.rivers[i].path);
    const entries = (next.names ?? world.names).entries.filter(entry =>
      !(entry.kind === 'river' && entry.path && deleted.some(path => samePath(path, entry.path)))
      && !(entry.kind === 'bridge' && droppedBridges.some(b => dist(entry.anchor, { x: (b.a.x + b.b.x) / 2, y: (b.a.y + b.b.y) / 2 }) <= b.width + 30)));
    next.names = { ...(next.names ?? world.names), entries };
  }
  return { world: next, plan };
}

/**
 * Rebuild the natural forest field over an edited water mask (as the terrain stage does), so no tree-less strip
 * remains where a river was. Optional and asynchronous (native or WASM forest builder); returns the same world when
 * the terrain has no retained forest field.
 */
export async function refreshNaturalForest(world: World, settings: V2Settings): Promise<World> {
  const terrain = world.terrain as TerrainLayer & { v2ForestField?: unknown; v2NaturalForest?: Float32Array };
  if (!terrain.v2ForestField) return world;
  const [{ buildForestField }, { effectiveTerrainSettings }, { seedHash }, { stepSeed }, { loopbackServer }] = await Promise.all([
    import('../../../rust/bridge/terrainForest'), import('./terrainSettings'), import('../../../rust/bridge/terrainAdjust'),
    import('../../../rust/bridge/generationSeed'), import('./platform')]);
  const configuration = effectiveTerrainSettings(settings, world.mapSize), climate = configuration.climateValues!;
  const runtime = settings.runtime?.backend === 'native' ? { profile: 'local' as const, server: loopbackServer(settings.runtime.localServer ?? 'http://127.0.0.1:8791') } : undefined;
  const grid = terrain.height, n = grid.w;
  const forest = await buildForestField({ seed: seedHash(stepSeed(settings.options.seed, 'cover-climate')), climate: [climate.temperature, climate.precipitation],
    height: { x: 0, y: 0, width: world.mapSize, n, data: grid.data }, water: terrain.water }, configuration.forest, runtime);
  const cover = new Float32Array(grid.data.length);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) cover[y * n + x] = forest.rgba[(Math.min(forest.n - 1, Math.floor((y + .5) * forest.n / n)) * forest.n + Math.min(forest.n - 1, Math.floor((x + .5) * forest.n / n))) * 4] / 255;
  return { ...world, terrain: { ...terrain, v2ForestField: forest, v2NaturalForest: cover } as TerrainLayer };
}
