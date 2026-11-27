/**
 * The moat line of a circuit (Rust `urban::fortification::moat_line`, `MoatSpec.runs`): pure helpers over its stations, shared by
 * the 3D ground cut (ui/urbanGroundCuts.ts), the 3D water and works (city3dMoat.ts) and the 2D plans.
 *
 * Station `k` of a run is the cross-section from `inner[k]` (scarp lip, curtain side) to `outer[k]` (counterscarp lip). Quad `k`
 * lies between stations `k` and `k + 1`; on a closed run the last quad joins the last station to the first. Inside a quad, `t`
 * runs along it (0 at station `k`, 1 at the next) and `u` across it (0 on the inner lip, 1 on the outer lip).
 *
 * Heights: `rim` and `bed` are in the height frame of the urban request. A renderer whose ground differs (finer relief) never
 * uses them as such: `runFrame` carries them onto its own ground.
 *
 * `moatPlan` builds the 2D plan parts of a circuit's ditch straight from the stations, per display level (cityWalls.ts).
 */
import type { MoatCrossing, MoatReach, MoatRun, MoatSpec } from '../../../rust/bridge/urban';
import type { Point } from '../../../rust/bridge/housesContract';
import { MOAT_BUCKETS, MOAT_PARTS, moatCut, moatFill, moatFreeboard, moatScarp, type MoatFill, type MoatForm, type MoatPart, type MoatPartShape, type MoatState } from './moatModel';

type Shape = { outer: Point[]; holes: Point[][] };

/** Shortest scarp run of the 3D terrain cut (m): the ground is sampled on grids of 2 m and more, so a steeper lip would
 * stair-step. The revetment faces give the crisp wall at close range. */
export const TERRAIN_MIN_SCARP = 2.5;
/** Half window (stations) of the low-pass of the offset between the engine's heights and a renderer's ground. */
const FRAME_HALF_WINDOW = 2;
/** The bed stays this far under the lower lip, the water this far under the lowest lip of its reach (m). */
const BED_CLEARANCE = 0.5,
  WATER_CLEARANCE = 0.2;
