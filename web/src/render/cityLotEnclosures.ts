import type { CityLod, CityPalette, CityParcel, CityScene } from './cityCanvas';
import { CITY_LOD_LIMITS, SpatialBins, shapeBox } from './cityCanvas';
import type { LotEnclosure, Point, ResolvedEnclosure, Shape } from '../../../rust/bridge/urban';
import { polygonContains } from '../gen/core/geom';
import { cultureEnclosure, type CultureEnclosure } from './hedges';
import { yardRuns, yardStyle } from './yardStyle';

/** `cluster` groups several footprints (farmstead house and outbuildings) into one yard; default one per parcel. */
export interface YardHouse { parcel_id: string; footprint: readonly Shape[]; cluster?: string; farm?: boolean; enclosure?: 'wall' | 'fence' | 'hedge' | 'none'; programme?: { farmstead?: { farm?: boolean; enclosure?: string } } }
const KINDS = ['wall', 'fence', 'hedge', 'none'];
export interface Yard { parcel: number; shape: Shape }
/** `culture` and `height` carry the culture's look (tint, wall height) to the 3D meshes. */
export type YardBoundary = LotEnclosure & { fenceStyle?: 'plank' | 'wattle'; culture?: string; height?: number };
export interface YardGeometry { enclosures: YardBoundary[]; yards: Yard[]; pairs: number; /** the deliberate gaps of a yard loop: gates, and with `open` a street front the culture leaves unfenced */ gates: { a: Point; b: Point; open?: boolean }[]; /** zone/reason -> count, for measuring coverage */ stats: Record<string, number> }
type Profile = ResolvedEnclosure & CultureEnclosure;
type Box = ReturnType<typeof shapeBox>;
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const minus = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const length = (p: Point): number => Math.sqrt(p.x * p.x + p.y * p.y);
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const unit = (p: Point): Point => { const l = length(p) || 1; return { x: p.x / l, y: p.y / l }; };
const signed = (r: readonly Point[]): number => r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]; return s + a.x * b.y - b.x * a.y; }, 0) / 2;
const area = (r: readonly Point[]): number => Math.abs(signed(r));
const perimeter = (r: readonly Point[]): number => r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]; return s + Math.hypot(b.x - a.x, b.y - a.y); }, 0);
const boxOf = (r: readonly Point[], pad = 0): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of r) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
};
const draw = (id: string, salt: number): number => { let h = 2166136261 ^ salt; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); return ((h ^ (h >>> 12)) >>> 0) / 4294967296; };
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
function distance(p: Point, a: Point, b: Point): number {
  const d = minus(b, a), t = Math.max(0, Math.min(1, dot(minus(p, a), d) / (dot(d, d) || 1)));
  return length(minus(p, lerp(a, b, t)));
}
const crosses = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const cr = (o: Point, p: Point, q: Point): number => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  return cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0;
};
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
/** Parcel vertices closer than this are one node of the boundary graph. */
const SNAP = .12;
/** A vertex this close to the limit of a neighbouring parcel lies on it: the two limits are one chain. */
const ON_LIMIT = .3;
/** A chain leaves the parcel limit by at most this (m), once. */
const TOLERANCE = .6;
/** A chain shorter than this between two junctions collapses into one node (each end moves by at most TOLERANCE). */
const JUNCTION = 1.2;
/** Two ends of the fence graph closer than this are one node. */
const WELD = .8;
/** A fence piece shorter than this between two house walls is left out: the gap between two houses is no fence line. */
const STUB = 2.5;
/** A fence piece shorter than this from a house wall to a junction is left out too: it only marks the corner. */
const SPUR = 1.5;
/** Streets up to this width are lanes: the fences of their two banks would read as one doubled line, one bank is enough. */
const LANE = 3.4;
/** In the country only the narrowest closes count: both sides of a village street keep their yards. */
const COUNTRY_LANE = 2.6;
/** Attached ground (garden, unbuilt plot): shared limit needed (m) and largest size against the lot. */
const ATTACH_M = 3, ATTACH_AREA = 3;
/** Share of fringe (faubourg/edge) lots that keep a yard in a culture that fences at all. */
const FRINGE_PLOT = .9;
/** Share of country lots that keep a yard: there the decision stays per house, an unfenced house is a hole in the patchwork. */
const OPEN_PLOT = .95;
/** Public ground inside a block: yards stop at it, never enclose it. */
const OBSTACLES = new Set(['place', 'common', 'market', 'court']);
const COUNTRY = new Set(['village', 'hamlet', 'rural']);
const CLOSABLE = new Set(['plot', 'compound']);
/** An inset ring closer to the lot limit than this (m) is no gap: the lot gets no fence. */
const MIN_INSET = .4;
/** Smallest ring of its own: area (m²) and mean width (2 area / perimeter, m). */
const MIN_YARD = 12, MIN_WIDTH = 1.2;
const mean = (points: readonly Point[]): Point => points.reduce((s, q) => ({ x: s.x + q.x / points.length, y: s.y + q.y / points.length }), { x: 0, y: 0 });

/** Street frame of a parcel: `u` along its street front, `entry` the middle of its served front, `street` the street serving it. */
function frame(p: CityParcel): { u: Point; entry?: Point; street: number } {
  const front = p.source.contacts?.filter(c => !['unserved', 'reserved'].includes(c.kind)).sort((a, b) => b.length - a.length)[0];
  const segment = front ? [front.a, front.b] : p.source.front;
  let u = segment ? minus(segment[1], segment[0]) : p.source.axis ?? { x: 1, y: 0 };
  const served = !!segment && length(u) > .9;
  if (!(length(u) > 1e-6)) u = { x: 1, y: 0 };
  return { u: unit(u), entry: served ? lerp(segment![0], segment![1], .5) : undefined, street: front?.street ?? -1 };
}

