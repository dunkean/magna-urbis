import type { CityLod, CityPalette, CityParcel, CityScene } from './cityCanvas';
import { SpatialBins, shapeBox } from './cityCanvas';
import type { LotEnclosure, Point, ResolvedEnclosure, Shape } from '../../../rust/bridge/urban';
import { polygonContains } from '../gen/core/geom';
import { fromGeom, toGeom } from '../gen/geo/bool';
import polygonClipping from '../vendor/polygonClipping';
import { cultureEnclosure, type CultureEnclosure } from './hedges';
const intersect = polygonClipping.intersection as (...shapes: ReturnType<typeof toGeom>[]) => ReturnType<typeof toGeom>;

/** `cluster` groups several footprints (farmstead house and outbuildings) into one yard; default one per parcel. */
export interface YardHouse { parcel_id: string; footprint: readonly Shape[]; cluster?: string; farm?: boolean; enclosure?: 'wall' | 'fence' | 'hedge' | 'none'; programme?: { farmstead?: { farm?: boolean; enclosure?: string } } }
const KINDS = ['wall', 'fence', 'hedge', 'none'];
export interface Yard { parcel: number; shape: Shape }
/** `culture` and `height` carry the culture's look (tint, wall height) to the 3D meshes. */
export type YardBoundary = LotEnclosure & { fenceStyle?: 'plank' | 'wattle'; culture?: string; height?: number };
export interface YardGeometry { enclosures: YardBoundary[]; yards: Yard[]; pairs: number; /** gate openings (the only deliberate gaps of a yard loop) */ gates: { a: Point; b: Point }[]; /** zone/reason -> count, for measuring coverage */ stats: Record<string, number> }
type Profile = ResolvedEnclosure & CultureEnclosure;
type Box = ReturnType<typeof shapeBox>;
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const minus = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const neg = (a: Point): Point => ({ x: -a.x, y: -a.y });
const length = (p: Point): number => Math.hypot(p.x, p.y);
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const unit = (p: Point): Point => { const l = length(p) || 1; return { x: p.x / l, y: p.y / l }; };
const signed = (r: readonly Point[]): number => r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]; return s + a.x * b.y - b.x * a.y; }, 0) / 2;
const area = (r: readonly Point[]): number => Math.abs(signed(r));
const meet = (a: Box, b: Box): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const boxOf = (r: readonly Point[], pad = 0): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of r) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
};
const bounds = (r: readonly Point[], n: Point): [number, number] => {
  let lo = Infinity, hi = -Infinity;
  for (const p of r) { const d = p.x * n.x + p.y * n.y; if (d < lo) lo = d; if (d > hi) hi = d; }
  return [lo, hi];
};
const draw = (id: string, salt: number): number => { let h = 2166136261 ^ salt; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); return ((h ^ (h >>> 12)) >>> 0) / 4294967296; };
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const contains = (r: Point[], p: Point, tol = .025): boolean => polygonContains(r, p) || r.some((a, i) => distance(p, a, r[(i + 1) % r.length]) < tol);
function distance(p: Point, a: Point, b: Point): number {
  const d = minus(b, a), t = Math.max(0, Math.min(1, dot(minus(p, a), d) / (dot(d, d) || 1)));
  return length(minus(p, lerp(a, b, t)));
}
/** Distance between two segments. */
function gap(a: Point, b: Point, c: Point, d: Point): number {
  const cr = (o: Point, p: Point, q: Point): number => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  if (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) return 0;
  return Math.min(distance(a, c, d), distance(b, c, d), distance(c, a, b), distance(d, a, b));
}
/** Half-plane cut, keeps dot(p, n) <= at. */
function cut(r: Point[], n: Point, at: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], da = dot(a, n) - at, db = dot(b, n) - at;
    if (da <= 1e-7) out.push(a);
    if ((da < -1e-7 && db > 1e-7) || (da > 1e-7 && db < -1e-7)) out.push(lerp(a, b, da / (da - db)));
  }
  return out;
}
/** Only remove (near) collinear points. An obstacle corner is never rounded out into a road. */
function clean(r: Point[]): Point[] {
  r = r.filter((p, i) => length(minus(p, r[(i + r.length - 1) % r.length])) > .025);
  return r.filter((p, i) => distance(p, r[(i + r.length - 1) % r.length], r[(i + 1) % r.length]) > .05);
}
const inTriangle = (p: Point, a: Point, b: Point, c: Point): boolean => {
  const s1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x), s2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x), s3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
};
/** A few straight runs: remove convex (shrinking) vertices of short edges / beyond `max` vertices while the kept house points stay inside. */
function simplifyYard(ring: Point[], points: Point[], max = 8, fill?: (a: Point, b: Point, c: Point) => boolean): Point[] {
  ring = clean(ring);
  while (ring.length > 3) {
    const n = ring.length, sign = Math.sign(signed(ring)) || 1;
    const short = (i: number): boolean => length(minus(ring[(i + 1) % n], ring[i])) < .8;
    // a barely bent corner (< 12 deg, < 0.8 m off its chord) is one straight side (Emilien et al. 2012, parcel simplification)
    const flat = (i: number): boolean => { const a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n], u = unit(minus(b, a)), v = unit(minus(c, b));
      return dot(u, v) > .978 && distance(b, a, c) < .8; };
    // a notch of the block edge (terrace steps, raster stairs) up to 6 m deep is filled when nothing (street, wall) lies in it
    const notch = (i: number): boolean => { if (!fill) return false; const a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n];
      return ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) * sign < 0 && distance(b, a, c) <= 6 && fill(a, b, c); };
    if (n <= max && !ring.some((_, i) => short(i) || flat(i) || notch(i))) break;
    let best = -1, cost = Infinity;
    for (let i = 0; i < n; i++) {
      const a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n], turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const filled = notch(i);
      if (n <= max && !short(i) && !short((i + n - 1) % n) && !flat(i) && !filled) continue;
      // Reflex vertices would grow the yard: only a nearly straight one (a curved street front, <= 25 cm off the chord) or a free notch may go.
      if (turn * sign <= 0 && distance(b, a, c) > .25 && !filled) continue;
      const t = Math.abs(turn) / 2 + (turn * sign <= 0 ? .5 : 0); if (t >= cost) continue;
      // Cutting the corner a-b-c loses exactly the triangle: no kept house point may lie inside it.
      if (turn * sign > 0 && points.some(q => inTriangle(q, a, b, c) && distance(q, a, c) > .1)) continue;
      best = i; cost = t;
    }
    if (best < 0) break;
    ring = ring.filter((_, j) => j !== best);
  }
  return ring;
}
/** Parameters in [0, 1] of `a`→`b` outside every shape and not running along one of its walls
 * (house walls interrupt a fence or replace it, they are never crossed or doubled). */