/** Samples across a station when its wetted width is sought. */
const WET_SAMPLES = 8;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpPoint = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const signedArea = (r: readonly Point[]): number => r.reduce((s, p, i) => s + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2;
const oriented = (r: Point[], positive: boolean): Point[] => (signedArea(r) > 0 === positive ? r : r.reverse());

// ---------------------------------------------------------------- stations
export const stationCount = (run: MoatRun): number => Math.min(run.inner.length, run.outer.length);
export const quadCount = (run: MoatRun): number => {
  const n = stationCount(run);
  return n < 2 ? 0 : run.closed ? n : n - 1;
};
/** The station after `k` (the first after the last on a closed run). */
export const nextStation = (run: MoatRun, k: number): number => (k + 1) % stationCount(run);
export const stationWidth = (run: MoatRun, k: number): number => dist(run.inner[k], run.outer[k]);
/** Engine depth of station `k` (rim to bed, m), or `fallback` where the station carries none. */
export function stationDepth(run: MoatRun, k: number, fallback: number): number {
  const d = run.rim[k] - run.bed[k];
  return Number.isFinite(d) && d > 0.2 ? d : fallback;
}
/** Middle of each station. */
export const runAxis = (run: MoatRun): Point[] => Array.from({ length: stationCount(run) }, (_, k) => lerpPoint(run.inner[k], run.outer[k], 0.5));
/** Arc length of the axis at each station (m); a closed run has one more entry, the length of the whole ring. */
export function runArc(run: MoatRun): number[] {
  const axis = runAxis(run),
    arc = axis.length ? [0] : [];
  for (let k = 1; k < axis.length; k++) arc.push(arc[k - 1] + dist(axis[k - 1], axis[k]));
  if (run.closed && axis.length > 1) arc.push(arc[axis.length - 1] + dist(axis[axis.length - 1], axis[0]));
  return arc;
}
/** Length of the taper of an open run end on a slope, in ditch widths. */
export const END_TAPER = 1.5;
/** 1 along a run, falling smoothly to 0 at an open end on a slope over END_TAPER widths: `s` is the arc length of the axis
 * (`runArc`, given as `arc`), `width` the local width. The one taper of the ditch: the 3D terrain cut (ui/urbanGroundCuts.ts)
 * scales its depth by it, the revetment (city3dMoat.ts) the height of its facing. */
export function runEndTaper(run: MoatRun, arc: readonly number[], s: number, width: number): number {
  if (run.closed || !arc.length) return 1;
  const reach = Math.max(1, END_TAPER * width),
    smooth = (x: number): number => {
      const v = Math.max(0, Math.min(1, x));
      return v * v * (3 - 2 * v);
    };
  return (run.ends[0] === 'slope' ? smooth(s / reach) : 1) * (run.ends[1] === 'slope' ? smooth((arc[arc.length - 1] - s) / reach) : 1);
}
/** Stations `from..=to` of a reach, in walking order (wrapping round a closed run). The one reach of a ring (`from == to` on a
 * closed run) walks the whole ring back to its first station. */
export function reachStations(run: MoatRun, reach: MoatReach): number[] {
  const n = stationCount(run);
  if (!n || reach.from < 0 || reach.to < 0 || reach.from >= n || reach.to >= n || (!run.closed && reach.to < reach.from)) return [];
  const count = run.closed ? (reach.to === reach.from ? n : (((reach.to - reach.from) % n) + n) % n) + 1 : reach.to - reach.from + 1;
  return Array.from({ length: count }, (_, i) => (reach.from + i) % n);
}
/** Stations `s` walk the whole of a closed run (their last is their first). */
const isRing = (run: MoatRun, s: readonly number[]): boolean => !!run.closed && s.length === stationCount(run) + 1 && s.length > 3;
/** The reach that holds each quad (index in `run.reaches`, -1 for none). A quad no reach spans (the joint of a closed ring)
 * takes the reach of the quad before it. */
export function quadReaches(run: MoatRun): number[] {
  const q = quadCount(run),
    out = new Array<number>(q).fill(-1);
  run.reaches.forEach((reach, ri) => {
    const s = reachStations(run, reach);
    for (let i = 0; i + 1 < s.length; i++) if (s[i] < q) out[s[i]] = ri;
  });
  for (let pass = 0; pass < 2; pass++) for (let k = 0; k < q; k++) if (out[k] < 0) out[k] = out[(k + q - 1) % q] >= 0 ? out[(k + q - 1) % q] : out[(k + 1) % q];
  return out;
}

// ---------------------------------------------------------------- plan shapes
/** The polygon of a reach: its inner lips forward, its outer lips back. */
export function reachStrip(run: MoatRun, reach: MoatReach): Shape {
  const s = reachStations(run, reach);
  if (s.length < 2) return { outer: [], holes: [] };
  if (isRing(run, s)) return runStrip(run);
  return { outer: oriented([...s.map(k => run.inner[k]), ...[...s].reverse().map(k => run.outer[k])], true), holes: [] };
}
/** The polygon of a whole run: a ring with the inner lips as its hole when the run is closed. */
export function runStrip(run: MoatRun): Shape {
  const n = stationCount(run);
  if (n < 2) return { outer: [], holes: [] };
  if (run.closed && n >= 3) return { outer: oriented(run.outer.slice(0, n), true), holes: [oriented(run.inner.slice(0, n), false)] };
  return reachStrip({ ...run, closed: false }, { from: 0, to: n - 1, supply: 'dry' });
}
/** Distance from `p` to a polyline (m). */
export function pathDistance(p: Point, path: readonly Point[]): number {
  if (path.length === 1) return dist(p, path[0]);
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i],
      dx = path[i + 1].x - a.x,
      dy = path[i + 1].y - a.y,
      l = dx * dx + dy * dy,
      t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return best;
}
/** The corridor of a crossing: its path widened by its half width on both sides. */
export function crossingShape(crossing: MoatCrossing): Shape {
  const path = crossing.path,
    hw = crossing.half_width_m;
  if (path.length < 2) return { outer: [], holes: [] };
  const normal = (i: number): Point => {
    const a = path[Math.max(0, i - 1)],
      b = path[Math.min(path.length - 1, i + 1)],
      l = dist(a, b) || 1;
    return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
  };
  const side = (sign: number): Point[] =>
    path.map((p, i) => {
      const n = normal(i);
      return { x: p.x + n.x * hw * sign, y: p.y + n.y * hw * sign };
    });
  return { outer: oriented([...side(1), ...side(-1).reverse()], true), holes: [] };
}

// ---------------------------------------------------------------- section and fill
/** Depth of the cut (m) at across position `u` of a ditch `depth` deep and `width` wide, in its form; the scarp runs at least
 * `minScarp` metres (never past the middle). */
export function sectionDepth(form: MoatForm, depth: number, width: number, u: number, minScarp = 0): number {
  const half = Math.max(0.25, width / 2),
    run = Math.min(half, Math.max(minScarp, moatScarp(form, depth, width)));
  return moatCut(form, depth, run, half, Math.max(0, Math.min(u, 1 - u)) * width);
}
/** The fill of a reach in the map's climate and season: one fill for every reach a source feeds, and for every pool; dry
 * reaches vary from one to the next. */
