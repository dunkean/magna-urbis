/**
 * Open-field system: arable regions are partitioned (never filled with seeds) by a network of field ways, headlands and
 * hedges that follows a direction field (contours on slopes, perpendicular to roads on the flat, a slow noise elsewhere).
 * Each furlong is then cut into long thin strips running in its own direction, with a slight reverse-S (aratral) curve.
 *
 *   region --(recursive cuts along streamlines of the direction field)--> furlongs / closes --> strips
 *
 * A cut across the strip direction is a headland (the strips end on it); a cut along the strip direction is a way or a
 * baulk. The first cuts of a region are cart ways (drawn as tracks), the later ones narrow headlands. In closed ground
 * (bocage, farm closes, assarts) the same recursion makes small irregular hedged closes instead.
 */
import polygonClipping from 'polygon-clipping';
import type { Rng } from '../core/rng';
import type { Noise2D } from '../core/noise';
import { Vec2, Polygon, Polyline, simplify, polygonArea, polygonCentroid, polygonContains, offsetRibbon, distToPolyline } from '../core/geom';

export type Ring = [number, number][];


export const toRing = (p: Polygon): Ring => {
  const r = p.map((q) => [q.x, q.y] as [number, number]);
  r.push([p[0].x, p[0].y]);
  return r;
};
export const fromRing = (r: Ring): Polygon => {
  const out = r.map(([x, y]) => ({ x, y }));
  if (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop();
  return out;
};

export interface FieldCtx {
  /** Strip direction (radians, mod pi) at a world point. */
  dirAt(x: number, y: number): number;
  /** Slope (rise/run) at a world point. */
  slopeAt(x: number, y: number): number;
  /** True where the ground is enclosed (hedged closes) rather than open field. */
  closeAt(x: number, y: number): boolean;
  noise: Noise2D;
  rng: Rng;
  /** Level of detail: cut the strips only where this returns true. */
  stripsAt?(c: Vec2): boolean;
  minArea?: number;
  accessWays?: boolean;
  /** Compact holdings with straight shared boundaries; legacy open fields keep
   * their separate strip system. Curved terrain edges remain authoritative. */
  regular?: boolean;
}

export interface Furlong {
  outer: Polygon; holes: Polygon[];
  angle: number;
  enclosed: boolean;
  strips?: Polygon[];
  /** Strip width used (m). */
  stripW: number;
  layout?: 'parcel';
}

export interface FieldNet { furlongs: Furlong[]; ways: Polyline[]; headlands: Polyline[]; margins?: { outer: Polygon; holes: Polygon[] }[] }

/**
 * Field ways worth drawing as cart tracks: a way that duplicates a road or an earlier way (most of its length within
 * a few meters of it) is dropped, and a way not linked (through other ways) to a road, track or farm drive is demoted
 * to a headland: the partition is unchanged (the line stays a furlong boundary), but no isolated track runs through
 * the fields without connecting anything.
 */
export function pruneWays(net: FieldNet, connectors: { path: Polyline; width: number }[], tol = 12): { dropped: number; demoted: number } {
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const boxOf = (pl: Polyline, m: number): Box => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pl) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
  };
  const inBox = (p: Vec2, b: Box): boolean => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
  const con = connectors.filter((c) => c.path.length >= 2).map((c) => ({ ...c, b: boxOf(c.path, 2 * tol) }));
  const nearCon = (p: Vec2, d: number): boolean => con.some(({ path, b }) => inBox(p, b) && distToPolyline(p, path) < d);
  /** Candidate search may be broad, but connectivity requires the actual carriageway ribbons to meet. */
  const joins = (end: Vec2, path: Polyline, width: number): boolean => distToPolyline(end, path) <= (GAP.way + width) / 2 + 0.5;
  const samples = (pl: Polyline): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 1; i < pl.length; i++) {
      const a = pl[i - 1], b = pl[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 10));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    return out;
  };
  // 1. duplicates of a road or of an earlier way
  const kept: { pl: Polyline; b: Box }[] = [];
  let dropped = 0;
  for (const pl of net.ways) {
    if (pl.length < 2) continue;
    const ss = samples(pl);
    let dup = 0;
    for (const p of ss) if (nearCon(p, 8) || kept.some((k) => inBox(p, k.b) && distToPolyline(p, k.pl) < 6)) dup++;
    if (dup >= 0.7 * ss.length) { dropped++; continue; }
    kept.push({ pl, b: boxOf(pl, 2 * tol) });
  }
  // 2. connectivity to the road network (fixpoint over the ways touching each other)
  const linked = kept.map((k) => [k.pl[0], k.pl[k.pl.length - 1]].some((end) => con.some((c) => inBox(end, c.b) && joins(end, c.path, c.width))));
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < kept.length; i++) {
      if (linked[i]) continue;
      const a = kept[i].pl;
      const ends = [a[0], a[a.length - 1]];
      for (let j = 0; j < kept.length && !linked[i]; j++) {
        if (!linked[j] || i === j) continue;
        const b = kept[j].pl;
        if (ends.some((e) => inBox(e, kept[j].b) && joins(e, b, GAP.way)) || [b[0], b[b.length - 1]].some((e) => inBox(e, kept[i].b) && joins(e, a, GAP.way))) { linked[i] = true; changed = true; }
      }
    }
  }
  const ways: Polyline[] = [];
  let demoted = 0;
  kept.forEach((k, i) => { if (linked[i]) ways.push(k.pl); else { net.headlands.push(k.pl); demoted++; } });
  net.ways = ways;
  return { dropped, demoted };
}

