/**
 * Vector rivers for the neural bench.
 *
 * The drainage grid of `simpleHydrology` only decides where water goes. Each
 * stream (a source followed downstream through every confluence where it is
 * the larger donor) becomes one continuous polyline in metres:
 * - everywhere, the cell chain is fitted into its thalweg by an active
 *   contour (Kass, Witkin & Terzopoulos 1988): smoothing, descent to the
 *   valley bottom and alignment on the steepest descent, never above the
 *   course's water level (its filled drainage level). This removes D8
 *   staircases and 0°/45° runs at sub-cell precision;
 * - flat and gentle reaches: only the entry and exit points and their
 *   tangents are kept. The channel between them grows by the Howard &
 *   Knutson (1984) migration model, in the form used by meanderpy (Sylvester,
 *   Durkin & Covault 2019): banks move by a weighted sum of local and
 *   upstream curvature, and neck cutoffs leave oxbows. Bank erodibility varies
 *   across the floodplain (Güneralp & Rhoads 2011; Motta et al. 2012), which
 *   breaks the model's otherwise regular bend train.
 * Sinuosity falls as the gradient rises (Schumm 1963), from the target on
 * flats and filled depressions to none on reaches ten times steeper. Water
 * never climbs: along the meandering channel its level is the running minimum
 * of the valley floor level (the nearest thalweg node's), and the terrain
 * under the channel may exceed it by a bankfull depth only, which admits
 * false flats and shallow basins but no valley side. The model's nodes are
 * most of a width apart, so the channel between them is checked too, and any
 * stretch still standing above its water gives way to the thalweg. The belt
 * also stays in the stream's own drainage corridor, so a channel never wanders
 * into another river. Widths follow downstream hydraulic geometry
 * (W ∝ A^0.45); the meander wavelength, about 11 W (Leopold & Wolman 1960),
 * comes out of the model.
 *
 * Steepest descent crosses the flat surface of a filled depression in
 * straight lines, over whatever it drowns. A course crossing a depression
 * deeper than a few metres (a lake, drawn or not) follows its floor instead,
 * along the cheapest path where cost grows with height; it meanders there
 * only where the floor itself is flat; a tributary whose confluence lies on a
 * stretch its parent left that way runs down the same depression to the
 * parent's course. Standing water as drawn (sea, lakes, ground below sea
 * level) stops courses at its shore. A lake drains through its undrawn
 * shoals too: water leaving it there only to fall back into it is lake, not
 * river, and a course ending on such a shoal runs on to the drawn shore. Channels whose banks
 * touch merge; a tributary that meets its parent away from where the parent
 * now runs joins it along a curve that stays in the valley, or else along the
 * parent's former thalweg; self-intersections are cut off like meander necks.
 */
import { Rng } from '../gen/core/rng';
import type { SimpleHydrology } from './simpleHydrology';

export interface RiverSettings {
  /** Upstream area that starts a river, km². */
  riverArea: number;
  /** Gradient below which a reach meanders fully, m/km. */
  flatSlope: number;
  /** Target sinuosity of flat reaches (arc length / valley length). */
  sinuosity: number;
  /** Multiplier of the hydraulic-geometry channel width. */
  widthScale: number;
  seed: string;
}

export interface RiverLine {
  /** Interleaved x, y in metres, upstream to mouth. */
  points: number[];
  /** Upstream area at each vertex, m². */
  area: number[];
  /** Water surface at each vertex, metres: the filled drainage level of the course. */
  level: number[];
  /** How each vertex was traced: 0 smoothed course, 1 meander, 2 confluence join. */
  kind: number[];
}

export interface RiverNetwork {
  rivers: RiverLine[];
  /** Abandoned meander loops; `area` is the river's upstream area when cut off. */
  oxbows: RiverLine[];
  meanderRuns: number;
  lengthKm: number;
  meanderKm: number;
  ms: number;
}

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

/** Bankfull width in metres from upstream area in m². */
export function channelWidth(area: number, scale: number): number {
  return scale * 3 * Math.pow(area / 1e6, 0.45);
}

// Howard & Knutson weights: local curvature −1, upstream integral 2.5.
const OMEGA = -1, GAMMA = 2.5;
/** Decay length of the upstream curvature integral, in channel widths. */
const DECAY = 2.5;
/** Node spacing, in channel widths. */
const SPACING = 0.75;
/** Bank displacement per iteration for a unit dimensionless rate, in widths. */
const RATE = 0.25;
/** Neck cutoff distance, in widths. */
const CUTOFF = 1.3;
/** Reaches up to this many times the flat gradient still wander, less and less. */
const GENTLE = 10;
/** Share of the target sinuosity left at the flat gradient on gentle reaches. */
const GENTLE_SHARE = 0.35;
/**
 * Meander belt: the terrain under the channel may stand at most a bankfull
 * depth above the nearest drainage level, metres plus metres per width.
 */
const MEANDER_DEPTH = 0.5, MEANDER_DEPTH_PER_WIDTH = 0.02;
/** Height the thalweg fit may reach above the course's water level, metres. */
const CURVE_TOLERANCE = 0.3;
/**
 * Filled depressions deeper than this (m) are lakes: a course crosses them
 * along their floor, whose cost grows by one cell length per `BED_HEIGHT`
 * metres above the lowest floor on the way.
 */
const DEEP = 3, BED_HEIGHT = 5;
/**
 * Smallest oxbow drawn, in channel widths, and the least area it encloses
 * (with the chord between its ends), as a share of its length squared:
 * a half circle encloses 0.08, a hairpin almost none.
 */
const OXBOW_LENGTH = 6, OXBOW_COMPACTNESS = 0.035;
/** Most an oxbow turns along one channel width, radians: its bends are no tighter than the channel. */
const OXBOW_TURN = 1.3;
/** Meanders are simulated at least this many drainage cells wide (map generalisation). */
const MIN_WIDTH_CELLS = 0.5;

interface Stream {
  cells: number[];
  /** Cell after the last river cell: confluence, sea or lake; −1 at the map edge. */
  end: number;
  parent: number;
}

function latticeHash(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
}

/** Smooth 2D value noise in [-1, 1], one lattice cell per unit. */
function valueNoise(x: number, y: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = latticeHash(i, j, seed), b = latticeHash(i + 1, j, seed);
  const c = latticeHash(i, j + 1, seed), d = latticeHash(i + 1, j + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smoothstep = (t: number): number => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

/** Arc-length resampling with exact end points. */
function resample(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, step: number): [Float64Array, Float64Array] {
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1];
    s[i] = s[i - 1] + Math.sqrt(dx * dx + dy * dy);
  }
  const length = s[n - 1], m = Math.max(1, Math.round(length / step));
  const ox = new Float64Array(m + 1), oy = new Float64Array(m + 1);
  ox[0] = xs[0]; oy[0] = ys[0];
  let k = 0;
  for (let j = 1; j < m; j++) {
    const t = length * j / m;
    while (k < n - 2 && s[k + 1] < t) k++;
    const f = (t - s[k]) / Math.max(1e-9, s[k + 1] - s[k]);
    ox[j] = xs[k] + (xs[k + 1] - xs[k]) * f; oy[j] = ys[k] + (ys[k + 1] - ys[k]) * f;
  }
  ox[m] = xs[n - 1]; oy[m] = ys[n - 1];
  return [ox, oy];
}

/** Gaussian smoothing along a chain; symmetric windows keep the ends fixed. */
function smoothChain(xs: ArrayLike<number>, ys: ArrayLike<number>, sigma: number): [number[], number[]] {
  const n = xs.length, radius = Math.ceil(2.5 * sigma);
  const weights = Array.from({ length: radius + 1 }, (_, k) => Math.exp(-k * k / (2 * sigma * sigma)));
  const ox = Array.from(xs), oy = Array.from(ys);
  for (let i = 1; i < n - 1; i++) {
    const r = Math.min(radius, i, n - 1 - i);
    let sx = xs[i], sy = ys[i], sw = 1;
    for (let k = 1; k <= r; k++) {
      sx += weights[k] * (xs[i - k] + xs[i + k]); sy += weights[k] * (ys[i - k] + ys[i + k]); sw += 2 * weights[k];
    }
    ox[i] = sx / sw; oy[i] = sy / sw;
  }
  return [ox, oy];
}

/**
 * Centripetal Catmull–Rom curve through a polyline (Yuksel, Schaefer & Keyser
 * 2011: no cusps or self-intersections within a span), sampled every `step` metres
 * at most. The input points are kept.
 */
function spline(xs: ArrayLike<number>, ys: ArrayLike<number>, step: number): [number[], number[]] {
  const n = xs.length, ox: number[] = [xs[0]], oy: number[] = [ys[0]];
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1), i3 = Math.min(n - 1, i + 2);
    const x0 = i0 < i ? xs[i0] : 2 * xs[i] - xs[i + 1], y0 = i0 < i ? ys[i0] : 2 * ys[i] - ys[i + 1];
    const x3 = i3 > i + 1 ? xs[i3] : 2 * xs[i + 1] - xs[i], y3 = i3 > i + 1 ? ys[i3] : 2 * ys[i + 1] - ys[i];
    const x1 = xs[i], y1 = ys[i], x2 = xs[i + 1], y2 = ys[i + 1];
    const t1 = Math.sqrt(Math.hypot(x1 - x0, y1 - y0)) || 1e-6, t2 = t1 + (Math.sqrt(Math.hypot(x2 - x1, y2 - y1)) || 1e-6);
    const t3 = t2 + (Math.sqrt(Math.hypot(x3 - x2, y3 - y2)) || 1e-6);
    const m = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step);
    for (let j = 1; j < m; j++) {
      const t = t1 + (t2 - t1) * j / m;
      const ax1 = ((t1 - t) * x0 + t * x1) / t1, ay1 = ((t1 - t) * y0 + t * y1) / t1;
      const ax2 = ((t2 - t) * x1 + (t - t1) * x2) / (t2 - t1), ay2 = ((t2 - t) * y1 + (t - t1) * y2) / (t2 - t1);
      const ax3 = ((t3 - t) * x2 + (t - t2) * x3) / (t3 - t2), ay3 = ((t3 - t) * y2 + (t - t2) * y3) / (t3 - t2);
      const bx1 = ((t2 - t) * ax1 + t * ax2) / t2, by1 = ((t2 - t) * ay1 + t * ay2) / t2;
      const bx2 = ((t3 - t) * ax2 + (t - t1) * ax3) / (t3 - t1), by2 = ((t3 - t) * ay2 + (t - t1) * ay3) / (t3 - t1);
      ox.push(((t2 - t) * bx1 + (t - t1) * bx2) / (t2 - t1)); oy.push(((t2 - t) * by1 + (t - t1) * by2) / (t2 - t1));
    }
    ox.push(x2); oy.push(y2);
  }
  return [ox, oy];
}

/** Cubic Hermite curve from a to b with end tangents ta and tb (vectors in metres). */
function hermite(
  ax: number, ay: number, tax: number, tay: number, bx: number, by: number, tbx: number, tby: number, step: number,
): [number[], number[]] {
  const m = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
  const xs: number[] = [], ys: number[] = [];
  for (let j = 0; j <= m; j++) {
    const t = j / m, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    xs.push(h00 * ax + h10 * tax + h01 * bx + h11 * tbx); ys.push(h00 * ay + h10 * tay + h01 * by + h11 * tby);
  }
  return [xs, ys];
}