export function reachFill(reach: MoatReach, reachIndex: number, form: MoatForm, town: MoatState = ''): MoatFill {
  const { kind, bucket } = reachSupply(reach, reachIndex);
  return moatFill(kind, bucket, form, undefined, town);
}
/** What `moatFill` reads of a reach (index `reachIndex` in its run): its supply class and its fill bucket. */
export function reachSupply(reach: MoatReach, reachIndex: number): { kind: 'wet' | 'pool' | 'dry'; bucket: number } {
  const kind = reach.supply === 'fed' ? 'wet' : reach.supply === 'pool' ? 'pool' : 'dry';
  return { kind, bucket: kind === 'dry' ? reachIndex % MOAT_BUCKETS : 0 };
}

// ---------------------------------------------------------------- heights in a renderer's frame
/** The heights of a run on a renderer's ground, per station: the ground at both lips, the bed, and the offset from the
 * engine's frame (low-passed along the run). */
export interface RunFrame {
  inner: Float64Array;
  outer: Float64Array;
  bed: Float64Array;
  delta: Float64Array;
}
/** The run on the ground `g` (undug): `delta` = g(lower lip) - rim, low-passed; the bed is the engine's bed + delta, kept
 * under the lower lip. A station without engine heights lies `depth` under its lower lip. Undefined where `g` is not finite. */
export function runFrame(run: MoatRun, g: (p: Point) => number, depth: number): RunFrame | undefined {
  const n = stationCount(run),
    inner = new Float64Array(n),
    outer = new Float64Array(n),
    raw = new Float64Array(n),
    delta = new Float64Array(n),
    bed = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    inner[k] = g(run.inner[k]);
    outer[k] = g(run.outer[k]);
    if (!Number.isFinite(inner[k]) || !Number.isFinite(outer[k])) return undefined;
    raw[k] = Math.min(inner[k], outer[k]) - run.rim[k];
  }
  for (let k = 0; k < n; k++) {
    let sum = 0,
      count = 0;
    for (let j = k - FRAME_HALF_WINDOW; j <= k + FRAME_HALF_WINDOW; j++) {
      const i = run.closed ? (j + n) % n : j;
      if (i < 0 || i >= n || !Number.isFinite(raw[i])) continue;
      sum += raw[i];
      count++;
    }
    delta[k] = count ? sum / count : 0;
    const low = Math.min(inner[k], outer[k]),
      engine = Number.isFinite(run.rim[k]) && Number.isFinite(run.bed[k]) ? run.bed[k] + delta[k] : low - depth;
    bed[k] = Math.min(engine, low - BED_CLEARANCE);
  }
  return { inner, outer, bed, delta };
}
/** Height of the dug section in the renderer's frame at (`t` along quad `k`..`k1`, `u` across): a level bottom at the bed,
 * each scarp rising to its own lip, so the uphill bank is simply higher. */
export function framedSection(form: MoatForm, frame: RunFrame, k: number, k1: number, t: number, u: number, width: number, minScarp = 0): number {
  const bed = lerp(frame.bed[k], frame.bed[k1], t),
    inner = lerp(frame.inner[k], frame.inner[k1], t) - bed,
    outer = lerp(frame.outer[k], frame.outer[k1], t) - bed,
    depth = inner + (outer - inner) * u;
  return bed + depth - sectionDepth(form, depth, width, u, minScarp);
}
/** Water surface of a reach in the renderer's frame, undefined when its fill holds no sheet. A fed reach at full water stands at
 * the engine's level (carried by the smallest offset of the reach); a pool or a lower fill stands its freeboard under the
 * lowest lip. Never above the lowest lip of the reach. `depth`: the reach's depth, for the freeboard. */
export function reachWater(run: MoatRun, frame: RunFrame, reach: MoatReach, fill: MoatFill, depth: number): number | undefined {
  const drop = moatFreeboard(fill, depth),
    stations = reachStations(run, reach);
  if (drop === undefined || stations.length < 2) return undefined;
  let lowest = Infinity,
    shift = Infinity;
  for (const k of stations) {
    lowest = Math.min(lowest, frame.inner[k], frame.outer[k]);
    shift = Math.min(shift, frame.delta[k]);
  }
  const level = reach.supply === 'fed' && reach.level != null && Number.isFinite(reach.level) && (fill === 'full' || fill === 'ice') ? reach.level + shift : lowest - drop;
  return Math.min(level, lowest - WATER_CLEARANCE);
}
/** The wetted width of station `k` under the water surface `water`: the across interval [u0, u1] where the dug section lies
 * under it, or undefined where it is dry. */