function outside(a: Point, b: Point, shapes: readonly Shape[], walls = true): [number, number][] {
  const d = minus(b, a), l2 = dot(d, d), l = Math.sqrt(l2), cr = (p: Point, q: Point): number => p.x * q.y - p.y * q.x, ts = [0, 1], along: [number, number][] = [];
  for (const shape of shapes) for (const ring of [shape.outer, ...shape.holes]) for (let i = 0; i < ring.length; i++) {
    const c = ring[i], f = ring[(i + 1) % ring.length], e = minus(f, c), den = cr(d, e), el = length(e);
    if (walls && el > 1e-6 && Math.abs(den) < .17 * l * el && Math.abs(cr(d, minus(c, a))) < .3 * l && Math.abs(cr(d, minus(f, a))) < .3 * l) {
      const t0 = dot(minus(c, a), d) / l2, t1 = dot(minus(f, a), d) / l2, lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
      if (hi > lo) { along.push([lo, hi]); ts.push(lo, hi); }
      continue;
    }
    if (Math.abs(den) < 1e-9) continue;
    const ca = minus(c, a), t = cr(ca, e) / den, u = cr(ca, d) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - ts[i - 1] < 1e-6) continue;
    const m = (ts[i] + ts[i - 1]) / 2, p = lerp(a, b, m);
    if (along.some(([lo, hi]) => m > lo && m < hi) || shapes.some(s => polygonContains(s.outer, p) && !s.holes.some(h => polygonContains(h, p)))) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - ts[i - 1]) < 1e-9) last[1] = ts[i]; else out.push([ts[i - 1], ts[i]]);
  }
  return out;
}
/** Exact clip of the block ground by a convex counter-clockwise cell (Sutherland-Hodgman);
 * undefined when the result would bridge two pieces or holes are involved (polygon-clipping then). */
function clipConvex(cell: Point[], ground: readonly Shape[]): Point[] | null | undefined {
  const box = boxOf(cell), hits = ground.filter(g => meet(box, shapeBox(g)));
  if (!hits.length) return null;
  if (hits.length > 1 || hits[0].holes.some(h => meet(box, boxOf(h)))) return undefined;
  let out = hits[0].outer.slice();
  if (signed(out) < 0) out.reverse();
  const lines: { n: Point; at: number }[] = [];
  for (let i = 0; i < cell.length; i++) {
    const a = cell[i], e = minus(cell[(i + 1) % cell.length], a), l = length(e); if (l < 1e-6) continue;
    const n = { x: e.y / l, y: -e.x / l }; lines.push({ n, at: dot(a, n) });
    out = cut(out, n, dot(a, n)); if (out.length < 3) return null;
  }
  // A non-convex ground cut by one window line into two parts leaves overlapping runs on that line.
  for (const { n, at } of lines) {
    const t = { x: -n.y, y: n.x }, runs: [number, number][] = [];
    for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length];
      if (Math.abs(dot(a, n) - at) < 1e-5 && Math.abs(dot(b, n) - at) < 1e-5) runs.push([Math.min(dot(a, t), dot(b, t)), Math.max(dot(a, t), dot(b, t))]); }
    runs.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < runs.length; i++) if (runs[i][0] < runs[i - 1][1] - 1e-4) return undefined;
  }
  return out;
}
interface Cut { n: Point; at: number; inner?: boolean; /** shared by the two cells of one inner line */ id?: number }
/** Who owns a yard: a house cluster (farmstead, parcel), a merged pair sharing one yard, or a public parcel. */
interface Owner {
  key: string; id: string; parcel: number; block: string; points: Point[]; size: number; center: Point;
  u: Point; v: Point; entry?: Point; farm: boolean; obstacle: boolean; enclosure?: string; profile: Profile; dense: boolean; closed: boolean
  /** Gap (m) to the second-nearest neighbouring house of the block (the nearest when alone with one): the local spacing. */
  spacing: number
}
/** One connected body of an owner (house with its attached annexes, a detached barn...): one cell of the partition. */
interface Site { owner: number; block: string; points: Point[]; center: Point; r: number; ext: [number, number, number, number]; box: Box; cuts: Cut[] }
/** Share of fringe (faubourg/edge/village) houses that keep a yard in a culture that fences at all. */
const FRINGE_PLOT = .9;
/** Public ground inside a block: yards stop at it, never enclose it. */
const OBSTACLES = new Set(['place', 'common', 'market', 'court']);
/** Touching bodies (party walls, bent rows along a curved street) are still separated by their common wall line:
 * a body may cross the line by this much (the fence is cut back at its walls), beyond that they interlock. */
const TOUCH = -2;
/** Two houses closer than this (m) are neighbours of one built row: their yards always meet. */
const NEAR = 14;
/** Open ground: yards grow to meet neighbours up to this spacing (m); beyond, a house keeps a yard of its own size. */
const MEET = 70;
/** Share of open-ground houses (no neighbour within NEAR) that keep a yard in a culture that fences at all. */
const OPEN_PLOT = .95;
const mean = (points: readonly Point[]): Point => points.reduce((s, q) => ({ x: s.x + q.x / points.length, y: s.y + q.y / points.length }), { x: 0, y: 0 });

/** Street frame of a parcel: `u` along its street front, `v` into the lot, `entry` the middle of its served front. */
function frame(p: CityParcel, center: Point): { u: Point; v: Point; entry?: Point } {
  const front = p.source.contacts?.filter(c => !['unserved', 'reserved'].includes(c.kind)).sort((a, b) => b.length - a.length)[0];
  const segment = front ? [front.a, front.b] : p.source.front;
  let u = segment ? minus(segment[1], segment[0]) : p.source.axis ?? { x: 1, y: 0 };
  const served = !!segment && length(u) > .9;
  if (!(length(u) > 1e-6)) u = { x: 1, y: 0 };
  u = unit(u);
  let v = { x: -u.y, y: u.x };
  const entry = served ? lerp(segment![0], segment![1], .5) : undefined;
  if (entry && dot(minus(center, entry), v) < 0) v = neg(v);
  return { u, v, entry };
}

