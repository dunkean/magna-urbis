import type { Layout, Point, Street } from '../../../rust/bridge/urban';
import type { RoadOutput } from '../../../rust/bridge/settlements';
import { outsideUrbanStreets, urbanRoadOwnership } from '../../../rust/bridge/urbanNetwork';

/** Dry waterLevel cells contain terrain height. Never interpolate those
 * hillside samples into the water surface beside a bridge abutment. */
export function bridgeWaterHeight(r: { n: number; width: number; water: Uint8Array; waterLevel: Float32Array }, wet: (x: number, y: number) => boolean): (x: number, y: number) => number {
  return (x, y) => {
    if (!wet(x, y)) return NaN;
    const gx = x / r.width * r.n - 0.5, gy = y / r.width * r.n - 0.5, ix = Math.round(gx), iy = Math.round(gy);
    let distance = Infinity, level = NaN;
    for (let j = Math.max(0, iy-2); j <= Math.min(r.n-1, iy+2); j++) for (let i = Math.max(0, ix-2); i <= Math.min(r.n-1, ix+2); i++) {
      const at = j*r.n+i, d = (i-gx)**2+(j-gy)**2;
      if (r.water[at] && d < distance && Number.isFinite(r.waterLevel[at])) { distance = d; level = r.waterLevel[at]; }
    }
    return level;
  };
}

const crossing = (s: Street): boolean => ['bridge', 'ford', 'causeway'].includes(s.role) && s.path.length >= 2;
const distance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const inside = (p: Point, ring: Point[]): boolean => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) hit = !hit;
  }
  return hit;
};

/** Land where the town draws the roads itself (the regional road is clipped there). */
const OWNERSHIP = new WeakMap<readonly Layout[], (p: Point) => boolean>();
function townOwns(layouts: readonly Layout[]): (p: Point) => boolean {
  let owns = OWNERSHIP.get(layouts);
  if (!owns) {
    const shapes = urbanRoadOwnership(layouts as Layout[]).map(s => {
      const xs = s.outer.map(p => p.x), ys = s.outer.map(p => p.y);
      return { s, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    });
    owns = p => shapes.some(({ s, box }) => p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3]
      && inside(p, s.outer) && !s.holes.some(h => inside(p, h)));
    OWNERSHIP.set(layouts, owns);
  }
  return owns;
}

/** Native urban crossings own their replaced regional artwork, including an
 * oblique old deck and a bank chord that the native street now skirts on land.
 * A regional deck is also retired when its road was rejected: one of its banks
 * lies where the town draws the roads and no town street meets it there. A deck
 * whose road is still drawn on both banks always stays. */
export function urbanReplacesCrossing(street: Street, layouts: readonly Layout[]): boolean {
  if (!crossing(street)) return false;
  const a = street.path[0], b = street.path[street.path.length - 1], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const owns = townOwns(layouts), served = (p: Point): boolean => layouts.some(l => l.streets.some(s =>
    !['bridge', 'ford', 'causeway', 'pier', 'mole', 'landing'].includes(s.role)
    && s.path.slice(1).some((q, i) => distance(p, s.path[i], q) < 12 + Math.max(0, ...s.widths.filter(Number.isFinite)) / 2)));
  if ([a, b].some(p => owns(p) && !served(p))) return true;
  return layouts.some(l => {
    const direct = l.streets.some(s => {
    if (s.role === 'approach') return [a, b].every(p => s.path.slice(1).some((q, i) => distance(p, s.path[i], q) < 6));
    if (!crossing(s)) return false;
    const p = s.path[0], q = s.path[s.path.length - 1], len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 0.1) return false;
    const ux = (q.x - p.x) / len, uy = (q.y - p.y) / len, project = (v: Point): number => (v.x - p.x) * ux + (v.y - p.y) * uy;
    const lo = Math.min(project(a), project(b)), hi = Math.max(project(a), project(b)), tolerance = Math.max(6, len * 0.3);
    const along = Math.abs((mid.x - p.x) * -uy + (mid.y - p.y) * ux);
    return Math.abs(lo) < tolerance && Math.abs(hi - len) < tolerance && along < Math.min(200, 30 + 2 * len);
    });
    if (direct) return true;
    // A native span may move along a bend to obtain buildable landings. Its
    // bank connections still replace the old regional artwork at that site.
    const near = l.streets.some(s => s.role === 'bridge' && s.path.length >= 2 && Math.hypot(
      (s.path[0].x + s.path[s.path.length - 1].x) / 2 - mid.x, (s.path[0].y + s.path[s.path.length - 1].y) / 2 - mid.y) < 200);
    const reach = Math.max(6, Math.min(50, Math.hypot(b.x - a.x, b.y - a.y) * 0.5));
    return near && [a, b].every(p => l.streets.some(s => !['bridge', 'pier', 'mole', 'landing'].includes(s.role)
      && s.path.slice(1).some((q, i) => distance(p, s.path[i], q) < reach)));
  });
}

