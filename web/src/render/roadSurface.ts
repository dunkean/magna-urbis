/** Street surface: the ground a street network covers, as polygons in metres, shared by
 * the Canvas (cityCanvas.ts) and WebGL (cityGl.ts) city renderers.
 *
 * A street is a ribbon following its per-vertex widths (tapers included), with round
 * joins at its bends. Its ends are either loose (cut square at the last vertex unless the
 * ground calls for another finish, `ends`) or at a junction, where they stop square at
 * the node and the junction polygon takes
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
import { polygonArea } from '../gen/core/geom';

export interface SurfaceStreet {
  path: readonly Point[];
  widths: readonly number[];
  role: string;
  rank: number;
}
export type SurfaceEnd = 'square' | 'taper' | 'butt';
export interface SurfaceOptions {
  /** Metres added to every half width (casing). */
  extra?: number | ((street: number) => number);
  /** Smallest full width of a street (screen floors at far zoom), metres. */
  minWidth?: (street: number) => number;
  /** Chord tolerance of arcs, metres. */
  tolerance?: number;
  /** Curb return radius as a share of the narrower width of two arms (0: sharp corners). */
  fillet?: number;
  /** How a loose end stops: 'butt' (default) cut square at its last vertex, nothing past it; natural grounds also use
   * 'square', a paved end with a short bevel, and 'taper', an earth way narrowing into the ground. Given, a straight
   * continuation into a narrower way (a paved street running on as a country track) also narrows over a taper of 15
   * to 40 m instead of stepping at the node. */
  ends?: (street: number) => SurfaceEnd;
}
/** One ring; `street` owns its style (a junction belongs to its major arm). */
export interface SurfacePiece {
  street: number;
  ring: Point[];
}

/** Ways whose loose ends stop square (decks, quays, moles). */
const BUTT = new Set(['bridge', 'mole', 'pier', 'landing']);
/** Ways that get no curb return (structures, steps). */
const SHARP = new Set(['bridge', 'mole', 'pier', 'landing', 'ford', 'causeway', 'stairs', 'port-stairs', 'boardwalk', 'walkway']);
const SNAP = 0.02;

/** `length`: the straight run of the arm's first segment, which bounds its curb return. */
interface Arm {
  street: number;
  dir: Point;
  half: number;
  base: number;
  rank: number;
  length: number;
  sharp: boolean;
}

const keyOf = (p: Point): string => `${Math.round(p.x / SNAP)},${Math.round(p.y / SNAP)}`;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const len = (v: Point): number => Math.hypot(v.x, v.y);
const unit = (v: Point): Point => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
};
/** Left normal (counter-clockwise quarter turn). */
const left = (v: Point): Point => ({ x: -v.y, y: v.x });
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const ccw = (r: Point[]): Point[] => (polygonArea(r) < 0 ? r.reverse() : r);

/** Points of an arc around `c` from angle a0 sweeping `sweep` (signed), ends included. */
function arc(c: Point, r: number, a0: number, sweep: number, tolerance: number): Point[] {
  const step = r > tolerance ? 2 * Math.acos(Math.max(-1, 1 - tolerance / r)) : Math.PI / 2;
  // An even count keeps the arc's apex (a cap's tip) on the ring.
  const n = 2 * Math.max(1, Math.ceil(Math.abs(sweep) / Math.max(step, 0.05) / 2));
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}

/** Two ways meeting end to end in a straight line with unequal widths: the wider one narrows to the other over its last
 * 15 to 40 m (a new vertex where the narrowing starts), so a paved street runs on into a track instead of stepping. */
