/** Street surface: the ground a street network covers, as polygons in metres, shared by
 * the Canvas (cityCanvas.ts) and WebGL (cityGl.ts) city renderers.
 *
 * A street is a ribbon following its per-vertex widths (tapers included), with round
 * joins at its bends. Its ends are either loose (round cap, butt for decks and quays)
 * or at a junction, where they stop square at the node and the junction polygon takes
 * over: the corners between consecutive arms, rounded by a curb return (fillet), so
 * a lane meets a main street as it would on the ground instead of as two strokes laid
 * across each other. A street end lying on another street's segment (a T without a
 * shared vertex) is a junction too.
 *
 * Pieces overlap (quads, joins, junctions): a renderer must cover each pixel once per
 * class — one nonzero fill per class on Canvas, a stencil pass on WebGL — so that
 * translucent streets never darken where pieces meet. Every ring is counter-clockwise.
 * The casing is the same surface with every half width grown by `extra` (and every
 * curb return shrunk by it), so its outline runs parallel to the fill's. */
import type { Point } from '../../../rust/bridge/urban';

export interface SurfaceStreet { path: readonly Point[]; widths: readonly number[]; role: string; rank: number }
export interface SurfaceOptions {
  /** Metres added to every half width (casing). */
  extra?: number | ((street: number) => number);
  /** Smallest full width of a street (screen floors at far zoom), metres. */
  minWidth?: (street: number) => number;
  /** Chord tolerance of arcs, metres. */
  tolerance?: number;
  /** Curb return radius as a share of the narrower width of two arms (0: sharp corners). */
  fillet?: number;
}
/** One ring; `street` owns its style (a junction belongs to its major arm). */
export interface SurfacePiece { street: number; ring: Point[] }

/** Ways whose loose ends stop square (decks, quays, moles). */
const BUTT = new Set(['bridge', 'quay', 'mole', 'pier', 'landing']);
/** Ways that get no curb return (structures, steps). */
const SHARP = new Set(['bridge', 'quay', 'mole', 'pier', 'landing', 'ford', 'causeway', 'stairs', 'port-stairs', 'boardwalk', 'walkway']);
const SNAP = 0.02;

/** `length`: the straight run of the arm's first segment, which bounds its curb return. */
interface Arm { street: number; dir: Point; half: number; base: number; rank: number; length: number; sharp: boolean }

const keyOf = (p: Point): string => `${Math.round(p.x / SNAP)},${Math.round(p.y / SNAP)}`;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const len = (v: Point): number => Math.hypot(v.x, v.y);
const unit = (v: Point): Point => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; };
/** Left normal (counter-clockwise quarter turn). */
const left = (v: Point): Point => ({ x: -v.y, y: v.x });
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const signedArea = (r: readonly Point[]): number => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += cross(r[j], r[i]); return s / 2; };
const ccw = (r: Point[]): Point[] => signedArea(r) < 0 ? r.reverse() : r;

/** Points of an arc around `c` from angle a0 sweeping `sweep` (signed), ends included. */
function arc(c: Point, r: number, a0: number, sweep: number, tolerance: number): Point[] {
  const step = r > tolerance ? 2 * Math.acos(Math.max(-1, 1 - tolerance / r)) : Math.PI / 2;
  // An even count keeps the arc's apex (a cap's tip) on the ring.
  const n = 2 * Math.max(1, Math.ceil(Math.abs(sweep) / Math.max(step, 0.05) / 2));
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + sweep * i / n; out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); }
  return out;
}