interface Edge { a: number; b: number; owners: number[]; len: number }
/** The planar graph of parcel limits: vertices snapped into nodes, rings split at the T-junctions, one edge per stretch of limit with its owners. */
function boundaryGraph(rings: readonly { owner: number; ring: readonly Point[] }[]): { nodes: Point[]; edges: Edge[] } {
  const nodes: Point[] = [], fine = new Map<number, number[]>(), coarse = new Map<number, number[]>(), C = 4;
  const key = (x: number, y: number): number => (x + 32768) * 65536 + (y + 32768);
  const node = (p: Point): number => {
    const cx = Math.floor(p.x), cy = Math.floor(p.y), fx = p.x - cx, fy = p.y - cy;
    for (let x = fx < SNAP ? cx - 1 : cx; x <= (fx > 1 - SNAP ? cx + 1 : cx); x++) for (let y = fy < SNAP ? cy - 1 : cy; y <= (fy > 1 - SNAP ? cy + 1 : cy); y++)
      for (const i of fine.get(key(x, y)) ?? []) if (Math.abs(nodes[i].x - p.x) < SNAP && Math.abs(nodes[i].y - p.y) < SNAP && length(minus(nodes[i], p)) < SNAP) return i;
    const i = nodes.length; nodes.push({ x: p.x, y: p.y });
    const k = key(cx, cy), l = fine.get(k); if (l) l.push(i); else fine.set(k, [i]);
    const q = key(Math.floor(p.x / C), Math.floor(p.y / C)), m = coarse.get(q); if (m) m.push(i); else coarse.set(q, [i]);
    return i;
  };
  const ids = rings.map(r => r.ring.map(node));
  const found = new Map<number, number[]>(), edges = new Map<number, Edge>(), N = 1 << 26;
  /** Nodes lying on a→b, in order; a stretch met from both sides is searched once. */
  const between = (a: number, b: number): number[] => {
    const id = a < b ? a * N + b : b * N + a, seen = found.get(id);
    if (seen) return a < b ? seen : [...seen].reverse();
    const lo = Math.min(a, b), hi = Math.max(a, b), A = nodes[lo], B = nodes[hi], d = minus(B, A), L2 = dot(d, d), L = Math.sqrt(L2), hits: [number, number][] = [];
    const x0 = Math.floor((Math.min(A.x, B.x) - ON_LIMIT) / C), x1 = Math.floor((Math.max(A.x, B.x) + ON_LIMIT) / C), y0 = Math.floor((Math.min(A.y, B.y) - ON_LIMIT) / C), y1 = Math.floor((Math.max(A.y, B.y) + ON_LIMIT) / C);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (Math.abs(((x + .5) * C - A.x) * d.y - ((y + .5) * C - A.y) * d.x) > (C * .75 + ON_LIMIT) * L) continue; // cell far from the line
      for (const i of coarse.get(key(x, y)) ?? []) {
        if (i === a || i === b) continue;
        const v = minus(nodes[i], A), t = dot(v, d) / L2; if (t <= 0 || t >= 1) continue;
        if (Math.abs(v.x * d.y - v.y * d.x) < ON_LIMIT * L) hits.push([t, i]);
      }
    }
    hits.sort((p, q) => p[0] - q[0]);
    const list = hits.map(h => h[1]); found.set(id, list);
    return a < b ? list : [...list].reverse();
  };
  const add = (a: number, b: number, owner: number): void => {
    if (a === b) return;
    const id = a < b ? a * N + b : b * N + a, e = edges.get(id);
    if (!e) edges.set(id, { a: Math.min(a, b), b: Math.max(a, b), owners: [owner], len: length(minus(nodes[a], nodes[b])) });
    else if (!e.owners.includes(owner)) e.owners.push(owner);
  };
  ids.forEach((ring, r) => ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]; if (a === b) return;
    let prev = a; for (const v of between(a, b)) { add(prev, v, rings[r].owner); prev = v; } add(prev, b, rings[r].owner);
  }));
  return { nodes, edges: [...edges.values()] };
}
/** Douglas-Peucker: the two ends stay, so chains meeting at a node stay joined whatever each one loses. */
function simplifyChain(path: readonly Point[], tol: number, blocked: (a: Point, b: Point) => boolean): Point[] {
  if (path.length < 3) return [...path];
  const a = path[0], b = path[path.length - 1]; let best = -1, far = 0;
  for (let i = 1; i < path.length - 1; i++) { const d = distance(path[i], a, b); if (d > far) { far = d; best = i; } }
  if (far <= tol && !blocked(a, b)) return [a, b];
  if (best < 0) best = path.length >> 1;
  return [...simplifyChain(path.slice(0, best + 1), tol, blocked).slice(0, -1), ...simplifyChain(path.slice(best), tol, blocked)];
}
/** The ring moved `d` inwards, closed by construction: a side too short to survive goes, an acute corner is mitred short.
 * Undefined when too little is left or the ring crosses itself. */
function insetRing(ring: readonly Point[], d: number): Point[] | undefined {
  const r = signed(ring) < 0 ? [...ring].reverse() : [...ring], inner = (a: Point, b: Point): Point => { const e = unit(minus(b, a)); return { x: -e.y, y: e.x }; };
  for (;;) {
    const n = r.length; if (n < 3) return undefined;
    const out: Point[] = [];
    for (let i = 0; i < n; i++) {
      const m1 = inner(r[(i + n - 1) % n], r[i]), m2 = inner(r[i], r[(i + 1) % n]), k = Math.max(.35, 1 + dot(m1, m2));
      out.push({ x: r[i].x + d * (m1.x + m2.x) / k, y: r[i].y + d * (m1.y + m2.y) / k });
    }
    const flipped = out.findIndex((p, i) => dot(minus(out[(i + 1) % n], p), minus(r[(i + 1) % n], r[i])) <= 0);
    if (flipped >= 0) { r.splice((flipped + 1) % n, 1); continue; }
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if ((j + 1) % n !== i && crosses(out[i], out[(i + 1) % n], out[j], out[(j + 1) % n])) return undefined;
    return out;
  }
}