/** Yards are a partition of the built block among its houses, not a box per house.
 * Every body (a house with its attached annexes, a detached outbuilding) and every public parcel of the block is a site;
 * neighbouring sites are split by ONE line (a power-diagram bisector weighted by size, snapped to the street axes,
 * kept clear of both bodies), so neighbouring yards share their fence. A site's cell is its reach (sized by the house,
 * farm, culture data and a seeded spread) cut by those lines, clipped by the block ground (streets, water) and simplified
 * to a few straight runs. An owner's yard is the union of its cells: lines between its own cells carry no fence.
 * Fences are the closed yards' edges minus house walls; gates sit on the street side; collinear runs are drawn once.
 * Linear: bins for neighbours, barriers and footprints; the boolean clip only where the convex clip cannot decide.
 */
export function buildYardEnclosures(scene: CityScene, houses: readonly YardHouse[]): YardGeometry {
  const result: YardGeometry = { enclosures: [], yards: [], pairs: 0, gates: [], stats: {} };
  const note = (zone: string, why: string): void => { const k = `${zone}/${why}`; result.stats[k] = (result.stats[k] ?? 0) + 1; };
  const profiles: (Profile | undefined)[] = (scene.enclosureProfiles ?? []).map((r, i) => {
    const cultural = cultureEnclosure(scene.layouts[i]?.culture ?? '');
    return r && { ...cultural, ...r, plot: cultural.plot === 0 ? 0 : r.plot };
  });
  if (!profiles.some(r => r && r.plot > 0)) return result;
  const keyOf = (h: YardHouse): string => h.cluster ?? h.parcel_id;
  // ---- owners: one per farmstead / parcel; every footprint is kept for the fence subtraction
  const grouped = new Map<string, { pi: number; rings: Point[][]; size: number; farm: boolean; enclosure?: string }>();
  const footprints: Shape[] = [];
  for (const house of houses) {
    const pi = scene.parcelById.get(house.parcel_id);
    if (pi === undefined || !profiles[scene.parcels[pi].layout]) continue;
    let group = grouped.get(keyOf(house));
    if (!group) grouped.set(keyOf(house), group = { pi, rings: [], size: 0, farm: false });
    const hint = house.programme?.farmstead; // a farmstead is one cluster: its own farm flag and enclosure kind win
    group.farm ||= !!house.farm || !!hint?.farm;
    const kind = house.enclosure ?? hint?.enclosure; if (kind && KINDS.includes(kind)) group.enclosure = kind;
    for (const s of house.footprint) {
      const ring = s.outer.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)); if (ring.length < 3) continue;
      footprints.push({ outer: ring, holes: [] }); group.rings.push(ring); group.size += area(ring);
    }
  }
  const owners: Owner[] = [], sites: Site[] = [];
  const makeOwner = (key: string, pi: number, points: Point[], size: number, farm: boolean, obstacle: boolean, enclosure?: string): Owner | undefined => {
    const p = scene.parcels[pi], profile = profiles[p.layout];
    if (!profile || points.length < 3) return undefined;
    const center = mean(points), { u, v, entry } = frame(p, center);
    return { key, id: `${scene.layouts[p.layout]?.key}/${key}`, parcel: pi, block: `${p.layout}/${p.block}`, points, size: Math.max(size, 1), center, u, v, entry,
      farm: farm || /farm|compound/.test(p.allocation?.role ?? '') || p.use === 'compound', obstacle, enclosure,
      profile: enclosure && enclosure !== 'none' ? { ...profile, material: enclosure as Profile['material'] } : profile, dense: false, closed: false, spacing: Infinity };
  };
  const addSite = (owner: number, points: Point[]): void => {
    sites.push({ owner, block: owners[owner].block, points, center: mean(points), r: Math.sqrt(Math.max(area(points), 1) / Math.PI), ext: [0, 0, 0, 0], box: boxOf(points), cuts: [] });
  };
  for (const [key, g] of grouped) {
    const o = makeOwner(key, g.pi, g.rings.flat(), g.size, g.farm, false, g.enclosure); if (!o) continue;
    owners.push(o); for (const ring of g.rings) addSite(owners.length - 1, ring);
  }
  if (!owners.length) return result;
  const builtBlocks = new Set(owners.map(o => o.block));
  scene.parcels.forEach((p, pi) => {
    if (!OBSTACLES.has(p.use) || !builtBlocks.has(`${p.layout}/${p.block}`)) return;
    const o = makeOwner(`public:${p.id ?? pi}`, pi, p.shape.outer, area(p.shape.outer), false, true); if (!o) return;
    owners.push(o); addSite(owners.length - 1, p.shape.outer);
  });

  /** ONE line between two sites, clear of both bodies: the size-weighted bisector, snapped to a street axis when that is nearly as good. */
  const separator = (a: Site, b: Site): Cut | undefined => {
    const A = owners[a.owner], B = owners[b.owner];
    const d = minus(b.center, a.center), L = length(d), n = L > 1e-6 ? { x: d.x / L, y: d.y / L } : A.u;
    // in a built row the split stays near the middle (regular plot widths along the street); in open ground size weighs more
    const wa = (a.r * (A.farm ? 1.4 : 1)) ** 2, wb = (b.r * (B.farm ? 1.4 : 1)) ** 2, t = .5 + (A.dense && B.dense ? .4 : 1) * (clamp(.5 + (wa - wb) / (2 * L * L || 1), .25, .75) - .5);
    const gapOf = (m: Point): { m: Point; gap: number; hi: number; lo: number } => { const hi = bounds(a.points, m)[1], lo = bounds(b.points, m)[0]; return { m, gap: lo - hi, hi, lo }; };
    const centre = gapOf(n);
    let snapped: ReturnType<typeof gapOf> | undefined, best = centre;
    for (const axis of [A.u, A.v, B.u, B.v]) {
      const g = gapOf(dot(axis, n) < 0 ? neg(axis) : axis);
      if (dot(g.m, n) > .9 && g.gap >= Math.min(.6, centre.gap) && (!snapped || g.gap > snapped.gap)) snapped = g;
      if (g.gap > best.gap) best = g;
    }
    // Party walls and bent rows: the walls' own normals (separating-axis test) when no frame axis separates them.
    if (best.gap < TOUCH) for (const P of [a.points, b.points]) for (let i = 0; i < P.length && best.gap < TOUCH; i++) {
      const e = minus(P[(i + 1) % P.length], P[i]), l = length(e); if (l < .3) continue;
      const m = { x: -e.y / l, y: e.x / l }, g = gapOf(dot(m, n) < 0 ? neg(m) : m); if (g.gap > best.gap) best = g;
    }
    const pick = snapped ?? (centre.gap >= .6 ? centre : best);
    if (pick.gap < TOUCH) return undefined;
    const p = dot(a.center, pick.m) + t * dot(d, pick.m), margin = pick.gap > 0 ? Math.min(1, .35 * pick.gap) : 0;
    return { n: pick.m, at: pick.gap > 0 ? clamp(p, pick.hi + margin, pick.lo - margin) : (pick.hi + pick.lo) / 2 };
  };
  // ---- bodies: overlapping footprints form one site; owners whose bodies interlock share one court;
  // a seeded share of neighbours share one yard (culture `yardMerge`)
  const sp = sites.map((_, i) => i), op = owners.map((_, i) => i);
  const find = (q: number[], i: number): number => { while (q[i] !== i) i = q[i] = q[q[i]]; return i; };
  const near = owners.map(() => 0), nearest = owners.map(() => ({ j: -1, d: Infinity }));
  const nearBins = new SpatialBins(sites.map(s => boxOf(s.points, NEAR / 2)), 48);
  sites.forEach((a, i) => {
    for (const j of nearBins.query(boxOf(a.points, NEAR / 2))) {
      const b = sites[j]; if (j <= i || a.block !== b.block || owners[a.owner].obstacle || owners[b.owner].obstacle) continue;
      const bb = b.box, ab = a.box, gap = Math.max(bb.minX - ab.maxX, ab.minX - bb.maxX, bb.minY - ab.maxY, ab.minY - bb.maxY, 0);
      if (gap > NEAR) continue;
      const own = a.owner === b.owner, d = length(minus(a.center, b.center));
      if (!own) { near[a.owner]++; near[b.owner]++;
        if (d < nearest[a.owner].d) nearest[a.owner] = { j: b.owner, d }; if (d < nearest[b.owner].d) nearest[b.owner] = { j: a.owner, d }; }
      if (gap > .5 || separator(a, b)) continue; // only touching bodies can interlock
      sp[find(sp, i)] = find(sp, j);
      if (!own) { op[find(op, a.owner)] = find(op, b.owner); note('merge', 'interlocked'); }
    }
  });
  const paired = new Set<number>();
  owners.forEach((a, i) => {
    const { j, d } = nearest[i]; if (j < 0 || a.farm || paired.has(i) || paired.has(j) || owners[j].farm || draw(a.id, 5) >= a.profile.yardMerge) return;
    if (d > 2 * (Math.sqrt(a.size / Math.PI) + Math.sqrt(owners[j].size / Math.PI)) + 3 || find(op, i) === find(op, j)) return;
    paired.add(i); paired.add(j); op[find(op, i)] = find(op, j); note('merge', 'shared');
  });
  // merged owners: the largest member gives the parcel, the frame and the seed
  const members = new Map<number, number[]>();
  owners.forEach((_, i) => { const r = find(op, i); members.set(r, [...members.get(r) ?? [], i]); });
  for (const [root, list] of members) {
    const o = owners[root];
    if (list.length > 1) {
      const main = owners[list.reduce((m, i) => owners[i].size > owners[m].size ? i : m, list[0])], points = list.flatMap(i => owners[i].points);
      const merged = makeOwner(list.map(i => owners[i].key).join('+'), main.parcel, points, list.reduce((t, i) => t + owners[i].size, 0), list.some(i => owners[i].farm), false, list.map(i => owners[i].enclosure).find(e => e));
      if (merged) { Object.assign(o, merged); o.id = main.id; }
    }
    o.dense = list.some(i => near[i] >= 1);
    const p = scene.parcels[o.parcel], P = o.profile, share = o.enclosure ? 1 : p.peripheral || p.zone === 'faubourg' ? Math.max(P.plot, FRINGE_PLOT) : P.plot;
    o.closed = !o.obstacle && o.enclosure !== 'none' && P.plot > 0 && ['plot', 'compound'].includes(p.use) && !!o.entry && draw(o.id, 1) < share;
  }
  // Local spacing (Emilien et al. 2012 grow parcels until they collide): in open ground a yard reaches half-way to its
  // neighbours, so scattered houses still form a patchwork of touching yards; the shared line is the same bisector.
  const roots = [...members.keys()].filter(r => !owners[r].obstacle), rootBox = roots.map(r => boxOf(owners[r].points));
  const rootBins = new SpatialBins(rootBox.map(b => ({ minX: b.minX - MEET / 2, minY: b.minY - MEET / 2, maxX: b.maxX + MEET / 2, maxY: b.maxY + MEET / 2 })), 64);
  roots.forEach((r, i) => {
    const a = rootBox[i], gaps = rootBins.query({ minX: a.minX - MEET / 2, minY: a.minY - MEET / 2, maxX: a.maxX + MEET / 2, maxY: a.maxY + MEET / 2 })
      .filter(j => j !== i && owners[roots[j]].block === owners[r].block)
      .map(j => { const b = rootBox[j]; return Math.max(b.minX - a.maxX, a.minX - b.maxX, b.minY - a.maxY, a.minY - b.maxY, 0); }).filter(g => g <= MEET).sort((x, y) => x - y);
    owners[r].spacing = gaps.length ? gaps[Math.min(1, gaps.length - 1)] : Infinity;
    owners[r].dense ||= gaps.length > 0 && gaps[0] < NEAR;
    // An unfenced house in open ground would leave a hole in the patchwork: there nearly every house keeps its yard.
    const o = owners[r], p = scene.parcels[o.parcel];
    if (!o.dense && !o.closed && o.enclosure !== 'none' && o.profile.plot > 0 && ['plot', 'compound'].includes(p.use) && !!o.entry && draw(o.id, 1) < OPEN_PLOT) o.closed = true;
  });
  /** An owner's reach before its neighbours, shared by all its cells (one straight outline): sized by its houses (and farm),
   * the local spacing, the culture's yard data and a seeded spread. In a built row it is a box the neighbours' lines cut;
   * in open ground it is an organic convex yard: front along the road, splayed sides, a kinked back. */
  const reach = (o: Owner): Point[] => {
    const [x0, x1] = bounds(o.points, o.u), [y0, y1] = bounds(o.points, o.v), w = x1 - x0, d = y1 - y0, P = o.profile, k = P.yardSpread, id = o.id;
    const j = (q: number): number => 1 + k * 1.2 * (draw(id, q) - .5);
    // A built row reaches its neighbours (the shared line bounds it); a lone house keeps a house-sized yard.
    let side = (o.dense ? Math.max(6, .6 * w) : clamp(.35 * w, 2, 7)) * P.yardSide;
    let back = o.dense ? Math.max(8, d * P.yardDepth) : clamp(.8 * d * P.yardDepth, 4, 22);
    // Open ground: reach half-way to the neighbours (plus an overlap the shared line trims), so yards meet.
    const meet = Number.isFinite(o.spacing) ? Math.min(MEET / 2, o.spacing / 2 + 2) : 0;
    if (o.farm) { side += 4; back = Math.max(back, 12) + 6; if (!o.dense) back = Math.max(back, 28); } // the farm's croft behind
    if (draw(o.id, 12) < P.yardLong) back *= 2.2; // a long back garden
    back = Math.min(60, back);
    const front = o.entry ? Math.min(y0, dot(o.entry, o.v)) - 1.5 : y0 - side;
    const at = (x: number, y: number): Point => ({ x: o.u.x * x + o.v.x * y, y: o.u.y * x + o.v.y * y });
    // the seeded spread never shortens the reach below the meeting line
    const l = x0 - Math.max(side * j(15), meet), r = x1 + Math.max(side * j(16), meet), bl = y1 + Math.max(back * j(13), .8 * meet), br = y1 + Math.max(back * j(14), .8 * meet);
    let ring: Point[];
    if (o.dense) ring = [at(l, front), at(r, front), at(r, br), at(l, bl)];
    else {
      // splayed sides (up to ~20 deg) and an outward kink on the back line: never a lone rectangle
      // a side that has to meet a neighbour only splays outwards (an inward splay would open a wedge along the shared line)
      const taper = (q: number, depth: number): number => Math.max(meet > 0 ? 0 : -.3 * (r - l), (draw(id, q) - .35) * .7 * depth);
      const sl = taper(17, bl - front), sr = taper(18, br - front), xl = l - sl, xr = r + sr;
      const kx = xl + (xr - xl) * (.3 + .4 * draw(id, 19)), ky = Math.max(bl, br) + (.06 + .12 * draw(id, 20)) * back;
      const pts: [number, number][] = [[l, front], [r, front], [xr, br], [kx, ky], [xl, bl]];
      ring = pts.map(([x, y]) => at(x, y));
    }
    return signed(ring) < 0 ? ring.reverse() : ring;
  };
  // One separator per owner pair (whole clusters): an owner split by none of its neighbours keeps ONE cell, so its yard is one
  // convex outline with no inner lines; only owners whose clusters interlock with a neighbour are split into one cell per body.
  let cutIds = 0;
  const between = new Map<string, Cut | null>(), wholes = new Map<number, Site>();
  const whole0 = (oi: number): Site => { let w = wholes.get(oi); if (!w) { const o = owners[oi]; w = { owner: oi, block: o.block, points: o.points, center: o.center, r: Math.sqrt(o.size / Math.PI), ext: [0, 0, 0, 0], box: boxOf(o.points), cuts: [] }; wholes.set(oi, w); } return w; };
  const wholeCut = (x: number, y: number): Cut | null => {
    const key = x < y ? `${x}/${y}` : `${y}/${x}`;
    let whole = between.get(key);
    if (whole === undefined) { whole = separator(whole0(Math.min(x, y)), whole0(Math.max(x, y))) ?? null; between.set(key, whole); }
    return whole && (x < y ? whole : { n: neg(whole.n), at: -whole.at });
  };
  const live = roots.concat([...members.keys()].filter(r => owners[r].obstacle));
  const ownerReach = new Map<number, Point[]>(live.map(r => [r, owners[r].obstacle ? owners[r].points : reach(owners[r])]));
  const ownerBins = new SpatialBins(live.map(r => boxOf(ownerReach.get(r)!)), 48), split = new Set<number>();
  live.forEach((r, i) => { for (const j of ownerBins.query(boxOf(ownerReach.get(r)!))) { const q = live[j];
    if (j <= i || owners[r].block !== owners[q].block || (!owners[r].closed && !owners[q].closed)) continue;
    if (!wholeCut(r, q)) { split.add(r); split.add(q); } } });
  // bodies, re-attached to their owner's root and measured in its street frame (one cell per owner unless split)
  const bodies = new Map<string, number[]>();
  sites.forEach((_, i) => { const owner = find(op, sites[i].owner), k = split.has(owner) ? `b${find(sp, i)}` : `o${owner}`; bodies.set(k, [...bodies.get(k) ?? [], i]); });
  const cells: Site[] = [];
  for (const list of bodies.values()) {
    const points = list.flatMap(i => sites[i].points), owner = find(op, sites[list[0]].owner), o = owners[owner];
    const [x0, x1] = bounds(points, o.u), [y0, y1] = bounds(points, o.v);
    cells.push({ owner, block: o.block, points, center: mean(points), r: Math.sqrt(list.reduce((t, i) => t + Math.PI * sites[i].r ** 2, 0) / Math.PI), ext: [x0, x1, y0, y1], box: boxOf(points), cuts: [] });
  }
  const reaches = cells.map(s => ownerReach.get(s.owner)!);
  cells.forEach((s, i) => { s.box = boxOf(reaches[i]); });
  const bins = new SpatialBins(cells.map(s => s.box), 48);
  cells.forEach((a, i) => {
    for (const j of bins.query(a.box)) {
      const b = cells[j], A = owners[a.owner], B = owners[b.owner]; if (j <= i || a.block !== b.block || (!A.closed && !B.closed)) continue;
      result.pairs++;
      const inner = a.owner === b.owner;
      // Two owners are split by ONE line for all their cells when their whole clusters allow it: a straight shared side, not steps.
      let c: Cut | undefined = inner ? undefined : wholeCut(a.owner, b.owner) ?? undefined;
      c ??= separator(a, b);
      if (c) { const id = inner ? ++cutIds : undefined; a.cuts.push({ ...c, inner, id }); b.cuts.push({ n: neg(c.n), at: -c.at, inner, id }); }
      else if (!inner) { A.closed = false; B.closed = false; } // interlocked after a merge: the shared court stays open
    }
  });
  const blocks = new Map(scene.blocks.map(b => [`${b.layout}/${b.index}`, b]));
  // Physical barriers inside blocks (lanes, closes, walls) as short segments; streets around the block are its edge already.
  const barriers: { a: Point; b: Point; width: number; box: Box }[] = [];
  const add = (path: Point[], width: number): void => {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], l = length(minus(b, a)), steps = Math.max(1, Math.ceil(l / 32));
      for (let j = 0; j < steps; j++) { const x = lerp(a, b, j / steps), y = lerp(a, b, (j + 1) / steps);
        barriers.push({ a: x, b: y, width, box: { minX: Math.min(x.x, y.x) - width, minY: Math.min(x.y, y.y) - width, maxX: Math.max(x.x, y.x) + width, maxY: Math.max(x.y, y.y) + width } }); }
    }
  };
  for (const s of scene.streets) if (!['private', 'boundary'].includes(s.role)) add(s.street.path, s.width / 2 + .45);
  for (const w of scene.walls) for (const path of w.pieces) add(path, 1.8);
  const barrierBins = new SpatialBins(barriers.map(b => b.box), 48);
  const footprintBins = new SpatialBins(footprints.map(f => shapeBox(f)), 32);
  const onStreet = (p: Point, extra: number): boolean => scene.bins.streets.query({ minX: p.x - 1, minY: p.y - 1, maxX: p.x + 1, maxY: p.y + 1 }).some(i => {
    const s = scene.streets[i], path = s.street.path;
    for (let k = 1; k < path.length; k++) if (distance(p, path[k - 1], path[k]) <= s.width / 2 + extra) return true;
    return false;
  });
  /** The cell: reach, shared lines, inner barriers, block ground; then a few straight runs. */
  const fit = (s: Site, ring: Point[]): { ring?: Point[]; why: string } => {
    for (const c of s.cuts) ring = cut(ring, c.n, c.at);
    if (ring.length < 3) return { why: 'cut' };
    for (const i of barrierBins.query(boxOf(ring))) {
      const b = barriers[i], d = minus(b.b, b.a), n = unit({ x: -d.y, y: d.x });
      const normal = dot(minus(s.center, b.a), n) >= 0 ? neg(n) : n, at = dot(b.a, normal) - b.width;
      // Only a ribbon that really meets the cell cuts it (a segment's line extension never slices a yard).
      if (!ring.some(q => dot(q, normal) > at) || !(contains(ring, b.a) || ring.some((q, j) => gap(q, ring[(j + 1) % ring.length], b.a, b.b) < b.width))) continue;
      // The yard stops at the ribbon; a house standing in its margin keeps the yard flush with its facade.
      const hi = bounds(s.points, normal)[1];
      if (hi <= at + .025) ring = cut(ring, normal, at); else if (hi - at < 2.5) ring = cut(ring, normal, hi + .02);
      if (ring.length < 3) return { why: 'barrier' };
    }
    const block = blocks.get(s.block); if (!block) return { why: 'noBlock' };
    const ground = block.ground ?? [block.shape];
    let piece = clipConvex(ring, ground);
    if (piece === undefined) {
      note('clip', 'boolean');
      try {
        const pieces = fromGeom(intersect(toGeom([{ outer: ring, holes: [] }]), toGeom(ground)), .01, false, true);
        piece = pieces.map(p => p.outer).sort((x, y) => s.points.filter(q => contains(y, q)).length - s.points.filter(q => contains(x, q)).length)[0] ?? null;
      } catch { return { why: 'clip' }; }
    }
    if (!piece || piece.length < 3) return { why: 'clip' };
    const kept = s.points.filter(q => contains(piece!, q, .1));
    if (kept.length < s.points.length / 2) return { why: 'ownPoint' };
    // a notch may be filled only where no street or wall ribbon reaches into it
    const free = (a: Point, b: Point, c: Point): boolean => barrierBins.query(boxOf([a, b, c])).every(i => { const r = barriers[i];
      return !(inTriangle(r.a, a, b, c) || inTriangle(r.b, a, b, c) || [[a, b], [b, c], [c, a]].some(([p, q]) => gap(p, q, r.a, r.b) < r.width)); });
    const out = simplifyYard(piece, kept, 8, free);
    if (out.length < 3 || area(out) < 8) return { why: 'area' };
    // no sliver: a yard narrower than 2.5 m (a strip left between a house and the block edge) is no yard
    let width = Infinity;
    for (let i = 0; i < out.length; i++) { const e = unit(minus(out[(i + 1) % out.length], out[i])), n = { x: -e.y, y: e.x }, [lo, hi] = bounds(out, n); width = Math.min(width, hi - lo); }
    if (width < 2.5) return { why: 'sliver' };
    return { ring: out, why: 'yard' };
  };
  const runs: { a: Point; b: Point; side: LotEnclosure['side']; owner: Owner; gate?: boolean }[] = [];
  const cellsOf = new Map<number, number[]>();
  cells.forEach((s, i) => cellsOf.set(s.owner, [...cellsOf.get(s.owner) ?? [], i]));
  for (const [oi, list] of cellsOf) {
    const o = owners[oi], p = scene.parcels[o.parcel], P = o.profile;
    if (o.obstacle) continue;
    note(p.zone, 'holdings');
    if (!o.closed) { note(p.zone, 'open'); continue; }
    // Every yard is a closed loop: the street front is always fenced too, broken only by its gate.
    const own: { a: Point; b: Point; side: LotEnclosure['side'] }[] = [];
    const innerRuns = new Map<number, { u: Point; at: number; iv: [number, number, number][]; s: Site }>();
    let yard = 0;
    for (const ci of list) {
      const s = cells[ci], tried = fit(s, reaches[ci]);
      if (!tried.ring) { note(p.zone, tried.why); continue; }
      const ring = tried.ring; yard += area(ring);
      result.yards.push({ parcel: o.parcel, shape: { outer: ring, holes: [] } });
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], mid = lerp(a, b, .5), dir = unit(minus(b, a));
        const on = s.cuts.filter(c => Math.abs(dot(a, c.n) - c.at) < .06 && Math.abs(dot(b, c.n) - c.at) < .06);
        const innerCut = on.find(c => c.inner);
        if (innerCut) {
          // Between two cells of one yard: the two cells' edges cancel; what one missing or shorter cell leaves uncovered is boundary.
          let r = innerRuns.get(innerCut.id!);
          if (!r) { const u = { x: -innerCut.n.y, y: innerCut.n.x }; r = { u, at: dot(a, { x: -u.y, y: u.x }), iv: [], s }; innerRuns.set(innerCut.id!, r); }
          const ta = dot(a, r.u), tb = dot(b, r.u); r.iv.push([Math.min(ta, tb), Math.max(ta, tb), ta < tb ? 1 : -1]);
          continue;
        }
        const depth = dot(mid, o.v), along = Math.abs(dot(dir, o.u)) > .75;
        const side: LotEnclosure['side'] = !on.length && depth <= s.ext[2] + .5 && (along || onStreet(mid, 1.6)) ? 'front' : along && depth > s.ext[3] - .5 ? 'back' : 'side';
        if (side === 'front' || (side === 'side' ? P.side > 0 : P.back > 0)) own.push({ a, b, side });
      }
    }
    for (const r of innerRuns.values()) {
      const ev = r.iv.flatMap(([lo, hi, w]) => [[lo, w], [hi, -w]] as [number, number][]).sort((x, y) => x[0] - y[0]), n = { x: -r.u.y, y: r.u.x };
      let net = 0, from = 0;
      const at = (t: number): Point => ({ x: r.u.x * t + n.x * r.at, y: r.u.y * t + n.y * r.at });
      for (const [t, w] of ev) { if (net !== 0 && t - from > .05) own.push({ a: at(from), b: at(t), side: 'side' }); net += w; from = t; }
    }
    if (!yard) continue;
    note(p.zone, 'yard');
    // House walls close the yard themselves: the fence stops at them, never crosses or doubles them.
    const pieces = own.flatMap(r => {
      const close = footprintBins.query(boxOf([r.a, r.b], .35)).map(i => footprints[i]);
      // ... and never runs on a street: a house standing in the road margin leaves no fence on the carriageway.
      const roads = barrierBins.query(boxOf([r.a, r.b])).map(i => barriers[i]).filter(b => b.width > 1.2).map(b => {
        const u = unit(minus(b.b, b.a)), h = b.width - .65, nx = -u.y * h, ny = u.x * h;
        return { outer: [{ x: b.a.x + nx, y: b.a.y + ny }, { x: b.b.x + nx, y: b.b.y + ny }, { x: b.b.x - nx, y: b.b.y - ny }, { x: b.a.x - nx, y: b.a.y - ny }], holes: [] };
      });
      const free = close.length ? outside(r.a, r.b, close) : [[0, 1] as [number, number]];
      return free.flatMap(([t0, t1]) => { const a = lerp(r.a, r.b, t0), b = lerp(r.a, r.b, t1); return (roads.length ? outside(a, b, roads, false) : [[0, 1] as [number, number]]).map(([s0, s1]) => ({ a: lerp(a, b, s0), b: lerp(a, b, s1), side: r.side })); })
            .filter(q => length(minus(q.b, q.a)) > .1);
    });
    // The gate: on the street side, on the free front run nearest the house, a door or a cart gate.
    // a culture of open street fronts (`front` low) gets wide cart gates rather than an unclosed yard
    const width = o.farm ? 3.5 : (yard > 600 && draw(o.id, 6) < .5) || draw(o.id, 2) >= P.front ? 2.6 : 1.3;
    let gate: { k: number; t: number } | undefined, score = Infinity;
    pieces.forEach((q, k) => {
      const len = length(minus(q.b, q.a)); if (q.side !== 'front' || len < width + .6) return;
      const d = minus(q.b, q.a), t = clamp(dot(minus(o.center, q.a), d) / (len * len), (width / 2 + .3) / len, 1 - (width / 2 + .3) / len);
      const e = length(minus(lerp(q.a, q.b, t), o.center)); if (e < score) { score = e; gate = { k, t }; }
    });
    pieces.forEach((q, k) => {
      if (gate?.k !== k) { runs.push({ ...q, owner: o }); return; }
      const len = length(minus(q.b, q.a)), h = width / 2 / len, x = lerp(q.a, q.b, gate.t - h), y = lerp(q.a, q.b, gate.t + h);
      runs.push({ a: q.a, b: x, side: q.side, owner: o }, { a: x, b: y, side: q.side, owner: o, gate: true }, { a: y, b: q.b, side: q.side, owner: o });
      result.gates.push({ a: x, b: y });
    });
  }
  // Collinear interval union: a shared line is drawn once, partial overlaps included.
  // Gate intervals are subtracted globally: the neighbour can never fence an entrance shut.
  const lines = new Map<string, { u: Point; n: Point; at: number; runs: typeof runs; gates: [number, number][] }>();
  for (const s of runs) {
    if (length(minus(s.b, s.a)) < .05) continue;
    let u = unit(minus(s.b, s.a)); if (u.x < -1e-8 || Math.abs(u.x) < 1e-8 && u.y < 0) u = neg(u);
    const n = { x: -u.y, y: u.x }, at = dot(s.a, n), key = `${Math.round(u.x * 2e3)}/${Math.round(u.y * 2e3)}/${Math.round(at * 10)}`;
    const line = lines.get(key) ?? { u, n, at, runs: [], gates: [] }; lines.set(key, line);
    if (s.gate) line.gates.push([Math.min(dot(s.a, u), dot(s.b, u)), Math.max(dot(s.a, u), dot(s.b, u))]); else line.runs.push(s);
  }
  for (const line of lines.values()) {
    const list = line.runs.map(s => ({ lo: Math.min(dot(s.a, line.u), dot(s.b, line.u)), hi: Math.max(dot(s.a, line.u), dot(s.b, line.u)), s })).sort((a, b) => a.lo - b.lo);
    line.gates.sort((a, b) => a[0] - b[0]);
    let end = -Infinity, gateIndex = 0;
    const at = (t: number): Point => ({ x: line.u.x * t + line.n.x * line.at, y: line.u.y * t + line.n.y * line.at });
    for (const { lo, hi, s } of list) {
      let start = Math.max(lo, end); if (hi <= start) continue;
      const P = s.owner.profile, culture = scene.layouts[scene.parcels[s.owner.parcel].layout]?.culture;
      const emit = (b: number): void => { if (b - start > .05) result.enclosures.push({ path: [at(start), at(b)], material: P.material, ...(P.material === 'fence' ? { fenceStyle: P.fenceStyle ?? 'wattle' } : {}), side: s.side, culture, height: P.wallHeight }); };
      while (gateIndex < line.gates.length && line.gates[gateIndex][1] <= start) gateIndex++;
      for (let i = gateIndex; i < line.gates.length && line.gates[i][0] < hi; i++) { const [a, b] = line.gates[i]; emit(Math.min(a, hi)); start = Math.max(start, b); }
      emit(hi); end = Math.max(end, hi);
    }
  }
  result.enclosures = mergeParallel(result.enclosures, result.gates);
  return result;
}

