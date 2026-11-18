/** Inhabited isolated places: the land-use farms (Rust `landuse/rural_farms.rs`) that stand outside every
 * listed settlement, each a farmstead, and the farm groups of a hamlet lane as one hamlet.
 * They were drawn on the map but missing from the settlement list. This is the one rule shared by the V2
 * list, the population panel and any bench that lists places; nothing is generated here.
 * Their households are the farming households of the listed places (`rural_households`): their people are
 * already counted in those places' population, never added a second time. */
import type { Farmstead, Settlement, UrbanLayer, Vec2, World } from '../gen/types';
import { townUrban } from './edits';

export interface IsolatedPlace {
  /** Stable identity from the position of its first farm: `isolated:farmstead:x:y` or `isolated:hamlet:x:y`. */
  key: string;
  category: 'farmstead' | 'hamlet';
  center: Vec2;
  /** Farms (households) of the place. */
  farms: number;
  culture?: string;
  /** Farm type of its first farm (catalogue `farmstead.types`). */
  type?: string;
  /** Key of the nearest listed settlement: its parish and market. */
  near?: string;
  /** Every farm's drive (or the hamlet lane and the drives it joins) reaches the current roads or town streets:
   * false after a road edit moved or removed the road it joined, or for a farm no track reaches. */
  connected: boolean;
}

/** Farms of a hamlet lane stand 9 m apart along a lane of at most 320 m (rural_farms.rs). */
const HAMLET_LINK = 120;
/** A farm this close to a place's centre is that place's own farm (a farmstead settlement), not a second one. */
const OWN_FARM = 75;
/** A drive end this close to a network line (beyond its half-width) joins it: the Rust drive ends exactly on it. */
const JOIN = 1.5;

const length = (path: readonly Vec2[]): number => path.length < 2 ? 0 : Math.hypot(path[path.length - 1].x - path[0].x, path[path.length - 1].y - path[0].y);

function distanceTo(q: Vec2, path: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(q.x - a.x - dx * t, q.y - a.y - dy * t));
  }
  return best;
}

/** A network line (regional road or town street) with its half-width and bounding box. */
export interface NetworkLine { path: readonly Vec2[]; half: number; x0: number; y0: number; x1: number; y1: number }
export function networkLine(path: readonly Vec2[], width: number): NetworkLine {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of path) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  return { path, half: Math.max(0, width) / 2, x0, y0, x1, y1 };
}
const onLine = (q: Vec2, l: NetworkLine): boolean => {
  const r = l.half + JOIN;
  return q.x >= l.x0 - r && q.x <= l.x1 + r && q.y >= l.y0 - r && q.y <= l.y1 + r && distanceTo(q, l.path) <= r;
};

/** Built towns of the map (each once), through `townUrban`, the projection the inspector and the edits read. */
function towns(world: World): UrbanLayer[] {
  const out = new Set<UrbanLayer>();
  if (world.urban) out.add(world.urban);
  for (const place of world.settlements ?? []) { const urban = townUrban(world, place.key); if (urban) out.add(urban); }
  return [...out];
}

/** The current road network: the regional roads as the map holds them now (after any road edit) and the town streets. */
function networkLines(world: World): NetworkLine[] {
  const lines = (world.roads ?? []).filter(road => road.path.length >= 2).map(road => networkLine(road.path, road.width));
  for (const urban of towns(world)) for (const street of urban.streets ?? []) {
    if (street.path.length >= 2 && street.width > 0) lines.push(networkLine(street.path, street.width));
  }
  return lines;
}

/** Per farm: its drive reaches the network, directly or through the drives (or hamlet lane) it joins. A drive starts
 * on the road, street or drive it joins (`drive[0]`, Rust `landuse/farm_access.rs`); a farm without a drive never does. */
export function farmsConnected(farms: readonly Farmstead[], network: readonly NetworkLine[]): boolean[] {
  const has = farms.map(farm => farm.drive.length >= 2 && length(farm.drive) > .5);
  // A gate directly on a road needs no separate driveway (Rust can return [gate, gate]).
  const connected = farms.map(farm => {
    const gate=farm.drive[0]??farm.gate;
    return !!gate&&network.some(l=>onLine(gate,l));
  });
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < farms.length; i++) {
      if (connected[i] || !has[i]) continue;
      const start = farms[i].drive[0];
      if (farms.some((other, j) => j !== i && connected[j] && distanceTo(start, other.drive) <= JOIN)) { connected[i] = true; changed = true; }
    }
  }
  return connected;
}