/** Extra ownership strips hide the retired regional span in the base road
 * layer. These copies only enter its clipper, never the city data or drawing. */
export function bridgeRoadOwnership(layouts: Layout[], roads?: RoadOutput): Layout[] {
  if (!layouts.length || !roads) return layouts;
  const retired: Street[] = roads.segments.flatMap(s => s.crossings.map(c => ({ path: c.path, widths: c.path.map(() => s.width), rank: 0, role: c.kind })))
    .filter(s => urbanReplacesCrossing(s, layouts));
  return retired.length ? [{ ...layouts[0], streets: [...layouts[0].streets, ...retired] }, ...layouts.slice(1)] : layouts;
}

export function cityBridgeStreets(layouts: readonly Layout[], regional: readonly Street[]): Street[] {
  return [...layouts.flatMap(l => l.streets), ...regional.filter(s => !urbanReplacesCrossing(s, layouts))];
}

type RegionalRoad = { path: Point[]; width: number };
type RegionalBridge = { a: Point; b: Point; width: number };
const shownNetworks = new WeakMap<object, { roads?: readonly RegionalRoad[]; bridges?: readonly RegionalBridge[]; layouts: readonly Layout[]; out: { roads?: RegionalRoad[]; bridges?: RegionalBridge[] } }>();
/** The regional roads and decks a 2D map draws around native towns, owned exactly as the 3D ground and decks are
 * (city3d `outsideUrbanStreets`, `cityBridgeStreets`): a regional road is drawn outside the towns' road ownership only,
 * where the town draws its own approaches bending onto its decks, and a regional deck that a town crossing replaces
 * is not drawn. Town bridge records with a `kind` stay. Memoized per network and layouts, never per frame. */
export function cityRegionalNetwork<R extends RegionalRoad, B extends RegionalBridge>(roads: readonly R[] | undefined, bridges: readonly B[] | undefined, layouts: readonly Layout[]): { roads?: R[]; bridges?: B[] } {
  if (!layouts.length) return { roads: roads as R[] | undefined, bridges: bridges as B[] | undefined };
  const key = (roads ?? bridges) as object | undefined;
  if (!key) return {};
  const memo = shownNetworks.get(key);
  if (memo && memo.roads === roads && memo.bridges === bridges && memo.layouts.length === layouts.length && memo.layouts.every((l, i) => l === layouts[i]))
    return memo.out as { roads?: R[]; bridges?: B[] };
  const shown = roads && outsideUrbanStreets(roads.map((r, i) => ({ path: r.path, widths: r.path.map(() => r.width), rank: i, role: 'regional' })), layouts as Layout[])
    .map(s => ({ ...roads[s.rank], path: s.path }));
  const decks = bridges?.filter(b => typeof (b as { kind?: unknown }).kind === 'string'
    || !urbanReplacesCrossing({ path: [b.a, b.b], widths: [b.width, b.width], rank: 0, role: 'bridge' }, layouts));
  const out = { roads: shown, bridges: decks };
  shownNetworks.set(key, { roads, bridges, layouts: layouts.slice(), out });
  return out;
}

/** Probe budget of one crossing (clearance tracing over its window plus bank bisections) and bank precision (m). */
const SNAP_PROBES = 40, SNAP_BANK = 0.25;

/** A regional crossing measured on routing cells, moved along its own road onto the drawn water it crosses.
 * Invariants:
 * - the snapped span is a piece of the road polyline (ends and interior vertices on it), so the deck follows the road;
 *   both routed ends are projected onto the same local stretch of road, never onto another leg of a hairpin;
 * - it only takes drawn water that the road itself crosses within the routed span ± `near` (about half a routing
 *   cell); water further along the road, or water that only lies beside the road, is never claimed;
 * - its ends land `margin` metres beyond the banks of those wet runs. A bank beyond the window (`reach` metres past
 *   the routed ends) is followed outwards along the road up to `3 * reach`; an end whose bank stays unresolved never
 *   shortens the routed span;
 * - a bridge whose whole traced span (± `near`) crosses no drawn water is dropped (undefined): there is no deck
 *   without water. A ford or causeway without drawn water, or a crossing that is not on this road, stays as routed.
 * `clearance(x, y)`: signed distance to the drawn water, at most 0 inside it. At most SNAP_PROBES probes per crossing. */
