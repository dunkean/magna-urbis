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
 * false flats and shallow basins but no valley side. The belt also stays in
 * the stream's own drainage corridor, so a channel never wanders into another
 * river. Widths follow downstream hydraulic geometry (W ∝ A^0.45); the
 * meander wavelength, about 11 W (Leopold & Wolman 1960), comes out of the model.
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
 * does). Ends are fixed. Arrays are updated in place; `us` follows the nodes.
 */
function thalweg(
  xs: Float64Array, ys: Float64Array, limit: Float64Array, terrain: (x: number, y: number) => number,
  reach: number, iterations: number,
): void {
  const n = xs.length;
  if (n < 3) return;
  const nx = new Float64Array(n), ny = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    // Smoothing: move halfway to the neighbours' midpoint, or less if that climbs.
    nx.set(xs); ny.set(ys);
    for (let i = 1; i < n - 1; i++) {
      const dx = (xs[i - 1] + xs[i + 1]) / 2 - xs[i], dy = (ys[i - 1] + ys[i + 1]) / 2 - ys[i];
      for (let f = 0.5; f > 0.06; f /= 2) {
        const px = xs[i] + dx * f, py = ys[i] + dy * f;
        if (terrain(px, py) <= limit[i]) { nx[i] = px; ny[i] = py; break; }
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
        if (terrain(px, py) <= limit[i]) { xs[i] = px; ys[i] = py; }
      }
      continue;
    }
    for (let i = 1; i < n - 1; i++) {
      const tx = xs[i + 1] - xs[i - 1], ty = ys[i + 1] - ys[i - 1], tl = Math.sqrt(tx * tx + ty * ty) || 1;
      const ox = ty / tl, oy = -tx / tl;
      let best = terrain(xs[i], ys[i]) - 0.02, bt = 0;
      for (const t of [-1, -0.5, 0.5, 1]) {
        const z = terrain(xs[i] + ox * t * reach, ys[i] + oy * t * reach);
        if (z < best) { best = z; bt = t; }
      }
      if (bt) { xs[i] += ox * bt * reach; ys[i] += oy * bt * reach; }
    }
  }
}

