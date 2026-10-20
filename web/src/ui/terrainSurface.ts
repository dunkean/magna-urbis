import { FRACTAL_ROTATIONS } from '../../../rust/bridge/terrainAdjust';
import type { HeightLayer, TerrainLook } from './terrainGl';
import { createTerrain3dNoiseSampler } from './terrain3dNoise';

/** Box-filtered pyramid of a square grid, largest first (the engine's Surface). */
export function heightPyramid(data: Float32Array, n: number): Float32Array[] {
  const levels = [data];
  let size = n;
  while (size > 1 && size % 2 === 0) {
    const previous = levels[levels.length - 1], half = size / 2, next = new Float32Array(half * half);
    for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) {
      const i = 2 * y * size + 2 * x;
      next[y * half + x] = (previous[i] + previous[i + 1] + previous[i + size] + previous[i + size + 1]) * .25;
    }
    levels.push(next); size = half;
  }
  return levels;
}

interface PreparedLayer { layer: HeightLayer; levels: Float32Array[]; cell: number; inset: number }
const pyramids = new WeakMap<Float32Array, { n: number; levels: Float32Array[] }>();
function prepare(layer: HeightLayer, base: boolean): PreparedLayer {
  let levels = [layer.data];
  if (base) {
    let cached = pyramids.get(layer.data);
    if (!cached || cached.n !== layer.n) {
      cached = { n: layer.n, levels: heightPyramid(layer.data, layer.n) }; pyramids.set(layer.data, cached);
    }
    levels = cached.levels;
  }
  return { layer, levels, cell: layer.width / layer.n, inset: base ? 0 : 2 * layer.width / layer.n };
}

// Shader-equivalent gradient noise. terrainAdjust's array mutation API uses a
// hard octave cutoff; this point sampler needs the shader's continuous fade.
const cacheSize = 4096, hashes = new Uint32Array(cacheSize), valid = new Uint8Array(cacheSize);
const cosines = new Float64Array(cacheSize), sines = new Float64Array(cacheSize);
function noiseDot(x: number, y: number, dx: number, dy: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h = (h ^ (h >>> 16)) >>> 0;
  const slot = h & (cacheSize - 1);
  if (!valid[slot] || hashes[slot] !== h) {
    const angle = h / 4294967296 * Math.PI * 2;
    hashes[slot] = h; cosines[slot] = Math.cos(angle); sines[slot] = Math.sin(angle); valid[slot] = 1;
  }
  return cosines[slot] * dx + sines[slot] * dy;
}
function gradientNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = noiseDot(ix, iy, fx, fy, seed), b = noiseDot(ix + 1, iy, fx - 1, fy, seed);
  const c = noiseDot(ix, iy + 1, fx, fy - 1, seed), d = noiseDot(ix + 1, iy + 1, fx - 1, fy - 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4;
}

/** Retained, fully settled renderer surface in world metres. Pixel footprint is
 * metres per device pixel, matching TerrainGl's uPx; omitted means finest detail.
 * Inputs are retained immutable grids. No engine generation or per-query grids. */