export function roadSurface(streets: readonly SurfaceStreet[], options: SurfaceOptions = {}): SurfacePiece[] {
  const tolerance = options.tolerance ?? 0.12, fillet = options.fillet ?? 0.55;
  const extraOf = typeof options.extra === 'function' ? options.extra : ((v: number) => () => v)(options.extra ?? 0);
  const out: SurfacePiece[] = [];
  // Clean paths: no repeated vertices; widths aligned.
  const paths = streets.map((s, si) => {
    const pts: Point[] = [], ws: number[] = [];
    const floor = options.minWidth?.(si) ?? 0;
    s.path.forEach((p, i) => {
      const w = Math.max(floor, s.widths[i] ?? s.widths[s.widths.length - 1] ?? 3);
      if (pts.length && len(sub(p, pts[pts.length - 1])) < 1e-6) { ws[ws.length - 1] = Math.max(ws[ws.length - 1], w); return; }
      pts.push(p); ws.push(w);
    });
    return { pts, ws };
  });
  // Nodes: shared vertices, plus loose ends lying on another street's segment.
  const nodes = new Map<string, { at: Point; arms: Arm[]; ends: number }>();
  const node = (p: Point) => { const k = keyOf(p); let n = nodes.get(k); if (!n) nodes.set(k, n = { at: p, arms: [], ends: 0 }); return n; };
  paths.forEach(({ pts, ws }, si) => {
    if (pts.length < 2) return;
    const s = streets[si], sharp = SHARP.has(s.role);
    pts.forEach((p, i) => {
      const n = node(p);
      for (const step of [-1, 1] as const) {
        const j = i + step; if (j < 0 || j >= pts.length) continue;
        n.arms.push({ street: si, dir: unit(sub(pts[j], p)), half: ws[i] / 2, base: ws[i], rank: s.rank, length: len(sub(pts[j], p)), sharp });
      }
      if (i === 0 || i === pts.length - 1) n.ends++;
    });
  });
  // T without a shared vertex: a loose end on another street's segment interior.
  const CELL = 16, grid = new Map<string, [number, number][]>();
  paths.forEach(({ pts }, si) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++)
        for (let gy = Math.floor(Math.min(a.y, b.y) / CELL); gy <= Math.floor(Math.max(a.y, b.y) / CELL); gy++) {
          const k = `${gx},${gy}`; const list = grid.get(k); if (list) list.push([si, i]); else grid.set(k, [[si, i]]);
        }
    }
  });
  for (const n of nodes.values()) {
    if (n.arms.length !== 1) continue;
    const p = n.at, own = n.arms[0].street;
    for (const [si, i] of grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`) ?? []) {
      if (si === own) continue;
      const { pts, ws } = paths[si], a = pts[i - 1], b = pts[i], d = sub(b, a), l2 = d.x * d.x + d.y * d.y;
      const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (l2 || 1);
      if (t <= 1e-6 || t >= 1 - 1e-6 || len(sub(p, add(a, d, t))) > SNAP * 2) continue;
      const w = ws[i - 1] + (ws[i] - ws[i - 1]) * t, u = unit(d), s = streets[si];
      n.arms.push({ street: si, dir: u, half: w / 2, base: w, rank: s.rank, length: Math.sqrt(l2) * (1 - t), sharp: SHARP.has(s.role) },
        { street: si, dir: { x: -u.x, y: -u.y }, half: w / 2, base: w, rank: s.rank, length: Math.sqrt(l2) * t, sharp: SHARP.has(s.role) });
      break;
    }
  }
  const junction = (p: Point): boolean => { const n = nodes.get(keyOf(p)); return !!n && n.arms.length >= 2 && new Set(n.arms.map(a => a.street)).size + (n.arms.length > 2 ? 1 : 0) >= 2; };
  // Ribbons: quads, round joins, loose-end caps.
  paths.forEach(({ pts, ws }, si) => {
    if (pts.length < 2) return;
    const e = extraOf(si), h = ws.map(w => w / 2 + e), s = streets[si];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = left(unit(sub(b, a)));
      out.push({ street: si, ring: ccw([add(a, n, h[i - 1]), add(a, n, -h[i - 1]), add(b, n, -h[i]), add(b, n, h[i])]) });
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const d0 = unit(sub(pts[i], pts[i - 1])), d1 = unit(sub(pts[i + 1], pts[i])), turn = cross(d0, d1);
      if (Math.abs(turn) < 0.035 && d0.x * d1.x + d0.y * d1.y > 0) continue;
      // Outer side of the bend: the wedge between the two segment normals.
      const side = turn > 0 ? -1 : 1, n0 = left(d0), n1 = left(d1);
      const a0 = Math.atan2(n0.y * side, n0.x * side); let sweep = Math.atan2(n1.y * side, n1.x * side) - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI; while (sweep < -Math.PI) sweep += 2 * Math.PI;
      out.push({ street: si, ring: ccw([pts[i], ...arc(pts[i], h[i], a0, sweep, tolerance)]) });
    }
    for (const [i, j] of [[0, 1], [pts.length - 1, pts.length - 2]]) {
      if (junction(pts[i]) || BUTT.has(s.role)) continue;
      const d = unit(sub(pts[i], pts[j])), a0 = Math.atan2(-d.x, d.y);
      out.push({ street: si, ring: ccw([pts[i], ...arc(pts[i], h[i], a0, Math.PI, tolerance)]) });
    }
  });
  // Junctions: the corners between consecutive arms, rounded by curb returns.
  for (const n of nodes.values()) {
    if (n.arms.length < 2 || !junction(n.at)) continue;
    // Every decision (corner or bevel, curb return and its centre) is taken on the
    // bare widths, so the casing (`extra`) runs parallel to the fill whatever it adds.
    const arms = n.arms.map(a => ({ ...a, grown: a.half + extraOf(a.street), angle: Math.atan2(a.dir.y, a.dir.x) })).sort((a, b) => a.angle - b.angle);
    const major = arms.reduce((m, a) => a.rank < m.rank || a.rank === m.rank && a.half > m.half ? a : m, arms[0]);
    const hub: Point[] = [];
    const maxHalf = Math.max(...arms.map(a => a.half));
    const cornerOf = (A: Arm, B: Arm, ha: number, hb: number) => {
      const pA = add(n.at, left(A.dir), ha), pB = add(n.at, left(B.dir), -hb);
      const det = cross(A.dir, B.dir), w = sub(pB, pA), t = cross(w, B.dir) / det, s = cross(w, A.dir) / det;
      return { pA, pB, t, s, corner: add(pA, A.dir, t) };
    };
    for (let k = 0; k < arms.length; k++) {
      const A = arms[k], B = arms[(k + 1) % arms.length];
      let gap = B.angle - A.angle; if (k === arms.length - 1) gap += 2 * Math.PI;
      // Edge of A facing B (its left side) and edge of B facing A (its right side).
      const bare = cornerOf(A, B, A.half, B.half), grown = cornerOf(A, B, A.grown, B.grown);
      if (gap >= Math.PI - 0.12 || gap < 1e-3 || !(bare.t > -1e-6 && bare.s > -1e-6) || len(sub(bare.corner, n.at)) > 2.2 * maxHalf) {
        hub.push(grown.pA, grown.pB); continue;
      }
      hub.push(grown.corner);
      // Curb return: tangent to both bare edges, radius from the narrower arm, kept on the arms;
      // the casing's arc shares its centre, `extra` smaller.
      if (fillet <= 0 || A.sharp || B.sharp || gap < 0.35 || gap > Math.PI - 0.35) continue;
      const cot = 1 / Math.tan(gap / 2);
      const r = Math.min(fillet * Math.min(A.base, B.base), 0.8 * (A.length - bare.t) / cot, 0.8 * (B.length - bare.s) / cot);
      const e = Math.min(A.grown - A.half, B.grown - B.half), rc = r - e;
      if (!(r > 0.15) || !(rc > 0.05)) continue;
      const o = add(bare.corner, unit(add(A.dir, B.dir)), r / Math.sin(gap / 2));
      const foot = (p: Point, d: Point): Point => add(p, d, (o.x - p.x) * d.x + (o.y - p.y) * d.y);
      const t1 = foot(grown.pA, A.dir), t2 = foot(grown.pB, B.dir);
      const a1 = Math.atan2(t1.y - o.y, t1.x - o.x); let sweep = Math.atan2(t2.y - o.y, t2.x - o.x) - a1;
      while (sweep > Math.PI) sweep -= 2 * Math.PI; while (sweep < -Math.PI) sweep += 2 * Math.PI;
      out.push({ street: major.street, ring: ccw([grown.corner, ...arc(o, rc, a1, sweep, tolerance)]) });
    }
    if (hub.length >= 3) out.push({ street: major.street, ring: ccw(hub) });
  }
  return out;
}

/** Street ends a stroke renderer stops square: an end at a vertex or on a segment of
 * another street at least as wide there (a lane's round cap never shows past the road it
 * joins), and both ends of a straight continuation (a wider piece's cap never bulges past
 * its narrower continuation). [start, end] per street. */
export function coveredEnds(streets: readonly SurfaceStreet[]): [boolean, boolean][] {
  const CELL = 16, grid = new Map<string, [number, number][]>();
  const widthAt = (s: SurfaceStreet, i: number): number => s.widths[i] ?? s.widths[s.widths.length - 1] ?? 3;
  streets.forEach((s, si) => {
    for (let i = 1; i < s.path.length; i++) {
      const a = s.path[i - 1], b = s.path[i];
      for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++)
        for (let gy = Math.floor(Math.min(a.y, b.y) / CELL); gy <= Math.floor(Math.max(a.y, b.y) / CELL); gy++) {
          const k = `${gx},${gy}`; const list = grid.get(k); if (list) list.push([si, i]); else grid.set(k, [[si, i]]);
        }
    }
  });
  // `out`: the end's direction away from its street.
  const covered = (si: number, p: Point, own: number, out: Point): boolean => {
    for (const [sj, i] of grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`) ?? []) {
      if (sj === si) continue;
      const s = streets[sj], a = s.path[i - 1], b = s.path[i], d = sub(b, a), l2 = d.x * d.x + d.y * d.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (l2 || 1)));
      if (len(sub(p, add(a, d, t))) > SNAP * 2) continue;
      if (widthAt(s, i - 1) + (widthAt(s, i) - widthAt(s, i - 1)) * t >= own - 0.05) return true;
      // Straight continuation: the other street leaves this end ahead.
      const ahead = t < 0.5 ? d : { x: -d.x, y: -d.y }, u = unit(ahead), o = unit(out);
      if ((t < 1e-6 || t > 1 - 1e-6) && u.x * o.x + u.y * o.y > 0.95) return true;
    }
    return false;
  };
  return streets.map((s, si) => {
    const n = s.path.length;
    if (n < 2) return [false, false];
    return [covered(si, s.path[0], widthAt(s, 0), sub(s.path[0], s.path[1])), covered(si, s.path[n - 1], widthAt(s, n - 1), sub(s.path[n - 1], s.path[n - 2]))];
  });
}