/** One parcel with houses. `unit` is the decision key: a row of lots on one street, empty in the country where each house decides. */
interface Lot { pi: number; id: string; points: Point[]; size: number; farm: boolean; enclosure?: string; profile: Profile; u: Point; entry?: Point; unit: string; frontOpen: boolean }
/** A straight piece of fence; `link` continues the previous piece of the same run. */
interface Piece { a: Point; b: Point; side: LotEnclosure['side']; yard: number; link: boolean; lane: number }

/** Fences are the chains of the graph of parcel limits. Lots are closed by row of lots on one street (never lot by lot:
 * that drew a checkerboard of holes); attached gardens, clusters, blades of a fan and `yardMerge` pairs join a lot's yard,
 * which removes their common chain. Every remaining chain is simplified once and drawn once, so neighbours share it and
 * junctions stay joined; house walls and carriageways are then taken out. Street fronts follow the culture's `front`, except
 * in the country, where each house keeps a closed yard with its gate. A culture with `inset` > 0 fences each lot on its own
 * ring inside the limit, with no shared chain and a small gap between neighbours.
 * Linear: bins for footprints, streets and lanes; no boolean operation.
 */
export function buildYardEnclosures(scene: CityScene, houses: readonly YardHouse[]): YardGeometry {
  const result: YardGeometry = { enclosures: [], yards: [], pairs: 0, gates: [], stats: {} };
  const note = (zone: string, why: string): void => { const k = `${zone}/${why}`; result.stats[k] = (result.stats[k] ?? 0) + 1; };
  const profiles: (Profile | undefined)[] = (scene.enclosureProfiles ?? []).map((r, i) => {
    const cultural = cultureEnclosure(scene.layouts[i]?.culture ?? '');
    return r && { ...cultural, ...r, plot: cultural.plot === 0 ? 0 : r.plot };
  });
  if (!profiles.some(r => r && r.plot > 0)) return result;
  // ---- lots: one per parcel with houses; every footprint is kept for the fence subtraction
  const lots = new Map<number, Lot>(), clusters = new Map<string, number[]>(), footprints: Shape[] = [];
  for (const house of houses) {
    const pi = scene.parcelById.get(house.parcel_id);
    if (pi === undefined || !profiles[scene.parcels[pi].layout]) continue;
    const p = scene.parcels[pi]; let lot = lots.get(pi);
    if (!lot) {
      const f = frame(p);
      lots.set(pi, lot = { pi, id: `${scene.layouts[p.layout]?.key}/${p.id ?? pi}`, points: [], size: 0, farm: /farm|compound/.test(p.allocation?.role ?? '') || p.use === 'compound', profile: profiles[p.layout]!, u: f.u, entry: f.entry, unit: COUNTRY.has(p.zone) ? '' : `${p.layout}/${p.block}/${f.street}`, frontOpen: false });
    }
    const hint = house.programme?.farmstead; // a farmstead is one cluster: its own farm flag and enclosure kind win
    lot.farm ||= !!house.farm || !!hint?.farm;
    const kind = house.enclosure ?? hint?.enclosure; if (kind && KINDS.includes(kind)) lot.enclosure = kind;
    for (const s of house.footprint) {
      const ring = s.outer.filter(q => Number.isFinite(q.x) && Number.isFinite(q.y)); if (ring.length < 3) continue;
      footprints.push({ outer: ring, holes: [] }); lot.points.push(...ring); lot.size += area(ring);
    }
    if (house.cluster) clusters.set(house.cluster, [...clusters.get(house.cluster) ?? [], pi]);
  }
  if (!lots.size) return result;
  const footprintBins = new SpatialBins(footprints.map(f => shapeBox(f)), 32);
  // ---- who is closed: one draw per row of lots, one per house in the country
  const closed = new Set<number>();
  for (const lot of lots.values()) {
    const p = scene.parcels[lot.pi], P = lot.profile, own = P.inset > 0, key = own ? lot.id : lot.unit || lot.id;
    if (lot.enclosure && lot.enclosure !== 'none') lot.profile = { ...P, material: lot.enclosure as Profile['material'] };
    lot.frontOpen = !!lot.unit && draw(key, 2) >= P.front;
    const share = lot.enclosure ? 1 : own ? P.plot : !lot.unit ? Math.max(P.plot, OPEN_PLOT) : p.peripheral || p.zone === 'faubourg' ? Math.max(P.plot, FRINGE_PLOT) : P.plot;
    if (lot.enclosure !== 'none' && P.plot > 0 && CLOSABLE.has(p.use) && draw(key, 1) < share) closed.add(lot.pi); else note(p.zone, 'open');
    note(p.zone, 'holdings');
  }
  const ringsOf = (p: CityParcel): Shape[] => p.ground?.length ? p.ground : [p.shape];
  const styleOf = (lot: Lot, side: LotEnclosure['side']): Omit<YardBoundary, 'path'> => { const P = lot.profile; return { material: P.material, ...(P.material === 'fence' ? { fenceStyle: P.fenceStyle ?? 'wattle' } : {}), side, culture: scene.layouts[scene.parcels[lot.pi].layout]?.culture, height: P.wallHeight }; };
  const wallAt = (p: Point): boolean => { for (const i of footprintBins.query(boxOf([p], .6))) { const r = footprints[i].outer; for (let k = 0; k < r.length; k++) if (distance(p, r[k], r[(k + 1) % r.length]) < .6) return true; } return false; };
  // ---- inset cultures: each closed lot on its own ring, out of the shared graph; house walls interrupt it as they do a limit
  for (const pi of [...closed]) {
    const lot = lots.get(pi)!, p = scene.parcels[pi], want = lot.profile.inset; if (want <= 0) continue;
    closed.delete(pi);
    const whole = ringsOf(p).map(s => s.outer).sort((x, y) => area(y) - area(x))[0], center = mean(lot.points);
    const rough = simplifyChain([...whole, whole[0]], TOLERANCE, () => false).slice(0, -1);
    let ring: Point[] | undefined;
    for (const d of [want, want / 2]) { if (d < MIN_INSET || rough.length < 3) continue; const r = insetRing(rough, d); if (r && area(r) >= MIN_YARD && 2 * area(r) / perimeter(r) >= MIN_WIDTH && polygonContains(r, center)) { ring = r; break; } }
    if (!ring) { note(p.zone, 'insetSkipped'); continue; } // a lot too narrow for a ring of its own stays unfenced
    result.yards.push({ parcel: pi, shape: { outer: ring, holes: [] } }); note(p.zone, 'yard');
    const n = ring.length, width = lot.farm ? 3.5 : area(ring) > 600 && draw(lot.id, 6) < .5 ? 2.6 : 1.3, target = lot.entry ?? center;
    let gate = -1, t = .5, score = Infinity;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n], L = length(minus(b, a)); if (L < width + .6) continue;
      const s = clamp(dot(minus(target, a), minus(b, a)) / (L * L), (width / 2 + .3) / L, 1 - (width / 2 + .3) / L), m = lerp(a, b, s), e = length(minus(m, target)); if (e < score && !wallAt(m)) { score = e; gate = i; t = s; }
    }
    // from one jamb round to the other (or once round when no side takes a gate), then the walls come out
    let loop = [...ring, ring[0]];
    if (gate >= 0) {
      const a = ring[gate], b = ring[(gate + 1) % n], h = width / 2 / length(minus(b, a)), x = lerp(a, b, t - h), y = lerp(a, b, t + h);
      result.gates.push({ a: x, b: y }); loop = [y, ...ring.slice(gate + 1), ...ring.slice(0, gate + 1), x];
    }
    let run: Point[] = [];
    const flush = (): void => { let len = 0; for (let i = 1; i < run.length; i++) len += length(minus(run[i], run[i - 1])); if (len >= SPUR) result.enclosures.push({ path: run, ...styleOf(lot, 'side') }); run = []; };
    for (let i = 1; i < loop.length; i++) {
      const a = loop[i - 1], b = loop[i], close = footprintBins.query(boxOf([a, b], .35)).map(k => footprints[k]);
      for (const [t0, t1] of close.length ? outside(a, b, close) : [[0, 1] as [number, number]]) {
        if (t0 > 1e-9) flush();
        if (!run.length) run.push(lerp(a, b, t0));
        run.push(lerp(a, b, t1));
        if (t1 < 1 - 1e-9) flush();
      }
      if (close.length && !outside(a, b, close).length) flush();
    }
    flush();
  }
  if (!closed.size) return result;
  // ---- the graph of the limits of every block holding a fenced lot
  const blocks = new Set([...closed].map(pi => `${scene.parcels[pi].layout}/${scene.parcels[pi].block}`));
  const rings: { owner: number; ring: readonly Point[] }[] = [];
  scene.parcels.forEach((p, pi) => { if (p.use !== 'reserve' && blocks.has(`${p.layout}/${p.block}`)) for (const s of ringsOf(p)) for (const ring of [s.outer, ...s.holes]) if (ring.length >= 3) rings.push({ owner: pi, ring }); });
  const { nodes, edges } = boundaryGraph(rings);
  // ---- yards: clusters, then merges along the longest shared limit
  const parent = new Map<number, number>();
  const find = (i: number): number => { let r = i; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!; if (r !== i) parent.set(i, r); return r; };
  const join = (a: number, b: number): void => { const x = find(a), y = find(b); if (x !== y) parent.set(y, x); };
  for (const list of clusters.values()) for (const pi of list) if (closed.has(list[0]) || closed.has(pi)) { closed.add(pi); closed.add(list[0]); join(list[0], pi); }
  const shared = new Map<number, Map<number, number>>();
  const share = (a: number, b: number, l: number): void => { let m = shared.get(a); if (!m) shared.set(a, m = new Map()); m.set(b, (m.get(b) ?? 0) + l); };
  for (const e of edges) if (e.owners.length === 2) { share(e.owners[0], e.owners[1], e.len); share(e.owners[1], e.owners[0], e.len); }
  const neighbours = (pi: number): [number, number][] => [...shared.get(pi) ?? []].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  const sameBlock = (a: number, b: number): boolean => scene.parcels[a].layout === scene.parcels[b].layout && scene.parcels[a].block === scene.parcels[b].block;
  /** A sliver or a lot of a fan: a thin blade or an acute tip, whose limits read as noise. */
  const blade = (r: readonly Point[]): boolean => {
    let perimeter = 0, tip = false;
    r.forEach((b, i) => {
      const a = r[(i + r.length - 1) % r.length], c = r[(i + 1) % r.length], u = minus(a, b), v = minus(c, b), lu = length(u), lv = length(v); perimeter += lv;
      if (lu > 3 && lv > 3 && dot(u, v) / (lu * lv) > .87) tip = true;
    });
    return tip || 2 * area(r) / (perimeter || 1) < 2.5;
  };
  const paired = new Set<number>();
  for (const pi of closed) {
    const lot = lots.get(pi); if (!lot || paired.has(pi)) continue;
    const thin = blade(scene.parcels[pi].shape.outer); if (!thin && (lot.farm || draw(lot.id, 5) >= lot.profile.yardMerge)) continue;
    const other = neighbours(pi).find(([q, l]) => l >= ATTACH_M && closed.has(q) && !paired.has(q) && sameBlock(pi, q) && find(q) !== find(pi) && !lots.get(q)?.farm);
    if (other) { paired.add(pi); paired.add(other[0]); join(pi, other[0]); note('merge', thin ? 'blade' : 'shared'); }
  }
  // gardens and unbuilt plots belong to the built lot they share most limit with
  for (const pi of shared.keys()) {
    const p = scene.parcels[pi]; if (lots.has(pi) || !(p.use === 'garden' || CLOSABLE.has(p.use))) continue;
    const home = neighbours(pi).find(([q, l]) => l >= ATTACH_M && closed.has(q) && lots.has(q) && sameBlock(pi, q));
    if (home && area(p.shape.outer) <= ATTACH_AREA * area(scene.parcels[home[0]].shape.outer)) { closed.add(pi); join(home[0], pi); note('merge', 'attached'); }
  }
  // the lot of the largest house speaks for its yard
  const yards = new Map<number, { lot?: Lot; parcels: number[]; size: number }>();
  for (const pi of closed) {
    const r = find(pi), lot = lots.get(pi); let y = yards.get(r);
    if (!y) yards.set(r, y = { parcels: [], size: 0 });
    y.parcels.push(pi); y.size += area(scene.parcels[pi].shape.outer);
    if (lot && (!y.lot || lot.size > y.lot.size)) y.lot = lot;
  }
  for (const y of yards.values()) {
    note(scene.parcels[y.lot!.pi].zone, 'yard');
    for (const pi of y.parcels) for (const s of ringsOf(scene.parcels[pi])) result.yards.push({ parcel: y.lot!.pi, shape: { outer: s.outer, holes: s.holes } });
  }
  // ---- obstacles: carriageways and ramparts as ribbons; a street keeps its width to tell fronts and lanes
  const ribbons: { a: Point; b: Point; half: number; width: number; box: Box }[] = [];
  const addRibbon = (path: Point[], widthAt: (i: number) => number, street: boolean): void => {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], w = widthAt(i), half = w / 2 - .2, steps = Math.max(1, Math.ceil(length(minus(b, a)) / 32));
      for (let j = 0; j < steps; j++) { const x = lerp(a, b, j / steps), y = lerp(a, b, (j + 1) / steps); ribbons.push({ a: x, b: y, half, width: street ? w : 0, box: boxOf([x, y], half + 2.5) }); }
    }
  };
  for (const s of scene.streets) if (!['private', 'boundary'].includes(s.role)) { const w = s.street.widths, local = w.length === s.street.path.length; addRibbon(s.street.path, i => local ? (w[i - 1] + w[i]) / 2 : s.width, true); }
  for (const w of scene.walls) for (const path of w.pieces) addRibbon(path, () => 2.7, false);
  const ribbonBins = new SpatialBins(ribbons.map(r => r.box), 48);
  /** Width of the narrowest street whose edge runs along `p`, 0 if none. */
  const streetAt = (p: Point): number => { let w = 0; for (const i of ribbonBins.query({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y })) { const r = ribbons[i]; if (r.width && distance(p, r.a, r.b) <= r.half + 2.4) w = w ? Math.min(w, r.width) : r.width; } return w; };
  const ribbonShape = (r: typeof ribbons[number]): Shape => { const u = unit(minus(r.b, r.a)), nx = -u.y * r.half, ny = u.x * r.half; return { outer: [{ x: r.a.x + nx, y: r.a.y + ny }, { x: r.b.x + nx, y: r.b.y + ny }, { x: r.b.x - nx, y: r.b.y - ny }, { x: r.a.x - nx, y: r.a.y - ny }], holes: [] }; };
  const holes: Shape[] = scene.blocks.flatMap(b => b.shape.holes ?? []).map(h => ({ outer: h, holes: [] }));
  // ---- chains: maximal stretches with the same yards on both sides, between junctions
  interface Fenced { e: Edge; yards: number; yard: number; outer: boolean; open: boolean }
  const fenced: Fenced[] = [], at = new Map<number, number[]>();
  for (const e of edges) {
    const mine = [...new Set(e.owners.filter(o => closed.has(o)).map(find))].sort((a, b) => a - b); if (!mine.length) continue;
    if (mine.length === 1 && e.owners.length > 1 && e.owners.every(o => closed.has(o))) continue; // inside one yard: the merge removed it
    const others = e.owners.filter(o => !closed.has(o)), publicGround = others.some(o => OBSTACLES.has(scene.parcels[o].use));
    const i = fenced.length; fenced.push({ e, yards: mine.length > 1 ? mine[0] * 1e6 + mine[1] : mine[0], yard: mine[0], outer: mine.length === 1 && (publicGround || !others.length), open: publicGround });
    for (const n of [e.a, e.b]) { const l = at.get(n); if (l) l.push(i); else at.set(n, [i]); }
  }
  // Every ring is closed, so a leaf of the fence graph can only be a remnant of a merge whose two sides did not share their
  // vertices exactly: a near miss is welded, then what still hangs inside a yard is removed. Fences are made of closed outlines.
  const used = new Uint8Array(fenced.length);
  const leaves = [...at].filter(([, l]) => l.length === 1).map(([n]) => n);
  if (leaves.length) {
    const ends = [...at.keys()], endBins = new SpatialBins(ends.map(n => boxOf([nodes[n]], WELD)), 8);
    for (const n of leaves) {
      const l = at.get(n); if (l?.length !== 1) continue;
      const self = fenced[l[0]].e, other = self.a === n ? self.b : self.a;
      let best = -1, far = WELD; for (const k of endBins.query(boxOf([nodes[n]]))) { const m = ends[k], d = length(minus(nodes[m], nodes[n])); if (m !== n && m !== other && at.has(m) && d < far) { far = d; best = m; } }
      if (best < 0) continue;
      fenced[l[0]].e = { ...self, a: self.a === n ? best : self.a, b: self.b === n ? best : self.b }; at.get(best)!.push(l[0]); at.delete(n);
    }
    const hanging = [...at].filter(([, l]) => l.length === 1).map(([n]) => n);
    while (hanging.length) {
      const n = hanging.pop()!, l = at.get(n); if (l?.length !== 1) continue;
      const i = l[0], e = fenced[i].e, m = e.a === n ? e.b : e.a, rest = at.get(m)!.filter(j => j !== i);
      used[i] = 1; at.delete(n); if (rest.length) at.set(m, rest); else at.delete(m);
      if (rest.length === 1) hanging.push(m);
      note('graph', 'hanging');
    }
  }
  /** `p` brought out of the carriageways `near`, to the edge of the ribbon; itself when it stands on none. */
  const outOfRoad = (p: Point, near: readonly number[]): Point => {
    for (let pass = 0; pass < 3; pass++) {
      let out: Point | undefined, worst = 0;
      for (const i of near) {
        const r = ribbons[i], d = minus(r.b, r.a), c = lerp(r.a, r.b, clamp(dot(minus(p, r.a), d) / (dot(d, d) || 1), 0, 1)), v = minus(p, c), l = length(v), depth = r.half + .02 - l;
        if (depth <= worst) continue;
        const m = l > 1e-3 ? unit(v) : unit({ x: -d.y, y: d.x }); worst = depth; out = { x: c.x + m.x * (r.half + .15), y: c.y + m.y * (r.half + .15) };
      }
      if (!out) break;
      p = out;
    }
    return p;
  };
  // A parcel limit on a carriageway (street corners, tapers) comes out to the ribbon edge before anything is traced:
  // moving a node moves every chain meeting there, so the outline stays closed along the road instead of being cut by it.
  const moved = new Set<number>();
  for (const f of fenced) for (const n of [f.e.a, f.e.b]) if (!moved.has(n)) { moved.add(n); const p = nodes[n]; nodes[n] = outOfRoad(p, ribbonBins.query({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y })); }
  const stop = (n: number): boolean => { const l = at.get(n)!; return l.length !== 2 || fenced[l[0]].yards !== fenced[l[1]].yards; };
  interface Chain { ids: number[]; f: Fenced; len: number }
  const chains: Chain[] = [];
  const walk = (start: number, from: number): void => {
    const ids = [from]; let cur = start, n = from, len = 0;
    for (;;) {
      used[cur] = 1; const e = fenced[cur].e, m = e.a === n ? e.b : e.a; ids.push(m); len += e.len; n = m;
      if (n === from || stop(n)) break;
      const next = at.get(n)!.find(j => j !== cur); if (next === undefined || used[next]) break; cur = next;
    }
    chains.push({ ids, f: fenced[start], len });
  };
  for (const [n, l] of at) if (stop(n)) for (const i of l) if (!used[i]) walk(i, n);
  fenced.forEach((f, i) => { if (!used[i]) walk(i, f.e.a); });
  // A very short chain is a junction seen twice: its ends become one node, shared by everything that meets there.
  const merged = new Map<number, number>(), place = new Map<number, Point>(), root = (n: number): number => { let r = n; while (merged.has(r)) r = merged.get(r)!; return r; };
  const live = chains.filter(c => {
    const a = root(c.ids[0]), b = root(c.ids[c.ids.length - 1]); if (a === b || c.len >= JUNCTION) return true;
    const p = place.get(a) ?? nodes[a], q = place.get(b) ?? nodes[b]; if (length(minus(p, q)) >= JUNCTION) return true;
    merged.set(b, a); place.set(a, lerp(p, q, .5)); return false;
  });
  // ---- simplified once, then cut: nothing below moves a node again
  const pieces: Piece[] = [];
  let walls: number[] = [], near: number[] = [];
  const onRoad = (p: Point): boolean => { for (const i of near) if (distance(p, ribbons[i].a, ribbons[i].b) < ribbons[i].half) return true; return false; };
  /** A chord may not shortcut through a house, nor on a carriageway. */
  const blocked = (a: Point, b: Point): boolean => {
    const m = lerp(a, b, .5);
    for (const k of walls) { const h = footprints[k].outer; if (polygonContains(h, m)) return true; for (let j = 0; j < h.length; j++) if (crosses(a, b, h[j], h[(j + 1) % h.length])) return true; }
    if (near.length) for (let i = 1, n = Math.floor(length(minus(b, a)) / 1.5); i <= n; i++) if (onRoad(lerp(a, b, i / (n + 1)))) return true;
    return false;
  };
  interface Stretch { path: Point[]; cutA: boolean; cutB: boolean }
  for (const c of live) {
    const first = root(c.ids[0]), last = root(c.ids[c.ids.length - 1]);
    const raw = c.ids.map((n, i) => i === 0 ? place.get(first) ?? nodes[first] : i === c.ids.length - 1 ? place.get(last) ?? nodes[last] : nodes[n]);
    const path = raw.filter((p, i) => i === 0 || i === raw.length - 1 || distance(p, raw[i - 1], raw[i + 1]) > .02);
    const o = yards.get(c.f.yard)!.lot!, P = o.profile, box = boxOf(path, .35);
    walls = footprintBins.query(box); near = ribbonBins.query(box);
    if (c.f.yards >= 1e6) result.pairs++;
    // Along a street the limit may bulge on the carriageway between two nodes: points brought out keep it on the edge.
    let traced = path;
    if (near.length) {
      traced = [path[0]];
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], n = Math.floor(length(minus(b, a)) / 1.5);
        for (let k = 1; k <= n; k++) { const p = lerp(a, b, k / (n + 1)), q = outOfRoad(p, near); if (q !== p) traced.push(q); }
        traced.push(b);
      }
    }
    // Walls and carriageways come out of the chain first; each stretch left is then simplified, once, its two ends fixed.
    const stretches: Stretch[] = [];
    let open: Stretch | undefined;
    for (let i = 1; i < traced.length; i++) {
      const a = traced[i - 1], b = traced[i], seg = boxOf([a, b], .35), close: Shape[] = [], barriers: Shape[] = [...holes];
      for (const k of walls) { const q = footprintBins.boxes[k]; if (q.minX <= seg.maxX && q.maxX >= seg.minX && q.minY <= seg.maxY && q.maxY >= seg.minY) close.push(footprints[k]); }
      for (const k of near) if (ribbons[k].half > .3 && crosses(a, b, ribbons[k].a, ribbons[k].b)) barriers.push(ribbonShape(ribbons[k])); // what still crosses a street is cut
      if (!close.length && !barriers.length) { if (open) open.path.push(b); else stretches.push(open = { path: [a, b], cutA: i > 1, cutB: false }); continue; }
      const spans: [number, number][] = [];
      for (const [t0, t1] of close.length ? outside(a, b, close) : [[0, 1] as [number, number]]) {
        const p = lerp(a, b, t0), q = lerp(a, b, t1), sub = barriers.length ? outside(p, q, barriers, false) : [[0, 1] as [number, number]];
        // the street passes through the fence line: the gap it leaves is an opening, not a broken fence
        let at = 0; for (const [s0, s1] of [...sub, [1, 1]]) { if (s0 - at > 1e-6) result.gates.push({ a: lerp(p, q, at), b: lerp(p, q, s0), open: true }); at = s1; }
        for (const [s0, s1] of sub) spans.push([t0 + (t1 - t0) * s0, t0 + (t1 - t0) * s1]);
      }
      if (!spans.length) { if (open) open.cutB = true; open = undefined; continue; }
      for (const [t0, t1] of spans) {
        const p = t0 > 1e-9 ? lerp(a, b, t0) : a, q = t1 < 1 - 1e-9 ? lerp(a, b, t1) : b;
        if (open && t0 < 1e-9) open.path.push(q); else { if (open) open.cutB = true; stretches.push(open = { path: [p, q], cutA: t0 > 1e-9 || i > 1, cutB: false }); }
        if (t1 < 1 - 1e-9) { open.cutB = true; open = undefined; }
      }
    }
    for (const r of stretches) {
      let len = 0; for (let i = 1; i < r.path.length; i++) len += length(minus(r.path[i], r.path[i - 1]));
      if (len < .1) continue;
      if (len < STUB) { const wa = r.cutA || wallAt(r.path[0]), wb = r.cutB || wallAt(r.path[r.path.length - 1]); if (wa && wb || (wa || wb) && len < SPUR) continue; }
      const simple = simplifyChain(r.path, TOLERANCE, blocked);
      let linked = false;
      for (let i = 1; i < simple.length; i++) {
        const a = simple[i - 1], b = simple[i], dir = unit(minus(b, a));
        const lane = c.f.outer ? streetAt(lerp(a, b, .5)) : 0, front = c.f.outer && (c.f.open || lane > 0);
        const side: LotEnclosure['side'] = front ? 'front' : Math.abs(dot(dir, o.u)) > .75 ? 'back' : 'side';
        if (front && o.frontOpen) { result.gates.push({ a, b, open: true }); linked = false; continue; }
        if (!front && (side === 'side' ? P.side : P.back) <= 0) { linked = false; continue; }
        pieces.push({ a, b, side, yard: c.f.yard, link: linked, lane: front && lane <= (o.unit ? LANE : COUNTRY_LANE) ? lane : 0 });
        linked = true;
      }
    }
  }
  const keep = new Uint8Array(pieces.length).fill(1);
  // ---- lanes: the longer bank keeps its fence, the shorter is left open on the lane
  const lanes = pieces.map((_, i) => i).filter(i => keep[i] && pieces[i].lane > 0).sort((x, y) => length(minus(pieces[y].b, pieces[y].a)) - length(minus(pieces[x].b, pieces[x].a)) || x - y);
  const laneBins = new SpatialBins(lanes.map(i => boxOf([pieces[i].a, pieces[i].b], LANE)), 16), kept = new Uint8Array(lanes.length);
  lanes.forEach((i, k) => {
    const s = pieces[i], L = length(minus(s.b, s.a)), u = unit(minus(s.b, s.a));
    const covered = laneBins.query(boxOf([s.a, s.b])).reduce((sum, j) => {
      if (!kept[j]) return sum;
      const o = pieces[lanes[j]], off = distance(lerp(s.a, s.b, .5), o.a, o.b), v = unit(minus(o.b, o.a)); if (Math.abs(dot(u, v)) < .96 || off < .3 || off > s.lane + 1) return sum;
      const t0 = dot(minus(o.a, s.a), u), t1 = dot(minus(o.b, s.a), u); return sum + Math.max(0, Math.min(L, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)));
    }, 0);
    if (covered >= .4 * L) { keep[i] = 0; result.gates.push({ a: s.a, b: s.b, open: true }); } else kept[k] = 1;
  });
  // ---- gates: on the street side, on the free front piece nearest the house, a door or a cart gate
  const fronts = new Map<number, number[]>();
  pieces.forEach((s, i) => { if (keep[i] && s.side === 'front') { const l = fronts.get(s.yard); if (l) l.push(i); else fronts.set(s.yard, [i]); } });
  const gateAt = new Map<number, [Point, Point]>();
  for (const [r, y] of yards) {
    const o = y.lot!, center = mean(o.points), width = o.farm ? 3.5 : (y.size > 600 && draw(o.id, 6) < .5) || draw(o.id, 2) >= o.profile.front ? 2.6 : 1.3;
    let best = -1, t = .5, score = Infinity;
    for (const i of fronts.get(r) ?? []) {
      const q = pieces[i], d = minus(q.b, q.a), L = length(d); if (L < width + .6) continue;
      const s = clamp(dot(minus(center, q.a), d) / (L * L), (width / 2 + .3) / L, 1 - (width / 2 + .3) / L), e = length(minus(lerp(q.a, q.b, s), center));
      if (e < score) { score = e; best = i; t = s; }
    }
    if (best < 0) continue;
    const q = pieces[best], h = width / 2 / length(minus(q.b, q.a)), x = lerp(q.a, q.b, t - h), z = lerp(q.a, q.b, t + h);
    gateAt.set(best, [x, z]); result.gates.push({ a: x, b: z });
  }
  // ---- emission: linked pieces make one polyline
  let run: YardBoundary | undefined;
  pieces.forEach((s, i) => {
    if (!keep[i]) { run = undefined; return; }
    const gate = gateAt.get(i);
    if (!run || !s.link || run.side !== s.side) { run = { path: [s.a], ...styleOf(yards.get(s.yard)!.lot!, s.side) }; result.enclosures.push(run); }
    if (gate) { run.path.push(gate[0]); run = { ...run, path: [gate[1]] }; result.enclosures.push(run); }
    run.path.push(s.b);
  });
  return result;
}

