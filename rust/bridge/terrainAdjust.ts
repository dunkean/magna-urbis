/**
 * Adjustments of sampled terrain regions in the bench: a height change kept
 * on a coarse grid (pre-hydrology conditioning), fractal refinement below the
 * source raster's cell, and placement of a generated neural surface.
 * Heights in metres, coordinates in metres from the map's north-west corner.
 */
interface SurfaceData {
  x: number; y: number; width: number; resolution: number; height: Float32Array;
  normalX: Float32Array; normalY: Float32Array; normalZ: Float32Array;
  minHeight: number; maxHeight: number;
}

/** Adds the gradient of `change` (metres per sample) to the retained normals. */
function addGradient(data: SurfaceData, change: Float32Array): void {
  const n = data.resolution, cell = data.width / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, xl = Math.max(0, x - 1), xr = Math.min(n - 1, x + 1), yt = Math.max(0, y - 1), yb = Math.min(n - 1, y + 1);
    const cx = change[y * n + xr] - change[y * n + xl], cy = change[yb * n + x] - change[yt * n + x];
    if (cx === 0 && cy === 0) continue;
    const nz = Math.max(1e-6, data.normalZ[i]);
    const dx = -data.normalX[i] / nz + cx / ((xr - xl) * cell), dy = -data.normalY[i] / nz + cy / ((yb - yt) * cell);
    const length = Math.hypot(dx, dy, 1);
    data.normalX[i] = -dx / length; data.normalY[i] = -dy / length; data.normalZ[i] = 1 / length;
  }
  let min = Infinity, max = -Infinity;
  for (const h of data.height) { min = Math.min(min, h); max = Math.max(max, h); }
  data.minHeight = min; data.maxHeight = max;
}

/** Adds a height change kept on an `m²` grid over the map, interpolated by cubic B-splines. */
export function applyDelta(data: SurfaceData, delta: Float32Array, m: number, mapWidth: number): void {
  const n = data.resolution, cell = data.width / n, dc = mapWidth / m;
  const axis = (origin: number): { i: Int32Array; w: Float64Array } => {
    const i = new Int32Array(n * 4), w = new Float64Array(n * 4);
    for (let k = 0; k < n; k++) {
      const g = Math.max(0, Math.min(m - 1, (origin + (k + 0.5) * cell) / dc - 0.5)), f = Math.floor(g), t = g - f, u = 1 - t;
      for (let j = 0; j < 4; j++) i[k * 4 + j] = Math.max(0, Math.min(m - 1, f + j - 1));
      w.set([u ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6], k * 4);
    }
    return { i, w };
  };
  const xs = axis(data.x), ys = axis(data.y), change = new Float32Array(n * n);
  let any = false;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = 0;
    for (let a = 0; a < 4; a++) {
      const row = ys.i[y * 4 + a] * m, wy = ys.w[y * 4 + a];
      for (let b = 0; b < 4; b++) v += delta[row + xs.i[x * 4 + b]] * wy * xs.w[x * 4 + b];
    }
    // Sea stays sea: the conditioning only reshapes land.
    if (data.height[y * n + x] <= 0) v = Math.min(0, v);
    change[y * n + x] = v; data.height[y * n + x] += v; any ||= v !== 0;
  }
  if (any) addGradient(data, change);
}

// Gradient noise (Perlin 2002 fade) on an integer lattice, seeded by a hash.
// The unit gradient of a lattice corner depends only on (corner, seed): applyFractalDetail memoizes the
// cos/sin pair per octave in a direct-mapped cache (identical values; a corner is shared by many texels).
const GRADIENT_CACHE = 1 << 16;
interface GradientCache { i: Int32Array; j: Int32Array; c: Float64Array; s: Float64Array }
const gradientCaches: GradientCache[] = [];
function gradientCache(k: number): GradientCache {
  let cache = gradientCaches[k];
  if (!cache) cache = gradientCaches[k] = { i: new Int32Array(GRADIENT_CACHE), j: new Int32Array(GRADIENT_CACHE), c: new Float64Array(GRADIENT_CACHE), s: new Float64Array(GRADIENT_CACHE) };
  cache.i.fill(0x7fffffff); cache.j.fill(0x7fffffff);
  return cache;
}
function cachedNoise(x: number, y: number, seed: number, cache: GradientCache): number {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const dot = (a: number, b: number, dx: number, dy: number): number => {
    const slot = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & (GRADIENT_CACHE - 1);
    if (cache.i[slot] !== a || cache.j[slot] !== b) {
      let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
      h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
      const angle = (h >>> 0) / 4294967296 * Math.PI * 2;
      cache.i[slot] = a; cache.j[slot] = b; cache.c[slot] = Math.cos(angle); cache.s[slot] = Math.sin(angle);
    }
    return cache.c[slot] * dx + cache.s[slot] * dy;
  };
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = dot(i, j, fx, fy), b = dot(i + 1, j, fx - 1, fy), c = dot(i, j + 1, fx, fy - 1), d = dot(i + 1, j + 1, fx - 1, fy - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4;
}

export function seedHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h | 0;
}