/**
 * Fits a course into its thalweg with an active contour (snake: Kass, Witkin &
 * Terzopoulos 1988). Nodes alternate Laplacian smoothing, which removes D8
 * staircases, with a descent along the normal to the lowest terrain within
 * reach, which keeps the course in the valley bottom at sub-cell precision,
 * and an alignment on the flow direction (down the gradient): on open slopes
 * without a thalweg, D8 runs straight at 0° or 45° whatever the slope's
 * aspect, while water follows the steepest descent. No node may stand higher than the course's water level
 * plus `tolerance` (or than where it started, when the raw chain already
 * does), nor enter standing water before node `shore`. Ends are fixed. Arrays are updated in place; `us` follows the nodes.
 */
function thalweg(
  xs: Float64Array, ys: Float64Array, limit: Float64Array, terrain: (x: number, y: number) => number,
  wet: (x: number, y: number) => boolean, shore: number, reach: number, iterations: number,
): void {
  const n = xs.length;
  if (n < 3) return;
  const nx = new Float64Array(n), ny = new Float64Array(n);
  // A node on land never moves into standing water (sea, lake, ground below
  // sea level), except from `shore` on, where the course runs into it.
  const fits = (i: number, x: number, y: number): boolean => terrain(x, y) <= limit[i] && (i >= shore || !wet(x, y) || wet(xs[i], ys[i]));
  for (let it = 0; it < iterations; it++) {
    // Smoothing: move halfway to the neighbours' midpoint, or less if that climbs.
    nx.set(xs); ny.set(ys);
    for (let i = 1; i < n - 1; i++) {
      const dx = (xs[i - 1] + xs[i + 1]) / 2 - xs[i], dy = (ys[i - 1] + ys[i + 1]) / 2 - ys[i];
      for (let f = 0.5; f > 0.06; f /= 2) {
        const px = xs[i] + dx * f, py = ys[i] + dy * f;
        if (fits(i, px, py)) { nx[i] = px; ny[i] = py; break; }
      }
    }
    xs.set(nx); ys.set(ny);
    // Descent and flow alignment alternate, except in the last quarter, which only smooths.
    if (it >= 0.75 * iterations) continue;
    if (it % 2) {
      // Each node moves towards where the flow from its upstream neighbour leads.
      for (let i = 1; i < n - 1; i++) {
        const x = xs[i - 1], y = ys[i - 1], h = reach;
        const gx = (terrain(x + h, y) - terrain(x - h, y)) / (2 * h), gy = (terrain(x, y + h) - terrain(x, y - h)) / (2 * h);
        const g = Math.sqrt(gx * gx + gy * gy);
        if (g < 0.002) continue;
        const tx = xs[i + 1] - xs[i - 1], ty = ys[i + 1] - ys[i - 1], tl = Math.sqrt(tx * tx + ty * ty) || 1;
        const fx = -gx / g, fy = -gy / g;
        if ((fx * tx + fy * ty) / tl < 0.5) continue;
        const d = Math.hypot(xs[i] - x, ys[i] - y), ox = ty / tl, oy = -tx / tl;
        const shift = Math.max(-reach / 2, Math.min(reach / 2, ((x + fx * d - xs[i]) * ox + (y + fy * d - ys[i]) * oy) / 2));
        const px = xs[i] + ox * shift, py = ys[i] + oy * shift;
        if (fits(i, px, py)) { xs[i] = px; ys[i] = py; }
      }
      continue;
    }
    for (let i = 1; i < n - 1; i++) {
      const tx = xs[i + 1] - xs[i - 1], ty = ys[i + 1] - ys[i - 1], tl = Math.sqrt(tx * tx + ty * ty) || 1;
      const ox = ty / tl, oy = -tx / tl;
      let best = terrain(xs[i], ys[i]) - 0.02, bt = 0;
      for (const t of [-1, -0.5, 0.5, 1]) {
        const x = xs[i] + ox * t * reach, y = ys[i] + oy * t * reach, z = terrain(x, y);
        if (z < best && fits(i, x, y)) { best = z; bt = t; }
      }
      if (bt) { xs[i] += ox * bt * reach; ys[i] += oy * bt * reach; }
    }
  }
}

export interface MeanderResult {
  xs: number[]; ys: number[];
  oxbows: [number[], number[]][];
  iterations: number;
  /** False when no meandered channel fitted: the axis came back unchanged, or with a long stretch of it at the end. */
  meandered: boolean;
}

/**
 * Grows meanders on a channel from the first to the last point of its axis
 * (both kept) by Howard–Knutson bank migration. `allowed` bounds the belt; it
 * receives the water level of the channel just upstream of the node: the
 * running minimum, along the channel, of the valley floor level `valleyAt`.
 * Water never rises, so a loop swinging back up the valley must stay as low
 * as the water it has already reached. `targetAt` gives the local target
 * sinuosity, which also sets the global stopping length (mean target × axis length).
 *
 * Bends migrate downstream, so a fixed exit would pile them into hooks. The
 * channel is therefore simulated past its exit along the exit tangent; the
 * result is cut where it crosses the normal through the exit, nearest the
 * exit, and eased onto it.
 */