const YARDS = new WeakMap<CityScene, object>();
/** Source identity changes only with retained buildings, not on camera/colour updates. */
export function updateYardEnclosures(scene: CityScene, source: object, houses: () => readonly YardHouse[]): void {
  if (YARDS.get(scene) === source) return;
  const result = buildYardEnclosures(scene, houses());
  scene.lotEnclosures = result.enclosures; scene.lotYards = result.yards; YARDS.set(scene, source);
}

/** House-yard boundaries; culture weights/materials come from Rust's enclosure table, their look from yardStyle. */
export interface LotEnclosureDraw { mpp: number; lod: CityLod; palette: CityPalette; /** the yard ground only: on a 3D ground the fences stand as meshes */ groundOnly?: boolean }
type Material = YardBoundary['material'];
const MATERIALS: Material[] = ['hedge', 'fence', 'wall'];
/** All strokes of one look. `carts` and `doors` hold the jamb ticks of the wide and narrow gates. */
interface Stroke { source: YardBoundary; path: Path2D; carts: Path2D; doors: Path2D }
const STROKES = new WeakMap<object, Stroke[]>();
const GROUND_PATHS = new WeakMap<object, Path2D>();
/** Half length of a jamb tick and width from which a gate is a cart gate (m). */
const JAMB = .6, CART = 2.4;
/** Mid scale: thinner strokes, and the opacity left at the far end of the band, so that nothing pops at the far level. */
const MID_PX = .8, MID_FADE = .35;

