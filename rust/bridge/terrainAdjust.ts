/**
 * Adjustments of sampled terrain regions in the bench: a height change kept
 * on a coarse grid (pre-hydrology conditioning), fractal refinement below the
 * source raster's cell, and the fit of a 40 km neural surface to the map.
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
function gradientNoise(x: number, y: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const dot = (a: number, b: number, dx: number, dy: number): number => {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    const angle = (h >>> 0) / 4294967296 * Math.PI * 2;
    return Math.cos(angle) * dx + Math.sin(angle) * dy;
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

/**
 * Fractal refinement below the source raster's cell `sourceCell`: self-affine
 * octaves (Hurst 0.8) whose amplitude follows the local slope, so slopes gain
 * rills and rock while flats stay flat. Octaves stop at two samples, so a
 * coarse view is unchanged and zooming in adds detail without pixels.
 */
export function applyFractalDetail(data: SurfaceData, sourceCell: number, seed: number): void {
  const n = data.resolution, cell = data.width / n;
  const octaves: number[] = [];
  for (let wavelength = sourceCell; wavelength >= 2 * cell && octaves.length < 8; wavelength /= 2) octaves.push(wavelength);
  if (!octaves.length) return;
  const change = new Float32Array(n * n);
  const rotation = [0.3, 1.1, 2.2, 0.7, 2.9, 1.7, 0.1, 2.5];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, h = data.height[i];
    if (h <= 0) continue;
    const nz = Math.max(1e-6, data.normalZ[i]), slope = Math.hypot(data.normalX[i], data.normalY[i]) / nz;
    const wx = data.x + (x + 0.5) * cell, wy = data.y + (y + 0.5) * cell;
    let v = 0;
    octaves.forEach((wavelength, k) => {
      const c = Math.cos(rotation[k]), s = Math.sin(rotation[k]), u = (wx * c - wy * s) / wavelength, w = (wx * s + wy * c) / wavelength;
      v += gradientNoise(u, w, seed + k * 7919) * 0.18 * (slope + 0.004) * sourceCell * Math.pow(wavelength / sourceCell, 0.8);
    });
    // Fade out near the shore: the coast keeps its line.
    v *= Math.min(1, h / 2);
    change[i] = v; data.height[i] = h + v;
  }
  addGradient(data, change);
}

/** Sea and land directions of the eight coast bits (N, NE, … NW, y pointing south). */
function coastShift(mask: number): [number, number] {
  let sx = 0, sy = 0;
  for (let k = 0; k < 8; k++) if (mask & (1 << k)) {
    const a = k * Math.PI / 4 - Math.PI / 2;
    sx += Math.cos(a); sy += Math.sin(a);
  }
  const l = Math.hypot(sx, sy);
  return l < 1e-6 ? [0, 0] : [sx / l, sy / l];
}

/**
 * Fits the 40 km neural surface (`1024²`) to a map of `width` metres:
 * `crop` keeps a window of the map's size, moved towards the coasts so they
 * stay in view; `scale` stretches the whole surface, and with `slopes` scales
 * its heights alike to keep its slopes. Returns a `1024²` surface.
 */
export function neuralWindow(extent: number, width: number, mode: 'crop' | 'scale', slopes: boolean, coastMask: number): { x: number; y: number; width: number; heightScale: number } {
  if (mode === 'scale' || width >= extent) {
    return { x: 0, y: 0, width: extent, heightScale: slopes ? width / extent : 1 };
  }
  const [sx, sy] = coastMask === 255 ? [0, 0] : coastShift(coastMask), free = (extent - width) / 2;
  return { x: free + sx * free * 0.9, y: free + sy * free * 0.9, width, heightScale: 1 };
}

export function fitNeuralSurface(heights: Float32Array, extent: number, width: number, mode: 'crop' | 'scale', slopes: boolean, coastMask: number): Float32Array {
  const n = 1024;
  if (mode === 'scale' || width >= extent) {
    if (width === extent || !slopes) return heights;
    const k = width / extent;
    return Float32Array.from(heights, h => h * k);
  }
  const window = neuralWindow(extent, width, mode, slopes, coastMask);
  const ox = window.x, oy = window.y, source = extent / n, out = new Float32Array(n * n);
  // Catmull–Rom interpolation of the window, sample centres to sample centres.
  const at = (x: number, y: number): number => heights[Math.max(0, Math.min(n - 1, y)) * n + Math.max(0, Math.min(n - 1, x))];
  const weights = (t: number): number[] => [(-t * t * t + 2 * t * t - t) / 2, (3 * t * t * t - 5 * t * t + 2) / 2, (-3 * t * t * t + 4 * t * t + t) / 2, (t * t * t - t * t) / 2];
  for (let y = 0; y < n; y++) {
    const gy = (oy + (y + 0.5) * width / n) / source - 0.5, j = Math.floor(gy), wy = weights(gy - j);
    for (let x = 0; x < n; x++) {
      const gx = (ox + (x + 0.5) * width / n) / source - 0.5, i = Math.floor(gx), wx = weights(gx - i);
      let v = 0;
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) v += at(i + b - 1, j + a - 1) * wy[a] * wx[b];
      out[y * n + x] = v;
    }
  }
  return out;
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