export function meander(
  axisX: number[], axisY: number[], width: number, rng: Rng, valleyAt: (x: number, y: number) => number,
  allowed: (x: number, y: number, water: number) => boolean, targetAt: (x: number, y: number) => number, resolution: number,
  maxIterations = 800,
): MeanderResult {
  const ds = SPACING * width;
  const [rx, ry] = resample(axisX, axisY, axisX.length, ds);
  const real = rx.length, bx = rx[real - 1], by = ry[real - 1];
  const axisLength = (real - 1) * ds;
  let target = 0;
  for (let i = 0; i < real; i++) target += targetAt(rx[i], ry[i]);
  target /= real;
  // Exit tangent over the last few widths of the axis, and the virtual extension.
  const back = Math.max(0, real - 1 - Math.ceil(4 * width / ds));
  const tangent = Math.hypot(bx - rx[back], by - ry[back]) || 1;
  const ex = (bx - rx[back]) / tangent, ey = (by - ry[back]) / tangent;
  const beyond = (x: number, y: number): number => (x - bx) * ex + (y - by) * ey;
  // The virtual extension is a box past the exit, not the whole half-plane:
  // a curved axis may wander behind the exit normal upstream.
  const lateral = (x: number, y: number): number => Math.abs((x - bx) * ey - (y - by) * ex);
  const extended = (x: number, y: number): boolean => {
    const f = beyond(x, y);
    return f > 2 * width && f < 40 * width && lateral(x, y) < 15 * width;
  };
  const extension = Math.ceil(30 * width / ds);
  let n = real + extension;
  let xs: Float64Array = new Float64Array(n), ys: Float64Array = new Float64Array(n);
  xs.set(rx); ys.set(ry);
  for (let k = 1; k <= extension; k++) { xs[real - 1 + k] = bx + ex * k * ds; ys[real - 1 + k] = by + ey * k * ds; }
  // Water level just upstream of each node. Well past the exit the channel is
  // virtual and free; a loop poking just past the exit normal must still fit.
  let water = waterProfile(xs, ys, n, valleyAt);
  const free = (x: number, y: number, i: number): boolean => extended(x, y) || allowed(x, y, water[Math.max(0, i - 1)]);
  // Nodes are most of a width apart, so the straight channel between two
  // nodes is checked too, every `resolution` metres: it may not cut a spur.
  const freeSpan = (ax: number, ay: number, bx2: number, by2: number, i: number): boolean => {
    const m = Math.ceil(Math.hypot(bx2 - ax, by2 - ay) / resolution);
    for (let k = 1; k < m; k++) if (!free(ax + (bx2 - ax) * k / m, ay + (by2 - ay) * k / m, i)) return false;
    return true;
  };
  const allowedSpan = (ax: number, ay: number, bx2: number, by2: number, level: number): boolean => {
    const m = Math.ceil(Math.hypot(bx2 - ax, by2 - ay) / resolution);
    for (let k = 1; k < m; k++) if (!allowed(ax + (bx2 - ax) * k / m, ay + (by2 - ay) * k / m, level)) return false;
    return true;
  };
  // A node may move to (x, y) when it and the channel to its neighbours stay free.
  const fits = (x: number, y: number, i: number, x0: number, y0: number, x1: number, y1: number): boolean =>
    free(x, y, i) && freeSpan(x0, y0, x, y, i) && freeSpan(x, y, x1, y1, i);
  const localTarget = (x: number, y: number): number => beyond(x, y) > 0 ? targetAt(bx, by) : targetAt(x, y);

  const oxbows: [number[], number[]][] = [];
  const entryTaper = 5 * width, exitTaper = 12 * width;
  // Bends stop growing where the channel is already more sinuous than its
  // local target over about a wavelength, so the belt develops evenly instead
  // of in a few giant loops. The limit wanders: tight loops in places, gentle bends elsewhere.
  const reach = Math.ceil(8 * width / ds);
  const swing = [0, 1].map(() => ({ k: 2 * Math.PI / (width * rng.range(30, 70)), phase: rng.range(0, 2 * Math.PI) }));
  const fieldSeed = rng.int(0, 1 << 30), fieldScale = 1 / (12 * width);
  const erodibility = (x: number, y: number): number => Math.exp(0.8 * (
    valueNoise(x * fieldScale, y * fieldScale, fieldSeed) + 0.5 * valueNoise(x * fieldScale * 2.7, y * fieldScale * 2.7, fieldSeed + 1)));
  // Curvature of the channel upstream of the run: it oscillates, so bends keep
  // entering the run while the model carries the older ones downstream.
  const inflowPeriod = rng.range(150, 300);
  let inflowPhase = rng.range(0, 2 * Math.PI);

  // Seed: a broad valley wander and a few bends near the preferred wavelength,
  // scaled by the local target and tapered at the ends.
  {
    const waves = [
      ...Array.from({ length: 2 }, () => ({ k: 2 * Math.PI / (width * rng.range(40, 90)), phase: rng.range(0, 2 * Math.PI), amp: width * rng.range(2, 5) })),
      ...Array.from({ length: 4 }, () => ({ k: 2 * Math.PI / (width * rng.range(8, 16)), phase: rng.range(0, 2 * Math.PI), amp: width * rng.range(0.4, 0.9) })),
    ];
    const length = (real - 1) * ds, nx = xs.slice(), ny = ys.slice();
    for (let i = 1; i < real - 1; i++) {
      const s = i * ds, strength = Math.min(1, (localTarget(xs[i], ys[i]) - 1) / 0.4);
      const taper = smoothstep(Math.min(s, length - s) / (8 * width)) * strength;
      let offset = 0;
      for (const w of waves) offset += w.amp * Math.sin(w.k * s + w.phase);
      const tx = xs[i + 1] - xs[i - 1], ty = ys[i + 1] - ys[i - 1], tl = Math.hypot(tx, ty) || 1;
      const px = xs[i] + offset * taper * ty / tl, py = ys[i] - offset * taper * tx / tl;
      if (fits(px, py, i, nx[i - 1], ny[i - 1], xs[i + 1], ys[i + 1])) { nx[i] = px; ny[i] = py; }
    }
    xs = nx; ys = ny;
  }

  const decay = Math.exp(-ds / (DECAY * width)), ghost = 1 / (1 - decay);
  const maxStep = 0.2 * ds;
  const minGap = Math.ceil(6 * width / ds), cutoff = CUTOFF * width;
  const entryMargin = Math.ceil(entryTaper / ds), exitMargin = Math.ceil(exitTaper / ds);
  let field = new Float64Array(0), saturation = new Float64Array(0);
  let iterations = 0, stalled = 0;
  for (; iterations < maxIterations; iterations++) {
    if (n < 5) break;
    if (iterations % 8 === 0) {
      // Length of the real channel, up to its first passage beyond the exit.
      let k = 0;
      while (k < n - 1 && beyond(xs[k], ys[k]) < 0) k++;
      if (k * ds >= target * axisLength) break;
      // A belt held by its floodplain stops lengthening: stop once it stalls.
      if (iterations % 32 === 0) {
        if (iterations && k * ds < stalled * 1.005) break;
        stalled = k * ds;
      }
    }
    water = waterProfile(xs, ys, n, valleyAt);
    // Floodplain properties change slowly: banks move a fraction of a node per step.
    if (iterations % 4 === 0 || field.length !== n) {
      field = new Float64Array(n); saturation = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const s = i * ds;
        field[i] = erodibility(xs[i], ys[i]);
        const wander = 1 + 0.3 * (Math.sin(swing[0].k * s + swing[0].phase) + Math.sin(swing[1].k * s + swing[1].phase));
        saturation[i] = 1 + 1.5 * (localTarget(xs[i], ys[i]) - 1) * wander;
      }
    }
    const nx = xs.slice(), ny = ys.slice(), length = (n - 1) * ds;
    inflowPhase += 2 * Math.PI / inflowPeriod * rng.range(0.5, 1.5);
    let sum = 0.3 * Math.sin(inflowPhase) * ghost, norm = ghost, moved = 0;
    for (let i = 0; i < n; i++) {
      // Signed curvature (positive to the left) as a dimensionless rate.
      let curvature = 0;
      if (i > 0 && i < n - 1) {
        const dx = (xs[i + 1] - xs[i - 1]) / 2, dy = (ys[i + 1] - ys[i - 1]) / 2;
        const ddx = xs[i + 1] - 2 * xs[i] + xs[i - 1], ddy = ys[i + 1] - 2 * ys[i] + ys[i - 1];
        const d2 = dx * dx + dy * dy;
        curvature = width * (dx * ddy - dy * ddx) / (d2 * Math.sqrt(d2) || 1);
      }
      // Upstream-weighted curvature integral, exponential kernel by recursion.
      sum = curvature + decay * sum; norm = 1 + decay * norm;
      if (i === 0 || i === n - 1) continue;
      const limit = saturation[i];
      if (limit - 1 < 1e-3) continue;
      const s = i * ds, taper = smoothstep(s / entryTaper) * smoothstep((length - s) / exitTaper) ** 2;
      const j0 = Math.max(0, i - reach), j1 = Math.min(n - 1, i + reach);
      const cx = xs[j1] - xs[j0], cy = ys[j1] - ys[j0];
      const local = (j1 - j0) * ds / Math.max(1e-6, Math.sqrt(cx * cx + cy * cy));
      const damping = Math.max(0, Math.min(1, (limit - local) / (limit - 1)));
      const rate = (OMEGA * curvature + GAMMA * sum / norm) * taper * damping;
      if (rate === 0) continue;
      const step = Math.max(-maxStep, Math.min(maxStep, rate * RATE * width * field[i]));
      const tx = xs[i + 1] - xs[i - 1], ty = ys[i + 1] - ys[i - 1], tl = Math.sqrt(tx * tx + ty * ty) || 1;
      // Positive rates move towards the right of the flow: the outer bank of a left bend.
      // A move blocked by the floodplain edge tries shorter steps, so the bank slides along it.
      for (let f = 1; f > 0.2; f /= 2) {
        const px = xs[i] + f * step * ty / tl, py = ys[i] - f * step * tx / tl;
        if (fits(px, py, i, nx[i - 1], ny[i - 1], xs[i + 1], ys[i + 1])) { nx[i] = px; ny[i] = py; moved++; break; }
      }
    }
    if (!moved) break;
    [xs, ys] = resample(nx, ny, n, ds); n = xs.length;
    // Neck cutoff: the first pair of distant nodes closer than the cutoff distance.
    if (iterations % 4 === 0) {
      const cut = findCutoff(xs, ys, cutoff, minGap, entryMargin, exitMargin);
      // The neck closes only where the new short course stays on the floodplain.
      if (cut && freeSpan(xs[cut[0]], ys[cut[0]], xs[cut[1]], ys[cut[1]], cut[0])) {
        const [i, j] = cut;
        // The abandoned loop, detached from the new channel by a width and a half at each end.
        const trim = Math.ceil(1.5 * width / ds);
        if ((j - i) * ds >= 10 * width && beyond(xs[i], ys[i]) < 0 && beyond(xs[j], ys[j]) < 0) {
          oxbows.push([Array.from(xs.subarray(i + trim, j + 1 - trim)), Array.from(ys.subarray(i + trim, j + 1 - trim))]);
        }
        const kx = new Float64Array(n - (j - i - 1)), ky = new Float64Array(n - (j - i - 1));
        kx.set(xs.subarray(0, i + 1)); kx.set(xs.subarray(j), i + 1);
        ky.set(ys.subarray(0, i + 1)); ky.set(ys.subarray(j), i + 1);
        [xs, ys] = resample(kx, ky, kx.length, ds); n = xs.length;
      }
    }
  }
  // Remove the node-scale roughness left by the explicit scheme, where the floodplain allows.
  const [sx, sy] = smoothChain(xs, ys, 1);
  const fx = Array.from(xs), fy = Array.from(ys);
  water = waterProfile(xs, ys, n, valleyAt);
  for (let k = 1; k < fx.length - 1; k++) if (fits(sx[k], sy[k], k, fx[k - 1], fy[k - 1], fx[k + 1], fy[k + 1])) { fx[k] = sx[k]; fy[k] = sy[k]; }

  // Cut where the channel crosses the exit normal, then ease onto the exit.
  // Candidates near the exit and heading along its tangent come first; the
  // first whose eased tail stays on the floodplain wins.
  const candidates: [number, number, number, number][] = [];
  for (let k = 0; k + 1 < fx.length; k++) {
    const f0 = beyond(fx[k], fy[k]), f1 = beyond(fx[k + 1], fy[k + 1]);
    if (f0 >= 0 || f1 < 0) continue;
    const t = f0 / (f0 - f1), px = fx[k] + (fx[k + 1] - fx[k]) * t, py = fy[k] + (fy[k + 1] - fy[k]) * t;
    if (lateral(px, py) > 15 * width) continue;
    const heading = ((fx[k + 1] - fx[k]) * ex + (fy[k + 1] - fy[k]) * ey) / (Math.hypot(fx[k + 1] - fx[k], fy[k + 1] - fy[k]) || 1);
    candidates.push([Math.hypot(px - bx, py - by) + (1 - heading) * 4 * width, k, px, py]);
  }
  candidates.sort((a, b) => a[0] - b[0]);
  const ease = 10 * width;
  const eased = (k: number, cx: number, cy: number): [number[], number[]] => {
    const ox = bx - cx, oy = by - cy, ex2 = fx.slice(0, k + 1), ey2 = fy.slice(0, k + 1);
    for (let j = k, arc = Math.hypot(cx - fx[k], cy - fy[k]); j > 0 && arc < ease; j--) {
      const w = smoothstep(1 - arc / ease);
      ex2[j] += ox * w; ey2[j] += oy * w;
      arc += Math.hypot(fx[j] - fx[j - 1], fy[j] - fy[j - 1]);
    }
    ex2.push(bx); ey2.push(by);
    return [ex2, ey2];
  };
  // The kept channel must fit where it was free (loops poking into the
  // virtual extension before the cut) and where it was eased.
  let result: [number[], number[]] | undefined;
  for (const [, k, cx, cy] of candidates.slice(0, 8)) {
    const [tx, ty] = eased(k, cx, cy);
    let ok = true;
    const tail = waterProfile(tx, ty, tx.length, valleyAt), easedFrom = k - Math.ceil(ease / ds) - 1;
    for (let j = 1; j < tx.length - 1 && ok; j++) {
      if (j < easedFrom && !extended(fx[j], fy[j])) continue;
      ok = allowed(tx[j], ty[j], tail[j - 1]) && allowedSpan(tx[j], ty[j], tx[j + 1], ty[j + 1], tail[j]);
    }
    if (ok) { result = [tx, ty]; break; }
  }
  // No cut fits (the eased tail would leave the floodplain): rejoin the axis
  // where the channel comes back onto it, as close to the exit as possible,
  // and follow the axis from there.
  let rejoined = -1;
  if (!result) {
    const near = 0.5 * width, blend = 3 * width;
    // Axis nodes binned by `near`, and the channel's water level along it.
    const bins = new Map<number, number[]>();
    for (let j = 1; j < real - 1; j++) {
      const key = Math.floor(rx[j] / near) * 1048576 + Math.floor(ry[j] / near), bin = bins.get(key);
      if (bin) bin.push(j); else bins.set(key, [j]);
    }
    const before = waterProfile(fx, fy, fx.length, valleyAt);
    for (let k = fx.length - 2; k > 0 && !result; k--) {
      if (beyond(fx[k], fy[k]) >= 0) continue;
      let best = near * near, ja = -1;
      const gx = Math.floor(fx[k] / near), gy = Math.floor(fy[k] / near);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        for (const j of bins.get((gx + ox) * 1048576 + gy + oy) ?? []) {
          const d = (rx[j] - fx[k]) ** 2 + (ry[j] - fy[k]) ** 2;
          if (d < best) { best = d; ja = j; }
        }
      }
      if (ja < 0) continue;
      // Same heading as the axis there, or the join would turn back.
      const hx = fx[k + 1] - fx[k - 1], hy = fy[k + 1] - fy[k - 1], ax = rx[ja + 1] - rx[ja - 1], ay = ry[ja + 1] - ry[ja - 1];
      if (hx * ax + hy * ay < 0.7 * Math.hypot(hx, hy) * Math.hypot(ax, ay)) continue;
      // The last few widths of channel shift onto the axis node.
      const ox = rx[ja] - fx[k], oy = ry[ja] - fy[k];
      let from = k;
      for (let arc = 0; from > 1 && arc < blend; from--) arc += Math.hypot(fx[from] - fx[from - 1], fy[from] - fy[from - 1]);
      const bxs = fx.slice(from, k + 1), bys = fy.slice(from, k + 1);
      for (let j = k, arc = 0; j >= from; j--) {
        const w = smoothstep(1 - arc / blend);
        bxs[j - from] += ox * w; bys[j - from] += oy * w;
        if (j > from) arc += Math.hypot(fx[j] - fx[j - 1], fy[j] - fy[j - 1]);
      }
      let level = before[from - 1], ok = true;
      for (let j = 0; j < bxs.length - 1 && ok; j++) {
        const previous = level;
        level = Math.min(level, valleyAt(bxs[j], bys[j]));
        ok = allowed(bxs[j], bys[j], previous) && allowedSpan(bxs[j], bys[j], bxs[j + 1], bys[j + 1], level);
      }
      if (!ok) continue;
      const tx = fx.slice(0, from), ty = fy.slice(0, from);
      tx.push(...bxs); ty.push(...bys);
      // The axis itself, not its resampling, whose chords cut the valley's bends.
      let onAxis = 0, gap = Infinity;
      for (let j = 0; j < axisX.length; j++) {
        const d = (axisX[j] - rx[ja]) ** 2 + (axisY[j] - ry[ja]) ** 2;
        if (d < gap) { gap = d; onAxis = j; }
      }
      for (let j = onAxis + 1; j < axisX.length; j++) { tx.push(axisX[j]); ty.push(axisY[j]); }
      result = [tx, ty]; rejoined = ja;
    }
  }
  // Nothing fits: keep the axis, which does.
  if (!result) return { xs: axisX.slice(), ys: axisY.slice(), oxbows: [], iterations, meandered: false };
  // A long stretch of axis left at the end does not count as meandered.
  const meandered = rejoined < 0 || (real - 1 - rejoined) * ds <= Math.max(20 * width, 0.25 * axisLength);
  return { xs: result[0], ys: result[1], oxbows, iterations, meandered };
}