const GAP = { way: 4.4, headland: 2.4, hedge: 1.3 };

interface Node { rings: Ring[]; rot: number; depth: number }

/** Streamline of the field `ang(x, y)` through p0, in both directions, until it leaves `box`, loops back on itself or runs `maxLen` m. */
function trace(p0: Vec2, ang: (x: number, y: number) => number, box: { x0: number; y0: number; x1: number; y1: number }, step: number, maxLen: number, wob: (x: number, y: number) => number): Polyline {
  const run = (sign: number): Vec2[] => {
    const out: Vec2[] = [];
    let p = p0;
    let dx = 0, dy = 0, prevHd = 0, turned = 0;
    const kmax = Math.ceil(maxLen / step);
    for (let k = 0; k < kmax; k++) {
      const a = ang(p.x, p.y);
      let ux = Math.cos(a), uy = Math.sin(a);
      if (k === 0) { ux *= sign; uy *= sign; } else if (ux * dx + uy * dy < 0) { ux = -ux; uy = -uy; }
      dx = ux; dy = uy;
      // a cut that curls round a summit is dropped from there on (no whorls)
      const hd = Math.atan2(dy, dx);
      if (k > 0) { let dh = Math.abs(hd - prevHd); if (dh > Math.PI) dh = 2 * Math.PI - dh; turned += dh; if (turned > 1.6) break; }
      prevHd = hd;
      const w = wob(p.x, p.y);
      p = { x: p.x + dx * step - dy * w, y: p.y + dy * step + dx * w };
      out.push(p);
      if (p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1) break;
      // spiral on a hill: stop where the line comes back to itself
      if (k > 8) {
        const lim = step * step * 0.64;
        let loop = false;
        for (let j = 0; j < k - 8; j++) { const q = out[j]; if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < lim) { loop = true; break; } }
        if (loop) break;
      }
    }
    return out;
  };
  const back = run(-1).reverse();
  return [...back, p0, ...run(1)];
}