/** Two parallel runs closer than 1 m are one fence: the longer is kept, the other loses the overlapping part.
 * Gates are cut out of every nearly collinear run, so no neighbouring run can close an entrance. */
function mergeParallel(runs: YardBoundary[], gates: readonly { a: Point; b: Point }[]): YardBoundary[] {
  const len = (r: YardBoundary): number => length(minus(r.path[1], r.path[0]));
  const order = runs.map((_, i) => i).sort((x, y) => len(runs[y]) - len(runs[x]));
  const pad = (a: Point, b: Point, d: number): Box => ({ minX: Math.min(a.x, b.x) - d, minY: Math.min(a.y, b.y) - d, maxX: Math.max(a.x, b.x) + d, maxY: Math.max(a.y, b.y) + d });
  const bins = new SpatialBins(runs.map(r => pad(r.path[0], r.path[1], 1)), 32), gateBins = new SpatialBins(gates.map(g => pad(g.a, g.b, .3)), 32);
  const kept: { a: Point; b: Point }[][] = runs.map(() => []), out: YardBoundary[] = [];
  for (const i of order) {
    const r = runs[i], a = r.path[0], b = r.path[1], L = len(r); if (L < .05) continue;
    const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, n = { x: -u.y, y: u.x }, cutOut: [number, number][] = [];
    const take = (c: Point, d: Point, tol: number): void => {
      const e = minus(d, c), l = length(e); if (l < .05 || Math.abs(dot(e, n)) / l > .07) return; // not parallel (4 deg)
      if (Math.abs(dot(minus(c, a), n)) >= tol || Math.abs(dot(minus(d, a), n)) >= tol) return;
      const t0 = dot(minus(c, a), u), t1 = dot(minus(d, a), u), lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(L, Math.max(t0, t1));
      if (hi > lo) cutOut.push([lo, hi]);
    };
    for (const j of bins.query(pad(a, b, 1))) for (const q of kept[j]) take(q.a, q.b, 1);
    for (const j of gateBins.query(pad(a, b, .3))) take(gates[j].a, gates[j].b, .3);
    cutOut.sort((x, y) => x[0] - y[0]);
    let from = 0;
    const emit = (to: number): void => { if (to - from > .1) { const q = { a: lerp(a, b, from / L), b: lerp(a, b, to / L) }; kept[i].push(q); out.push({ ...r, path: [q.a, q.b] }); } };
    for (const [lo, hi] of cutOut) { if (lo > from) emit(lo); from = Math.max(from, hi); }
    emit(L);
  }
  return out;
}