function taperContinuations(paths: { pts: Point[]; ws: number[] }[]): void {
  const ends = new Map<string, [number, boolean][]>(),
    inner = new Set<string>();
  paths.forEach(({ pts }, si) => {
    if (pts.length < 2) return;
    for (let i = 1; i < pts.length - 1; i++) inner.add(keyOf(pts[i]));
    for (const last of [false, true]) {
      const k = keyOf(last ? pts[pts.length - 1] : pts[0]);
      let list = ends.get(k);
      if (!list) ends.set(k, (list = []));
      list.push([si, last]);
    }
  });
  /** Outward direction of a way at one of its ends, and its width there. */
  const at = (si: number, last: boolean): { dir: Point; width: number } => {
    const { pts, ws } = paths[si],
      i = last ? pts.length - 1 : 0,
      j = last ? pts.length - 2 : 1;
    return { dir: unit(sub(pts[j], pts[i])), width: ws[i] };
  };
  for (const [k, list] of ends) {
    if (list.length !== 2 || inner.has(k) || list[0][0] === list[1][0]) continue;
    const a = at(...list[0]),
      b = at(...list[1]);
    if (a.dir.x * b.dir.x + a.dir.y * b.dir.y > -0.85 || Math.abs(a.width - b.width) < 0.75) continue;
    const [[si, last], to]: [[number, boolean], number] = a.width > b.width ? [list[0], b.width] : [list[1], a.width];
    const { pts, ws } = paths[si];
    if (!last) {
      pts.reverse();
      ws.reverse();
    }
    const span = Math.min(40, Math.max(15, 6 * (ws[ws.length - 1] - to)));
    // Walk back from the end to the start of the narrowing.
    let run = 0,
      i = pts.length - 1;
    while (i > 0 && run + len(sub(pts[i], pts[i - 1])) < span) {
      run += len(sub(pts[i], pts[i - 1]));
      i--;
    }
    if (i > 0) {
      // The narrowing starts on segment (i - 1, i): a vertex there carries the full width.
      const step = len(sub(pts[i], pts[i - 1])),
        t = (span - run) / (step || 1);
      pts.splice(i, 0, add(pts[i], sub(pts[i - 1], pts[i]), t));
      ws.splice(i, 0, ws[i] + (ws[i - 1] - ws[i]) * t);
    }
    // From that vertex to the end the width falls linearly with the distance left, down to the narrower way's.
    const dist: number[] = [];
    dist[pts.length - 1] = 0;
    for (let k = pts.length - 2; k >= i; k--) dist[k] = dist[k + 1] + len(sub(pts[k + 1], pts[k]));
    const total = Math.max(dist[i], 1e-6),
      from = ws[i];
    for (let k = i + 1; k < pts.length; k++) ws[k] = Math.min(ws[k], to + ((from - to) * dist[k]) / total);
    if (!last) {
      pts.reverse();
      ws.reverse();
    }
  }
}
export function roadSurface(streets: readonly SurfaceStreet[], options: SurfaceOptions = {}): SurfacePiece[] {
  const tolerance = options.tolerance ?? 0.12,
    fillet = options.fillet ?? 0.55;
  const extraOf =
    typeof options.extra === 'function'
      ? options.extra
      : (
          (v: number) => () =>
            v
        )(options.extra ?? 0);
  const out: SurfacePiece[] = [];
  // Clean paths: no repeated vertices; widths aligned.
  const paths = streets.map((s, si) => {
    const pts: Point[] = [],
      ws: number[] = [];
    const floor = options.minWidth?.(si) ?? 0;
    s.path.forEach((p, i) => {
      const w = Math.max(floor, s.widths[i] ?? s.widths[s.widths.length - 1] ?? 3);
      if (pts.length && len(sub(p, pts[pts.length - 1])) < 1e-6) {
        ws[ws.length - 1] = Math.max(ws[ws.length - 1], w);
        return;
      }
      pts.push(p);
      ws.push(w);
    });
    return { pts, ws };
  });
  if (options.ends) taperContinuations(paths);
  // Nodes: shared vertices, plus loose ends lying on another street's segment.
  const nodes = new Map<string, { at: Point; arms: Arm[]; ends: number }>();
  const node = (p: Point) => {
    const k = keyOf(p);
    let n = nodes.get(k);
    if (!n) nodes.set(k, (n = { at: p, arms: [], ends: 0 }));
    return n;
  };
  paths.forEach(({ pts, ws }, si) => {
    if (pts.length < 2) return;
    const s = streets[si],
      sharp = SHARP.has(s.role);
    pts.forEach((p, i) => {
      const n = node(p);
      for (const step of [-1, 1] as const) {
        const j = i + step;
        if (j < 0 || j >= pts.length) continue;
        n.arms.push({ street: si, dir: unit(sub(pts[j], p)), half: ws[i] / 2, base: ws[i], rank: s.rank, length: len(sub(pts[j], p)), sharp });
      }
      if (i === 0 || i === pts.length - 1) n.ends++;
    });
  });
  // T without a shared vertex: a loose end on another street's segment interior.
  const CELL = 16,
    grid = new Map<string, [number, number][]>();
  paths.forEach(({ pts }, si) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i];
      for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++)
        for (let gy = Math.floor(Math.min(a.y, b.y) / CELL); gy <= Math.floor(Math.max(a.y, b.y) / CELL); gy++) {
          const k = `${gx},${gy}`;
          const list = grid.get(k);
          if (list) list.push([si, i]);
          else grid.set(k, [[si, i]]);
        }
    }
  });
  for (const n of nodes.values()) {
    if (n.arms.length !== 1) continue;
    const p = n.at,
      own = n.arms[0].street;
    for (const [si, i] of grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`) ?? []) {
      if (si === own) continue;
      const { pts, ws } = paths[si],
        a = pts[i - 1],
        b = pts[i],
        d = sub(b, a),
        l2 = d.x * d.x + d.y * d.y;
      const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (l2 || 1);
      if (t <= 1e-6 || t >= 1 - 1e-6 || len(sub(p, add(a, d, t))) > SNAP * 2) continue;
      const w = ws[i - 1] + (ws[i] - ws[i - 1]) * t,
        u = unit(d),
        s = streets[si];
      n.arms.push({ street: si, dir: u, half: w / 2, base: w, rank: s.rank, length: Math.sqrt(l2) * (1 - t), sharp: SHARP.has(s.role) }, { street: si, dir: { x: -u.x, y: -u.y }, half: w / 2, base: w, rank: s.rank, length: Math.sqrt(l2) * t, sharp: SHARP.has(s.role) });
      break;
    }
  }
  const junction = (p: Point): boolean => {
    const n = nodes.get(keyOf(p));
    return !!n && n.arms.length >= 2 && new Set(n.arms.map(a => a.street)).size + (n.arms.length > 2 ? 1 : 0) >= 2;
  };
  // Ribbons: quads, round joins, loose-end finishes.
  paths.forEach(({ pts, ws }, si) => {
    if (pts.length < 2) return;
    const e = extraOf(si),
      h = ws.map(w => w / 2 + e),
      s = streets[si];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i],
        n = left(unit(sub(b, a)));
      out.push({ street: si, ring: ccw([add(a, n, h[i - 1]), add(a, n, -h[i - 1]), add(b, n, -h[i]), add(b, n, h[i])]) });
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const d0 = unit(sub(pts[i], pts[i - 1])),
        d1 = unit(sub(pts[i + 1], pts[i])),
        turn = cross(d0, d1);
      if (Math.abs(turn) < 0.035 && d0.x * d1.x + d0.y * d1.y > 0) continue;
      // Outer side of the bend: the wedge between the two segment normals.
      const side = turn > 0 ? -1 : 1,
        n0 = left(d0),
        n1 = left(d1);
      const a0 = Math.atan2(n0.y * side, n0.x * side);
      let sweep = Math.atan2(n1.y * side, n1.x * side) - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      out.push({ street: si, ring: ccw([pts[i], ...arc(pts[i], h[i], a0, sweep, tolerance)]) });
    }
    const end = options.ends?.(si) ?? 'butt';
    for (const [i, j] of [
      [0, 1],
      [pts.length - 1, pts.length - 2],
    ]) {
      if (junction(pts[i]) || BUTT.has(s.role) || end === 'butt') continue;
      const d = unit(sub(pts[i], pts[j])),
        n = left(d),
        p = pts[i],
        r = h[i];
      // A paved end stops square, its corners worn back a little; an earth way narrows to a point within a few metres.
      if (end === 'square') out.push({ street: si, ring: ccw([add(p, n, r), add(p, n, -r), add(add(p, d, 0.3 * r), n, -0.8 * r), add(add(p, d, 0.3 * r), n, 0.8 * r)]) });
      else {
        const reach = Math.min(2.2 * r, 6);
        out.push({ street: si, ring: ccw([add(p, n, r), add(p, n, -r), add(add(p, d, reach), n, -0.15 * r), add(add(p, d, reach), n, 0.15 * r)]) });
      }
    }
  });
  // Junctions: the corners between consecutive arms, rounded by curb returns.
  for (const n of nodes.values()) {
    if (n.arms.length < 2 || !junction(n.at)) continue;
    // Every decision (corner or bevel, curb return and its centre) is taken on the
    // bare widths, so the casing (`extra`) runs parallel to the fill whatever it adds.
    const arms = n.arms.map(a => ({ ...a, grown: a.half + extraOf(a.street), angle: Math.atan2(a.dir.y, a.dir.x) })).sort((a, b) => a.angle - b.angle);
    const major = arms.reduce((m, a) => (a.rank < m.rank || (a.rank === m.rank && a.half > m.half) ? a : m), arms[0]);
    const hub: Point[] = [];
    const maxHalf = Math.max(...arms.map(a => a.half));
    const cornerOf = (A: Arm, B: Arm, ha: number, hb: number) => {
      const pA = add(n.at, left(A.dir), ha),
        pB = add(n.at, left(B.dir), -hb);
      const det = cross(A.dir, B.dir),
        w = sub(pB, pA),
        t = cross(w, B.dir) / det,
        s = cross(w, A.dir) / det;
      return { pA, pB, t, s, corner: add(pA, A.dir, t) };
    };
    for (let k = 0; k < arms.length; k++) {
      const A = arms[k],
        B = arms[(k + 1) % arms.length];
      let gap = B.angle - A.angle;
      if (k === arms.length - 1) gap += 2 * Math.PI;
      // Edge of A facing B (its left side) and edge of B facing A (its right side).
      const bare = cornerOf(A, B, A.half, B.half),
        grown = cornerOf(A, B, A.grown, B.grown);
      if (gap >= Math.PI - 0.12 || gap < 1e-3 || !(bare.t > -1e-6 && bare.s > -1e-6) || len(sub(bare.corner, n.at)) > 2.2 * maxHalf) {
        hub.push(grown.pA, grown.pB);
        continue;
      }
      hub.push(grown.corner);
      // Curb return: tangent to both bare edges, radius from the narrower arm, kept on the arms;
      // the casing's arc shares its centre, `extra` smaller.
      if (fillet <= 0 || A.sharp || B.sharp || gap < 0.35 || gap > Math.PI - 0.35) continue;
      const cot = 1 / Math.tan(gap / 2);
      const r = Math.min(fillet * Math.min(A.base, B.base), (0.8 * (A.length - bare.t)) / cot, (0.8 * (B.length - bare.s)) / cot);
      const e = Math.min(A.grown - A.half, B.grown - B.half),
        rc = r - e;
      if (!(r > 0.15) || !(rc > 0.05)) continue;
      const o = add(bare.corner, unit(add(A.dir, B.dir)), r / Math.sin(gap / 2));
      const foot = (p: Point, d: Point): Point => add(p, d, (o.x - p.x) * d.x + (o.y - p.y) * d.y);
      const t1 = foot(grown.pA, A.dir),
        t2 = foot(grown.pB, B.dir);
      const a1 = Math.atan2(t1.y - o.y, t1.x - o.x);
      let sweep = Math.atan2(t2.y - o.y, t2.x - o.x) - a1;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      out.push({ street: major.street, ring: ccw([grown.corner, ...arc(o, rc, a1, sweep, tolerance)]) });
    }
    if (hub.length >= 3) out.push({ street: major.street, ring: ccw(hub) });
  }
  return out;
}

/** A street as both renderers draw it, built once per street set (`joinStreets`).
 * `path`: the centreline, with a stem end the generator left inside another street's ribbon (short of its axis or
 * past it) moved onto that axis, so the surface makes a junction of it and nothing shows past the road joined.
 * `stroke`, `widths`: the line a stroke follows with square (butt) ends everywhere. A stroke stops on the axis of a
 * through street it ends on (that street's own ribbon covers the rest) and at the last vertex of a dead end; where it
 * meets only other street ends (a bend or continuation between two records) it runs on half its width along the
 * widest of them, when that one is at least as wide, so the stroke's own round join closes the bend. At the end of a
 * deck (bridge, pier) or a ford both lines run on half their width under it: a short crossing over a stream too
 * narrow to draw leaves no hole in the street. Two loose ends facing each other in line across a gap narrower than
 * the way (the generator cut it where a regional road passes) meet at their midpoint. `pathWidths` follows `path`. */
export interface JoinedStreet {
  path: readonly Point[];
  pathWidths: readonly number[];
  stroke: readonly Point[];
  widths: readonly number[];
}

/** Join decisions of a street set: a grid over segments, no pair test; the same result whatever the street order. */
export function joinStreets(streets: readonly SurfaceStreet[]): JoinedStreet[] {
  const CELL = 16,
    grid = new Map<number, [number, number][]>(),
    ends = new Map<string, [number, number][]>();
  const widthAt = (s: SurfaceStreet, i: number): number => {
    const w = s.widths[i] ?? s.widths[s.widths.length - 1];
    return Number.isFinite(w) && w > 0 ? w : 3;
  };
  const cell = (gx: number, gy: number): number => gx * 1048576 + gy;
  const cellOf = (p: Point): number => cell(Math.floor(p.x / CELL), Math.floor(p.y / CELL));
  /** Segments near a point (a segment spanning several cells comes once per cell: harmless for a nearest search). */
  const near = (p: Point): [number, number][] => {
    const gx = Math.floor(p.x / CELL),
      gy = Math.floor(p.y / CELL),
      out: [number, number][] = [];
    for (let x = gx - 1; x <= gx + 1; x++)
      for (let y = gy - 1; y <= gy + 1; y++) {
        const list = grid.get(cell(x, y));
        if (list) for (const e of list) out.push(e);
      }
    return out;
  };
  const push = <K>(map: Map<K, [number, number][]>, k: K, v: [number, number]): void => {
    const list = map.get(k);
    if (list) list.push(v);
    else map.set(k, [v]);
  };
  // Copied only where an end moves.
  const paths: (readonly Point[])[] = streets.map(s => s.path);
  const isEnd = (si: number, i: number): boolean => i === 0 || i === paths[si].length - 1;
  // Segments by the cells their box covers; an end looks in its cell and the eight around it (a ribbon is narrower than a cell).
  paths.forEach((pts, si) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i];
      for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++) for (let gy = Math.floor(Math.min(a.y, b.y) / CELL); gy <= Math.floor(Math.max(a.y, b.y) / CELL); gy++) push(grid, cell(gx, gy), [si, i]);
    }
    if (pts.length >= 2) {
      push(ends, keyOf(pts[0]), [si, 0]);
      push(ends, keyOf(pts[pts.length - 1]), [si, pts.length - 1]);
    }
  });
  /** Other street ends at this end. */
  const others = (si: number, i: number): [number, number][] => (ends.get(keyOf(paths[si][i])) ?? []).filter(([sj, k]) => sj !== si || k !== i);
  /** Another street passes through this end: on the inside of one of its segments, or on one of its inner vertices. */
  const through = (si: number, i: number): boolean => {
    const p = paths[si][i];
    return (grid.get(cellOf(p)) ?? []).some(([sj, k]) => {
      if (sj === si) return false;
      const a = paths[sj][k - 1],
        d = sub(paths[sj][k], a),
        l2 = d.x * d.x + d.y * d.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (l2 || 1)));
      return len(sub(p, add(a, d, t))) <= SNAP * 2 && ((t > 1e-6 && t < 1 - 1e-6) || (t <= 1e-6 && !isEnd(sj, k - 1)) || (t >= 1 - 1e-6 && !isEnd(sj, k)));
    });
  };
  // Stems: a loose end inside another street's ribbon moves onto its axis (the nearest one when ribbons overlap).
  // Gaps: two loose ends facing each other in line, closer than the narrower width (a street the generator cut where a
  // regional road or a crossing passes), meet at their midpoint and become one continuous way.
  const moves: [number, number, Point][] = [],
    facing = new Map<number, { sj: number; k: number; d: number }>();
  const id = (si: number, i: number): number => si * 2 + (i === 0 ? 0 : 1);
  paths.forEach((pts, si) => {
    if (pts.length < 2) return;
    for (const [i, j] of [
      [0, 1],
      [pts.length - 1, pts.length - 2],
    ]) {
      if (others(si, i).length || through(si, i)) continue;
      const p = pts[i],
        back = sub(pts[j], p);
      let best: { at: Point; d: number } | undefined;
      for (const [sj, k] of near(p)) {
        if (sj === si) continue;
        const o = paths[sj],
          a = o[k - 1],
          b = o[k],
          d = sub(b, a),
          l2 = d.x * d.x + d.y * d.y;
        if (l2 < 1e-12) continue;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l2));
        // Never onto another street's own loose end: two ends close together are not a junction.
        if ((t === 0 && isEnd(sj, k - 1)) || (t === 1 && isEnd(sj, k))) continue;
        const at = t === 0 ? a : t === 1 ? b : add(a, d, t),
          gap = len(sub(p, at));
        const half = (widthAt(streets[sj], k - 1) * (1 - t) + widthAt(streets[sj], k) * t) / 2;
        // A stem meets the axis at an angle (a street running alongside is left alone) and keeps its last segment's direction.
        const moved = sub(pts[j], at);
        if (gap > half || Math.abs(cross(unit(back), unit(d))) < 0.35 || moved.x * back.x + moved.y * back.y <= 0 || len(moved) < 0.5) continue;
        if (!best || gap < best.d) best = { at, d: gap };
      }
      if (best) {
        moves.push([si, i, { x: best.at.x, y: best.at.y }]);
        continue;
      }
      const out = unit(sub(p, pts[j]));
      for (const [sj, k] of near(p))
        for (const e of [k - 1, k]) {
          const o = paths[sj];
          if (sj === si || !isEnd(sj, e) || BUTT.has(streets[sj].role) || BUTT.has(streets[si].role)) continue;
          const q = o[e],
            v = sub(q, p),
            d = len(v),
            w = unit(sub(q, o[e === 0 ? 1 : e - 1]));
          if (d < SNAP * 2 || d > Math.min(widthAt(streets[si], i), widthAt(streets[sj], e))) continue;
          if ((v.x * out.x + v.y * out.y) / d < 0.95 || -(v.x * w.x + v.y * w.y) / d < 0.95 || others(sj, e).length || through(sj, e)) continue;
          const prior = facing.get(id(si, i));
          if (!prior || d < prior.d) facing.set(id(si, i), { sj, k: e, d });
        }
    }
  });
  const closed: [number, number, Point][] = [];
  for (const [key, { sj, k }] of facing) {
    const si = key >> 1,
      i = key & 1 ? paths[si].length - 1 : 0,
      back = facing.get(id(sj, k));
    // Mutual nearest only, each pair once.
    if (!back || back.sj !== si || back.k !== i || id(si, i) > id(sj, k)) continue;
    const p = paths[si][i],
      q = paths[sj][k],
      m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    closed.push([si, i, m], [sj, k, { ...m }]);
  }
  for (const [si, i, at] of closed) {
    const list = ends.get(keyOf(paths[si][i]))!;
    list.splice(
      list.findIndex(([sj, k]) => sj === si && k === i),
      1,
    );
    push(ends, keyOf(at), [si, i]);
  }
  moves.push(...closed);
  // A stem lands on an axis, never on another end; the ends of a closed gap are indexed at their meeting point above.
  for (const [si, i, at] of moves) {
    const pts = paths[si] === streets[si].path ? (paths[si] = paths[si].slice()) : paths[si];
    (pts as Point[])[i] = at;
  }
  return paths.map((pts, si) => {
    const s = streets[si],
      n = pts.length;
    let path = pts,
      pathWidths = s.widths,
      stroke = pts,
      widths = s.widths;
    if (n < 2 || BUTT.has(s.role)) return { path, pathWidths, stroke, widths };
    const base = (): number[] => pts.map((_, j) => widthAt(s, j));
    for (const i of [n - 1, 0]) {
      const at = others(si, i);
      // A dead end, or a stem on a through street: square at its vertex.
      if (!at.length || through(si, i)) continue;
      // The widest other end, of a rank shown whenever this street is (lower rank: more major); ties by street index.
      let target: [number, number] | undefined,
        best = -1,
        deck: [number, number] | undefined;
      for (const [sj, k] of at) {
        const o = streets[sj],
          w = widthAt(o, k);
        if (paths[sj].length < 2) continue;
        // Decks and fords: the way runs on under the deck or into the shallow water the ford mark is drawn over.
        if (BUTT.has(o.role) || o.role === 'ford') {
          deck ??= [sj, k];
          continue;
        }
        if (o.rank > s.rank) continue;
        if (w > best || (w === best && target && sj < target[0])) {
          best = w;
          target = [sj, k];
        }
      }
      const own = widthAt(s, i),
        along = target && own <= best + 0.05 ? target : deck;
      if (!along) continue;
      const [sj, k] = along,
        o = paths[sj],
        step = k === 0 ? 1 : -1;
      let q = k + step;
      while (q >= 0 && q < o.length && len(sub(o[q], o[k])) < 1e-6) q += step;
      if (q < 0 || q >= o.length) continue;
      const d = sub(o[q], o[k]),
        on = add(o[k], unit(d), Math.min(len(d), own / 2));
      const grow = <T>(line: readonly T[], v: T): T[] => (i === 0 ? [v, ...line] : [...line, v]);
      stroke = grow(stroke, on);
      widths = grow(widths === s.widths ? base() : widths, own);
      if (along === deck) {
        path = grow(path, on);
        pathWidths = grow(pathWidths === s.widths ? base() : pathWidths, own);
      }
    }
    return { path, pathWidths, stroke, widths };
  });
}