/** Midpoint of the longest chord of the rings (even-odd) along the line o + t d. */
function chordMid(rings: Ring[], ox: number, oy: number, dx: number, dy: number): Vec2 | null {
  const ts: number[] = [];
  for (const r of rings) for (let i = 1; i < r.length; i++) {
    const cx = r[i - 1][0], cy = r[i - 1][1], ex = r[i][0] - cx, ey = r[i][1] - cy;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((cx - ox) * ey - (cy - oy) * ex) / den, u = ((cx - ox) * dy - (cy - oy) * dx) / den;
    if (u >= 0 && u < 1) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  let best = -1, bt = 0;
  for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] - ts[i] > best) { best = ts[i + 1] - ts[i]; bt = (ts[i] + ts[i + 1]) / 2; }
  return best > 0 ? { x: ox + dx * bt, y: oy + dy * bt } : null;
}

/** Parts of polyline `pl` that lie inside the rings (even-odd), cut exactly at the boundary. */
export function clipToRings(pl: Polyline, rings: Ring[]): Polyline[] {
  const inside = (p: Vec2): boolean => {
    let c = false;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a[1] > p.y) !== (b[1] > p.y) && p.x < a[0] + ((p.y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) c = !c;
    }
    return c;
  };
  const out: Polyline[] = [];
  let current: Polyline = [];
  const flush = () => { if (current.length > 1) out.push(current); current = []; };
  for (let k = 1; k < pl.length; k++) {
    const a = pl[k - 1], b = pl[k], dx = b.x - a.x, dy = b.y - a.y;
    if (Math.hypot(dx, dy) < 1e-9) continue;
    const cuts = [0, 1];
    for (const ring of rings) for (let i = 1; i < ring.length; i++) {
      const c = ring[i - 1], d = ring[i], sx = d[0] - c[0], sy = d[1] - c[1];
      const den = dx * sy - dy * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c[0] - a.x) * sy - (c[1] - a.y) * sx) / den;
      const u = ((c[0] - a.x) * dy - (c[1] - a.y) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1], hi = cuts[i];
      if (hi - lo < 1e-9) continue;
      const point = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
      if (!inside(point((lo + hi) / 2))) { flush(); continue; }
      const start = point(lo), end = point(hi), last = current[current.length - 1];
      if (last && Math.hypot(last.x - start.x, last.y - start.y) > 1e-7) flush();
      if (!current.length) current.push(start);
      current.push(end);
    }
  }
  flush();
  return out;
}

/** True when p lies on one of the rings (the exact crossings computed by clipToRings). */
function onRings(p: Vec2, rings: Ring[], tol = 0.01): boolean {
  for (const r of rings) for (let i = 1; i < r.length; i++) {
    const ax = r[i - 1][0], ay = r[i - 1][1], dx = r[i][0] - ax, dy = r[i][1] - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2));
    if (Math.hypot(p.x - ax - t * dx, p.y - ay - t * dy) <= tol) return true;
  }
  return false;
}
/** The polyline prolonged by `d` m at both ends, so that its ribbon cuts cleanly through an oblique border. */
function extendEnds(pl: Polyline, d: number): Polyline {
  const out = pl.slice(), n = out.length;
  const push = (a: Vec2, b: Vec2): Vec2 => { const l = Math.hypot(a.x - b.x, a.y - b.y) || 1; return { x: a.x + (a.x - b.x) / l * d, y: a.y + (a.y - b.y) / l * d }; };
  out[0] = push(pl[0], pl[1]); out[n - 1] = push(pl[n - 1], pl[n - 2]);
  return out;
}

const extents = (outer: Ring, ca: number, sa: number) => {
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const [x, y] of outer) {
    const u = x * ca + y * sa, v = -x * sa + y * ca;
    if (u < umin) umin = u; if (u > umax) umax = u;
    if (v < vmin) vmin = v; if (v > vmax) vmax = v;
  }
  return { umin, umax, vmin, vmax };
};

const ringArea = (r: Ring): number => {
  let a = 0;
  for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1];
  return Math.abs(a) / 2;
};