export interface MeanderResult {
  xs: number[]; ys: number[];
  oxbows: [number[], number[]][];
  iterations: number;
  /** False when no meandered channel fitted and the axis came back unchanged. */
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
  allowed: (x: number, y: number, water: number) => boolean, targetAt: (x: number, y: number) => number, maxIterations = 800,
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
      if (free(px, py, i)) { nx[i] = px; ny[i] = py; }
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
        if (free(px, py, i)) { nx[i] = px; ny[i] = py; moved++; break; }
      }
    }
    if (!moved) break;
    [xs, ys] = resample(nx, ny, n, ds); n = xs.length;
    // Neck cutoff: the first pair of distant nodes closer than the cutoff distance.
    if (iterations % 4 === 0) {
      const cut = findCutoff(xs, ys, cutoff, minGap, entryMargin, exitMargin);
      // The neck closes only where the new short course stays on the floodplain.
      if (cut && free((xs[cut[0]] + xs[cut[1]]) / 2, (ys[cut[0]] + ys[cut[1]]) / 2, cut[0])) {
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
  for (let k = 1; k < fx.length - 1; k++) if (free(sx[k], sy[k], k)) { fx[k] = sx[k]; fy[k] = sy[k]; }

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
      ok = allowed(tx[j], ty[j], tail[j - 1]) && allowed((tx[j] + tx[j + 1]) / 2, (ty[j] + ty[j + 1]) / 2, tail[j]);
    }
    if (ok) { result = [tx, ty]; break; }
  }
  // No cut fits: keep the axis, which does.
  if (!result) return { xs: Array.from(rx), ys: Array.from(ry), oxbows: [], iterations, meandered: false };
  return { xs: result[0], ys: result[1], oxbows, iterations, meandered: true };
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
function relax(points: number[], level: number[], terrain: (x: number, y: number) => number, tolerance: number): void {
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
        if (terrain(x + mx * f, y + my * f) <= ceiling) { points[2 * i] = x + mx * f; points[2 * i + 1] = y + my * f; moved++; break; }
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

/** Uniform-grid index of the segments of the courses traced so far. */
class SegmentIndex {
  private bins = new Map<number, number[]>();
  private segments: number[] = [];
  constructor(private size: number) {}
  add(points: number[]): void {
    const size = this.size;
    for (let i = 0; i + 3 < points.length; i += 2) {
      const id = this.segments.length / 4;
      this.segments.push(points[i], points[i + 1], points[i + 2], points[i + 3]);
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

  const river = new Uint8Array(total);
  for (let c = 0; c < total; c++) river[c] = !sea[c] && !lake[c] && accumulation[c] >= threshold ? 1 : 0;
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
  const traced = new SegmentIndex(4 * cell);
  const oxbows: RiverLine[] = [];
  let meanderRuns = 0, meanderLength = 0;

  for (const id of order) {
    const stream = streams[id], cells = stream.cells.slice();
    if (stream.end >= 0) cells.push(stream.end);
    const xs: number[] = [], ys: number[] = [], area: number[] = [], level: number[] = [], local: number[] = [], plain: number[] = [];
    for (const c of cells) {
      const [x, y] = centre(c);
      xs.push(x); ys.push(y); area.push(accumulation[c]); level.push(filled[c]);
      local.push(river[c] ? sinuosity[c] : 1); plain.push(river[c] ? flat[c] : 0);
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
    thalweg(px, py, limit, terrain, cell / 4, 60);

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
      if (chord < Math.max(6 * cell, 25 * width) || b - a < 4) continue;
      // Valley floor level of a point: the water level of the nearest thalweg
      // node of this run, on a local grid filled outwards from the thalweg.
      const bottom = levelAt(du[ib]);
      const valleyAt = valleyGrid(px, py, du, ia, ib, levelAt, cell, n, bottom);
      // Water may stand a bankfull depth above the valley floor (false flats,
      // shallow basins), never on a valley side: the floor never rises
      // downstream (`water` is its running minimum along the channel).
      const depth = MEANDER_DEPTH + MEANDER_DEPTH_PER_WIDTH * width, parent = stream.parent;
      const allowed = (x: number, y: number, water: number): boolean => {
        const c = cellAt(x, y);
        if (c < 0 || sea[c] || lake[c] || (owner[c] !== id && owner[c] !== parent)) return false;
        return terrain(x, y) <= Math.min(valleyAt(x, y), water) + depth;
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
      let result = meander(axisX, axisY, width, rng.fork(`${id}:${a}`), valleyAt, allowed, targetAt);
      // A Hermite axis that could not meander would stay nearly straight: retry on the thalweg.
      if (!result.meandered && axisX.length !== ib - ia + 1) {
        result = meander(Array.from(px.subarray(ia, ib + 1)), Array.from(py.subarray(ia, ib + 1)), width, rng.fork(`${id}:${a}:thalweg`), valleyAt, allowed, targetAt);
      }
      const water = waterProfile(result.xs, result.ys, result.xs.length, valleyAt);
      course(cursor, ia);
      // Each meander vertex takes the chain index of the nearest thalweg node, never going back.
      let near = ia, u = du[ia];
      for (let k = 1; k < result.xs.length; k++) {
        const x = result.xs[k], y = result.ys[k];
        let best = Infinity;
        for (let j = Math.max(ia, near - 60); j <= Math.min(ib, near + 60); j++) {
          const d = (px[j] - x) ** 2 + (py[j] - y) ** 2;
          if (d < best) { best = d; near = j; }
        }
        u = Math.max(u, du[near]);
        meanderLength += Math.hypot(x - result.xs[k - 1], y - result.ys[k - 1]);
        out.push(x, y); us.push(k === result.xs.length - 1 ? du[ib] : u); kind.push(1);
        lv.push(k === result.xs.length - 1 ? bottom : water[k]);
      }
      for (const [ox, oy] of result.oxbows) {
        const points: number[] = [];
        for (let k = 0; k < ox.length; k++) points.push(ox[k], oy[k]);
        oxbows.push({ points, area: ox.map(() => area[b]), level: ox.map(() => level[b]), kind: ox.map(() => 1) });
      }
      meanderRuns++;
      cursor = ib;
    }
    course(cursor, nodes - 1);

    // A course stops where it first meets one already traced: its parent, or
    // another course close to a confluence.
    let joined = false;
    for (let k = 0; k < out.length / 2 - 1 && !joined; k++) {
      const ax = out[2 * k], ay = out[2 * k + 1], bx = out[2 * k + 2], by = out[2 * k + 3];
      const t = traced.crossing(ax, ay, bx, by);
      if (t <= 1 && (k > 0 || t > 0)) {
        const u = us[k] + (us[k + 1] - us[k]) * t, z = lv[k] + (lv[k + 1] - lv[k]) * t;
        out.length = 2 * k + 2; us.length = k + 1; kind.length = k + 1; lv.length = k + 1;
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t); us.push(u); kind.push(kind[k]); lv.push(z);
        joined = true;
      }
    }
    if (!joined && stream.parent >= 0 && lines[stream.parent]) {
      // The parent meandered away from the confluence cell: join it ahead of
      // the tributary's end along a curve tangent to both courses.
      const parentPoints = lines[stream.parent].points, m = out.length / 2 - 1;
      const ex = out[2 * m], ey = out[2 * m + 1], back = Math.max(0, m - 3);
      const tl = Math.hypot(ex - out[2 * back], ey - out[2 * back + 1]) || 1;
      const tx = (ex - out[2 * back]) / tl, ty = (ey - out[2 * back + 1]) / tl;
      let best = Infinity, j = -1;
      for (let k = 0; k < parentPoints.length / 2; k++) {
        const vx = parentPoints[2 * k] - ex, vy = parentPoints[2 * k + 1] - ey, d = Math.hypot(vx, vy);
        if (d > 12 * cell) continue;
        const score = d - 0.7 * (vx * tx + vy * ty);
        if (score < best) { best = score; j = k; }
      }
      let jx: number, jy: number, px2: number, py2: number;
      if (j >= 0) {
        jx = parentPoints[2 * j]; jy = parentPoints[2 * j + 1];
        const k0 = Math.max(0, j - 1), k1 = Math.min(parentPoints.length / 2 - 1, j + 1);
        const pl = Math.hypot(parentPoints[2 * k1] - parentPoints[2 * k0], parentPoints[2 * k1 + 1] - parentPoints[2 * k0 + 1]) || 1;
        px2 = (parentPoints[2 * k1] - parentPoints[2 * k0]) / pl; py2 = (parentPoints[2 * k1 + 1] - parentPoints[2 * k0 + 1]) / pl;
      } else {
        [jx, jy] = nearestOnLine(parentPoints, ex, ey);
        px2 = tx; py2 = ty;
      }
      const d = Math.hypot(jx - ex, jy - ey), ax2 = tx + px2, ay2 = ty + py2, al = Math.hypot(ax2, ay2) || 1;
      const [hx, hy] = hermite(ex, ey, tx * 0.8 * d, ty * 0.8 * d, jx, jy, ax2 / al * 0.8 * d, ay2 / al * 0.8 * d, cell / 3);
      const z = Math.min(lv[m], level[count - 1]);
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
    relax(out, lv, terrain, CURVE_TOLERANCE);
    if (out.length < 4) continue;
    const lerp = (values: number[], u: number): number => {
      const i = Math.min(count - 2, Math.floor(u)), f = u - i;
      return values[i] + (values[i + 1] - values[i]) * f;
    };
    lines[id] = { points: out, area: us.map(u => lerp(area, u)), level: lv, kind };
    traced.add(out);
  }

  const rivers = lines.filter(Boolean);
  // Later migration may have swept through an oxbow: keep only those clear of every course.
  const clear = oxbows.filter(oxbow => {
    const p = oxbow.points;
    for (let k = 0; k + 3 < p.length; k += 2) if (traced.crossing(p[k], p[k + 1], p[k + 2], p[k + 3]) <= 1) return false;
    return true;
  });
  let length = 0;
  for (const line of rivers) for (let k = 2; k < line.points.length; k += 2) {
    length += Math.hypot(line.points[k] - line.points[k - 2], line.points[k + 1] - line.points[k - 1]);
  }
  return {
    rivers, oxbows: clear, meanderRuns, lengthKm: length / 1000, meanderKm: meanderLength / 1000, ms: performance.now() - started,
  };
}