/**
 * Valley floor level around a stretch of thalweg nodes `from..to`: each cell
 * of the stretch's box, widened by 16 cells, takes the level of the thalweg
 * cell it is nearest to (8-connected fronts). Outside the box: `outside`.
 */
function valleyGrid(
  xs: Float64Array, ys: Float64Array, us: number[], from: number, to: number, levelAt: (u: number) => number,
  cell: number, n: number, outside: number,
): (x: number, y: number) => number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = from; k <= to; k++) {
    const gx = Math.floor(xs[k] / cell), gy = Math.floor(ys[k] / cell);
    x0 = Math.min(x0, gx); y0 = Math.min(y0, gy); x1 = Math.max(x1, gx); y1 = Math.max(y1, gy);
  }
  x0 = Math.max(0, x0 - 16); y0 = Math.max(0, y0 - 16); x1 = Math.min(n - 1, x1 + 16); y1 = Math.min(n - 1, y1 + 16);
  const w = x1 - x0 + 1, hgt = y1 - y0 + 1, level = new Float64Array(w * hgt).fill(NaN);
  const queue = new Int32Array(w * hgt);
  let tail = 0;
  for (let k = from; k <= to; k++) {
    const c = (Math.floor(ys[k] / cell) - y0) * w + Math.floor(xs[k] / cell) - x0, z = levelAt(us[k]);
    if (Number.isNaN(level[c])) { level[c] = z; queue[tail++] = c; } else level[c] = Math.min(level[c], z);
  }
  for (let head = 0; head < tail; head++) {
    const c = queue[head], x = c % w, y = (c - x) / w;
    for (let k = 0; k < 8; k++) {
      const xx = x + DX[k], yy = y + DY[k];
      if (xx < 0 || yy < 0 || xx >= w || yy >= hgt) continue;
      const nb = yy * w + xx;
      if (Number.isNaN(level[nb])) { level[nb] = level[c]; queue[tail++] = nb; }
    }
  }
  return (x, y) => {
    const gx = Math.floor(x / cell) - x0, gy = Math.floor(y / cell) - y0;
    return gx < 0 || gy < 0 || gx >= w || gy >= hgt ? outside : level[gy * w + gx];
  };
}

/** Running minimum of the valley floor level along a channel: its water level. */
function waterProfile(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, valleyAt: (x: number, y: number) => number): Float64Array {
  const water = new Float64Array(n);
  let level = Infinity;
  for (let i = 0; i < n; i++) water[i] = level = Math.min(level, valleyAt(xs[i], ys[i]));
  return water;
}

/** First neck cutoff, ignoring loops that reach the end margins. */
function findCutoff(xs: Float64Array, ys: Float64Array, distance: number, minGap: number, entry: number, exit: number): [number, number] | undefined {
  // Open-addressing grid hash: bins of `distance`, nodes chained through `next`.
  const n = xs.length, size = 1 << Math.ceil(Math.log2(2 * n + 2)), mask = size - 1;
  const binX = new Int32Array(size), binY = new Int32Array(size), heads = new Int32Array(size).fill(-1), next = new Int32Array(n);
  const slot = (gx: number, gy: number): number => {
    let h = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) & mask;
    while (heads[h] >= 0 && (binX[h] !== gx || binY[h] !== gy)) h = (h + 1) & mask;
    return h;
  };
  for (let i = n - 1; i >= 0; i--) {
    const gx = Math.floor(xs[i] / distance), gy = Math.floor(ys[i] / distance), h = slot(gx, gy);
    binX[h] = gx; binY[h] = gy; next[i] = heads[h]; heads[h] = i;
  }
  const d2 = distance * distance;
  for (let i = entry; i < n - exit; i++) {
    const gx = Math.floor(xs[i] / distance), gy = Math.floor(ys[i] / distance);
    let best = -1;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (let j = heads[slot(gx + ox, gy + oy)]; j >= 0; j = next[j]) {
        if (j <= i + minGap || j >= n - exit || j <= best) continue;
        const dx = xs[j] - xs[i], dy = ys[j] - ys[i];
        if (dx * dx + dy * dy < d2) best = j;
      }
    }
    if (best >= 0) return [i, best];
  }
  return undefined;
}

/**
 * Rounds off sharp turns (over 40° between consecutive segments): the vertex
 * moves towards its neighbours' midpoint, as far as the terrain lets it stay
 * below its water level plus `tolerance`, and never higher than it stood;
 * a turn over 75° may rise 0.7 m more. Ends stay fixed.
 */
function relax(
  points: number[], level: number[], terrain: (x: number, y: number) => number, wet: (x: number, y: number) => boolean, tolerance: number,
): void {
  const cos40 = Math.cos(40 * Math.PI / 180), cos75 = Math.cos(75 * Math.PI / 180);
  for (let pass = 0; pass < 12; pass++) {
    let moved = 0;
    for (let i = 1; 2 * i + 3 < points.length; i++) {
      const ax = points[2 * i] - points[2 * i - 2], ay = points[2 * i + 1] - points[2 * i - 1];
      const bx = points[2 * i + 2] - points[2 * i], by = points[2 * i + 3] - points[2 * i + 1];
      const la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
      const turn = la && lb ? (ax * bx + ay * by) / (la * lb) : 1;
      if (turn >= cos40) continue;
      const x = points[2 * i], y = points[2 * i + 1];
      const mx = (points[2 * i - 2] + points[2 * i + 2]) / 2 - x, my = (points[2 * i - 1] + points[2 * i + 3]) / 2 - y;
      const ceiling = Math.max(terrain(x, y), level[i] + tolerance) + (turn < cos75 ? 0.7 : 0);
      for (let f = 1; f > 0.1; f /= 2) {
        const px = x + mx * f, py = y + my * f;
        if (terrain(px, py) <= ceiling && (!wet(px, py) || wet(x, y))) { points[2 * i] = px; points[2 * i + 1] = py; moved++; break; }
      }
    }
    if (!moved) break;
  }
}

/**
 * Removes hairpins: when two vertices up to ten apart are much closer than the
 * path between them (a quarter of it, over 10 m), the loop between them goes.
 */
function unfold(points: number[], ...values: number[][]): void {
  for (let i = 0; 2 * i + 2 < points.length; i++) {
    let arc = 0;
    for (let j = i + 1; j <= i + 10 && 2 * j + 1 < points.length; j++) {
      arc += Math.hypot(points[2 * j] - points[2 * j - 2], points[2 * j + 1] - points[2 * j - 1]);
      if (j - i < 2 || arc < 10) continue;
      if (Math.hypot(points[2 * j] - points[2 * i], points[2 * j + 1] - points[2 * i + 1]) < 0.25 * arc) {
        points.splice(2 * i + 2, 2 * (j - i - 1));
        for (const v of values) v.splice(i + 1, j - i - 1);
        break;
      }
    }
  }
}

/** Removes vertices where the line turns back by more than 120°, until none is left. */
function despike(points: number[], ...values: number[][]): void {
  for (let removed = true; removed;) {
    removed = false;
    for (let i = 1; 2 * i + 3 < points.length; i++) {
      const ax = points[2 * i] - points[2 * i - 2], ay = points[2 * i + 1] - points[2 * i - 1];
      const bx = points[2 * i + 2] - points[2 * i], by = points[2 * i + 3] - points[2 * i + 1];
      const la = ax * ax + ay * ay, lb = bx * bx + by * by;
      if (la > 0 && lb > 0 && ax * bx + ay * by >= -0.5 * Math.sqrt(la * lb)) continue;
      points.splice(2 * i, 2);
      for (const v of values) v.splice(i, 1);
      removed = true; i--;
    }
  }
}

/**
 * Cuts self-intersections: the loop between two crossing segments goes, as in
 * a neck cutoff, and the crossing point joins the two parts. `size` bins the
 * segments.
 */
function uncross(points: number[], size: number, ...values: number[][]): void {
  for (let guard = 0; guard < 100; guard++) {
    const m = points.length / 2, bins = new Map<number, number[]>();
    let cut: [number, number, number, number] | undefined;
    for (let i = 0; i < m - 1 && !cut; i++) {
      const ax = points[2 * i], ay = points[2 * i + 1], rx = points[2 * i + 2] - ax, ry = points[2 * i + 3] - ay;
      const x0 = Math.floor(Math.min(ax, ax + rx) / size), x1 = Math.floor(Math.max(ax, ax + rx) / size);
      const y0 = Math.floor(Math.min(ay, ay + ry) / size), y1 = Math.floor(Math.max(ay, ay + ry) / size);
      // Earliest segment crossing this one: the whole knot goes.
      let first = Infinity, cx = 0, cy = 0;
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        for (const j of bins.get(gx * 1048576 + gy) ?? []) {
          if (j >= i - 1 || j >= first) continue;
          const bx = points[2 * j], by = points[2 * j + 1], sx = points[2 * j + 2] - bx, sy = points[2 * j + 3] - by;
          const den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((bx - ax) * sy - (by - ay) * sx) / den, u = ((bx - ax) * ry - (by - ay) * rx) / den;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { first = j; cx = ax + rx * t; cy = ay + ry * t; }
        }
      }
      if (first < Infinity) { cut = [first, i, cx, cy]; break; }
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const k = gx * 1048576 + gy, bin = bins.get(k);
        if (bin) bin.push(i); else bins.set(k, [i]);
      }
    }
    if (!cut) return;
    const [j, i, cx, cy] = cut;
    points.splice(2 * j + 2, 2 * (i - j), cx, cy);
    for (const v of values) v.splice(j + 1, i - j, v[i]);
  }
}

interface NearPoint { d: number; x: number; y: number; line: number; index: number }