/** Partition one arable region (outer ring + holes) into furlongs / closes and cut the strips. */
export function partitionRegion(outer: Polygon, holes: Polygon[], ctx: FieldCtx, net: FieldNet): void {
  const rng = ctx.rng;
  const leaves: { rings: Ring[]; rot: number; enclosed: boolean }[] = [];
  const closed = ctx.closeAt(0, 0);
  const regular = !!ctx.regular, rootCenter = polygonCentroid(outer);
  const rootAngle = ctx.dirAt(rootCenter.x, rootCenter.y);
  // A holding inherits its estate's frame. Re-evaluating a noisy direction at
  // every cut used to turn even flat countryside into flowing ribbons.
  const direction = regular ? () => rootAngle : ctx.dirAt;

  /** Cut `rings` along (or across) the strips of direction field + rot with a streamline cut of width `gap`; null when it does not split. */
  const cutOnce = (rings: Ring[], rot: number, across: boolean, f: number, gap: number, wobAmp: number, bucket: Polyline[], jitter: boolean, straightCut = false): Ring[][] | null => {
    const cen = polygonCentroid(fromRing(rings[0]));
    const phi = direction(cen.x, cen.y) + rot;
    const ca = Math.cos(phi), sa = Math.sin(phi);
    const ex = extents(rings[0], ca, sa);
    let ox: number, oy: number, cdx: number, cdy: number;
    let angFn: (x: number, y: number) => number;
    if (across) {
      const u = ex.umin + (ex.umax - ex.umin) * f, v = (ex.vmin + ex.vmax) / 2;
      ox = u * ca - v * sa; oy = u * sa + v * ca; cdx = -sa; cdy = ca;
      angFn = straightCut ? () => phi + Math.PI / 2 : (x, y) => ctx.dirAt(x, y) + rot + Math.PI / 2;
    } else {
      const u = (ex.umin + ex.umax) / 2, v = ex.vmin + (ex.vmax - ex.vmin) * f;
      ox = u * ca - v * sa; oy = u * sa + v * ca; cdx = ca; cdy = sa;
      angFn = straightCut ? () => phi : (x, y) => ctx.dirAt(x, y) + rot;
    }
    const mid = chordMid(rings, ox, oy, cdx, cdy);
    if (!mid) return null;
    if (regular) {
      const ex = extents(rings[0], ca, sa), span = 4 * Math.hypot(ex.umax - ex.umin, ex.vmax - ex.vmin) + 32;
      const nx = -cdy, ny = cdx;
      const point = (u: number, v: number): [number, number] => [mid.x + u * cdx + v * nx, mid.y + u * cdy + v * ny];
      const pieces: Ring[][] = [];
      try {
        for (const sign of [-1, 1]) {
          const clip: Ring = [point(-span, 0), point(span, 0), point(span, sign * span), point(-span, sign * span), point(-span, 0)];
          pieces.push(...polygonClipping.intersection([rings], [[clip]]) as Ring[][]);
        }
      } catch { return null; }
      if (pieces.length < 2) return null;
      const minimum = ctx.minArea ?? 1000, minWidth = minimum < 500 ? 7 : 18;
      if (pieces.some(pg => {
        const area = ringArea(pg[0]) - pg.slice(1).reduce((sum, hole) => sum + ringArea(hole), 0);
        const box = extents(pg[0], ca, sa);
        return area < minimum || area / Math.max(box.umax - box.umin, box.vmax - box.vmin, 1) < minWidth;
      })) return null;
      // Only estate boundaries are candidate lanes. Minor parcel boundaries
      // share an edge, without a ribbon of paper resembling another road.
      for (const line of clipToRings([{ x: mid.x - span * cdx, y: mid.y - span * cdy }, { x: mid.x + span * cdx, y: mid.y + span * cdy }], rings)) bucket.push(line);
      return pieces;
    }
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const q of rings[0]) { if (q[0] < bx0) bx0 = q[0]; if (q[0] > bx1) bx1 = q[0]; if (q[1] < by0) by0 = q[1]; if (q[1] > by1) by1 = q[1]; }
    bx0 -= 30; bx1 += 30; by0 -= 30; by1 += 30;
    const wob = (x: number, y: number) => ctx.noise.noise(x / 55 + 11, y / 55 - 3) * wobAmp * 0.08;
    let line = trace(mid, angFn, { x0: bx0, y0: by0, x1: bx1, y1: by1 }, 10, 1.15 * Math.hypot(bx1 - bx0, by1 - by0), wob);
    if (jitter) line = line.map((p, i) => (i % 3 === 0 ? { x: p.x + ctx.noise.noise(p.x / 28, p.y / 28) * 3, y: p.y + ctx.noise.noise(p.x / 28 + 9, p.y / 28) * 3 } : p));
    line = simplify(line, 0.9);
    // Only the parts of the streamline that cross the ground from border to border cut it: a part that
    // stops short inside (a curling streamline) would leave a headland ending in the middle of a field.
    const crossing = clipToRings(line, rings).filter((seg) => onRings(seg[0], rings) && onRings(seg[seg.length - 1], rings));
    if (!crossing.length) return null;
    let pieces: Ring[][];
    try {
      pieces = polygonClipping.difference([rings as unknown as [number, number][][]], ...crossing.map((seg) => [[toRing(offsetRibbon(extendEnds(seg, gap + 1), gap))]] as [number, number][][][]))
        .map((pg) => pg as unknown as Ring[]);
    } catch { return null; }
    const real = pieces.filter((pg) => ringArea(pg[0]) > 300);
    if (real.length < 2) return null;
    for (const seg of crossing) bucket.push(seg);
    return real;
  };
  /** A cut that does not split (degenerate geometry) is retried at other positions. */
  const cut = (rings: Ring[], rot: number, across: boolean, f: number, gap: number, wobAmp: number, bucket: Polyline[], jitter: boolean): Ring[][] | null => {
    for (const straightCut of [false, true]) for (const df of [0, 0.13, -0.13]) {
      const r = cutOnce(rings, rot, across, Math.max(0.25, Math.min(0.75, f + df)), gap * (df ? 1.07 : 1), wobAmp, bucket, jitter, straightCut);
      if (r) return r;
    }
    return null;
  };
  const areaOf = (rings: Ring[]) => ringArea(rings[0]) - rings.slice(1).reduce((a, r) => a + ringArea(r), 0);
  const dims = (rings: Ring[], rot: number) => {
    const cen = polygonCentroid(fromRing(rings[0]));
    const phi = direction(cen.x, cen.y) + rot;
    const ex = extents(rings[0], Math.cos(phi), Math.sin(phi));
    const L = ex.umax - ex.umin;
    // mean width (a curved band has a large bounding box but a narrow body)
    const Wb = ex.vmax - ex.vmin;
    return { cen, L, W: Math.min(Wb, areaOf(rings) / Math.max(L, 1)), fill: areaOf(rings) / Math.max(1, L * Wb) };
  };

  // phase A: blocks of ~15-30 ha cut by cart ways (open fields only), each with its own strip direction (the patchwork)
  const blocks: { rings: Ring[]; rot: number }[] = [];
  const root: Ring[] = [toRing(outer), ...holes.map(toRing)];
  if (closed && !regular) blocks.push({ rings: root, rot: 0 });
  else {
    const stack: { rings: Ring[]; depth: number }[] = [{ rings: root, depth: 0 }];
    let guard = 0;
    while (stack.length && guard++ < 2000) {
      const nd = stack.pop()!;
      const a = areaOf(nd.rings);
      const { L, W } = dims(nd.rings, 0);
      const Ab = (regular ? rng.range(55, 90) : rng.range(14, 28)) * 1e4;
      let pcs: Ring[][] | null = null;
      if (a > Ab && nd.depth < 10) pcs = cut(nd.rings, 0, L >= W * 1.15, rng.range(0.4, 0.6), GAP.way, 3.5, net.ways, false);
      if (!pcs) { blocks.push({ rings: nd.rings, rot: 0 }); continue; }
      for (const pg of pcs) stack.push({ rings: pg, depth: nd.depth + 1 });
    }
    for (const nd of stack) blocks.push({ rings: nd.rings, rot: 0 });
    for (const b of blocks) {
      const c = polygonCentroid(fromRing(b.rings[0]));
      const sl = ctx.slopeAt(c.x, c.y);
      const flat = 1 - Math.min(1, Math.max(0, (sl - 0.03) / 0.05));
      // mostly a quarter turn (the furlongs stay square to the block's ways); an occasional skew
      if (blocks.length > 1) { const r = rng.float(); if (r < 0.4) b.rot = Math.PI / 2; else if (!regular && r < 0.52) b.rot = rng.range(0.25, 0.5) * (rng.chance(0.5) ? 1 : -1) * flat; }
      if (regular && sl >= .08) {
        // Reorient each estate to the local contour on stronger slopes, then
        // keep that frame fixed throughout its compact parcel subdivision.
        const relative = ctx.dirAt(c.x, c.y) - rootAngle;
        b.rot = Math.atan2(Math.sin(2 * relative), Math.cos(2 * relative)) / 2;
      }
    }
  }

  // phase B: furlongs (strips ~150-300 m long) / closes, cut by headlands across and baulks along the block's strip direction
  for (const bl of blocks) {
    const stack: Node[] = [{ rings: bl.rings, rot: bl.rot, depth: 0 }];
    let guard = 0;
    while (stack.length && guard++ < 3000) {
      const nd = stack.pop()!;
      const a = areaOf(nd.rings);
      const { L, W, fill, cen } = dims(nd.rings, nd.rot);
      const Lmax = regular ? rng.range(150, 240) : closed ? rng.range(110, 190) : rng.range(305, 345);
      const Wmax = closed ? rng.range(100, 170) : rng.range(130, 250);
      // a bent furlong (low fill of its box) is cut across so that each part is straight enough for long strips
      const bent = !closed && fill < 0.6 && L > 270;
      const long = regular && L > 75 && L > W * (ctx.slopeAt(cen.x, cen.y) >= .12 ? 5.5 : 3.2);
      const across = long || bent || (L > Lmax && (L / Lmax >= W / Wmax || W <= Wmax));
      const along = !across && W > Wmax;
      if (a < (regular ? 2.2 * (ctx.minArea ?? 1000) : closed ? 5000 : 14000) || nd.depth > 14 || (!across && !along)) { leaves.push({ rings: nd.rings, rot: nd.rot, enclosed: closed }); continue; }
      const access = !regular && closed && ctx.accessWays && nd.depth === 0;
      const pcs = cut(nd.rings, nd.rot, across, closed || !across ? rng.range(0.4, 0.6) : rng.range(0.46, 0.54), access ? GAP.way : closed ? GAP.hedge : GAP.headland, closed ? 5.5 : 3.5, regular ? [] : access ? net.ways : net.headlands, closed);
      if (!pcs) { leaves.push({ rings: nd.rings, rot: nd.rot, enclosed: closed }); continue; }
      for (const pg of pcs) stack.push({ rings: pg, rot: closed && !regular ? nd.rot + rng.range(-0.5, 0.5) : nd.rot, depth: nd.depth + 1 });
    }
    for (const nd of stack) leaves.push({ rings: nd.rings, rot: nd.rot, enclosed: closed });
  }

  // leaves: strips
  for (const lf of leaves) {
    const o = fromRing(lf.rings[0]);
    const a = ringArea(lf.rings[0]) - lf.rings.slice(1).reduce((s, r) => s + ringArea(r), 0);
    if (a < (ctx.minArea ?? 1400)) {
      if (regular) (net.margins ??= []).push({ outer: o, holes: lf.rings.slice(1).map(fromRing) });
      continue;
    }
    const cen = polygonCentroid(o);
    const ang0 = ((direction(cen.x, cen.y) + lf.rot) % Math.PI + Math.PI) % Math.PI;
    const ca = Math.cos(ang0), sa = Math.sin(ang0);
    const ex = extents(lf.rings[0], ca, sa);
    const holes = lf.rings.slice(1).map(fromRing);
    if (regular && a / Math.max(ex.umax - ex.umin, ex.vmax - ex.vmin, 1) < ((ctx.minArea ?? 1400) < 500 ? 7 : 18)) {
      (net.margins ??= []).push({ outer: o, holes }); continue;
    }
    const fl: Furlong = { outer: o, holes, angle: ang0, enclosed: lf.enclosed, stripW: 0, ...(regular ? { layout: 'parcel' as const } : {}) };
    net.furlongs.push(fl);
    if (regular) continue;
    if (lf.enclosed) continue;
    const ws = rng.range(11, 22);
    fl.stripW = ws;
    const L = ex.umax - ex.umin;
    const slabs = Math.ceil((ex.vmax - ex.vmin) / ws);
    if (slabs < 2 || slabs > 70 || a <= 2500 || (ctx.stripsAt && !ctx.stripsAt(cen))) continue;
    // Work in a fixed affine frame. Curved nearest-streamline coordinates are
    // not invertible in concavities and used to fold strips over themselves.
    // The same gently curved band is intersected with the complete polygon,
    // including holes, by the existing robust Boolean kernel.
    const amplitude = rng.range(-1, 1) * Math.min(.012 * L, 2.5);
    const phase = rng.range(0, .4);
    const bend = (u: number) => amplitude * Math.sin(2 * Math.PI * ((u - ex.umin) / Math.max(1, L) + phase));
    const local: Ring[] = lf.rings.map(ring => ring.map(([x, y]) => [x * ca + y * sa, -x * sa + y * ca]));
    const extent = Math.max(L, ex.vmax - ex.vmin) + 100;
    const strips: Polygon[] = [];
    // A strip stores a simple ring. Split any remaining internal holes along a
    // line through their interior, rather than silently filling the holes.
    const append = (piece: Ring[], depth = 0): void => {
      if (piece.length === 1) {
        const poly = fromRing(piece[0]).map(p => ({ x: p.x * ca - p.y * sa, y: p.x * sa + p.y * ca }));
        if (Math.abs(polygonArea(poly)) >= 120) strips.push(poly);
        return;
      }
      if (depth >= 32) return;
      const hole = piece[1], xs = hole.map(p => p[0]);
      const split = (Math.min(...xs) + Math.max(...xs)) / 2;
      const bounds = extents(piece[0], 1, 0);
      for (const [lo, hi] of [[bounds.umin - 1, split], [split, bounds.umax + 1]]) {
        const box: Ring = [[lo, ex.vmin - extent], [hi, ex.vmin - extent], [hi, ex.vmax + extent], [lo, ex.vmax + extent], [lo, ex.vmin - extent]];
        for (const pg of polygonClipping.intersection([piece], [[box]])) append(pg as Ring[], depth + 1);
      }
    };
    const count = Math.ceil((ex.vmax - ex.vmin + 2 * Math.abs(amplitude)) / ws);
    for (let i = 0; i < count; i++) {
      const lo = ex.vmin - Math.abs(amplitude) + i * ws;
      const hi = lo + ws - .65; // narrow unploughed baulk, in metres
      const band: Ring = [];
      const steps = Math.max(8, Math.ceil(L / 20));
      for (let k = 0; k <= steps; k++) {
        const u = ex.umin - 1 + (L + 2) * k / steps;
        band.push([u, lo + bend(u)]);
      }
      for (let k = steps; k >= 0; k--) {
        const u = ex.umin - 1 + (L + 2) * k / steps;
        band.push([u, hi + bend(u)]);
      }
      band.push(band[0]);
      try { for (const pg of polygonClipping.intersection([local], [[band]])) append(pg as Ring[]); }
      catch { strips.length = 0; break; } // Retain the holding when a Boolean degeneracy defeats its texture.
    }
    if (strips.length) fl.strips = strips;
  }
}