const YARDS = new WeakMap<CityScene, object>();
/** Source identity changes only with retained buildings, not on camera/colour updates. */
export function updateYardEnclosures(scene: CityScene, source: object, houses: () => readonly YardHouse[]): void {
  if (YARDS.get(scene) === source) return;
  const result = buildYardEnclosures(scene, houses());
  scene.lotEnclosures = result.enclosures; scene.lotYards = result.yards; YARDS.set(scene, source);
}

/** House-yard boundaries; culture weights/materials come from Rust's enclosure table. */
export interface LotEnclosureDraw { mpp: number; lod: CityLod; palette: CityPalette }
type Material = 'wall' | 'hedge' | 'fence';
const MATERIALS: Material[] = ['wall', 'hedge', 'fence'];
const PATHS = new WeakMap<object, Map<Material, Path2D>>();
const GROUND_PATHS = new WeakMap<object, Path2D>();

function pathsOf(scene: CityScene): Map<Material, Path2D> {
  const key = scene.lotEnclosures!;
  let paths = PATHS.get(key);
  if (paths) return paths;
  paths = new Map();
  for (const e of key) {
    if (e.path.length < 2) continue;
    const path = paths.get(e.material) ?? paths.set(e.material, new Path2D()).get(e.material)!;
    path.moveTo(e.path[0].x, e.path[0].y);
    for (let i = 1; i < e.path.length; i++) path.lineTo(e.path[i].x, e.path[i].y);
  }
  PATHS.set(key, paths);
  return paths;
}