export function snapCrossingToWater<C extends { kind?: string; path: Point[] }>(road: readonly Point[], crossing: C, clearance: (x: number, y: number) => number, reach: number, margin = 2): C | undefined {
  if (road.length < 2 || crossing.path.length < 2 || !(reach >= 0)) return crossing;
  const station = [0];
  for (let i = 1; i < road.length; i++) station.push(station[i - 1] + Math.hypot(road[i].x - road[i - 1].x, road[i].y - road[i - 1].y));
  const total = station[station.length - 1];
  /** Nearest road point with its station restricted to [from, to]. */
  const project = (p: Point, from: number, to: number): { at: number; off: number } => {
    let off = Infinity, at = 0;
    for (let i = 1; i < road.length; i++) {
      const s = station[i - 1], len = station[i] - s;
      if (station[i] < from || s > to || !(len > 0)) continue;
      const a = road[i - 1], b = road[i], dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(Math.max(0, (from - s) / len), Math.min(Math.min(1, (to - s) / len), ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
      if (d < off) { off = d; at = s + t * len; }
    }
    return { at, off };
  };
  const pointAt = (d: number): Point => {
    let i = 1; while (i < station.length - 1 && station[i] < d) i++;
    const t = (d - station[i - 1]) / (station[i] - station[i - 1] || 1), a = road[i - 1], b = road[i];
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  };
  let length = 0;
  for (let i = 1; i < crossing.path.length; i++) length += Math.hypot(crossing.path[i].x - crossing.path[i - 1].x, crossing.path[i].y - crossing.path[i - 1].y);
  const pa = project(crossing.path[0], 0, total), pb = project(crossing.path[crossing.path.length - 1], pa.at - length - reach, pa.at + length + reach);
  // Not routed along this road: nothing to measure against.
  if (!(pa.off <= reach && pb.off <= reach)) return crossing;
  const ca = pa.at, cb = pb.at, s0 = Math.min(ca, cb), s1 = Math.max(ca, cb), near = Math.max(margin, reach / 3);
  const lo = Math.max(0, s0 - reach), hi = Math.min(total, s1 + reach);
  if (!(hi > lo)) return crossing;
  const minStep = Math.max(0.5, (hi - lo) / 64), maxStep = Math.max(minStep, (hi - lo) / 12);
  let probes = 0;
  const at = (d: number): number => { probes++; const p = pointAt(d); return clearance(p.x, p.y); };
  const step = (c: number): number => Math.min(maxStep, Math.max(minStep, Math.abs(c)));
  const bank = (dry: number, wet: number): number => {
    while (Math.abs(wet - dry) > SNAP_BANK && probes < SNAP_PROBES) { const m = (dry + wet) / 2; if (at(m) <= 0) wet = m; else dry = m; }
    return (dry + wet) / 2;
  };
  /** Follows a wet run outwards from `d` (wet, clearance `c`) along the road until its bank, within 3 * reach. */
  const outwards = (d: number, c: number, dir: 1 | -1): { at: number; bank: boolean } => {
    const limit = dir > 0 ? Math.min(total, s1 + 3 * reach) : Math.max(0, s0 - 3 * reach);
    while (dir * (limit - d) > 0 && probes < SNAP_PROBES) {
      const next = dir > 0 ? Math.min(limit, d + step(c)) : Math.max(limit, d - step(c)), cn = at(next);
      if (cn > 0) return { at: bank(next, d), bank: true };
      d = next; c = cn;
    }
    return { at: d, bank: false };
  };
  // Trace the window by clearance: a step never jumps over a bank nearer than the step.
  const runs: { from: number; to: number; fromBank: boolean; toBank: boolean; depth: number }[] = [];
  const c0 = at(lo);
  let d = lo, c = c0, from = c <= 0 ? lo : NaN, fromBank = false, depth = Math.min(0, c0);
  while (d < hi && probes < SNAP_PROBES) {
    const next = Math.min(hi, d + step(c)), cn = at(next);
    if ((c <= 0) !== (cn <= 0)) {
      if (cn <= 0) { from = bank(d, next); fromBank = true; depth = cn; }
      else { runs.push({ from, to: bank(next, d), fromBank, toBank: true, depth }); from = NaN; }
    } else if (cn <= 0) depth = Math.min(depth, cn);
    d = next; c = cn;
  }
  const traced = d;
  if (!Number.isNaN(from)) runs.push({ from, to: d, fromBank, toBank: false, depth });
  // Only water the road crosses at its routed span (± near) is taken.
  const over = runs.filter(r => r.from <= s1 + near && r.to >= s0 - near);
  if (!over.length) return crossing.kind === 'bridge' && traced >= Math.min(total, s1 + near) ? undefined : crossing;
  const first = over[0], last = over[over.length - 1];
  if (!first.fromBank && first.from <= lo && lo > 0) { const o = outwards(lo, c0, -1); first.from = o.at; first.fromBank = o.bank; }
  if (!last.toBank && last.to >= hi && hi < total && traced >= hi) { const o = outwards(hi, c, 1); last.to = o.at; last.toBank = o.bank; }
  const a = Math.max(0, first.fromBank ? first.from - margin : Math.min(s0, first.from));
  const b = Math.min(total, last.toBank ? last.to + margin : Math.max(s1, last.to));
  if (!(b > a)) return crossing;
  // A deck many times the width of its river follows the water instead of crossing it: never lengthen one.
  const across = 2 * Math.max(1, -Math.min(...over.map(r => r.depth)));
  if (last.to - first.from > DECK_WIDTHS * across && b - a > s1 - s0) return crossing;
  const path = [pointAt(a), ...road.filter((_, j) => station[j] > a && station[j] < b), pointAt(b)];
  return { ...crossing, path: ca <= cb ? path : path.reverse() };
}

/** Longest snapped deck, in drawn river widths (twice the deepest clearance): about a crossing at 30 degrees. */
const DECK_WIDTHS = 2.5;
/** Depth (m) inside a drawn river ribbon that makes a wet run a crossing; lakes and sea answer exactly 0 and a road
 * grazing a bank stays shallower. */
const MISSED_DEPTH = 0.5;
/** Drawn river water that the road crosses where no crossing lies: routing rasters (30 m cells) can let a road slip
 * between the cells of a narrow river, so the router emits nothing there. Invariants:
 * - the road is traced by clearance, a step never longer than the clearance nor than `reach / 2`, so no drawn river is
 *   jumped; a run counts when it goes deeper than MISSED_DEPTH, has a bank on both sides and is at most `4 * reach` long;
 * - a run covered by a crossing (its road stations ± `near`) is left to that crossing;
 * - each deck is a piece of the road from `margin` metres before the first bank to `margin` metres past the last;
 *   a ford when the road is a track or a trail and the water is narrower than 3.5 m (as Rust `deck::spans`).
 * One trace per road, run once per routing result. */
export function missedWaterCrossings(road: readonly Point[], crossings: readonly { path: Point[] }[], clearance: (x: number, y: number) => number, reach: number, minor = false, margin = 2): { kind: 'bridge' | 'ford'; path: Point[] }[] {
  if (road.length < 2 || !(reach > 0)) return [];
  const station = [0];
  for (let i = 1; i < road.length; i++) station.push(station[i - 1] + Math.hypot(road[i].x - road[i - 1].x, road[i].y - road[i - 1].y));
  const total = station[station.length - 1];
  const pointAt = (d: number): Point => {
    let lo = 1, hi = station.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (station[m] < d) lo = m + 1; else hi = m; }
    const t = (d - station[lo - 1]) / (station[lo] - station[lo - 1] || 1), a = road[lo - 1], b = road[lo];
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  };
  const at = (d: number): number => { const p = pointAt(d); return clearance(p.x, p.y); };
  const bank = (dry: number, wet: number): number => {
    for (let k = 0; k < 12 && Math.abs(wet - dry) > SNAP_BANK; k++) { const m = (dry + wet) / 2; if (at(m) <= 0) wet = m; else dry = m; }
    return (dry + wet) / 2;
  };
  const maxStep = Math.max(1, reach / 2), near = Math.max(margin, reach / 3);
  const runs: { from: number; to: number; depth: number }[] = [];
  let d = 0, c = at(0), from = NaN, depth = 0;
  while (d < total) {
    const next = Math.min(total, d + Math.min(maxStep, Math.max(0.5, 0.9 * Math.abs(c)))), cn = at(next);
    if (cn <= 0 && c > 0) { from = bank(d, next); depth = cn; }
    else if (cn <= 0) depth = Math.min(depth, cn);
    else if (c <= 0 && !Number.isNaN(from)) { runs.push({ from, to: bank(next, d), depth }); from = NaN; }
    d = next; c = cn;
  }
  const missed = runs.filter(r => r.depth < -MISSED_DEPTH && r.to - r.from <= 4 * reach);
  if (!missed.length) return [];
  /** Road stations covered by the existing crossings (their points projected onto the road). */
  const covered = crossings.map(x => {
    let lo = Infinity, hi = -Infinity;
    for (const p of x.path) {
      let off = Infinity, s = 0;
      for (let i = 1; i < road.length; i++) {
        const a = road[i - 1], b = road[i], dx = b.x - a.x, dy = b.y - a.y, len = station[i] - station[i - 1];
        const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len))) : 0, o = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
        if (o < off) { off = o; s = station[i - 1] + t * len; }
      }
      if (off <= reach) { lo = Math.min(lo, s); hi = Math.max(hi, s); }
    }
    return [lo, hi];
  });
  return missed.filter(r => !covered.some(([lo, hi]) => lo <= r.to + near && hi >= r.from - near)).map(r => {
    const a = Math.max(0, r.from - margin), b = Math.min(total, r.to + margin);
    return { kind: minor && r.to - r.from < 3.5 ? 'ford' : 'bridge', path: [pointAt(a), ...road.filter((_, j) => station[j] > a && station[j] < b), pointAt(b)] };
  });
}