/** Shape of the fractal refinement; shared by the CPU path and the WebGL renderer. */
export interface FractalDetail {
  /** Amplitude, in source cells, on a unit slope (45°). */
  amplitude: number;
  /** Hurst exponent: amplitude ∝ wavelength^H (low: rough, high: smooth). */
  hurst: number;
  /** Wavelength ratio between successive octaves. */
  lacunarity: number;
  octaves: number;
  /** First octave's wavelength, in source cells. */
  start: number;
  /** Slope exponent γ: amplitude ∝ (slope + flat)^γ (0: uniform, 1: linear). */
  slope: number;
  /** Slope floor: detail kept on flats. */
  flat: number;
  /** Height (metres) over which the detail fades in from the shore. */
  shore: number;
}
export const DEFAULT_FRACTAL_DETAIL: FractalDetail = { amplitude: 0.008, hurst: 1, lacunarity: 1.5, octaves: 8, start: 1, slope: 0.5, flat: 0.004, shore: 2 };
/** Octave rotations, shared with the WebGL renderer. */
export const FRACTAL_ROTATIONS = [0.3, 1.1, 2.2, 0.7, 2.9, 1.7, 0.1, 2.5, 1.4, 2.0, 0.5, 2.7];

/**
 * Fractal refinement below the source raster's cell `sourceCell`: self-affine
 * octaves whose amplitude follows a power of the local slope, so slopes gain
 * rills and rock while flats keep a faint texture. Octaves stop at two samples, so a coarse view is
 * unchanged and zooming in adds detail without pixels.
 */
export function applyFractalDetail(data: SurfaceData, sourceCell: number, seed: number, detail: FractalDetail = DEFAULT_FRACTAL_DETAIL): void {
  const n = data.resolution, cell = data.width / n;
  const octaves: number[] = [], lacunarity = Math.max(1.1, detail.lacunarity);
  const count = Math.min(FRACTAL_ROTATIONS.length, Math.round(detail.octaves));
  for (let wavelength = sourceCell * detail.start; wavelength >= 2 * cell && octaves.length < count; wavelength /= lacunarity) octaves.push(wavelength);
  if (!octaves.length || !detail.amplitude) return;
  const change = new Float32Array(n * n);
  const rotation = octaves.map((wavelength, k) => ({ c: Math.cos(FRACTAL_ROTATIONS[k]), s: Math.sin(FRACTAL_ROTATIONS[k]), amplitude: Math.pow(wavelength / sourceCell, detail.hurst), seed: seed + k * 7919, cache: gradientCache(k) }));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, h = data.height[i];
    if (h <= 0) continue;
    const nz = Math.max(1e-6, data.normalZ[i]), slope = Math.hypot(data.normalX[i], data.normalY[i]) / nz;
    const scale = detail.amplitude * Math.pow(slope + detail.flat, detail.slope) * sourceCell;
    const wx = data.x + (x + 0.5) * cell, wy = data.y + (y + 0.5) * cell;
    let v = 0;
    for (let k = 0; k < octaves.length; k++) {
      const o = rotation[k], wavelength = octaves[k], u = (wx * o.c - wy * o.s) / wavelength, w = (wx * o.s + wy * o.c) / wavelength;
      v += cachedNoise(u, w, o.seed, o.cache) * scale * o.amplitude;
    }
    // Fade out near the shore: the coast keeps its line.
    v *= detail.shore > 0 ? Math.min(1, h / detail.shore) : 1;
    change[i] = v; data.height[i] = h + v;
  }
  addGradient(data, change);
}

/** Physical neural fields use identity coordinates for refinement registration. */
export function neuralWindow(_extent: number, width: number, _mode: 'crop' | 'scale', _slopes: boolean, _coastMask: number): { x: number; y: number; width: number; heightScale: number } {
  if (!Number.isFinite(width) || width <= 0) throw new Error('Invalid neural surface extent.');
  return { x: 0, y: 0, width, heightScale: 1 };
}

export function fitNeuralSurface(heights: Float32Array, extent: number, width: number, mode: 'crop' | 'scale', slopes: boolean, coastMask: number): Float32Array {
  if (!Number.isFinite(extent) || extent <= 0 || extent !== width) throw new Error('Neural surface extent must match the requested map extent.');
  neuralWindow(extent, width, mode, slopes, coastMask);
  return heights;
}

/** Cubic B-spline upsampling of an `m²` grid to `n²` over the same extent. */
export function upsampleDelta(delta: Float32Array, m: number, n: number): Float32Array {
  if (m === n) return delta;
  const out = new Float32Array(n * n), f = m / n;
  const axis = (k: number): [number[], number[]] => {
    const g = Math.max(0, Math.min(m - 1, (k + 0.5) * f - 0.5)), i = Math.floor(g), t = g - i, u = 1 - t;
    return [[i - 1, i, i + 1, i + 2].map(v => Math.max(0, Math.min(m - 1, v))), [u ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6]];
  };
  const axes = Array.from({ length: n }, (_, k) => axis(k));
  for (let y = 0; y < n; y++) {
    const [ri, rw] = axes[y];
    for (let x = 0; x < n; x++) {
      const [ci, cw] = axes[x];
      let v = 0;
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) v += delta[ri[a] * m + ci[b]] * rw[a] * cw[b];
      out[y * n + x] = v;
    }
  }
  return out;
}