/** Uniform-grid index of the segments of the courses traced so far. */
class SegmentIndex {
  private bins = new Map<number, number[]>();
  private segments: number[] = [];
  /** Line id and index of the first vertex of each segment. */
  private owners: number[] = [];
  constructor(private size: number) {}
  add(points: number[], line: number): void {
    const size = this.size;
    for (let i = 0; i + 3 < points.length; i += 2) {
      const id = this.segments.length / 4;
      this.segments.push(points[i], points[i + 1], points[i + 2], points[i + 3]);
      this.owners.push(line, i / 2);
      const x0 = Math.floor(Math.min(points[i], points[i + 2]) / size), x1 = Math.floor(Math.max(points[i], points[i + 2]) / size);
      const y0 = Math.floor(Math.min(points[i + 1], points[i + 3]) / size), y1 = Math.floor(Math.max(points[i + 1], points[i + 3]) / size);
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const k = gx * 1048576 + gy, bin = this.bins.get(k);
        if (bin) bin.push(id); else this.bins.set(k, [id]);
      }
    }
  }
  /** Parameter along ab of its first crossing with an indexed segment, or Infinity. */
  crossing(ax: number, ay: number, bx: number, by: number): number {
    const p = this.segments, size = this.size;
    let first = Infinity;
    const x0 = Math.floor(Math.min(ax, bx) / size), x1 = Math.floor(Math.max(ax, bx) / size);
    const y0 = Math.floor(Math.min(ay, by) / size), y1 = Math.floor(Math.max(ay, by) / size);
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      for (const i of this.bins.get(gx * 1048576 + gy) ?? []) {
        const cx = p[4 * i], cy = p[4 * i + 1], rx = bx - ax, ry = by - ay, sx = p[4 * i + 2] - cx, sy = p[4 * i + 3] - cy;
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < first) first = t;
      }
    }
    return first;
  }
  /** Nearest point of an indexed segment within `radius`. */
  nearest(x: number, y: number, radius: number): NearPoint | undefined {
    const p = this.segments, size = this.size;
    let best: NearPoint | undefined;
    const x0 = Math.floor((x - radius) / size), x1 = Math.floor((x + radius) / size);
    const y0 = Math.floor((y - radius) / size), y1 = Math.floor((y + radius) / size);
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      for (const i of this.bins.get(gx * 1048576 + gy) ?? []) {
        const ax = p[4 * i], ay = p[4 * i + 1], dx = p[4 * i + 2] - ax, dy = p[4 * i + 3] - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        const qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(qx - x, qy - y);
        if (d <= radius && (!best || d < best.d)) best = { d, x: qx, y: qy, line: this.owners[2 * i], index: this.owners[2 * i + 1] };
      }
    }
    return best;
  }
}

/** Nearest point of a polyline to (x, y). */
function nearestOnLine(p: number[], x: number, y: number): [number, number] {
  let best = Infinity, bx = p[0], by = p[1];
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], ay = p[i + 1], dx = p[i + 2] - ax, dy = p[i + 3] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const px = ax + dx * t, py = ay + dy * t, d = (px - x) ** 2 + (py - y) ** 2;
    if (d < best) { best = d; bx = px; by = py; }
  }
  return [bx, by];
}