/** Every crossing of the routed segments snapped onto the drawn water (see snapCrossingToWater); a bridge over no
 * drawn water is dropped, and drawn river water the road crosses without a crossing gets one (missedWaterCrossings),
 * so no road runs over drawn water without a deck or a ford. Run once per routing result, never per frame. */
export function snapRoadCrossings<S extends { path: Point[]; class?: string; crossings: { kind?: string; path: Point[] }[] }>(segments: readonly S[], clearance: (x: number, y: number) => number, reach: number): S[] {
  return segments.map(s => {
    const snapped = s.crossings.flatMap(c => snapCrossingToWater(s.path, c, clearance, reach) ?? []);
    const missed = missedWaterCrossings(s.path, snapped, clearance, reach, s.class === 'track' || s.class === 'trail') as S['crossings'];
    if (!missed.length) return s.crossings.length ? { ...s, crossings: snapped } : s;
    const first = (c: { path: Point[] }): number => { const p = c.path[0]; let best = Infinity, at = 0; s.path.forEach((q, i) => { const o = Math.hypot(q.x - p.x, q.y - p.y); if (o < best) { best = o; at = i; } }); return at; };
    return { ...s, crossings: [...snapped, ...missed].sort((a, b) => first(a) - first(b)) };
  });
}

/** Regional crossing paths can contain long dry approaches. Only their wet
 * runs and short abutments carry a deck; hills on an approach cannot lift it. */