function strokesOf(scene: CityScene): Stroke[] {
  const key = scene.lotEnclosures!;
  let strokes = STROKES.get(key);
  if (strokes) return strokes;
  const looks = new Map<string, Stroke>(), { runs, gates } = yardRuns(key);
  const strokeOf = (e: YardBoundary): Stroke => { const k = `${e.material}/${e.culture ?? ''}/${e.fenceStyle ?? ''}`; let s = looks.get(k); if (!s) looks.set(k, s = { source: e, path: new Path2D(), carts: new Path2D(), doors: new Path2D() }); return s; };
  for (const r of runs) {
    const { path } = strokeOf(r.source);
    path.moveTo(r.path[0].x, r.path[0].y);
    for (let i = 1; i < r.path.length; i++) path.lineTo(r.path[i].x, r.path[i].y);
    if (r.closed) path.closePath();
  }
  for (const g of gates) {
    const s = strokeOf(g.source), l = length(minus(g.b, g.a)), n = { x: -(g.b.y - g.a.y) / l * JAMB, y: (g.b.x - g.a.x) / l * JAMB }, ticks = l >= CART ? s.carts : s.doors;
    for (const p of [g.a, g.b]) { ticks.moveTo(p.x - n.x, p.y - n.y); ticks.lineTo(p.x + n.x, p.y + n.y); }
  }
  strokes = [...looks.values()].sort((a, b) => MATERIALS.indexOf(a.source.material) - MATERIALS.indexOf(b.source.material));
  STROKES.set(key, strokes);
  return strokes;
}