/** What the list depends on besides the farms: the places (key, position, size, culture), the road array and the town street arrays. */
function inputsOf(world: World): { signature: string; refs: readonly unknown[] } {
  // Road geometry checksum as well as the array identity: an edit that moves or cuts a road in place still invalidates.
  let roads = 0, k = 0;
  for (const road of world.roads ?? []) { roads += 7919 * road.width + road.path.length; for (const q of road.path) roads += (q.x * 31 + q.y * 17) * (++k % 13 + 1); }
  const signature = `${roads}#${(world.roads ?? []).length}#` + (world.settlements ?? []).map(p => `${p.key}|${p.center.x}|${p.center.y}|${p.radius}|${p.culture}`).join(';');
  return { signature, refs: [world.roads, ...towns(world).map(urban => urban.streets)] };
}
const cache = new WeakMap<object, { signature: string; refs: readonly unknown[]; places: readonly IsolatedPlace[] }>();
const NONE: readonly IsolatedPlace[] = [];

function insidePlace(farm: Farmstead, places: readonly Settlement[]): boolean {
  return places.some(place => Math.hypot(farm.pos.x - place.center.x, farm.pos.y - place.center.y) <= Math.max(place.radius, OWN_FARM));
}

function nearest(center: Vec2, places: readonly Settlement[]): string | undefined {
  let best: Settlement | undefined, distance = Infinity;
  for (const place of places) {
    const d = Math.hypot(center.x - place.center.x, center.y - place.center.y) - place.radius;
    if (d < distance) { distance = d; best = place; }
  }
  return best?.key;
}

/** The isolated inhabited places of `world`, largest first, then by key. Recomputed when the farms, the places
 * (moved, resized, replaced), the regional roads or a town's streets change. */
export function isolatedPlacesOf(world: World | undefined): readonly IsolatedPlace[] {
  const farms = world?.landuse?.farmsteads;
  if (!world || !farms?.length) return NONE;
  const inputs = inputsOf(world), hit = cache.get(farms);
  if (hit && hit.signature === inputs.signature && hit.refs.length === inputs.refs.length && hit.refs.every((r, i) => r === inputs.refs[i])) return hit.places;
  const places = world.settlements ?? [];
  // Access is judged over every farm: a lone farm may reach the road through the drive of a town's farm.
  const reached = farmsConnected(farms, networkLines(world));
  const isConnected = new Map(farms.map((farm, i) => [farm, reached[i]]));
  const lone = farms.filter(farm => !insidePlace(farm, places));
  // Hamlet farms: one group per chain of farms closer than HAMLET_LINK.
  const parent = lone.map((_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : parent[i] = find(parent[i]);
  const hamlet = (farm: Farmstead) => farm.tags?.includes('hamlet') ?? false;
  for (let i = 0; i < lone.length; i++) if (hamlet(lone[i])) for (let j = i + 1; j < lone.length; j++) {
    if (hamlet(lone[j]) && Math.hypot(lone[i].pos.x - lone[j].pos.x, lone[i].pos.y - lone[j].pos.y) <= HAMLET_LINK) parent[find(j)] = find(i);
  }
  const groups = new Map<number, Farmstead[]>();
  lone.forEach((farm, i) => { const root = find(i); groups.set(root, [...groups.get(root) ?? [], farm]); });
  const out: IsolatedPlace[] = [...groups.values()].map(group => {
    const first = group[0], category = group.length > 1 ? 'hamlet' as const : 'farmstead' as const;
    const center = { x: group.reduce((n, f) => n + f.pos.x, 0) / group.length, y: group.reduce((n, f) => n + f.pos.y, 0) / group.length };
    return { key: `isolated:${category}:${Math.round(first.pos.x)}:${Math.round(first.pos.y)}`, category, center, farms: group.length,
      culture: first.culture, type: first.type, near: nearest(center, places),
      // Every farm of the place reaches the current network (a hamlet's farms through its lane).
      connected: group.every(farm => isConnected.get(farm) === true) };
  });
  out.sort((a, b) => b.farms - a.farms || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  cache.set(farms, { ...inputs, places: out });
  return out;
}