export function vectorRivers(h: SimpleHydrology, lake: Uint8Array, settings: RiverSettings): RiverNetwork {
  const started = performance.now();
  const { n, receiver, accumulation, sea, filled, height } = h;
  const total = n * n, cell = h.width / n, threshold = settings.riverArea * 1e6;
  const rng = new Rng(`rivers:${settings.seed}`);

  // Standing water as drawn: the sea, lakes, and any ground below sea level
  // (inland basins below zero are not sea for the drainage, but look like it).
  const standing = new Uint8Array(total);
  for (let c = 0; c < total; c++) standing[c] = sea[c] || lake[c] || height[c] <= 0 ? 1 : 0;
  // The flood front drains a lake through its shoals and shallow margins, cells
  // at its level not deep enough to be drawn. Water that leaves a body there
  // only to flow back into the same body crosses it: it is no river. Water
  // running on to another body or below the level stays a river.
  const body = new Int32Array(total).fill(-1);
  for (let s = 0, bodies = 0; s < total; s++) {
    if (!standing[s] || body[s] >= 0) continue;
    const stack = [s];
    body[s] = bodies;
    while (stack.length) {
      const c = stack.pop()!, x = c % n, y = (c - x) / n;
      for (let k = 0; k < 8; k++) {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const nb = yy * n + xx;
        if (standing[nb] && body[nb] < 0) { body[nb] = bodies; stack.push(nb); }
      }
    }
    bodies++;
  }
  // Cells at a body's level downstream of it, and the body their water falls
  // back into (−1: none, it leaves the level).
  const back = new Int32Array(total).fill(-2);
  const below = (r: number, a: number): boolean => r < 0 || standing[r] === 1 || filled[r] !== filled[a];
  const path: number[] = [];
  for (let c = 0; c < total; c++) {
    if (!standing[c]) continue;
    const r = receiver[c];
    if (below(r, c) || back[r] !== -2) continue;
    path.length = 0;
    let a = c, q = r;
    while (!below(q, a) && back[q] === -2) { path.push(q); a = q; q = receiver[q]; }
    const into = !below(q, a) ? back[q] : q >= 0 && standing[q] && filled[q] === filled[a] ? body[q] : -1;
    for (const p of path) back[p] = into;
  }
  // A shoal fed by another body links two bodies: a river.
  const link = new Uint8Array(total);
  for (let c = 0; c < total; c++) {
    if (!standing[c]) continue;
    for (let r = receiver[c]; r >= 0 && !standing[r] && back[r] >= 0 && back[r] !== body[c] && !link[r]; r = receiver[r]) link[r] = 1;
  }
  // Water for the courses: standing water as drawn and the shoals it crosses.
  const still = new Uint8Array(total);
  for (let c = 0; c < total; c++) still[c] = standing[c] || (back[c] >= 0 && !link[c]) ? 1 : 0;
  const river = new Uint8Array(total);
  for (let c = 0; c < total; c++) river[c] = !still[c] && accumulation[c] >= threshold ? 1 : 0;
  // The larger donor of each river cell continues its stream.
  const main = new Int32Array(total).fill(-1);
  for (let c = 0; c < total; c++) {
    const r = receiver[c];
    if (!river[c] || r < 0 || !river[r]) continue;
    if (main[r] < 0 || accumulation[c] > accumulation[main[r]]) main[r] = c;
  }
  const streams: Stream[] = [];
  const streamOf = new Int32Array(total).fill(-1);
  for (let source = 0; source < total; source++) {
    if (!river[source] || main[source] >= 0) continue;
    const id = streams.length, cells = [source];
    streamOf[source] = id;
    let end = -1;
    for (;;) {
      const last = cells[cells.length - 1], r = receiver[last];
      if (r < 0) break;
      if (river[r] && main[r] === last) { cells.push(r); streamOf[r] = id; continue; }
      end = r; break;
    }
    streams.push({ cells, end, parent: -1 });
  }
  for (const stream of streams) if (stream.end >= 0 && river[stream.end]) stream.parent = streamOf[stream.end];

  const centre = (c: number): [number, number] => [(c % n + 0.5) * cell, (Math.floor(c / n) + 0.5) * cell];
  // Terrain between cell centres, bilinear.
  const terrain = (x: number, y: number): number => {
    const fx = Math.max(0, Math.min(n - 1.000001, x / cell - 0.5)), fy = Math.max(0, Math.min(n - 1.000001, y / cell - 0.5));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, c = j * n + i;
    return (height[c] * (1 - u) + height[c + 1] * u) * (1 - v) + (height[c + n] * (1 - u) + height[c + n + 1] * u) * v;
  };
  const cellAt = (x: number, y: number): number => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    return gx < 0 || gy < 0 || gx >= n || gy >= n ? -1 : gy * n + gx;
  };
  const wet = (x: number, y: number): boolean => {
    const c = cellAt(x, y);
    return c >= 0 && (standing[c] === 1 || terrain(x, y) <= 0);
  };

  // Target sinuosity of each river cell, from the gradient over ±4 cells along
  // its stream and from the stream's size: small streams meander less.
  const sinuosity = new Float32Array(total).fill(1), flat = new Uint8Array(total);
  const flatGradient = settings.flatSlope / 1000, window = 4 * cell;
  for (const stream of streams) {
    const cells = stream.cells, count = cells.length, s = new Float64Array(count);
    for (let i = 1; i < count; i++) {
      const a = cells[i - 1], b = cells[i];
      s[i] = s[i - 1] + (a % n !== b % n && Math.floor(a / n) !== Math.floor(b / n) ? Math.SQRT2 : 1) * cell;
    }
    for (let i = 0, j0 = 0, j1 = 0; i < count; i++) {
      while (s[i] - s[j0] > window) j0++;
      while (j1 < count - 1 && s[j1] - s[i] < window) j1++;
      const c = cells[i];
      const gradient = (filled[cells[j0]] - filled[cells[j1]]) / Math.max(cell, s[j1] - s[j0]);
      const filledDepression = filled[c] - height[c] > 0.01;
      flat[c] = filledDepression || gradient < flatGradient ? 1 : 0;
      const share = flat[c] ? 1
        : GENTLE_SHARE * Math.max(0, 1 - Math.log(gradient / flatGradient) / Math.log(GENTLE));
      const size = Math.max(0.4, Math.min(1, 0.4 + 0.15 * Math.log2(accumulation[c] / threshold)));
      sinuosity[c] = 1 + (settings.sinuosity - 1) * share * size;
    }
  }

  // Drainage corridors: every cell takes its nearest river cell's stream and
  // target sinuosity, 8-connected.
  const owner = new Int32Array(total).fill(-1), target = new Float32Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  for (let c = 0; c < total; c++) if (streamOf[c] >= 0) {
    owner[c] = streamOf[c]; target[c] = sinuosity[c]; queue[tail++] = c;
  }
  while (head < tail) {
    const c = queue[head++], x = c % n, y = (c - x) / n;
    for (let k = 0; k < 8; k++) {
      const xx = x + DX[k], yy = y + DY[k];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const nb = yy * n + xx;
      if (owner[nb] < 0) { owner[nb] = owner[c]; target[nb] = target[c]; queue[tail++] = nb; }
    }
  }

  // Larger streams first: a tributary joins its parent's final course.
  const order = streams.map((_, i) => i).sort((a, b) => {
    const sa = streams[a], sb = streams[b];
    return accumulation[sb.cells[sb.cells.length - 1]] - accumulation[sa.cells[sa.cells.length - 1]] || a - b;
  });
  const lines: RiverLine[] = new Array(streams.length);
  // Each course's thalweg fit, for tributaries that join it after it meandered away.
  const thalwegs: [Float64Array, Float64Array][] = new Array(streams.length);
  const traced = new SegmentIndex(4 * cell);
  let widest = 0;
  const oxbows: RiverLine[] = [];
  let meanderRuns = 0, meanderLength = 0;

  // Deep filled depressions are lakes, drawn or not. Steepest descent crosses
  // their flat filled surface in straight lines, over drowned hills; a course
  // crossing one instead follows its floor: the cheapest path through it,
  // where cost grows with the height above the lowest floor met on the way.
  const chains: number[][] = new Array(streams.length);
  const floorPath = (from: number, targets: Set<number>, x0: number, y0: number, x1: number, y1: number, lowest: number): number[] | undefined => {
    const w = x1 - x0 + 1, size = w * (y1 - y0 + 1);
    const cost = new Float64Array(size).fill(Infinity), previous = new Int32Array(size).fill(-1);
    const local = (c: number): number => (Math.floor(c / n) - y0) * w + c % n - x0;
    const heap: number[] = [], keys: number[] = [];
    const push = (c: number, key: number): void => {
      let i = heap.length;
      heap.push(c); keys.push(key);
      while (i > 0) {
        const up = (i - 1) >> 1;
        if (keys[up] <= key) break;
        heap[i] = heap[up]; keys[i] = keys[up]; heap[up] = c; keys[up] = key; i = up;
      }
    };
    const pop = (): number => {
      const top = heap[0], c = heap.pop()!, key = keys.pop()!;
      if (heap.length) {
        let i = 0;
        heap[0] = c; keys[0] = key;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && keys[l] < keys[m]) m = l;
          if (r < heap.length && keys[r] < keys[m]) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]]; [keys[i], keys[m]] = [keys[m], keys[i]]; i = m;
        }
      }
      return top;
    };
    cost[local(from)] = 0; push(from, 0);
    while (heap.length) {
      const c = pop(), lc = local(c);
      if (targets.has(c)) {
        const path = [c];
        for (let k = previous[lc]; k >= 0; k = previous[k]) path.push((y0 + Math.floor(k / w)) * n + x0 + k % w);
        return path.reverse();
      }
      const x = c % n, y = (c - x) / n;
      for (let k = 0; k < 8; k++) {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx < x0 || yy < y0 || xx > x1 || yy > y1) continue;
        const nb = yy * n + xx, lnb = local(nb);
        if (still[nb] || (filled[nb] - height[nb] <= 0.01 && !targets.has(nb))) continue;
        const step = (DX[k] && DY[k] ? Math.SQRT2 : 1) * (1 + Math.max(0, height[nb] - lowest) / BED_HEIGHT);
        if (cost[lc] + step < cost[lnb]) { cost[lnb] = cost[lc] + step; previous[lnb] = lc; push(nb, cost[lnb]); }
      }
    }
    return undefined;
  };
  const acrossBeds = (cells: number[], parentChain: number[] | undefined, bed: Set<number>): number[] => {
    let result = cells;
    const onParent = new Set(parentChain);
    // Parent cells within a box, as targets of a floor path.
    const parentIn = (x0: number, y0: number, x1: number, y1: number): Set<number> => {
      const found = new Set<number>();
      for (const c of parentChain ?? []) {
        const x = c % n, y = (c - x) / n;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) found.add(c);
      }
      return found;
    };
    for (let i = 0; i < result.length; i++) {
      if (filled[result[i]] - height[result[i]] <= DEEP) continue;
      // The whole crossing of the depression, shallow margins included,
      // where steepest descent wanders just as much.
      let j = i;
      while (i > 0 && filled[result[i - 1]] - height[result[i - 1]] > 0.01) i--;
      while (j + 1 < result.length && filled[result[j + 1]] - height[result[j + 1]] > 0.01) j++;
      const entry = Math.max(0, i - 1), exit = Math.min(result.length - 1, j + 1);
      let x0 = n, y0 = n, x1 = 0, y1 = 0, lowest = Infinity;
      for (let k = entry; k <= exit; k++) {
        const c = result[k], x = c % n, y = (c - x) / n;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        lowest = Math.min(lowest, height[c]);
      }
      x0 = Math.max(0, x0 - 24); y0 = Math.max(0, y0 - 24); x1 = Math.min(n - 1, x1 + 24); y1 = Math.min(n - 1, y1 + 24);
      // A tributary ending in the lake runs to its parent's own path across
      // it, not to the confluence cell its parent may have left for the floor.
      const toParent = exit === result.length - 1 ? parentIn(x0, y0, x1, y1) : new Set<number>();
      let path = toParent.size && !onParent.has(result[exit]) ? floorPath(result[entry], toParent, x0, y0, x1, y1, lowest) : undefined;
      path ??= floorPath(result[entry], new Set([result[exit], ...toParent]), x0, y0, x1, y1, lowest);
      if (!path || path.length < 2) { i = j; continue; }
      for (let k = 1; k < path.length - 1; k++) bed.add(path[k]);
      const tail = path[path.length - 1] === result[exit] ? result.slice(exit + 1) : [];
      result = [...result.slice(0, entry), ...path, ...tail];
      i = entry + path.length - 1;
    }
    // A confluence in a shallower depression: the parent crossed it along its
    // floor and no longer passes there. The tributary runs down the same
    // depression to the parent's course.
    const last = result.length - 1;
    if (parentChain && last > 0 && !onParent.has(result[last]) && filled[result[last]] - height[result[last]] > 0.01) {
      let i = last;
      while (i > 0 && filled[result[i - 1]] - height[result[i - 1]] > 0.01) i--;
      const entry = Math.max(0, i - 1);
      let x0 = n, y0 = n, x1 = 0, y1 = 0, lowest = Infinity;
      for (let k = entry; k <= last; k++) {
        const c = result[k], x = c % n, y = (c - x) / n;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        lowest = Math.min(lowest, height[c]);
      }
      x0 = Math.max(0, x0 - 64); y0 = Math.max(0, y0 - 64); x1 = Math.min(n - 1, x1 + 64); y1 = Math.min(n - 1, y1 + 64);
      const targets = parentIn(x0, y0, x1, y1);
      const path = targets.size ? floorPath(result[entry], targets, x0, y0, x1, y1, lowest) : undefined;
      if (path && path.length >= 2) {
        for (let k = 1; k < path.length - 1; k++) bed.add(path[k]);
        result = [...result.slice(0, entry), ...path];
      }
    }
    return result;
  };

  // Cells after `from` across its shoal to the nearest drawn standing water, 8-connected.
  const toStanding = (from: number): number[] => {
    const previous = new Map<number, number>([[from, -1]]), queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i], x = c % n, y = (c - x) / n;
      if (standing[c]) {
        const path: number[] = [];
        for (let k = c; k !== from; k = previous.get(k)!) path.push(k);
        return path.reverse();
      }
      for (let k = 0; k < 8; k++) {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const nb = yy * n + xx;
        if (still[nb] && !previous.has(nb)) { previous.set(nb, c); queue.push(nb); }
      }
    }
    return [];
  };

  for (const id of order) {
    const stream = streams[id], bed = new Set<number>();
    let cells = stream.cells.slice();
    if (stream.end >= 0) cells.push(stream.end);
    cells = acrossBeds(cells, stream.parent >= 0 ? chains[stream.parent] : undefined, bed);
    // A course ending on a shoal runs on to the nearest standing water as drawn.
    const shoal = stream.end >= 0 && !standing[stream.end] && still[stream.end] ? toStanding(stream.end) : [];
    cells.push(...shoal);
    chains[id] = cells;
    const xs: number[] = [], ys: number[] = [], area: number[] = [], level: number[] = [], local: number[] = [], plain: number[] = [];
    for (const c of cells) {
      const [x, y] = centre(c), onBed = bed.has(c);
      // On a lake floor the course lies on the ground.
      xs.push(x); ys.push(y); area.push(onBed ? NaN : accumulation[c]); level.push(onBed ? height[c] : filled[c]);
      local.push(!onBed && river[c] ? sinuosity[c] : 1); plain.push(!onBed && river[c] ? flat[c] : 0);
    }
    // On a floor, water fills the small dips: its level is the highest
    // floor within two cells along the path, never above the lake surface.
    const floor = level.slice();
    for (let i = 0; i < cells.length; i++) {
      if (!bed.has(cells[i])) continue;
      for (let k = Math.max(0, i - 2); k <= Math.min(cells.length - 1, i + 2); k++) {
        if (bed.has(cells[k])) level[i] = Math.max(level[i], floor[k]);
      }
      level[i] = Math.min(level[i], filled[cells[i]]);
    }
    // On a floor the course meanders where the floor itself is flat or gentle.
    for (let i = 0; i < cells.length; i++) {
      if (!bed.has(cells[i])) continue;
      const j0 = Math.max(0, i - 4), j1 = Math.min(cells.length - 1, i + 4);
      const gradient = Math.abs(level[j0] - level[j1]) / Math.max(cell, Math.hypot(xs[j1] - xs[j0], ys[j1] - ys[j0]));
      const share = gradient < flatGradient ? 1 : GENTLE_SHARE * Math.max(0, 1 - Math.log(gradient / flatGradient) / Math.log(GENTLE));
      const size = Math.max(0.4, Math.min(1, 0.4 + 0.15 * Math.log2(accumulation[cells[j1]] / threshold)));
      local[i] = 1 + (settings.sinuosity - 1) * share * size; plain[i] = gradient < flatGradient ? 1 : 0;
    }
    // A course led across a floor to its parent's path, or across a shoal,
    // keeps its own area there.
    if (stream.end >= 0 && cells[cells.length - 1] !== stream.end) area[area.length - 1] = accumulation[stream.cells[stream.cells.length - 1]];
    for (let k = cells.length - shoal.length; k < cells.length; k++) area[k] = area[area.length - 1];
    // Areas across a floor: interpolated between its ends.
    for (let i = 0; i < area.length; i++) {
      if (!Number.isNaN(area[i])) continue;
      let j = i;
      while (j < area.length && Number.isNaN(area[j])) j++;
      const a0 = i > 0 ? area[i - 1] : area[j], a1 = j < area.length ? area[j] : a0;
      for (let k = i; k < j; k++) area[k] = a0 + (a1 - a0) * (k - i + 1) / (j - i + 1);
      i = j;
    }
    // The end cell drains the whole stream.
    if (stream.end >= 0) {
      area[area.length - 1] = Math.max(area[area.length - 1], area[area.length - 2]);
      local[local.length - 1] = local[local.length - 2]; plain[plain.length - 1] = plain[plain.length - 2];
    } else {
      // Map-edge outlet: run on to the border.
      const c = cells[cells.length - 1], gx = c % n, gy = Math.floor(c / n);
      const [x, y] = centre(c);
      const bx = gx === 0 ? 0 : gx === n - 1 ? h.width : x, by = gy === 0 ? 0 : gy === n - 1 ? h.width : y;
      if (bx !== x || by !== y) {
        xs.push(bx); ys.push(by); area.push(area[area.length - 1]); level.push(level[level.length - 1]);
        local.push(local[local.length - 1]); plain.push(plain[plain.length - 1]);
      }
    }
    const count = xs.length;
    if (count < 2) continue;
    const levelAt = (u: number): number => {
      const i = Math.min(count - 2, Math.floor(u)), f = u - i;
      return level[i] + (level[i + 1] - level[i]) * f;
    };

    // Dense chain, about three nodes per cell, fitted into the thalweg.
    const dx: number[] = [], dy: number[] = [], du: number[] = [], nodeOf: number[] = [];
    for (let i = 0; i < count - 1; i++) {
      const m = Math.max(1, Math.ceil(Math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]) / (cell / 3)));
      nodeOf.push(dx.length);
      for (let j = 0; j < m; j++) {
        dx.push(xs[i] + (xs[i + 1] - xs[i]) * j / m); dy.push(ys[i] + (ys[i + 1] - ys[i]) * j / m); du.push(i + j / m);
      }
    }
    nodeOf.push(dx.length); dx.push(xs[count - 1]); dy.push(ys[count - 1]); du.push(count - 1);
    const px = Float64Array.from(dx), py = Float64Array.from(dy), nodes = px.length;
    const limit = new Float64Array(nodes);
    for (let k = 0; k < nodes; k++) limit[k] = Math.max(levelAt(du[k]) + CURVE_TOLERANCE, terrain(px[k], py[k]));
    // A course ending in standing water may run into it over its last two cells.
    const shore = stream.end >= 0 && still[stream.end] ? nodeOf[Math.max(0, count - 3)] : nodes;
    thalweg(px, py, limit, terrain, wet, shore, cell / 4, 60);
    thalwegs[id] = [px, py];

    // Meandering runs: vertices that should wander, short steep gaps closed.
    const s = [0];
    for (let i = 1; i < count; i++) s.push(s[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
    const runs: [number, number][] = [];
    for (let i = 0; i < count;) {
      if (local[i] < 1.02) { i++; continue; }
      let j = i;
      while (j + 1 < count && local[j + 1] >= 1.02) j++;
      const previous = runs[runs.length - 1];
      if (previous && s[i] - s[previous[1]] <= 3 * cell) previous[1] = j; else runs.push([i, j]);
      i = j + 1;
    }

    // Output vertices carry their fractional index `u` along the cell chain.
    const out: number[] = [px[0], py[0]], us: number[] = [0], kind: number[] = [0], lv: number[] = [level[0]];
    const course = (from: number, to: number): void => {
      for (let k = from + 1; k <= to; k++) { out.push(px[k], py[k]); us.push(du[k]); kind.push(0); lv.push(levelAt(du[k])); }
    };
    let cursor = 0;
    for (const [a, b] of runs) {
      const ia = nodeOf[a], ib = nodeOf[b];
      const width = Math.max(channelWidth(area[b], settings.widthScale), MIN_WIDTH_CELLS * cell);
      const chord = Math.hypot(px[ib] - px[ia], py[ib] - py[ia]);
      if (chord < Math.max(6 * cell, 15 * width) || b - a < 4) continue;
      // Valley floor level of a point: the water level of the nearest thalweg
      // node of this run, on a local grid filled outwards from the thalweg.
      const bottom = levelAt(du[ib]);
      const valleyAt = valleyGrid(px, py, du, ia, ib, levelAt, cell, n, bottom);
      // Water may stand a bankfull depth above the valley floor (false flats,
      // shallow basins), never on a valley side: the floor never rises
      // downstream (`water` is its running minimum along the channel).
      // The depth is the physical channel's: a wider drawn channel does not dig deeper.
      const depth = MEANDER_DEPTH + MEANDER_DEPTH_PER_WIDTH * channelWidth(area[b], 1), parent = stream.parent;
      const allowed = (x: number, y: number, water: number): boolean => {
        const c = cellAt(x, y);
        if (c < 0 || still[c] || (owner[c] !== id && owner[c] !== parent)) return false;
        const z = terrain(x, y);
        return z > 0 && z <= Math.min(valleyAt(x, y), water) + depth;
      };
      const targetAt = (x: number, y: number): number => {
        const c = cellAt(x, y);
        return c < 0 ? 1 : target[c];
      };
      // Axis: on flats, a Hermite curve from entry to exit along the course's
      // own tangents when it stays on the floodplain; elsewhere the thalweg.
      let axisX = Array.from(px.subarray(ia, ib + 1)), axisY = Array.from(py.subarray(ia, ib + 1));
      let flats = 0;
      for (let i = a; i <= b; i++) flats += plain[i];
      if (flats >= 0.5 * (b - a + 1)) {
        const ta = Math.max(0, ia - 9), tb = Math.min(nodes - 1, ib + 9);
        const tal = Math.hypot(px[ia] - px[ta], py[ia] - py[ta]) || 1, tbl = Math.hypot(px[tb] - px[ib], py[tb] - py[ib]) || 1;
        const reach = Math.min(0.5 * chord, 40 * width);
        const [inX, inY] = ia > ta ? [(px[ia] - px[ta]) / tal, (py[ia] - py[ta]) / tal] : [(px[ib] - px[ia]) / chord, (py[ib] - py[ia]) / chord];
        const [outX, outY] = tb > ib ? [(px[tb] - px[ib]) / tbl, (py[tb] - py[ib]) / tbl] : [(px[ib] - px[ia]) / chord, (py[ib] - py[ia]) / chord];
        const [hx, hy] = hermite(px[ia], py[ia], inX * reach, inY * reach, px[ib], py[ib], outX * reach, outY * reach, cell / 4);
        const water = waterProfile(hx, hy, hx.length, valleyAt);
        if (hx.every((x, k) => allowed(x, hy[k], water[Math.max(0, k - 1)]))) { axisX = hx; axisY = hy; }
      }
      let result = meander(axisX, axisY, width, rng.fork(`${id}:${a}`), valleyAt, allowed, targetAt, cell / 2);
      // A Hermite axis that could not meander would stay nearly straight: retry on the thalweg.
      if (!result.meandered && axisX.length !== ib - ia + 1) {
        result = meander(Array.from(px.subarray(ia, ib + 1)), Array.from(py.subarray(ia, ib + 1)), width, rng.fork(`${id}:${a}:thalweg`), valleyAt, allowed, targetAt, cell / 2);
      }
      // The model's nodes are most of a width apart: draw the curve through them.
      const [mx, my] = spline(result.xs, result.ys, cell / 3);
      const water = waterProfile(mx, my, mx.length, valleyAt), last = mx.length - 1;
      // Each meander vertex takes the chain index of the nearest thalweg node, never going back.
      const nearOf = new Int32Array(last + 1), gapOf = new Float64Array(last + 1), vu = new Float64Array(last + 1), vl = new Float64Array(last + 1);
      for (let k = 0, near = ia, u = du[ia]; k <= last; k++) {
        let best = Infinity;
        for (let j = Math.max(ia, near - 60); j <= Math.min(ib, near + 60); j++) {
          const d = (px[j] - mx[k]) ** 2 + (py[j] - my[k]) ** 2;
          if (d < best) { best = d; near = j; }
        }
        u = Math.max(u, du[near]);
        nearOf[k] = k === last ? ib : near; gapOf[k] = Math.sqrt(best);
        vu[k] = k === last ? du[ib] : u; vl[k] = k === last ? bottom : Math.max(water[k], levelAt(u));
      }
      // Where the channel still stands above its water (its nodes were too far
      // apart to follow a tight valley), the thalweg replaces it between the
      // nearest points where the channel lies on it.
      const above = (k: number): boolean => {
        const ceiling = vl[k] + depth + 0.5;
        return terrain(mx[k], my[k]) > ceiling || (k < last && terrain((mx[k] + mx[k + 1]) / 2, (my[k] + my[k + 1]) / 2) > ceiling);
      };
      const onThalweg = Math.max(0.3 * width, cell / 2);
      course(cursor, ia);
      const runStart = out.length / 2, emitted: number[] = [];
      for (let k = 1; k <= last;) {
        if (!above(k)) {
          out.push(mx[k], my[k]); us.push(vu[k]); kind.push(1); lv.push(vl[k]); emitted.push(k);
          k++;
          continue;
        }
        let q = k;
        while (q < last && (above(q) || gapOf[q] > onThalweg)) q++;
        while (emitted.length && gapOf[emitted[emitted.length - 1]] > onThalweg) {
          emitted.pop(); out.length -= 2; us.length--; kind.length--; lv.length--;
        }
        const from = emitted.length ? nearOf[emitted[emitted.length - 1]] : ia;
        for (let j = from + 1; j <= nearOf[q]; j++) {
          out.push(px[j], py[j]); us.push(Math.max(us[us.length - 1], du[j])); kind.push(0); lv.push(Math.min(lv[lv.length - 1], levelAt(du[j])));
        }
        k = q + 1;
      }
      for (let k = runStart; k < out.length / 2; k++) {
        if (kind[k] === 1) meanderLength += Math.hypot(out[2 * k] - out[2 * k - 2], out[2 * k + 1] - out[2 * k - 1]);
      }
      for (const loop of result.oxbows) {
        const [ox, oy] = spline(loop[0], loop[1], cell / 3), points: number[] = [];
        for (let k = 0; k < ox.length; k++) points.push(ox[k], oy[k]);
        uncross(points, cell);
        const m = points.length / 2;
        oxbows.push({ points, area: new Array<number>(m).fill(area[b]), level: new Array<number>(m).fill(level[b]), kind: new Array<number>(m).fill(1) });
      }
      meanderRuns++;
      cursor = ib;
    }
    course(cursor, nodes - 1);

    const lerp = (values: number[], u: number): number => {
      const i = Math.min(count - 2, Math.floor(u)), f = u - i;
      return values[i] + (values[i + 1] - values[i]) * f;
    };
    // Whether the terrain along a straight line stays at or below `ceiling`.
    const below = (ax: number, ay: number, bx: number, by: number, ceiling: number): boolean => {
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 4)));
      for (let j = 0; j <= steps; j++) if (terrain(ax + (bx - ax) * j / steps, ay + (by - ay) * j / steps) > ceiling) return false;
      return true;
    };

    // A course stops where it first meets one already traced (its parent, or
    // another course near a confluence), or where it first runs alongside one
    // closer than half their summed widths: channels whose banks touch merge,
    // unless a spur separates them. A course born alongside another is part of it.
    let joined = false, beside = -1, absorbed = false;
    for (let k = 0; k < out.length / 2; k++) {
      const x = out[2 * k], y = out[2 * k + 1], own = channelWidth(lerp(area, us[k]), settings.widthScale);
      const near = traced.nearest(x, y, Math.max(0.75 * cell, 0.5 * (own + widest)));
      if (near) {
        const other = channelWidth(lines[near.line].area[near.index], settings.widthScale);
        const gap = Math.max(0.75 * cell, 0.5 * (own + other));
        // A crossing just ahead is a confluence, not two channels side by side.
        let ahead = false;
        if (near.d < gap) for (let j = k, arc = 0; j + 1 < out.length / 2 && arc < 3 * gap && !ahead; j++) {
          ahead = traced.crossing(out[2 * j], out[2 * j + 1], out[2 * j + 2], out[2 * j + 3]) <= 1;
          arc += Math.hypot(out[2 * j + 2] - out[2 * j], out[2 * j + 3] - out[2 * j + 1]);
        }
        if (near.d < gap && !ahead && below(x, y, near.x, near.y, lv[k] + 1)) {
          if (k === 0) absorbed = true;
          out.length = 2 * k + 2; us.length = k + 1; kind.length = k + 1; lv.length = k + 1;
          beside = near.line;
          break;
        }
      }
      if (2 * k + 3 >= out.length) break;
      const bx = out[2 * k + 2], by = out[2 * k + 3];
      const t = traced.crossing(x, y, bx, by);
      if (t <= 1 && (k > 0 || t > 0)) {
        const u = us[k] + (us[k + 1] - us[k]) * t, z = lv[k] + (lv[k + 1] - lv[k]) * t;
        out.length = 2 * k + 2; us.length = k + 1; kind.length = k + 1; lv.length = k + 1;
        out.push(x + (bx - x) * t, y + (by - y) * t); us.push(u); kind.push(kind[k]); lv.push(z);
        joined = true;
        break;
      }
    }
    if (absorbed) continue;
    // A tributary that did not reach its parent joins it, or whichever course
    // passes nearest when the parent's drawn line stops short of the confluence.
    let joinTo = beside;
    if (joinTo < 0 && !joined && stream.parent >= 0) {
      const m = out.length / 2 - 1, reach = 12 * cell;
      const parent = lines[stream.parent];
      if (parent) {
        const [qx, qy] = nearestOnLine(parent.points, out[2 * m], out[2 * m + 1]);
        if (Math.hypot(qx - out[2 * m], qy - out[2 * m + 1]) <= reach) joinTo = stream.parent;
      }
      if (joinTo < 0) joinTo = traced.nearest(out[2 * m], out[2 * m + 1], reach)?.line ?? -1;
    }
    if (joinTo >= 0) {
      // Join the other course ahead of the end, along a curve tangent to both
      // courses that stays in the valley: of the nearest points ahead, the
      // first whose curve does not rise above the water.
      const tp = lines[joinTo].points, m = out.length / 2 - 1;
      const ex = out[2 * m], ey = out[2 * m + 1], back = Math.max(0, m - 3);
      const [qx, qy] = nearestOnLine(tp, ex, ey);
      let tx = ex - out[2 * back], ty = ey - out[2 * back + 1], tl = Math.hypot(tx, ty);
      if (tl < 1e-6) { tx = qx - ex; ty = qy - ey; tl = Math.hypot(tx, ty) || 1; }
      tx /= tl; ty /= tl;
      const candidates: [number, number][] = [];
      for (let k = 0; k < tp.length / 2; k++) {
        const vx = tp[2 * k] - ex, vy = tp[2 * k + 1] - ey, d = Math.hypot(vx, vy);
        if (d <= 12 * cell) candidates.push([d - 0.7 * (vx * tx + vy * ty), k]);
      }
      candidates.sort((a, b) => a[0] - b[0]);
      // Last, the nearest point of the other course, however far it meandered.
      const nearestVertex = (): number => {
        let best = Infinity, j = 0;
        for (let k = 0; k < tp.length / 2; k++) {
          const d = (tp[2 * k] - qx) ** 2 + (tp[2 * k + 1] - qy) ** 2;
          if (d < best) { best = d; j = k; }
        }
        return j;
      };
      candidates.push([Infinity, nearestVertex()]);
      // Height of a curve above the water, which may rise to the other course's bank.
      const excess = (hx: number[], hy: number[]): number => {
        const ceiling = Math.max(lv[m], terrain(hx[hx.length - 1], hy[hy.length - 1])) + 0.5;
        let worst = -Infinity;
        for (let k = 0; k < hx.length; k++) worst = Math.max(worst, terrain(hx[k], hy[k]) - ceiling);
        return worst;
      };
      let best: [number[], number[]] | undefined, bestExcess = Infinity;
      for (const [, j] of [...candidates.slice(0, 8), ...candidates.slice(-1)]) {
        if (bestExcess <= 0) break;
        const jx = tp[2 * j], jy = tp[2 * j + 1];
        const k0 = Math.max(0, j - 1), k1 = Math.min(tp.length / 2 - 1, j + 1);
        const pl = Math.hypot(tp[2 * k1] - tp[2 * k0], tp[2 * k1 + 1] - tp[2 * k0 + 1]) || 1;
        const px2 = (tp[2 * k1] - tp[2 * k0]) / pl, py2 = (tp[2 * k1 + 1] - tp[2 * k0 + 1]) / pl;
        const d = Math.hypot(jx - ex, jy - ey), ax2 = tx + px2, ay2 = ty + py2, al = Math.hypot(ax2, ay2) || 1;
        for (const f of [0.8, 0.4]) {
          const curve = hermite(ex, ey, tx * f * d, ty * f * d, jx, jy, ax2 / al * f * d, ay2 / al * f * d, cell / 3);
          const e = excess(curve[0], curve[1]);
          if (e < bestExcess) { best = curve; bestExcess = e; }
          if (e <= 0) break;
        }
      }
      // No curve stays in the valley: follow the other course's thalweg (the
      // valley bottom it meandered away from) down to where it crosses its course.
      if (bestExcess > 0 && thalwegs[joinTo]) {
        const [gx, gy] = thalwegs[joinTo];
        let start = -1, nearest = (2 * cell) ** 2;
        for (let k = 0; k < gx.length; k++) {
          const d = (gx[k] - ex) ** 2 + (gy[k] - ey) ** 2;
          if (d < nearest) { nearest = d; start = k; }
        }
        if (start >= 0) {
          const wx = [ex], wy = [ey];
          for (let k = start; k < gx.length && k < start + 300; k++) {
            // The thalweg may run along the course itself: touching it is joining it.
            const touch = traced.nearest(gx[k], gy[k], 1.5);
            if (touch) {
              wx.push(touch.x); wy.push(touch.y);
              const e = excess(wx, wy);
              if (e < bestExcess) { best = [wx, wy]; bestExcess = e; }
              break;
            }
            const t = traced.crossing(wx[wx.length - 1], wy[wy.length - 1], gx[k], gy[k]);
            if (t <= 1) {
              wx.push(wx[wx.length - 1] + (gx[k] - wx[wx.length - 1]) * t); wy.push(wy[wy.length - 1] + (gy[k] - wy[wy.length - 1]) * t);
              const e = excess(wx, wy);
              if (e < bestExcess) { best = [wx, wy]; bestExcess = e; }
              break;
            }
            wx.push(gx[k]); wy.push(gy[k]);
          }
        }
      }
      // The straight line to the nearest point only when it is much lower than any curve.
      const [sx, sy] = resample([ex, qx], [ey, qy], 2, cell / 3);
      const straight: [number[], number[]] = [Array.from(sx), Array.from(sy)];
      if (!best || excess(straight[0], straight[1]) < bestExcess - 1) best = straight;
      const [hx, hy] = best, z = Math.min(lv[m], level[count - 1]);
      for (let k = 1; k < hx.length; k++) {
        const t = traced.crossing(hx[k - 1], hy[k - 1], hx[k], hy[k]);
        const last = t <= 1 || k === hx.length - 1;
        out.push(t <= 1 ? hx[k - 1] + (hx[k] - hx[k - 1]) * t : hx[k], t <= 1 ? hy[k - 1] + (hy[k] - hy[k - 1]) * t : hy[k]);
        us.push(count - 1); kind.push(2); lv.push(z);
        if (last) break;
      }
    }
    unfold(out, us, kind, lv);
    despike(out, us, kind, lv);
    uncross(out, cell, us, kind, lv);
    relax(out, lv, terrain, wet, CURVE_TOLERANCE);
    uncross(out, cell, us, kind, lv);
    // A course ending in standing water stops at its shore.
    if (stream.end >= 0 && still[stream.end] && joinTo < 0) {
      let k = out.length / 2 - 1;
      while (k > 0 && wet(out[2 * k], out[2 * k + 1])) k--;
      if (k < out.length / 2 - 1 && !wet(out[2 * k], out[2 * k + 1])) {
        const ax = out[2 * k], ay = out[2 * k + 1], bx = out[2 * k + 2], by = out[2 * k + 3];
        let lo = 0, hi = 1;
        for (let j = 0; j < 16; j++) { const mid = (lo + hi) / 2; if (wet(ax + (bx - ax) * mid, ay + (by - ay) * mid)) hi = mid; else lo = mid; }
        const u = us[k + 1], z = lv[k + 1], kd = kind[k + 1];
        out.length = 2 * k + 2; us.length = k + 1; kind.length = k + 1; lv.length = k + 1;
        out.push(ax + (bx - ax) * hi, ay + (by - ay) * hi); us.push(u); kind.push(kd); lv.push(z);
      }
    }
    if (out.length < 4) continue;
    lines[id] = { points: out, area: us.map(u => lerp(area, u)), level: lv, kind };
    // Tributaries crossing a lake floor run to the part of this course that is drawn.
    chains[id] = cells.slice(0, Math.min(cells.length, Math.floor(us[us.length - 1]) + 2));
    widest = Math.max(widest, channelWidth(lines[id].area[lines[id].area.length - 1], settings.widthScale));
    traced.add(out, id);
  }

  const rivers = lines.filter(Boolean);
  // Later migration may have swept through an oxbow or carried the channel
  // away from it: keep only those clear of every course and of standing water,
  // with both ends still beside the channel that abandoned them. Ends running
  // along a course are trimmed; what remains must still read as an oxbow, a
  // crescent at least `OXBOW_LENGTH` channel widths long enclosing some area,
  // not a hairpin or a kink.
  const clear: RiverLine[] = [];
  for (const oxbow of oxbows) {
    const p = oxbow.points, width = Math.max(channelWidth(oxbow.area[0], settings.widthScale), MIN_WIDTH_CELLS * cell);
    if (p.some((_, k) => k % 2 === 0 && k + 3 < p.length && traced.crossing(p[k], p[k + 1], p[k + 2], p[k + 3]) <= 1)) continue;
    if (p.some((_, k) => k % 2 === 0 && wet(p[k], p[k + 1]))) continue;
    let first = 0, last = p.length / 2 - 1;
    while (first < last && traced.nearest(p[2 * first], p[2 * first + 1], width)) first++;
    while (last > first && traced.nearest(p[2 * last], p[2 * last + 1], width)) last--;
    if (last - first < 3) continue;
    let length = 0, enclosed = 0;
    for (let k = first; k <= last; k++) {
      const j = k === last ? first : k + 1;
      if (k < last) length += Math.hypot(p[2 * j] - p[2 * k], p[2 * j + 1] - p[2 * k + 1]);
      enclosed += p[2 * k] * p[2 * j + 1] - p[2 * j] * p[2 * k + 1];
    }
    if (length < OXBOW_LENGTH * width || Math.abs(enclosed / 2) < OXBOW_COMPACTNESS * length * length) continue;
    // A bend tighter than the channel itself is a fold of the model, no oxbow.
    let sharp = false;
    for (let k = first + 1; k < last && !sharp; k++) {
      let turn = 0;
      const heading = (j: number): number => Math.atan2(p[2 * j + 3] - p[2 * j + 1], p[2 * j + 2] - p[2 * j]);
      for (let j = k, arc = 0; j < last && arc < width; j++) {
        let t = heading(j) - heading(j - 1);
        t -= 2 * Math.PI * Math.round(t / (2 * Math.PI));
        turn += t; arc += Math.hypot(p[2 * j + 2] - p[2 * j], p[2 * j + 3] - p[2 * j + 1]);
        if (Math.abs(turn) > OXBOW_TURN) sharp = true;
      }
    }
    if (sharp) continue;
    const reach = 3 * width;
    if (!traced.nearest(p[2 * first], p[2 * first + 1], reach) || !traced.nearest(p[2 * last], p[2 * last + 1], reach)) continue;
    clear.push({
      points: p.slice(2 * first, 2 * last + 2), area: oxbow.area.slice(first, last + 1),
      level: oxbow.level.slice(first, last + 1), kind: oxbow.kind.slice(first, last + 1),
    });
  }
  let length = 0;
  for (const line of rivers) for (let k = 2; k < line.points.length; k += 2) {
    length += Math.hypot(line.points[k] - line.points[k - 2], line.points[k + 1] - line.points[k - 1]);
  }
  return {
    rivers, oxbows: clear, meanderRuns, lengthKm: length / 1000, meanderKm: meanderLength / 1000, ms: performance.now() - started,
  };
}