/** Hook of drawCity: one stroke per look. At the far level a lot is about a pixel and no parcel is drawn: no fence either,
 * the opacity has already faded through the `mid` band. */
export function drawLotEnclosures(ctx: CanvasRenderingContext2D, scene: CityScene, o: LotEnclosureDraw): void {
  if (!scene.lotEnclosures?.length || o.lod === 'far') return;
  const px = o.mpp, mono = o.palette === 'parchment' || o.palette === 'ink';
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'butt'; ctx.setLineDash([]);
  if (scene.lotYards?.length) {
    let path = GROUND_PATHS.get(scene.lotYards);
    if (!path) { path = new Path2D(); for (const y of scene.lotYards) { y.shape.outer.forEach((p, i) => i ? path!.lineTo(p.x, p.y) : path!.moveTo(p.x, p.y)); path.closePath(); } GROUND_PATHS.set(scene.lotYards, path); }
    ctx.fillStyle = mono ? '#d6c9a5' : '#b6ad84'; ctx.globalAlpha = .1; ctx.fill(path);
  }
  if (!o.groundOnly) {
    const [, nearLimit, midLimit] = CITY_LOD_LIMITS, mid = o.lod === 'mid', fade = mid ? 1 - (1 - MID_FADE) * clamp(Math.log(px / nearLimit) / Math.log(midLimit / nearLimit), 0, 1) : 1;
    for (const s of strokesOf(scene)) {
      const look = yardStyle(s.source.material, s.source.culture, o.palette, s.source.fenceStyle);
      ctx.strokeStyle = look.color; ctx.globalAlpha = look.alpha * fade;
      ctx.lineWidth = Math.max(look.width, (mid ? MID_PX : look.minPx) * px); ctx.stroke(s.path);
      if (mid) continue;
      // A gap of a few pixels reads by its jambs: every gate up close, cart gates one level further.
      ctx.strokeStyle = look.jamb; ctx.globalAlpha = 1; ctx.lineWidth = Math.max(look.width * .7, 1.3 * px);
      ctx.stroke(s.carts); if (o.lod === 'close') ctx.stroke(s.doors);
    }
  }
  ctx.restore();
}