export function wettedSpan(form: MoatForm, frame: RunFrame, run: MoatRun, k: number, water: number, minScarp = 0): [number, number] | undefined {
  const width = stationWidth(run, k),
    z = Array.from({ length: WET_SAMPLES + 1 }, (_, i) => framedSection(form, frame, k, k, 0, i / WET_SAMPLES, width, minScarp));
  const first = z.findIndex(h => h < water);
  if (first < 0) return undefined;
  let last = z.length - 1;
  while (z[last] >= water) last--;
  const cross = (i: number, j: number): number => (i + (j - i) * ((z[i] - water) / (z[i] - z[j]))) / WET_SAMPLES;
  return [first ? cross(first - 1, first) : 0, last < WET_SAMPLES ? cross(last + 1, last) : 1];
}

// ---------------------------------------------------------------- index
/** The runs of one circuit; `bank`: how far beyond the outer lip `nearOuterLip` looks (m), 0 for none. */
export interface MoatLineCircuit {
  runs: readonly MoatRun[];
  bank?: number;
}
/** Quad `k` of run `run` of circuit `circuit`, with its box. */
export interface MoatQuad {
  circuit: number;
  run: number;
  k: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface MoatLocation {
  circuit: number;
  run: number;
  k: number;
  t: number;
  u: number;
}
interface Lip {
  circuit: number;
  run: number;
  k: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Outward (away from the inner lip). */
  nx: number;
  ny: number;
}
const EPS = 1e-6;
const cross2 = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;
/** (t, u) of `p` in the bilinear quad a (t 0, u 0), b (t 1, u 0), c (t 1, u 1), d (t 0, u 1); undefined outside. */
function invBilinear(px: number, py: number, a: Point, b: Point, c: Point, d: Point): [number, number] | undefined {
  const ex = b.x - a.x,
    ey = b.y - a.y,
    fx = d.x - a.x,
    fy = d.y - a.y,
    gx = a.x - b.x + c.x - d.x,
    gy = a.y - b.y + c.y - d.y,
    hx = px - a.x,
    hy = py - a.y;
  const k2 = cross2(gx, gy, fx, fy),
    k1 = cross2(ex, ey, fx, fy) + cross2(hx, hy, gx, gy),
    k0 = cross2(hx, hy, ex, ey),
    w = k1 * k1 - 4 * k0 * k2;
  if (w < 0) return undefined;
  // The stable pair of roots: the near one stays exact when the quad is a parallelogram (k2 = 0).
  const q = -0.5 * (k1 + (k1 < 0 ? -1 : 1) * Math.sqrt(w));
  for (const u of [k0 / q, q / k2]) {
    if (!(u >= -EPS && u <= 1 + EPS)) continue;
    const dx = ex + gx * u,
      dy = ey + gy * u,
      t = Math.abs(dx) > Math.abs(dy) ? (hx - fx * u) / dx : (hy - fy * u) / dy;
    if (t >= -EPS && t <= 1 + EPS) return [Math.max(0, Math.min(1, t)), Math.max(0, Math.min(1, u))];
  }
  return undefined;
}

/** A uniform grid over the station quads of every run of a set of circuits. */
export class MoatLineIndex {
  readonly quads: MoatQuad[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly lips: Lip[] = [];
  private readonly lipCells = new Map<number, number[]>();

  constructor(
    readonly circuits: readonly MoatLineCircuit[],
    private readonly cell = 8,
  ) {
    circuits.forEach(({ runs, bank = 0 }, circuit) =>
      runs.forEach((run, ri) => {
        for (let k = 0; k < quadCount(run); k++) {
          const k1 = nextStation(run, k),
            corners = [run.inner[k], run.inner[k1], run.outer[k1], run.outer[k]],
            box = { circuit, run: ri, k, x0: Math.min(...corners.map(p => p.x)), y0: Math.min(...corners.map(p => p.y)), x1: Math.max(...corners.map(p => p.x)), y1: Math.max(...corners.map(p => p.y)) };
          this.insert(this.cells, this.quads.push(box) - 1, box.x0, box.y0, box.x1, box.y1);
          if (bank <= 0) continue;
          const a = run.outer[k],
            b = run.outer[k1],
            ox = a.x - run.inner[k].x + b.x - run.inner[k1].x,
            oy = a.y - run.inner[k].y + b.y - run.inner[k1].y,
            ol = Math.hypot(ox, oy) || 1;
          const lip = this.lips.push({ circuit, run: ri, k, ax: a.x, ay: a.y, bx: b.x, by: b.y, nx: ox / ol, ny: oy / ol }) - 1;
          this.insert(this.lipCells, lip, Math.min(a.x, b.x) - bank, Math.min(a.y, b.y) - bank, Math.max(a.x, b.x) + bank, Math.max(a.y, b.y) + bank);
        }
      }),
    );
  }
  get empty(): boolean {
    return !this.quads.length;
  }
  private key(x: number, y: number): number {
    return (Math.floor(x / this.cell) + 32768) * 65536 + (Math.floor(y / this.cell) + 32768);
  }
  private insert(cells: Map<number, number[]>, item: number, x0: number, y0: number, x1: number, y1: number): void {
    for (let y = Math.floor(y0 / this.cell); y <= Math.floor(y1 / this.cell); y++)
      for (let x = Math.floor(x0 / this.cell); x <= Math.floor(x1 / this.cell); x++) {
        const k = (x + 32768) * 65536 + (y + 32768),
          list = cells.get(k);
        if (list) list.push(item);
        else cells.set(k, [item]);
      }
  }
  /** The quad holding (x, y) and the point's place in it; undefined outside every quad. */
  locate(x: number, y: number): MoatLocation | undefined {
    for (const i of this.cells.get(this.key(x, y)) ?? []) {
      const q = this.quads[i];
      if (x < q.x0 || x > q.x1 || y < q.y0 || y > q.y1) continue;
      const run = this.circuits[q.circuit].runs[q.run],
        k1 = nextStation(run, q.k),
        at = invBilinear(x, y, run.inner[q.k], run.inner[k1], run.outer[k1], run.outer[q.k]);
      if (at) return { circuit: q.circuit, run: q.run, k: q.k, t: at[0], u: at[1] };
    }
    return undefined;
  }
  /** The nearest outer-lip segment within `reach` m of (x, y), the point lying on its outer side; only circuits indexed
   * with a `bank` of at least `reach` are searched to the full reach. */
  nearOuterLip(x: number, y: number, reach: number): { circuit: number; run: number; k: number; d: number } | undefined {
    let best: { circuit: number; run: number; k: number; d: number } | undefined;
    for (const i of this.lipCells.get(this.key(x, y)) ?? []) {
      const e = this.lips[i],
        dx = e.bx - e.ax,
        dy = e.by - e.ay,
        l = dx * dx + dy * dy,
        t = l ? Math.max(0, Math.min(1, ((x - e.ax) * dx + (y - e.ay) * dy) / l)) : 0,
        px = x - (e.ax + t * dx),
        py = y - (e.ay + t * dy),
        d = Math.hypot(px, py);
      // Beyond the lip and facing away from the ditch (not past the end of a run).
      if (d > reach || d < EPS || px * e.nx + py * e.ny < 0.5 * d || (best && best.d <= d)) continue;
      best = { circuit: e.circuit, run: e.run, k: e.k, d };
    }
    return best;
  }
}

// ---------------------------------------------------------------- 2D plan
/** What one display level of a moat holds (cityWalls.ts shows `far` alone at the far level, `mid` from the standard views in,
 * `detail` over `mid` close up): `far` the bed of each reach in one tint; `mid` the bed, a channel, both scarps lit or shaded
 * and the outer bank ridge; `detail` a fringe, reeds, marsh pools, lilies, garden plots and the hachures of the engraved plans. */
export type MoatLevel = 'far' | 'mid' | 'detail';
/** Light of the plan shadows: they fall to the south-east (cityWalls shadowShift). */
const LIGHT = { x: 0.78, y: 0.62 };
/** Widest share of the local width a scarp strip takes. */
const SCARP_SHARE = 0.3;
/** Quads of the facing low-pass on each side, and the shortest group of one facing class (a shorter one joins a neighbour). */
const FACING_HALF_WINDOW = 2,
  MIN_FACING_QUADS = 3;
/** Spacing (m) of the hachures along a lip at the closest level; every other one (`hatch`) shows at the near level. */
const HATCH_STEP = 3;
/** Stroke widths (m) of the hachures: `hatch` (near level and closer), `hatchFine` (closest level only). */
const HATCH_WIDTH = { hatch: 0.35, hatchFine: 0.25 } as const;
/** A scarp shorter than this (m: a revetted face) takes no hachure. */
const HATCH_MIN = 0.3;
const PART_ORDER = new Map(MOAT_PARTS.map((p, i) => [p, i]));

const hash = (x: number, y: number, k = 0): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};
/** The point at across position `u` of station `k` (0 on the inner lip, 1 on the outer lip, beyond 1 outside the counterscarp). */
const across = (run: MoatRun, k: number, u: number): Point => lerpPoint(run.inner[k], run.outer[k], u);
/** A small irregular heptagon round `c`, `stretch` times longer along the unit vector `along`. */
const blob = (c: Point, r: number, along: Point, seed: number, stretch = 1): Shape => ({
  outer: Array.from({ length: 7 }, (_, i) => {
    const a = (i * 2 * Math.PI) / 7,
      j = 0.7 + 0.6 * hash(c.x, c.y, seed + i),
      x = Math.cos(a) * r * stretch * j,
      y = Math.sin(a) * r * j;
    return { x: c.x + along.x * x - along.y * y, y: c.y + along.y * x + along.x * y };
  }),
  holes: [],
});

/** Per station: width (m), and the scarp and the verge as shares of the width. */
interface RunMetrics {
  width: number[];
  scarp: number[];
  verge: number[];
}
function runMetrics(run: MoatRun, form: MoatForm, depth: number): RunMetrics {
  const m: RunMetrics = { width: [], scarp: [], verge: [] };
  for (let k = 0; k < stationCount(run); k++) {
    const w = Math.max(0.5, stationWidth(run, k)),
      d = stationDepth(run, k, depth);
    m.width.push(w);
    m.scarp.push(Math.min(moatScarp(form, d, w), SCARP_SHARE * w) / w);
    m.verge.push(Math.max(0.6, Math.min(2.5, 0.12 * w)) / w);
  }
  return m;
}
/** The band over stations `s` between across positions `u0(k)` and `u1(k)`: a ring with a hole when `s` walks the whole closed run. */
function band(run: MoatRun, s: readonly number[], u0: (k: number) => number, u1: (k: number) => number): Shape {
  const a = s.map(k => across(run, k, u0(k))),
    b = s.map(k => across(run, k, u1(k)));
  if (isRing(run, s)) {
    a.pop();
    b.pop();
    const [outer, hole] = Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? [a, b] : [b, a];
    return { outer: oriented(outer, true), holes: [oriented(hole, false)] };
  }
  // One winding for every band: the plans fill many in one path (nonzero).
  return { outer: oriented([...a, ...b.reverse()], true), holes: [] };
}
/** The class of the scarp of each quad on `side` (0: under the curtain, 1: the counterscarp) by its facing to the plan light,
 * low-passed along the run: `shade` when it faces away from the light, `lit` towards it, `bank` side on. */
function facingClasses(run: MoatRun, side: 0 | 1): MoatPart[] {
  const q = quadCount(run),
    raw = Array.from({ length: q }, (_, k) => {
      const k1 = nextStation(run, k),
        dx = run.outer[k].x + run.outer[k1].x - run.inner[k].x - run.inner[k1].x,
        dy = run.outer[k].y + run.outer[k1].y - run.inner[k].y - run.inner[k1].y;
      // A scarp faces into the ditch, from its lip towards the other one.
      return ((side ? -1 : 1) * (dx * LIGHT.x + dy * LIGHT.y)) / (Math.hypot(dx, dy) || 1);
    });
  return raw.map((_, k) => {
    let sum = 0,
      count = 0;
    for (let j = k - FACING_HALF_WINDOW; j <= k + FACING_HALF_WINDOW; j++) {
      const i = run.closed ? ((j % q) + q) % q : j;
      if (i < 0 || i >= q) continue;
      sum += raw[i];
      count++;
    }
    const f = sum / count;
    return f > 0.25 ? 'shade' : f < -0.25 ? 'lit' : 'bank';
  });
}
/** Quads `from..from + count` (wrapping round a closed run) of one class. */
interface FacingGroup {
  part: MoatPart;
  from: number;
  count: number;
}
/** The quads of one class in walking order, slivers merged into a neighbour; a closed run's groups wrap round its joint. */
function facingGroups(classes: readonly MoatPart[], closed: boolean): FacingGroup[] {
  const q = classes.length;
  let start = 0;
  if (closed) {
    start = classes.findIndex((c, k) => c !== classes[(k + q - 1) % q]);
    if (start < 0) return q ? [{ part: classes[0], from: 0, count: q }] : [];
  }
  const groups: FacingGroup[] = [];
  for (let i = 0; i < q; i++) {
    const k = (start + i) % q,
      last = groups[groups.length - 1];
    if (last?.part === classes[k]) last.count++;
    else groups.push({ part: classes[k], from: k, count: 1 });
  }
  for (let i = 0; i < groups.length && groups.length > 1; ) {
    if (groups[i].count >= MIN_FACING_QUADS) {
      i++;
      continue;
    }
    const [sliver] = groups.splice(i, 1);
    if (i > 0) groups[i - 1].count += sliver.count;
    else {
      groups[0].from = sliver.from;
      groups[0].count += sliver.count;
    }
    // The two groups the sliver parted may now be one.
    if (i > 0 && i < groups.length && groups[i - 1].part === groups[i].part) groups[i - 1].count += groups.splice(i, 1)[0].count;
    i = Math.max(0, i - 1);
  }
  if (closed && groups.length > 1 && groups[0].part === groups[groups.length - 1].part) {
    const last = groups.pop()!;
    groups[0].from = last.from;
    groups[0].count += last.count;
  }
  return groups;
}
type AddPart = (part: MoatPart, shape: Shape) => void;
/** Both scarps of a run, each as long strips of one facing class, and the outer bank ridge of a form that throws one up. */
function runBanks(run: MoatRun, m: RunMetrics, form: MoatForm, add: AddPart): void {
  const n = stationCount(run);
  for (const side of [0, 1] as const)
    for (const g of facingGroups(facingClasses(run, side), !!run.closed)) {
      const s = Array.from({ length: g.count + 1 }, (_, i) => (g.from + i) % n);
      add(g.part, side ? band(run, s, k => 1 - m.scarp[k], () => 1) : band(run, s, () => 0, k => m.scarp[k]));
      if (!side || !form.bankM || g.part === 'bank') continue;
      // The outer bank: its inner slope faces the ditch like the counterscarp, its outer slope the country.
      const bank = form.bankM[0],
        crest = (k: number): number => 1 + bank / 2 / m.width[k];
      add(g.part === 'shade' ? 'ridgeShade' : 'ridgeLit', band(run, s, () => 1, crest));
      add(g.part === 'shade' ? 'ridgeLit' : 'ridgeShade', band(run, s, crest, k => 1 + bank / m.width[k]));
    }
}
/** A low-water channel along the middle of a reach, winding gently by arc length. */
function reachChannel(run: MoatRun, m: RunMetrics, s: readonly number[], arc: readonly number[], phase: number): Shape {
  const n = stationCount(run),
    mean = m.width.reduce((a, w) => a + w, 0) / Math.max(1, n),
    length = arc[arc.length - 1] ?? 0,
    wave0 = Math.max(40, 6 * mean),
    // A whole number of bends round a ring, so the channel meets itself at the joint.
    wave = run.closed && length > 0 ? length / Math.max(1, Math.round(length / wave0)) : wave0;
  const edge = (k: number, sign: number): number => {
    const hw = Math.min(Math.max(0.8, 0.11 * m.width[k]) / m.width[k], Math.max(0.03, 0.48 - m.scarp[k])),
      amp = Math.max(0, Math.min(0.12, 0.5 - m.scarp[k] - m.verge[k] - hw));
    return 0.5 + amp * Math.sin((2 * Math.PI * arc[k]) / wave + phase) + sign * hw;
  };
  return band(run, s, k => edge(k, -1), k => edge(k, 1));
}
/** The near-view detail of a reach: a ragged fringe at the foot of both scarps, sparse reed clumps on the verge, lilies in open
 * water (`wet`: a fed or pool reach), kitchen plots across a dry bed, and two or three pools along the middle. */
function reachDetail(run: MoatRun, m: RunMetrics, s: readonly number[], wet: boolean, add: AddPart): void {
  const rag = (k: number, side: number): number => m.verge[k] * (0.35 + 1.1 * hash(run.inner[k].x, run.inner[k].y, side));
  add('fringe', band(run, s, k => m.scarp[k], k => Math.min(0.5, m.scarp[k] + rag(k, 0))));
  add('fringe', band(run, s, k => Math.max(0.5, 1 - m.scarp[k] - rag(k, 1)), k => 1 - m.scarp[k]));
  const quad = (i: number): { k: number; w: number; length: number; along: Point; at: (t: number, u: number) => Point } => {
    const k = s[i],
      k1 = s[i + 1],
      at = (t: number, u: number): Point => lerpPoint(across(run, k, u), across(run, k1, u), t),
      a = at(0, 0.5),
      b = at(1, 0.5),
      length = dist(a, b) || 1;
    return { k, w: (m.width[k] + m.width[k1]) / 2, length, along: { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, at };
  };
  let plot = 0;
  for (let i = 0; i + 1 < s.length; i++) {
    const { k, w, length, along, at } = quad(i),
      scarp = m.scarp[k],
      verge = m.verge[k];
    for (const side of [0, 1]) {
      const h = hash(run.inner[k].x + side, run.inner[k].y - side, 3),
        on = (u: number): number => (side ? 1 - u : u);
      if (h < 0.3) add('reed', blob(at(0.2 + 2 * h, on(scarp + verge * (0.3 + h))), Math.min(0.2 * w, 0.6 + 2 * h), along, k + side, 1.6));
      // Plots from each bank to a path along the middle: two beds in three, a balk between them.
      const p0 = scarp + 0.4 / w,
        p1 = 0.5 - 0.9 / w;
      if (wet || p1 - p0 <= 0.8 / w || length <= 2.5) continue;
      if (plot % 3 < 2) add(plot % 3 ? 'plotB' : 'plotA', { outer: [at(0.08, on(p0)), at(0.92, on(p0)), at(0.92, on(p1)), at(0.08, on(p1))], holes: [] });
      plot++;
    }
    const free = 1 - 2 * (scarp + verge),
      h = hash(run.outer[k].x, run.outer[k].y, 5);
    if (wet && free * w > 3 && h > 0.3 && h < 0.5) add('lily', blob(at(0.3 + h, 0.5 + (h - 0.4) * free), 0.5 + 0.5 * h, along, k, 1));
  }
  const quads = s.length - 1,
    pools = quads < 4 ? 1 : hash(run.outer[s[0]].x, run.outer[s[0]].y, 7) < 0.5 ? 2 : 3;
  for (let j = 0; j < pools; j++) {
    const { k, w, along, at } = quad(Math.floor(((j + 0.5) * quads) / pools));
    add('patch', blob(at(0.5, 0.5), Math.min(0.3 * w, 1 + 0.12 * w), along, k + j, 1.8));
  }
}
/** Thin hachures down both scarps of a run, every HATCH_STEP m along the lips: down the whole scarp on the shaded side, two thirds
 * of it elsewhere. A stroke never runs past the foot of its scarp (at most SCARP_SHARE of the width), so a clear bed always parts
 * the two sides. Alternate ones are `hatchFine`. */
function runHatches(run: MoatRun, m: RunMetrics, add: AddPart): void {
  for (const side of [0, 1] as const) {
    const classes = facingClasses(run, side),
      on = (u: number): number => (side ? 1 - u : u);
    let count = 0;
    for (let k = 0; k < classes.length; k++) {
      const k1 = nextStation(run, k),
        a = side ? run.outer[k] : run.inner[k],
        b = side ? run.outer[k1] : run.inner[k1],
        l = dist(a, b);
      if (l < 1e-6) continue;
      const ux = (b.x - a.x) / l,
        uy = (b.y - a.y) / l,
        w = (m.width[k] + m.width[k1]) / 2,
        stroke = Math.min(SCARP_SHARE, (classes[k] === 'shade' ? 1 : 2 / 3) * Math.min(m.scarp[k], m.scarp[k1])),
        steps = Math.max(1, Math.round(l / HATCH_STEP));
      if (stroke * w < HATCH_MIN) {
        count += steps;
        continue;
      }
      for (let j = 0; j < steps; j++, count++) {
        const part = count % 2 ? 'hatchFine' : 'hatch',
          tx = (ux * HATCH_WIDTH[part]) / 2,
          ty = (uy * HATCH_WIDTH[part]) / 2,
          t = (j + 0.5) / steps,
          p = lerpPoint(across(run, k, on(0.02)), across(run, k1, on(0.02)), t),
          r = lerpPoint(across(run, k, on(stroke)), across(run, k1, on(stroke)), t);
        add(part, {
          outer: [
            { x: p.x - tx, y: p.y - ty },
            { x: p.x + tx, y: p.y + ty },
            { x: r.x + tx, y: r.y + ty },
            { x: r.x - tx, y: r.y - ty },
          ],
          holes: [],
        });
      }
    }
  }
}
/** The plan parts of a circuit's ditch at one display level, in draw order, straight from the stations of its runs: no run, no
 * moat. A causeway crossing fills the ditch across its corridor (drawn over the bed and the banks, under the street). */
export function moatPlan(spec: MoatSpec | undefined, form: MoatForm, level: MoatLevel): MoatPartShape[] {
  const runs = spec?.runs ?? [],
    depth = spec?.depth_m || form.depthM,
    out: MoatPartShape[] = [],
    push = (part: MoatPart, kind: string, bucket: number, shape: Shape): void => {
      if (shape.outer.length >= 3) out.push({ part, kind, bucket, shape });
    };
  for (const run of runs) {
    if (!quadCount(run)) continue;
    const m = runMetrics(run, form, depth),
      arc = level === 'mid' ? runArc(run) : [],
      phase = 2 * Math.PI * hash(run.inner[0].x, run.inner[0].y);
    run.reaches.forEach((reach, ri) => {
      const s = reachStations(run, reach);
      if (s.length < 2) return;
      const { kind, bucket } = reachSupply(reach, ri),
        add: AddPart = (part, shape) => push(part, kind, bucket, shape);
      if (level === 'far') add('wash', band(run, s, () => 0, () => 1));
      else if (level === 'mid') {
        add('bed', band(run, s, () => 0, () => 1));
        add('channel', reachChannel(run, m, s, arc, phase + ri));
      } else reachDetail(run, m, s, kind !== 'dry', add);
    });
    const fixed: AddPart = (part, shape) => push(part, 'dry', 0, shape);
    if (level === 'mid') runBanks(run, m, form, fixed);
    else if (level === 'detail') runHatches(run, m, fixed);
  }
  if (out.length && level !== 'detail') for (const c of spec?.crossings ?? []) if (c.kind === 'causeway') push('causeway', 'dry', 0, crossingShape(c));
  return out.sort((a, b) => PART_ORDER.get(a.part)! - PART_ORDER.get(b.part)!);
}