export function createTerrainSurfaceSampler(base: HeightLayer, look: TerrainLook, details: HeightLayer[] = [], enhanced3d = false): (x: number, y: number, metresPerPixel?: number) => number {
  const fallback = prepare(base, true), layers = details.map(layer => prepare(layer, false)).reverse();
  const floor = look.floor, sourceCell = look.sourceCell, detail = { ...look.detail };
  const refine = !enhanced3d && look.refine && sourceCell > 0 && detail.amplitude !== 0;
  const octaves: { wavelength: number; c: number; s: number; amplitude: number; seed: number }[] = [];
  const count = Math.max(0, Math.min(FRACTAL_ROTATIONS.length, Math.round(detail.octaves)));
  let wavelength = sourceCell * detail.start;
  for (let k = 0; refine && k < count && wavelength > 0; k++, wavelength /= Math.max(1.1, detail.lacunarity)) {
    octaves.push({ wavelength, c: Math.cos(FRACTAL_ROTATIONS[k]), s: Math.sin(FRACTAL_ROTATIONS[k]),
      amplitude: Math.pow(wavelength / sourceCell, detail.hurst), seed: (look.seed + k * 7919) >>> 0 });
  }
  const weights = new Float64Array(16);
  let height = 0, gradientX = 0, gradientY = 0;
  const axis = (offset: number, t: number): void => {
    const u = 1 - t, t2 = t * t, t3 = t2 * t;
    weights[offset] = u * u * u / 6; weights[offset + 1] = (3 * t3 - 6 * t2 + 4) / 6;
    weights[offset + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6; weights[offset + 3] = t3 / 6;
    weights[offset + 4] = -.5 * u * u; weights[offset + 5] = 1.5 * t2 - 2 * t;
    weights[offset + 6] = -1.5 * t2 + t + .5; weights[offset + 7] = .5 * t2;
  };
  const level = (prepared: PreparedLayer, lod: number, x: number, y: number): void => {
    const { layer, levels } = prepared, n = Math.max(1, layer.n >> lod), cell = prepared.cell * 2 ** lod;
    const gx = (x - layer.x) / cell - .5, gy = (y - layer.y) / cell - .5;
    const bx = Math.floor(gx), by = Math.floor(gy), data = levels[lod];
    axis(0, gx - bx); axis(8, gy - by);
    height = gradientX = gradientY = 0;
    for (let j = 0; j < 4; j++) {
      const row = Math.max(0, Math.min(n - 1, by + j - 1)) * n;
      let value = 0, derivative = 0;
      for (let i = 0; i < 4; i++) {
        const sample = data[row + Math.max(0, Math.min(n - 1, bx + i - 1))];
        value += sample * weights[i]; derivative += sample * weights[i + 4];
      }
      height += value * weights[j + 8]; gradientX += derivative * weights[j + 8]; gradientY += value * weights[j + 12];
    }
    gradientX /= cell; gradientY /= cell;
  };
  const filtered = (prepared: PreparedLayer, lower: number, t: number, x: number, y: number): void => {
    level(prepared, lower, x, y);
    if (t > .001 && lower < prepared.levels.length - 1) {
      const h = height, gx = gradientX, gy = gradientY;
      level(prepared, lower + 1, x, y);
      height = h + (height - h) * t; gradientX = gx + (gradientX - gx) * t; gradientY = gy + (gradientY - gy) * t;
    }
  };
  const sampler = (x: number, y: number, metresPerPixel = 0): number => {
    const px = Number.isFinite(metresPerPixel) ? Math.max(0, metresPerPixel) : 0;
    let prepared = fallback;
    for (const candidate of layers) {
      const { layer, inset } = candidate;
      if (x >= layer.x + inset && y >= layer.y + inset && x <= layer.x + layer.width - inset && y <= layer.y + layer.width - inset) { prepared = candidate; break; }
    }
    const maxLod = prepared.levels.length - 1;
    const lod = Math.max(0, Math.min(maxLod, Math.log2(Math.max(1, px / prepared.cell)) - .5)), lower = Math.floor(lod), t = lod - lower;
    filtered(prepared, lower, t, x, y);
    if (floor > 0) height = Math.max(height, floor);
    if (refine && height > 0 && px * 2 < sourceCell * detail.start) {
      const scale = detail.amplitude * Math.pow(Math.max(Math.hypot(gradientX, gradientY) + detail.flat, 1e-6), detail.slope) * sourceCell;
      let sum = 0;
      for (const octave of octaves) {
        const weight = px > 0 ? Math.max(0, Math.min(1, octave.wavelength / px * .5 - 1)) : 1;
        if (weight <= 0) break;
        const noise = gradientNoise((x * octave.c - y * octave.s) / octave.wavelength, (x * octave.s + y * octave.c) / octave.wavelength, octave.seed);
        sum += noise * octave.amplitude * weight;
      }
      height += sum * scale * (detail.shore > 0 ? Math.max(0, Math.min(1, height / detail.shore)) : 1);
    }
    return height;
  };
  return enhanced3d ? createTerrain3dNoiseSampler(sampler, look) : sampler;
}