/** Hook of drawCity: one stroke per material, styled by material and palette. */
export function drawLotEnclosures(ctx: CanvasRenderingContext2D, scene: CityScene, o: LotEnclosureDraw): void {
  if (!scene.lotEnclosures?.length || o.lod === 'far') return;
  const px = o.mpp, paths = pathsOf(scene), mono = o.palette === 'parchment' || o.palette === 'ink';
  ctx.save(); ctx.lineJoin = 'round'; ctx.setLineDash([]);
  if (scene.lotYards?.length) {
    let path = GROUND_PATHS.get(scene.lotYards);
    if (!path) { path = new Path2D(); for (const y of scene.lotYards) { y.shape.outer.forEach((p, i) => i ? path!.lineTo(p.x, p.y) : path!.moveTo(p.x, p.y)); path.closePath(); } GROUND_PATHS.set(scene.lotYards, path); }
    ctx.fillStyle = mono ? '#d6c9a5' : '#b6ad84'; ctx.globalAlpha = .1; ctx.fill(path);
  }
  // Discreet continuous strokes, about half the former width: shades of the ground (a little darker, desaturated) rather than
  // ink lines; hedges a soft green near the ground green, walls a muted grey-beige, fences a pale weathered brown.
  for (const material of MATERIALS) {
    const path = paths.get(material);
    if (!path) continue;
    if (material === 'wall') { ctx.strokeStyle = mono ? '#9a8f7b' : '#8f887a'; ctx.lineWidth = Math.max(0.3, px * 0.5); ctx.globalAlpha = 0.6; }
    else if (material === 'hedge') { ctx.strokeStyle = mono ? '#929a76' : '#7d8c62'; ctx.lineWidth = Math.max(0.35, px * 0.5); ctx.globalAlpha = 0.55; }
    else { ctx.strokeStyle = mono ? '#a5937a' : '#9a8a6f'; ctx.lineWidth = Math.max(0.15, px * 0.3); ctx.globalAlpha = 0.6; }
    ctx.lineCap = 'butt'; ctx.stroke(path);
  }
  ctx.restore();
}