export function wetBridgeSpans<T extends { path: Point[]; widths: number[]; role: string }>(street: T, waterAt?: (x: number, y: number) => number): T[] {
  if (!waterAt || !['bridge', 'causeway'].includes(street.role) || street.path.length < 2) return [street];
  const points: Point[] = [], widths: number[] = [];
  for (let i = 1; i < street.path.length; i++) {
    const a = street.path[i - 1], b = street.path[i], steps = Math.max(1, Math.ceil(Math.hypot(b.x-a.x, b.y-a.y) / 2));
    for (let j = i === 1 ? 0 : 1; j <= steps; j++) {
      points.push({ x: a.x+(b.x-a.x)*j/steps, y: a.y+(b.y-a.y)*j/steps });
      widths.push(street.widths[i - 1] ?? street.widths[0] ?? 3);
    }
  }
  const wet = points.map(p => Number.isFinite(waterAt(p.x, p.y))), runs: T[] = [];
  for (let i = 0; i < points.length; i++) {
    if (!wet[i]) continue;
    const start = Math.max(0, i - 1);
    while (i + 1 < points.length && wet[i + 1]) i++;
    const end = Math.min(points.length - 1, i + 1);
    if (end > start) {
      const ids = [start];
      for (let j = start + 1; j < end; j++) {
        const a = points[ids[ids.length - 1]], b = points[j], c = points[j + 1];
        if (Math.abs((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)) > 1e-6) ids.push(j);
      }
      ids.push(end);
      runs.push({ ...street, path: ids.map(j => points[j]), widths: ids.map(j => widths[j]) });
    }
  }
  // Retain the original segmentation for a span entirely over water.
  return wet.every(Boolean) ? [street] : runs;
}
