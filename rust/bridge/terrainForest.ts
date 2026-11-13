/** Render3D forest: one canonical CPU control field per applied tile, plus a
 * world-space GLSL appearance sampled identically by the top-down view, the
 * perspective view and the raster export. Own procedural model; ideas from
 * Boolean-model coverage, crown allometry (Jucker et al. 2017), forest-edge
 * structure (Harper et al. 2005) and the growing-season treeline isotherm
 * (Körner & Paulsen 2004). Its Render eligibility guide re-evaluates terms of
 * the Neural Earth material ported in terrainMaterial.ts (GPL-3.0), and the
 * shader keeps Render's colour as the unresolved reference. Display only:
 * never feeds terrain. */

import { LAND_DETAIL_GLSL } from './terrainMaterialOccupation';
import { RENDER_V2_ZONE_GLSL } from './terrainRenderV2Zones';
import { forestBeachGrid } from './terrainForestBeach';
import { FOREST_BANK_GLSL, forestBankDensity, forestBankField, forestLakeInterior, forestRoutingRiverSegments, forestSegmentsKey, type ForestBank } from './terrainForestRiparian';
import { forestPlanes } from './forestNative';
import { executionRuntime, type ExecutionRuntime } from '../../web/src/ui/executionProfile';

export interface ForestSettings { enabled: boolean; density: number; clearings: number }
/** density 0..2 (1 = climate potential), clearings 0..1. */
export const DEFAULT_FOREST_SETTINGS: ForestSettings = { enabled: true, density: 1, clearings: .45 };
/** Included in completed-field and display-cache keys, not terrain identity. */
export const V2_FOREST_PROFILE_VERSION = 'optical-thinning4';
/** Occupation RGBA8: R/G signed distance to open/forest land, encoded
 * clamp(128+16d) in native texels (positive inside); B class id (0 none,
 * 1 field, 2 meadow, 3 pasture, 4 orchard, 5 garden, 6 commons, 7 built reserve, 8 occupied construction);
 * 9 agricultural lane clearance, 10 marsh, 11 forest clearing (main road corridor, farmstead ground), 12 covered way
 * (small road or track under the canopy); A 255 inside applied polygons. */
export interface ForestOccupation { x: number; y: number; width: number; n: number; rgba: Uint8Array; key: string; /** Holdings for the satellite ground, on their own finer grid. */ detail?: LandDetail;
  /** Exact ways (roads, town streets; render/forestRoom.ts corridors) for the modelled trees: the raster is too coarse
   * to keep a trunk off a street a few metres wide. */
  ways?: readonly { path: readonly { x: number; y: number }[]; half: number | readonly number[]; covered?: boolean }[] }
/** Holdings raster (web/src/ui/landDetail.ts): R cropping system and crop (a plot identity in gardens), G and B cos 2a and sin 2a of the row direction, A edge distance over its range. */
export interface LandDetail { x: number; y: number; width: number; n: number; rgba: Uint8Array; key: string; /** Quantized parcel frames, matching GB. */ orchards?: { poly: { x: number; y: number }[]; holes?: { x: number; y: number }[][]; along: [number, number] }[] }
/** RGBA8 world raster on the height layer's square: R canopy cover 0..1,
 * G potential canopy height 0..50 m (also where cover is 0), B needleleaf
 * fraction, A stand tone (age/disturbance, .5 neutral). Texel centres at
 * x+(i+.5)·width/n. Natural cover only: occupation is applied per fragment at
 * its native resolution, and only enters the key. R and G both carry Render's
 * tree eligibility E (rock, slope, perennial snow, treeline): cover·E and
 * height·E, so ineligible ground has no stand, woods prior or orchard tree.
 * Inside the riparian envelope G carries the gallery stature instead. `bank`
 * is the narrow bank-envelope raster on the same texels (ForestBank.rgba).
 * bankDensity is the applied 0..2 density control for gallery candidates;
 * its area channel is already scaled, and its bank geometry stays unchanged. */
export type ForestBeachGrid = ReturnType<typeof forestBeachGrid>;
/** `beach`: V2 crown-root beach grid (0..255) over the height layer, read by the shaders as uForestBeach. */
export interface ForestField { x: number; y: number; width: number; n: number; rgba: Uint8Array; bank?: Uint8Array; bankDensity?: number; clearingProfile?: 'progressive'; beach?: ForestBeachGrid; key: string }
export interface ForestFieldInput {
  /** Material seed, the same uint as uMaterialSeed (seedHash(settings.seed)). */
  seed: number;
  /** Sea-level annual mean Celsius, annual precipitation mm. */
  climate: readonly [number, number];
  height: { x: number; y: number; width: number; n: number; data: Float32Array };
  /** Routing-grid codes: 0 land, 1 sea, 2 lake, 3 river. Lake interiors and a
   * fallback only; its deliberately widened safety buffer never defines banks. */
  water?: Uint8Array;
  /** Displayed river geometry, nine floats per segment (ax, ay, bx, by,
   * widthA, widthB, r, g, b; metres): defines the narrow gallery envelope. */
  riverSegments?: Float32Array;
  occupation?: ForestOccupation;
  /** V2 appearance only: bounded thinning of the same seeded disturbance field.
   * Omitted preserves Render3D's historical population exactly. */
  clearingProfile?: 'progressive';
}

/** Field texels of about 16 m, capped at 1024² (39 m over 40 km). */
export function forestFieldResolution(width: number): number {
  return Math.max(32, Math.min(1024, Math.ceil(width / 16)));
}

function clamp(v: number, a = 0, b = 1): number { return v < a ? a : v > b ? b : v; }
function sstep(a: number, b: number, v: number): number {
  let t = (v - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
export function forestHash(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x9e3779b9) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(z, 0xc2b2ae35) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
const GX = new Float64Array(16), GY = new Float64Array(16);
for (let i = 0; i < 16; i++) { GX[i] = Math.cos(i * Math.PI / 8 + .2); GY[i] = Math.sin(i * Math.PI / 8 + .2); }
/** 2D gradient noise, unit standard deviation (measured .2156 before scaling). */
function noise(x: number, y: number, salt: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let h = forestHash(ix, iy, 0, salt) & 15; const a = GX[h] * fx + GY[h] * fy;
  h = forestHash(ix + 1, iy, 0, salt) & 15; const b = GX[h] * (fx - 1) + GY[h] * fy;
  h = forestHash(ix, iy + 1, 0, salt) & 15; const c = GX[h] * fx + GY[h] * (fy - 1);
  h = forestHash(ix + 1, iy + 1, 0, salt) & 15; const d = GX[h] * (fx - 1) + GY[h] * (fy - 1);
  return ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v) * 4.639;
}
/** Fixed octave set (never footprint- or resolution-dependent), unit variance. */
function fbm(x: number, y: number, wavelength: number, octaves: number, salt: number): number {
  let sum = 0, norm = 0, a = 1, l = wavelength;
  for (let i = 0; i < octaves; i++) { sum += a * noise(x / l + 31.7 * i, y / l - 17.3 * i, salt + i * 0x9e37); norm += a * a; a *= .55; l *= .5; }
  return sum / Math.sqrt(norm);
}
/** Unit-Gaussian upper quantile via the logistic approximation of the normal CDF. */
const upperQuantile = (fraction: number): number => Math.log((1 - fraction) / fraction) / 1.702;

/** Separable box blur applied twice (triangle kernel), clamped edges. */
function blur(src: Float32Array, n: number, radius: number): Float32Array {
  if (radius < 1) return src.slice();
  const a = src.slice(), row = new Float64Array(n + 2 * radius + 1), scale = 1 / (2 * radius + 1);
  // Transposing passes: four horizontal passes = two separable 2D box blurs.
  let from = a, to = new Float32Array(n * n);
  for (let pass = 0; pass < 4; pass++) {
    for (let line = 0; line < n; line++) {
      const base = line * n;
      for (let k = 0; k < row.length; k++) row[k] = from[base + Math.min(n - 1, Math.max(0, k - radius))];
      let sum = 0;
      for (let k = 0; k <= 2 * radius; k++) sum += row[k];
      for (let k = 0; k < n; k++) { to[k * n + line] = sum * scale; sum += row[k + 2 * radius + 1] - row[k]; }
    }
    const swap = from; from = to; to = swap;
  }
  return from;
}
function fnv(bytes: Uint8Array, hash = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193);
  return hash >>> 0;
}

// Exact port of Neural Earth's surfaceNoise/surfaceFbm/surfaceCover
// (terrainMaterial.ts): same uint hash (forestHash), gradients and fades, so the
// eligibility guide sees the same rock pattern as the Render material.
function surfaceCorner(cx: number, cy: number, cz: number, fx: number, fy: number, fz: number, salt: number): number {
  const h = forestHash(cx, cy, cz, salt);
  return ((h & 1023) / 511.5 - 1) * fx + (((h >>> 10) & 1023) / 511.5 - 1) * fy + (((h >>> 20) & 1023) / 511.5 - 1) * fz;
}
function surfaceNoise(x: number, y: number, z: number, salt: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  let a0 = surfaceCorner(ix, iy, iz, fx, fy, fz, salt), a1 = surfaceCorner(ix + 1, iy, iz, fx - 1, fy, fz, salt);
  let a2 = surfaceCorner(ix, iy + 1, iz, fx, fy - 1, fz, salt), a3 = surfaceCorner(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz, salt);
  let x0 = a0 + (a1 - a0) * ux, x1 = a2 + (a3 - a2) * ux;
  const y0 = x0 + (x1 - x0) * uy;
  // The map plane z = 0 has u.z = 0: the upper layer has no weight.
  if (uz === 0) return y0 * 5.25;
  a0 = surfaceCorner(ix, iy, iz + 1, fx, fy, fz - 1, salt); a1 = surfaceCorner(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1, salt);
  a2 = surfaceCorner(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1, salt); a3 = surfaceCorner(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1, salt);
  x0 = a0 + (a1 - a0) * ux; x1 = a2 + (a3 - a2) * ux;
  return (y0 + (x0 + (x1 - x0) * uy - y0) * uz) * 5.25;
}
/** [unit-variance resolved pattern, retained variance]; octaves fade by footprint as in the shader. */
function surfaceFbm(x: number, y: number, z: number, scale: number, octaves: number, footprint: number, salt: number, out: number[]): void {
  let value = 0, kept = 0, total = 0, s = scale, a = 1;
  for (let i = 0; i < octaves; i++) {
    total += a * a;
    if (footprint < s * .25) {
      const fade = 1 - sstep(s * .125, s * .25, footprint);
      value += a * fade * surfaceNoise(x / s, y / s, z / s, (salt + i * 0x9e37) >>> 0); kept += a * fade * a * fade;
    }
    a *= .5; s *= .5;
  }
  out[0] = kept > 0 ? value / Math.sqrt(kept) : 0; out[1] = kept / total;
}
function surfaceCover(fraction: number, pattern: number, retained: number, sharp: number): number {
  const c = clamp(fraction);
  return c + clamp(sharp) * c * (1 - c) * pattern / Math.sqrt(1 + pattern * pattern) * Math.sqrt(retained);
}
const ROCK_TAN = Math.tan(40 * Math.PI / 180);

/** Render's tree eligibility E in [0,1] per field texel: the semantic terms of
 * Neural Earth's surfaceMaterial (outcrop exposure and its crag/grove pattern,
 * the canopy slope gate, perennial snow, the summer treeline ramp), evaluated
 * once at canonical footprints instead of the display one. Relief terms use
 * the height grid per texel; noise patterns use lattices of their own scale.
 * Material semantics only: never classified from colour. Display only. */
function renderEligibility(layer: ForestFieldInput['height'], climate: readonly [number, number], seed: number, N: number,
  heightAt: (wx: number, wy: number) => number): Float32Array {
  const [T, P] = climate, cell = layer.width / N, source = layer.width / layer.n, eligible = new Float32Array(N * N), fbm2 = [0, 0];
  // Patterns on lattices, bilinear per texel. Crag (700 m, octaves to 87.5 m)
  // every second texel with the shader's octave fade at that spacing; grove
  // (4.8 km to 600 m) and the 64/48 km regional fields every ~140 m.
  const sampleLattice = (step: number, channels: number, fill: (x: number, y: number, out: Float32Array, o: number) => void) => {
    const M = Math.ceil(N / step) + 2, values = new Float32Array(M * M * channels);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) fill(layer.x + (i * step + .5) * cell, layer.y + (j * step + .5) * cell, values, (j * M + i) * channels);
    return { step, M, channels, values };
  };
  const cragStep = 2, crag = sampleLattice(cragStep, 2, (x, y, out, o) => {
    surfaceFbm(x, y, 0, 700, 4, cragStep * cell, (seed + 4) >>> 0, fbm2); out[o] = fbm2[0]; out[o + 1] = fbm2[1];
  });
  // Render's 2D material: TPI against the mean height ±max(300 m, 2 cells) away.
  const radius = Math.max(300, 2 * source);
  const coarse = sampleLattice(Math.max(1, Math.round(140 / cell)), 4, (x, y, out, o) => {
    surfaceFbm(x, y, 0, 4800, 4, cell, (seed + 3) >>> 0, fbm2); out[o] = fbm2[0] * Math.sqrt(fbm2[1]);
    surfaceFbm(x, y, 0, 64000, 4, cell, (seed + 1) >>> 0, fbm2); out[o + 1] = fbm2[0] * Math.sqrt(fbm2[1]);
    surfaceFbm(x + 5101, y - 2297, 3313, 48000, 4, cell, (seed + 2) >>> 0, fbm2); out[o + 2] = fbm2[0] * Math.sqrt(fbm2[1]);
    const lx = x - layer.x, ly = y - layer.y;
    out[o + 3] = (heightAt(lx + radius, ly) + heightAt(lx - radius, ly) + heightAt(lx, ly + radius) + heightAt(lx, ly - radius)) * .25;
  });
  const lerp = new Float64Array(4);
  const at = (l: typeof crag, i: number, j: number): void => {
    const gi = i / l.step, gj = j / l.step, cx = Math.min(l.M - 2, Math.floor(gi)), cy = Math.min(l.M - 2, Math.floor(gj)), fx = gi - cx, fy = gj - cy;
    const c = l.channels, c00 = (cy * l.M + cx) * c, c10 = c00 + c, c01 = c00 + l.M * c, c11 = c01 + c, v = l.values;
    for (let k = 0; k < c; k++) lerp[k] = (v[c00 + k] * (1 - fx) + v[c10 + k] * fx) * (1 - fy) + (v[c01 + k] * (1 - fx) + v[c11 + k] * fx) * fy;
  };
  // Render's continentality-free summer proxy is T+6; the field's growing season adds .5·max(0, 10−T).
  const boost = .5 * Math.max(0, 10 - T);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const wx = (i + .5) * cell, wy = (j + .5) * cell, o = j * N + i;
    const z = heightAt(wx, wy), h = Math.max(z, 0);
    if (z <= 0) continue;
    // Central slope on the source grid, as the 2D and raster materials.
    const gx = (heightAt(wx + source, wy) - heightAt(wx - source, wy)) / (2 * source), gy = (heightAt(wx, wy + source) - heightAt(wx, wy - source)) / (2 * source);
    at(coarse, i, j); const grove = lerp[0], m1 = lerp[1], m2 = lerp[2], tpi = (z - lerp[3]) / (6 * radius), grade = Math.sqrt(gx * gx + gy * gy);
    at(crag, i, j); const cragValue = lerp[0], cragKept = lerp[1];
    // surfaceMaterial at full locality and variation (fine footprints).
    const ts = clamp(T + 6 - .0065 * h, -45, 45), tw = clamp(T - 6 - .0065 * h, -45, 45);
    const tHot = Math.max(ts, tw) + .8 * m2 * (.25 + .75 * sstep(.015, .12, Math.abs(tpi)));
    const wetShift = Math.exp(.1 * m1), valley = sstep(0, -.12, tpi), ridge = sstep(0, .12, tpi);
    let humid = P / Math.max(20 * (ts + tw) * .5 + 280, 120) * wetShift;
    humid *= 1 + .7 * valley * (1 - sstep(1.5, 3, humid)) - .18 * ridge;
    const rockTanEff = ROCK_TAN * (.55 + .45 * sstep(.3, 1.3, humid)), alpine = 1 - sstep(2, 9, tHot);
    const exposure = sstep(rockTanEff * .5, rockTanEff * 1.3, grade) + .45 * alpine * sstep(rockTanEff * .15, rockTanEff * .7, grade)
      + .35 * ridge * sstep(.35, .9, grade / ROCK_TAN) - .3 * valley;
    const outcrop = surfaceCover(exposure, .75 * cragValue + .25 * grove, cragKept, .35);
    const supply = sstep(60, 400, P * wetShift * (1 + .5 * valley - .25 * ridge));
    const perennial = sstep(2.5, -2.5, Math.max(ts, tw) + .35 * m1) * supply;
    // Render: trees ∝ (1 − outcrop). Rock-coloured ground (outcrop ≳ .6) is
    // sharpened to almost no trees; mild outcrops keep most of their stands.
    const rock = sstep(.3, .85, 1 - outcrop) * (1 - sstep(ROCK_TAN * .9, ROCK_TAN * 1.6, grade));
    eligible[o] = rock * (1 - perennial) * sstep(5.5, 13.5, tHot + boost + .8 * valley);
  }
  return eligible;
}


/** CPU counterpart of canonical v2StandCoverage; optical gap law, not measured LAI. */
export function v2StandCoverage(cover: number, stand: number, disturbed: number, trop: number): number {
  const mosaic = .22 * (1 - .75 * trop);
  const density = Math.exp(mosaic * stand + .05 * stand * (1 - cover)) * (1 - .3 * disturbed * (1 - .7 * trop));
  return 1 - Math.pow(Math.max(1 - cover, .001), density);
}

let baseCache: { key: string; base: Float32Array; optical: Float32Array; eligible: Float32Array; bank?: ForestBank } | undefined;
let beachCache: { key: string; beach: ForestBeachGrid } | undefined;
/** Deterministic in (seed, climate, heights, water, rivers, settings); no Math.random.
 * Rust (`magna_urbis_terrain::forest`, `forestNative.ts`) in the local profile (native `/terrain/forest`)
 * and in isolated web workers (threads WASM package: ~7x faster than this TypeScript). The web main thread
 * and single-thread realms keep this TypeScript: its base and beach caches make slider edits ~4x faster than
 * a stateless single-thread WASM rebuild, and a cold build is within ~15 % (web-parity report, 2026-11-07).
 * Same bytes either way. */
export async function buildForestField(input: ForestFieldInput, settings: ForestSettings = DEFAULT_FOREST_SETTINGS, runtime: ExecutionRuntime = executionRuntime): Promise<ForestField> {
  if (runtime.profile !== 'local') {
    const { expectedWasmThreads, inWorker } = await import('./wasmThreads');
    if (!(inWorker() && expectedWasmThreads().mode === 'threads')) return buildForestFieldTs(input, settings);
  }
  const layer = input.height, [T, P] = input.climate, seed = input.seed >>> 0, n = layer.n;
  const density = clamp(settings.density, 0, 2), clearings = clamp(settings.clearings, 0, 1);
  const terrainKey = `forest7:${seed}:${T}:${P}:${layer.x},${layer.y},${layer.width},${n}:${fnv(new Uint8Array(layer.data.buffer, layer.data.byteOffset, layer.data.byteLength)).toString(36)}`
    + `:${input.water ? fnv(input.water).toString(36) : '-'}:${forestSegmentsKey(input.riverSegments)}`;
  const key = `${terrainKey}:${settings.enabled ? 1 : 0}:${density}:${clearings}:${input.occupation?.key ?? '-'}`
    + (input.clearingProfile === 'progressive' ? `:${V2_FOREST_PROFILE_VERSION}` : '');
  const planes = await forestPlanes({ seed, climate: input.climate, x: layer.x, y: layer.y, width: layer.width, n, height: layer.data,
    water: input.water, riverSegments: input.riverSegments, enabled: settings.enabled, density, clearings, progressive: input.clearingProfile === 'progressive' }, runtime);
  return { x: layer.x, y: layer.y, width: layer.width, n: planes.n, rgba: planes.rgba, bank: planes.bank, bankDensity: density, clearingProfile: input.clearingProfile, beach: planes.beach, key };
}
/** The TypeScript forest field (web main thread and single-thread realms), with its terrain-keyed base and beach caches. */
function buildForestFieldTs(input: ForestFieldInput, settings: ForestSettings): ForestField {
  const layer = input.height, [T, P] = input.climate, seed = input.seed >>> 0;
  const N = forestFieldResolution(layer.width), cell = layer.width / N, n = layer.n, source = layer.width / n;
  const density = clamp(settings.density, 0, 2), clearings = clamp(settings.clearings, 0, 1);
  const terrainKey = `forest7:${seed}:${T}:${P}:${layer.x},${layer.y},${layer.width},${n}:${fnv(new Uint8Array(layer.data.buffer, layer.data.byteOffset, layer.data.byteLength)).toString(36)}`
    + `:${input.water ? fnv(input.water).toString(36) : '-'}:${forestSegmentsKey(input.riverSegments)}`;
  const key = `${terrainKey}:${settings.enabled ? 1 : 0}:${density}:${clearings}:${input.occupation?.key ?? '-'}`
    + (input.clearingProfile === 'progressive' ? `:${V2_FOREST_PROFILE_VERSION}` : '');
  const rgba = new Uint8Array(N * N * 4), data = layer.data;
  const heightAt = (wx: number, wy: number): number => {
    if (n < 2) return data[0];
    const gx = clamp(wx / source - .5, 0, n - 1), gy = clamp(wy / source - .5, 0, n - 1);
    const x0 = Math.min(n - 2, Math.floor(gx)), y0 = Math.min(n - 2, Math.floor(gy)), fx = gx - x0, fy = gy - y0, k = y0 * n + x0;
    return (data[k] * (1 - fx) + data[k + 1] * fx) * (1 - fy) + (data[k + n] * (1 - fx) + data[k + n + 1] * fx) * fy;
  };
  // Base grid: heights (bilinear, cell-centred). Reused with the eligibility
  // and bank envelope while only density/clearings change, so slider edits
  // rebuild the full-res pass only.
  const B = Math.max(16, Math.ceil(N / 2)), bcell = layer.width / B;
  const cached = baseCache?.key === terrainKey ? baseCache : undefined;
  const base = cached?.base ?? new Float32Array(B * B * 5);
  const optical = cached?.optical ?? new Float32Array(B * B);
  const eligible = cached?.eligible ?? renderEligibility(layer, input.climate, seed, N, heightAt);
  let bank = cached?.bank;
  if (!cached) {
    // Narrow gallery envelope from the displayed river banks. Without that
    // geometry, routing river cells give a slightly wider fallback.
    const rivers = input.riverSegments ?? (input.water ? forestRoutingRiverSegments(input.water, { x: layer.x, y: layer.y, width: layer.width, n }) : undefined);
    const lake = forestLakeInterior(input.water, n, layer.width);
    bank = forestBankField(rivers, { x: layer.x, y: layer.y, width: layer.width, n: N },
      { seed, climate: input.climate, heightAt: (wx, wy) => heightAt(wx - layer.x, wy - layer.y), lakeAt: lake && ((wx, wy) => lake(wx - layer.x, wy - layer.y)) });
    // Render's eligibility stays authoritative on rock and above the treeline.
    if (bank) for (let o = 0; o < N * N; o++) {
      const gate = sstep(0, .4, eligible[o]);
      bank.rgba[o * 4 + 2] = Math.round(bank.rgba[o * 4 + 2] * gate); bank.rgba[o * 4 + 3] = Math.round(bank.rgba[o * 4 + 3] * eligible[o]);
    }
    const h = new Float32Array(B * B);
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) h[j * B + i] = heightAt((i + .5) * bcell, (j + .5) * bcell);
    const near = blur(h, B, Math.round(150 / bcell)), far = blur(h, B, Math.round(600 / bcell));
    // Landscape-scale noises (>= 520 m) on a ~140 m lattice, bilinear upsampled.
    const step = Math.max(1, Math.round(140 / bcell)), M = Math.ceil(B / step) + 2, coarse = new Float32Array(M * M * 6);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const x = layer.x + (i * step + .5) * bcell, y = layer.y + (j * step + .5) * bcell, o = (j * M + i) * 6;
      const wx = 900 * fbm(x, y, 5200, 2, seed + 11), wy = 900 * fbm(x + 7310, y - 2210, 5200, 2, seed + 13);
      coarse[o] = fbm(x + wx, y + wy, 2400, 3, seed + 17);         // stand mosaic 1–3 km
      coarse[o + 1] = fbm(x - wy, y + wx, 1100, 2, seed + 19);     // disturbance patches
      coarse[o + 2] = fbm(x, y, 1800, 2, seed + 23);               // conifer admixture
      coarse[o + 3] = fbm(x + wy, y - wx, 1300, 2, seed + 29);     // stand tone (independent)
      coarse[o + 4] = fbm(x, y, 9000, 2, seed + 31);               // regional productivity
      coarse[o + 5] = fbm(x, y, 520, 2, seed + 37);                // treeline raggedness
    }
    // Base channels: potential cover, clearing bias, height, needleleaf, tone.
    const wTropRegion = sstep(13, 19, T - 6), growBoost = .5 * Math.max(0, 10 - T), noise6 = new Float64Array(6);
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const o = j * B + i, z = h[o];
      const left = h[j * B + Math.max(0, i - 1)], right = h[j * B + Math.min(B - 1, i + 1)];
      const up = h[Math.max(0, j - 1) * B + i], down = h[Math.min(B - 1, j + 1) * B + i];
      const slope = Math.sqrt((right - left) ** 2 + (down - up) ** 2) / (2 * bcell);
      const tpiNear = (z - near[o]) / 150, tpiFar = (z - far[o]) / 600;
      const valley = Math.max(sstep(0, -.06, tpiFar), .7 * sstep(0, -.05, tpiNear));
      const ridge = Math.max(sstep(0, .06, tpiFar), .6 * sstep(0, .05, tpiNear));
      // Climate as earthMaterial (winter T−6, 6.5 °C/km lapse, Köppen-like threshold 20T+280 mm), but the
      // growing season warms with continentality: T+6 + .5·max(0, 10−T). Hyytiälä (T≈3.5) and BOREAS NSA
      // (T≈−3) carry 6–13 m closed forests with July ≈ 15–16 °C; T ≥ 10 °C is unchanged.
      const local = T - .0065 * Math.max(z, 0), grow = local + 6 + growBoost, humid0 = P / Math.max(20 * local + 280, 120);
      const gx = i / step, gy = j / step, cx = Math.min(M - 2, Math.floor(gx)), cy = Math.min(M - 2, Math.floor(gy)), fx = gx - cx, fy = gy - cy;
      const c00 = (cy * M + cx) * 6, c10 = c00 + 6, c01 = c00 + M * 6, c11 = c01 + 6;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      for (let c = 0; c < 6; c++) noise6[c] = coarse[c00 + c] * w00 + coarse[c10 + c] * w10 + coarse[c01 + c] * w01 + coarse[c11 + c] * w11;
      const stand = noise6[0], disturbed = sstep(1.05, 1.5, noise6[1]), conifer = noise6[2], toneNoise = noise6[3];
      // Valleys gather water, ridges drain (as earthMaterial). Rivers feed only
      // the narrow bank envelope (terrainForestRiparian), not a broad halo.
      const humid = humid0 * (1 + .7 * valley * (1 - sstep(1.5, 3, humid0)) - .18 * ridge) * Math.exp(.12 * noise6[4]);
      // Ragged treeline: ~6.4 °C growing-season isotherm, higher in sheltered gullies.
      const treeline = grow + .9 * noise6[5] + .7 * valley - .5 * ridge;
      // Rock, slope and snow come from Render's eligibility at full resolution.
      const thermal = sstep(5, 8.5, treeline), moisture = sstep(.38, 1.25, humid);
      const coverMax = .6 + .38 * sstep(.8, 2.2, humid);
      // Boreal wet flats open into bog and fen.
      const bog = valley * (1 - sstep(.02, .08, slope)) * sstep(1.6, 3, humid) * (1 - sstep(11, 17, grow)) * (1 - wTropRegion);
      let cover = thermal * moisture * coverMax * (1 - .6 * bog) * (1 - .2 * ridge * (1 - moisture));
      // Retain a separate V2 channel: either style can populate the shared
      // terrain cache first without changing historical cover or other fields.
      optical[o] = v2StandCoverage(cover, stand, disturbed, wTropRegion);
      // Wet tropical disturbance and stand mosaic mostly lower and lighten the
      // canopy (height, tone) rather than opening it: the canopy stays closed.
      const mosaic = .22 * (1 - .75 * wTropRegion);
      cover = clamp(cover * (1 + mosaic * stand) + .05 * stand * cover * (1 - cover)) * (1 - .3 * disturbed * (1 - .7 * wTropRegion));
      // Clearings open gentle ground and ridges first and keep steep slopes (zero-mean bias).
      const gentle = 1 - sstep(.05, .25, slope), rugged = sstep(.35, .8, slope);
      // Includes the 400 m clearing octave; the 200 m octave is added at full resolution.
      const bias = .45 * (ridge - valley) + .3 * (gentle - .5) - .6 * rugged + .35 * stand + .45 * noise6[4] + noise(layer.x / 400 + (i + .5) * bcell / 400, layer.y / 400 + (j + .5) * bcell / 400, seed + 41) / 1.077;
      // Potential height: climate productivity, valley boost, young regrowth patches.
      const thermalHeight = .5 * sstep(5.5, 9.5, grow) + .5 * sstep(9, 22, grow);
      let height = 3 + 31 * Math.pow(sstep(.4, 2.8, humid), .8) * thermalHeight;
      height *= (1 + (.16 + .08 * wTropRegion) * stand) * (1 - .55 * disturbed) * (1 + .15 * valley - .12 * ridge) * (.35 + .65 * sstep(5, 9, treeline));
      const needle = clamp(1 - sstep(10, 19, grow) + .3 * conifer + .35 * (1 - sstep(.7, 1.4, humid)) * (1 - wTropRegion) - wTropRegion);
      // Independent of cover and height, so closed tropical canopies still vary.
      const tone = clamp(.5 + (.16 + .1 * wTropRegion) * toneNoise + .22 * disturbed - .05 * valley);
      const b = o * 5;
      base[b] = cover; base[b + 1] = bias; base[b + 2] = height; base[b + 3] = needle; base[b + 4] = tone;
    }
    baseCache = { key: terrainKey, base, optical, eligible, bank };
  }
  // Full resolution: legacy clearings or bounded V2 thinning at 100–400 m,
  // then the independent physical eligibility and signed sea exclusion.
  // Target opened share of the potential forest. Closed wet tropical forest stays mostly closed (CHMv2 tropical
  // windows show no ≥ 1 ha opening, a known smoothing bias), so it keeps 15 %: ~2.7 % at the default.
  // The terrain bias widens the noise to a ~1.15 standard deviation.
  // V2 represents natural stands: wet productive forests retain fewer small
  // disturbance openings. This bounded appearance policy is not a measured
  // universal clearing rate. Rock, bog, drought and treeline gates stay intact.
  const humidAnnual = P / Math.max(20 * T + 280, 120);
  const clearingRate = input.clearingProfile === 'progressive' ? .4 + (.08 - .4) * sstep(.8, 1.8, humidAnnual) : .4;
  const clearedFraction = clearingRate * clearings * (1 - .85 * sstep(13, 19, T - 6)), threshold = 1.15 * upperQuantile(Math.max(clearedFraction, 1e-4));
  const byte = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : v * 255 + .5) | 0;
  for (let j = 0; j < N; j++) {
    const wy = (j + .5) * cell, gy = clamp(wy / bcell - .5, 0, B - 1), y0 = Math.min(B - 2, Math.floor(gy)), fy = gy - y0;
    for (let i = 0; i < N; i++) {
      const wx = (i + .5) * cell, o = j * N + i, gx = clamp(wx / bcell - .5, 0, B - 1), x0 = Math.min(B - 2, Math.floor(gx)), fx = gx - x0;
      const b00 = (y0 * B + x0) * 5, b10 = b00 + 5, b01 = b00 + B * 5, b11 = b01 + 5;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const at = (c: number): number => base[b00 + c] * w00 + base[b10 + c] * w10 + base[b01 + c] * w01 + base[b11 + c] * w11;
      const score = .4 * noise((layer.x + wx) / 200 + 31.7, (layer.y + wy) / 200 - 17.3, seed + 41 + 0x9e37) / 1.077 + at(1);
      // The same 100--400 m score thins V2 stands instead of clearing cells.
      // Symmetric, unbiased scores retain mean loss c before the .55 cap;
      // physical openings and the historical Render3D threshold stay separate.
      const opened = clearedFraction <= 0 ? 0 : input.clearingProfile === 'progressive'
        ? Math.min(.55, 2 * clearedFraction / (1 + Math.exp(clamp(-score / 1.15, -20, 20))))
        : sstep(threshold - .25, threshold + .25, score);
      const potential = input.clearingProfile === 'progressive'
        ? optical[y0 * B + x0] * w00 + optical[y0 * B + x0 + 1] * w10 + optical[(y0 + 1) * B + x0] * w01 + optical[(y0 + 1) * B + x0 + 1] * w11
        : at(0);
      let cover = potential * (1 - opened);
      if (density !== 1) cover = 1 - Math.pow(1 - Math.min(cover, .999), density);
      // After the density control, so it cannot reforest rock or the treeline.
      // Height stays whole down to E = .4, then collapses: sparse marginal
      // stands keep real trees, ineligible ground has no height for the
      // woods prior or open-land trees (both gated by height in the shader).
      const e = eligible[o];
      cover *= e;
      // Water labels come from the routing raster: narrow rivers deliberately
      // occupy at least 1.2 cells there. Applying that safety buffer to canopy
      // creates square clear corridors and slices crowns along cell edges.
      // The shared water pass composites the actual banks over complete crowns.
      if (!settings.enabled || heightAt(wx, wy) <= 0) cover = 0;
      // Inside the bank envelope the gallery stature replaces the potential
      // height where natural cover is sparse: low shrubs on ordinary arid
      // banks, taller broadleaf gallery trees in sheltered or wetter reaches.
      const g = bank ? bank.weight[o] * (1 - sstep(.2, .6, cover)) : 0;
      const height = g > 0 ? at(2) + (bank!.stature[o] - at(2)) * g : at(2);
      rgba[o * 4] = byte(cover); rgba[o * 4 + 1] = byte(height * sstep(0, .4, e) / 50); rgba[o * 4 + 2] = byte(at(3) * (1 - .7 * g)); rgba[o * 4 + 3] = byte(at(4));
    }
  }
  // Density changes canopy occupancy, never the physical bank width. Adjust
  // the area channel by the same coverage curve used for resolved candidates.
  // Copy before editing/transferring: sliders reuse the cached base envelope.
  const bankRgba = settings.enabled && density > 0 && bank ? bank.rgba.slice() : undefined;
  if (bankRgba && density !== 1) for (let o = 0; o < N * N; o++) {
    const k = o * 4, base = forestBankDensity(bankRgba[k + 2] * .5);
    bankRgba[k + 3] = Math.min(255, Math.round(bankRgba[k + 3] * (1 - Math.pow(1 - base, density)) / base));
  }
  // Only V2 crowns avoid beaches; the grid is about 8 m (fp = 30 m in the beach width), once per terrain and seed.
  let beach: ForestBeachGrid | undefined;
  if (input.clearingProfile === 'progressive') {
    const beachKey = `${terrainKey}:${input.seed >>> 0}`;
    if (beachCache?.key !== beachKey) beachCache = { key: beachKey, beach: forestBeachGrid(input.height, input.seed >>> 0, Math.min(2048, Math.max(256, 2 ** Math.ceil(Math.log2(input.height.width / 8)))), input.climate[0]) };
    beach = beachCache.beach;
  }
  return { x: layer.x, y: layer.y, width: layer.width, n: N, rgba, bank: bankRgba, bankDensity: density, clearingProfile: input.clearingProfile, beach, key };
}

/** Crown lattice: per-level coverage target d → control τ (Monte-Carlo
 * inverse of the jittered-lattice union coverage, d = k/32, ±.003). */
export const FOREST_TAU_TABLE = [0, .0211, .0446, .066, .0881, .1113, .1338, .1573, .182, .2051, .2303, .2538, .2796, .3045, .3293, .3546,
  .3816, .4091, .435, .4636, .4895, .5188, .5472, .5668, .586, .6063, .6289, .6524, .6805, .7112, .751, .8099, 1];
/** τ → occupancy q and crown radius / spacing ρ (sizes ×.8–1.2, centres jittered ±.35 cell). */
export const forestCrownParams = (tau: number): { q: number; rho: number } => ({ q: Math.min(1, tau / .55), rho: .5 + .4 * Math.max(0, (tau - .55) / .45) });
/** CDFs of the patch threshold u = .6·gradient noise + .5, alone and as .8u + .2·white (Monte Carlo). */
const PATCH_CDF = [0, 0, .0001, .001, .0085, .0401, .1202, .2729, .5009, .7274, .8801, .9598, .9914, .999, .9999, 1, 1];
const CROWN_CDF = [0, 0, 0, .0005, .0063, .0336, .1125, .2742, .4998, .7261, .8874, .9665, .9936, .9994, 1, 1, 1];
const list = (values: readonly number[]): string => values.map(v => Number.isInteger(v) ? `${v}.` : String(v)).join(',');

/** Emitted before NEURAL_EARTH_MATERIAL_GLSL. Its colour is unchanged; it
 * additionally writes the Render guide below for applyForest. */
/** Single-channel linear texture of the baked V2 crown-root beach. */
export function forestBeachTexture(gl: WebGL2RenderingContext, beach: { n: number; data: Uint8Array }): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, beach.n, beach.n, 0, gl.RED, gl.UNSIGNED_BYTE, beach.data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}
export const FOREST_PRELUDE_GLSL = `
#define RENDER3D_FOREST
uniform int uForest;
uniform int uRenderV2;uniform float uV2Season;uniform int uV2WaterVisible;
${RENDER_V2_ZONE_GLSL}
float v2Foliage=1.;vec3 v2CrownGuide=vec3(0.);
// Zone water table and zone bare belt (rock, treeline): set by v2ZoneEnv, read by crowns and land use.
float v2ZoneWet=0.,v2ZoneBare=0.;
float v2FloorModulation=1.;
vec3 v2MacroNormal=vec3(0.,1.,0.);
vec3 v2MacroCanopy=vec3(0.);
float v2GroundSnow=0.;
float v2MeanEnabled=0.,v2ForestReveal=0.;
uniform int uForestBrushes; uniform highp sampler2DArray uForestBrushAtlas;
// 3D near trees (terrain3dTrees.ts): eye xy, full radius, end of fade (m); w = 0 when no tree stands.
uniform vec4 uForestTrees;
uniform sampler2D uForestField; uniform vec3 uForestRect;
uniform int uHasForestBank; uniform sampler2D uForestBank; uniform float uForestBankDensity;
uniform int uHasOccupation; uniform sampler2D uOccupation; uniform vec3 uOccupationRect; uniform float uOccupationN;
// V2 crown-root beach (0..1), baked once per terrain on the CPU (terrainForestBeach.ts): evaluating it per
// crown cost minutes of FXC compilation and dozens of height samples per pixel.
uniform int uHasForestBeach; uniform sampler2D uForestBeach; uniform vec3 uForestBeachRect;
// GLSL ES 3.00 has no packUnorm4x8: four bytes in one uint (auxiliary pass texels).
uint auxPack4x8(vec4 v){uvec4 b=uvec4(clamp(v,0.,1.)*255.+.5);return b.x|(b.y<<8)|(b.z<<16)|(b.w<<24);}
vec4 auxUnpack4x8(uint u){return vec4(float(u&255u),float((u>>8)&255u),float((u>>16)&255u),float(u>>24))/255.;}
float forestBeach(vec2 world){return uHasForestBeach==1?textureLod(uForestBeach,(world-uForestBeachRect.xy)/uForestBeachRect.z,0.).r:0.;}
float forestWaterCoverage(vec2 world);
vec3 forestRootSurface(vec2 world);
float forestRootCell();
// Written by the last earthMaterial call (display RGB): Render's colour, the
// same surface without and with full canopy, and its macro woods coverage.
vec3 renderGuideColor=vec3(0.),renderGuideOpen=vec3(0.),renderGuideClosed=vec3(0.),renderGuideBaseOpen=vec3(0.),renderGuideBaseClosed=vec3(0.),renderGuideSediment=vec3(0.);float renderGuideWoods=0.,renderGuideBeach=0.,renderGuideFlats=0.;
float renderGuideShore=1e9,renderGuideOpenness=0.;
`;

/** 2D gradient noise of the forest lattices. Shared with the 3D tree crowns (terrain3dTrees.ts). */
export const FOREST_PERLIN_GLSL = `
// 2D gradient noise from four corner gradients: (value, d/dx, d/dy) in lattice units.
vec3 forestPerlin(vec2 f,vec2 g00,vec2 g10,vec2 g01,vec2 g11){
  float n00=dot(g00,f),n10=dot(g10,f-vec2(1.,0.)),n01=dot(g01,f-vec2(0.,1.)),n11=dot(g11,f-1.),k=n00-n10-n01+n11;
  vec2 u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);
  vec2 g=g00+u.x*(g10-g00)+u.y*(g01-g00)+u.x*u.y*(g00-g10-g01+g11)+du*vec2(n10-n00+u.y*k,n01-n00+u.x*k);
  return vec3(n00+u.x*(n10-n00)+u.y*(n01-n00)+u.x*u.y*k,g);
}
`;
/** Leaf clumps of a crown, shared by the painted crowns (applyForest) and the 3D tree meshes (terrain3dTrees.ts)
 * so a tree carries the same foliage in both views. Needs groundSmooth, forestGradient and FOREST_PERLIN_GLSL. */
export const FOREST_CLUMP_GLSL = `
// Leaf clumps of a resolved crown: x a zero-mean albedo offset (light clumps bounded by darker gaps), yz the slope
// of the clump relief. Two adjacent octaves of the fixed world lattices 2^k m bracket the crown-relative scale
// (.7 radius) and cross-fade, so the pattern never swims with the stand's radius; each fades before its cells fall
// under about three pixels. The crown's tint offsets the lookup: neighbouring crowns never share a motif.
vec3 forestClump(vec2 world,float radius,float fp,float tint){
  float e=log2(.7*max(radius,.5)),e0=floor(e),w=e-e0,n=0.,norm=0.;vec2 grad=vec2(0.);
  vec2 offset=vec2(fract(tint*5.83),fract(tint*11.37))*97.;
  for(int i=0;i<2;i++){
    float scale=exp2(e0+float(i)),a=(i==0?1.-w:w)*(1.-groundSmooth(scale*.16,scale*.4,fp));
    vec2 g=world/scale+offset;ivec2 c=ivec2(floor(g));
    vec3 o=forestPerlin(g-vec2(c),forestGradient(c),forestGradient(c+ivec2(1,0)),forestGradient(c+ivec2(0,1)),forestGradient(c+ivec2(1,1)));
    n+=a*o.x;grad+=a*o.yz/scale;norm+=a*a;
  }
  norm=sqrt(norm);float amp=groundSmooth(0.,.6,norm)*groundSmooth(2.5,5.,radius/fp);
  n/=max(norm,1e-3);grad/=max(norm,1e-3);
  // Each sign domain of the noise is one clump, a bump of height |n| whose creases are the gaps (.48: mean of the ramp).
  return amp*vec3(groundSmooth(0.,.26,abs(n))-.48,.7*exp2(e)*n*inversesqrt(n*n+.0009)*grad);
}
`;

/** Needs GROUND_FIELD_GLSL (GroundMaterial, groundHash, groundSmooth), uMaterialSeed/uMaterialClimate
 * and an earthMaterial call for the same fragment before applyForest (Render guide). */
export const FOREST_GLSL = `
${LAND_DETAIL_GLSL}
// Class IDs are categorical: never decode the bilinearly filtered B channel.
bool groundOccupationCached=false;vec2 groundOccupationPoint=vec2(0.);vec3 groundOccupationSample=vec3(0.);
vec3 groundOccupation(vec2 world){
  if(groundOccupationCached&&all(equal(world,groundOccupationPoint)))return groundOccupationSample;
  if(uHasOccupation==0)return vec3(-1e3,-1e3,0.);
  vec2 uv=(world-uOccupationRect.xy)/uOccupationRect.z;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec3(-1e3,-1e3,0.);
  vec2 dist=(textureLod(uOccupation,uv,0.).rg*255.-128.)/16.*(uOccupationRect.z/uOccupationN);
  float cls=texelFetch(uOccupation,clamp(ivec2(uv*uOccupationN),ivec2(0),ivec2(int(uOccupationN)-1)),0).b*255.;
  groundOccupationCached=true;groundOccupationPoint=world;groundOccupationSample=vec3(dist,floor(cls+.5));
  return groundOccupationSample;
}
float forestResolvedCover=0.;
// Crown shadow cast on the ground (0..1), resolved and revealed like forestResolvedCover: the water pass darkens with it.
float forestResolvedShade=0.;
// Cover of a canopy mixed over another ground: resolved crowns up close, the stand's expected fraction once crowns are below a pixel.
float forestMapCover=0.;
const float forestTauTable[33]=float[33](${list(FOREST_TAU_TABLE)});
const float forestPatchCdf[17]=float[17](${list(PATCH_CDF)});
const float forestCrownCdf[17]=float[17](${list(CROWN_CDF)});
// Patch-noise lattice; crown lattices are 2·√2^L metres (L = 0..6), all ≤ λ/3.
const float FOREST_PATCH=56.;
// Fixed world lattices of the mid-zoom stand edge: a radius-scaled one would swim with the stand mip.
const float FOREST_LOBE=14.;
const float FOREST_LONE=24.;
float forestLookup17(float x,int table){
  float u=clamp(x,0.,1.)*16.;int k=min(int(u),15);
  float a=table==0?forestPatchCdf[k]:forestCrownCdf[k],b=table==0?forestPatchCdf[k+1]:forestCrownCdf[k+1];
  return mix(a,b,u-float(k));
}
float forestTau(float d){float u=clamp(d,0.,.985)*32.;int k=min(int(u),31);return mix(forestTauTable[k],forestTauTable[k+1],u-float(k));}
float forestRho(float tau){return .5+.4*max(0.,(tau-.55)/.45);}
float forestU8(uint h,uint shift){return (float((h>>shift)&255u)+.5)/256.;}
vec2 forestGradient(ivec2 c){uint h=groundHash(ivec3(c,991),uMaterialSeed^0x6a09e667u);return vec2(float(h&255u),float((h>>8u)&255u))*(1./128.)+(.5/128.-1.);}
${FOREST_PERLIN_GLSL}
// Glade octave of the stand mosaic: one 56 m octave alone cuts a grid of same-size holes (a leopard coat).
// Sheared and stretched lattice, decorrelated from the patch octave: glades of every size, elongated.
const float FOREST_GLADE=210.;
const mat2 FOREST_GLADE_FRAME=mat2(.83,.39,-.21,1.27);
vec3 forestGlade(vec2 p){
  vec2 g=FOREST_GLADE_FRAME*p/FOREST_GLADE+vec2(43.1,-17.7);ivec2 c=ivec2(floor(g));ivec2 o=ivec2(7919,-4421);
  vec3 n=forestPerlin(g-vec2(c),forestGradient(c+o),forestGradient(c+o+ivec2(1,0)),forestGradient(c+o+ivec2(0,1)),forestGradient(c+o+ivec2(1,1)));
  return vec3(n.x,n.yz*FOREST_GLADE_FRAME/FOREST_GLADE);
}
// Patch and glade octaves at the patch octave's variance (value, gradient in 1/m). The glade octave carries three
// quarters of it: openings follow its long sheared shapes and take every size, the patch octave only breaks their
// outline; at equal weights the excursions of the patch octave pierce the stand as round holes of one size.
vec3 forestPatchNoise(vec3 fine,vec3 glade){return .5*fine+.866*glade;}
// Uniform lattice threshold at p and its gradient magnitude (1/m).
vec2 forestPatchThreshold(vec2 p){
  vec2 g=p/FOREST_PATCH;ivec2 c=ivec2(floor(g));
  vec3 f=forestPerlin(g-vec2(c),forestGradient(c),forestGradient(c+ivec2(1,0)),forestGradient(c+ivec2(0,1)),forestGradient(c+ivec2(1,1)));
  vec3 n=forestPatchNoise(vec3(f.x,f.yz/FOREST_PATCH),forestGlade(p));
  float u=clamp(n.x*.6+.5,0.,1.),x=u*16.;int k=min(int(x),15);
  return vec2(forestLookup17(u,0),(forestPatchCdf[k+1]-forestPatchCdf[k])*16.*.6*length(n.yz));
}
// Explicit LOD: no implicit derivatives after non-uniform returns.
// V2 climate zones reweight cover and needle share of the canonical field
// at its single read point, so stands, crowns and diagnostics agree.
vec4 forestField(vec2 world,float lod){return v2ZoneForest(textureLod(uForestField,(world-uForestRect.xy)/uForestRect.z,lod));}
${FOREST_BANK_GLSL}
// Filtered per-fragment state for the far material. Resolved crowns sample
// their fixed world centres so every pixel takes the same candidate decision.
struct ForestStand{
  vec2 p;float cover;float height;float needle;float tone;
  float kappa;float trop;float dry;
  float open;float forced;float allow;float hedge;bool orchard;vec2 rows;
};
// Crown cover inside the stands of a ground covered at c (the stand share is c / density). Clumping eases as the
// cover closes: a closed forest loses most of its deficit as gaps between crowns, not as holes in the stand.
float forestDensity(float c,float kappa){return clamp(c+kappa*(1.-.5*groundSmooth(.55,.9,c))*(.985-c),c,.985);}
// Broadleaf forest type of the regional climate: x Mediterranean, y tropical, z savanna; temperate is
// the remainder. Conifers are the field's needle share, which the lapse rate already raises with altitude.
vec3 forestKind(float trop,float dry){
  float savanna=trop*groundSmooth(.3,.6,dry);
  return vec3((1.-trop)*groundSmooth(10.,14.,uMaterialClimate.x)*groundSmooth(.35,.7,dry),trop-savanna,savanna);
}
// Mean crown radius: spires are narrow, so the τ lattice packs them tighter at the same cover.
float forestRadius(float height,float needle,float dry){return mix((.24*height+1.)*(1.+.45*dry),.07*height+.55,needle);}
// Stunted conifers near the treeline: the field's stature has already shrunk with altitude.
float forestKrummholz(float height,float needle){return (1.-groundSmooth(3.,7.,height))*groundSmooth(.35,.7,needle);}
// Field heights vanish where Render's eligibility does: planted trees need ground where trees can grow.
float forestHeightGate(float h){return groundSmooth(2.,6.,h);}
// Applied woods are a weak prior: a 25 % cover floor where trees grow, natural variation above it.
float forestWoods(float c,float h){return max(c,.25*forestHeightGate(h));}
// Render3D level of detail: 0 keeps Render's colour and macro woods (fully
// unresolved, >= 32 m/px), 1 the canonical forest (<= 2 m/px), log-smooth between.
float forestReveal(float fp){return 1.-groundSmooth(1.,5.,log2(max(fp,.001)));}
// Lattice noise cell around one 3×3 crown neighbourhood. Corner gradients are
// hashed where they are read: a gradient table filled in a loop forces
// ANGLE/D3D11 (FXC) to unroll every crown loop, minutes of shader compilation.
// The glade octave is read once per neighbourhood and extended linearly (its wavelength is far above a crown).
struct ForestPatch{ivec2 base;vec2 centre;vec3 glade;};
ForestPatch forestPatchAround(ivec2 cell,float s){
  ForestPatch q;q.base=ivec2(floor(vec2(cell-1)*s/FOREST_PATCH));
  q.centre=(vec2(cell)+.5)*s;q.glade=forestGlade(q.centre);
  return q;
}
float forestPatchValue(ForestPatch q,vec2 p){
  vec2 g=p/FOREST_PATCH-vec2(q.base);ivec2 c=clamp(ivec2(floor(g)),ivec2(0),ivec2(1)),b=q.base+c;
  float fine=forestPerlin(g-vec2(c),forestGradient(b),forestGradient(b+ivec2(1,0)),forestGradient(b+ivec2(0,1)),forestGradient(b+ivec2(1,1))).x;
  return clamp(forestPatchNoise(vec3(fine,0.,0.),vec3(q.glade.x+dot(q.glade.yz,p-q.centre),0.,0.)).x*.6+.5,0.,1.);
}
// One crown: centre, mean radius, outline harmonics, height, crown depth.
struct ForestCrown{vec2 c;float r;float h;float depth;bool needle;bool alive;bool riparian;float edge;uint id;};
// Signed distance (m, positive inside) to the open land of the occupation raster.
float forestOpenAt(vec2 p){return (textureLod(uOccupation,(p-uOccupationRect.xy)/uOccupationRect.z,0.).r*255.-128.)/16.*uOccupationRect.z/uOccupationN;}
ForestCrown forestCrown(ivec2 cell,int level,float s,ForestStand st,ForestPatch lattice){
  ForestCrown k;uint seed=uMaterialSeed^0x2c1b3c6du;k.riparian=false;
  uint h=groundHash(ivec3(cell,level*2),seed),h2=groundHash(ivec3(cell,level*2+1),seed);k.id=h2;
  k.c=(vec2(cell)+.15+.7*vec2(forestU8(h,0u),forestU8(h,8u)))*s;
  // Sample a candidate at its fixed world centre. Fragment-varying lattice
  // probabilities/radii can otherwise switch half-way through a drawing,
  // leaving a sliced crown or only a thin strip of its painted foot.
  vec4 centre=forestField(k.c,0.);float cover=centre.r,height=centre.g*50.,needle=centre.b;
  float open=-1e3,forced=-1e3,allow=0.,hedge=0.,openGallery=.5;bool occupied=false,tilledPlot=false;
  if(uHasOccupation==1){
    vec2 ouv=(k.c-uOccupationRect.xy)/uOccupationRect.z;
    if(all(greaterThanEqual(ouv,vec2(0.)))&&all(lessThanEqual(ouv,vec2(1.)))){
      vec2 dist=(textureLod(uOccupation,ouv,0.).rg*255.-128.)/16.*uOccupationRect.z/uOccupationN;
      open=dist.x;forced=dist.y;
      int cls=int(texelFetch(uOccupation,clamp(ivec2(ouv*uOccupationN),ivec2(0),ivec2(int(uOccupationN)-1)),0).b*255.+.5);
      // Kitchen and market-garden plots (class 5) root no crown: only the woods around them overhang the beds.
      tilledPlot=cls==5;
      allow=(cls==6?.12:cls==3?.05:cls==2?.02:cls==7?.03:0.)*forestHeightGate(height);
      hedge=(cls>=1&&cls<=3?.6:0.)*groundSmooth(3.,8.,height)*(1.-st.dry);
      if(cls==7||cls==8||cls==9||cls==11)openGallery=0.;
      // Class 11 clearings (main road corridors, farmsteads) root no crown; crowns rooted outside may overhang them.
      // Class 12 covered ways (small roads, tracks) root no crown either, and nothing holds the crowns of their
      // sides back: they close over the way.
      occupied=cls==4||cls==8||cls==9||cls==11||cls==12;
    }
  }
  if(forced>0.)cover=forestWoods(cover,height);
  float kappa=st.kappa*mix(.55,1.,groundSmooth(3.,10.,height))/mix(.55,1.,groundSmooth(3.,10.,st.height))
    *mix(1.,.85,needle)/mix(1.,.85,st.needle);
  // Riparian gallery: a centre inside the narrow bank envelope (already gated
  // by Render's eligibility) takes the gallery density with no stand clumping,
  // so no stand threshold chops the ribbon into islands. Broadleaf-biased.
  float gallery=forestBankGallery(forestBankAt(k.c));
  if(gallery>cover){k.riparian=true;cover=gallery;kappa=0.;needle*=.3;}
  float density=forestDensity(cover,kappa),share=cover/max(density,1e-3);
  float radius=forestRadius(height,needle,st.dry);
  // Clearings (class 11: road corridors, farmsteads), lanes (9) and construction (8) keep crowns back by most of
  // their own radius: they overhang the road, lane or yard edge without closing over it. Only crowns near an open edge look.
  if(uHasOccupation==1&&open<0.&&open>-radius){
    float e=uOccupationRect.z/uOccupationN;
    vec2 g=vec2(forestOpenAt(k.c+vec2(e,0.))-forestOpenAt(k.c-vec2(e,0.)),forestOpenAt(k.c+vec2(0.,e))-forestOpenAt(k.c-vec2(0.,e)));
    vec2 edge=(k.c+g/max(length(g),1e-4)*(.5*e-open)-uOccupationRect.xy)/uOccupationRect.z;
    int side=int(texelFetch(uOccupation,clamp(ivec2(edge*uOccupationN),ivec2(0),ivec2(int(uOccupationN)-1)),0).b*255.+.5);
    if((side==4||side==8||side==9||side==11)&&open>-(.7+.3*forestU8(h2,16u))*radius)occupied=true;
  }
  float centreLevel=clamp(2.*log2(radius/forestRho(forestTau(density))/2.),0.,5.999);
  float weight=max(0.,1.-abs(centreLevel-float(level)));
  float tau=forestTau(1.-pow(1.-density,weight)),q=min(1.,tau/.55),rho=forestRho(tau);
  float threshold=forestLookup17(.8*forestPatchValue(lattice,k.c)+.2*forestU8(h2,0u),1);
  // Near the treeline stands break into single crowns, not shrinking patches.
  float krumm=forestKrummholz(height,needle);threshold=mix(threshold,forestU8(h2,0u),krumm);
  // Each crown steps over or short of the occupation line by up to half a radius: a ragged row, not a polygon.
  float beyond=open+(forestU8(h*0x165667b1u,8u)-.5)*radius;
  k.alive=false;
  if(beyond>0.){
    // Trees left in open land: scattered field trees, orchards, hedgerows, and
    // lone trees within a few crowns of the stand. Bank strips persist in
    // farmland at half density, not in built land.
    float stray=.18*(1.-groundSmooth(0.,4.*radius,open))*min(cover*3.,1.);
    k.alive=!tilledPlot&&forestU8(h2*0x27d4eb2du,24u)<max(allow+(open<5.?hedge:0.)+stray,openGallery*gallery)*(1.-v2ZoneBare);k.edge=1.;
  } else {
    // The zone bare belt (rock, treeline) takes the same share cut as the mean, so near crowns stop where it does.
    k.alive=forestU8(h,16u)<q&&threshold<share*(1.-v2ZoneBare);
    // Harper et al.: stand margins are denser and darker.
    k.edge=1.-groundSmooth(0.,.1,share-threshold);
  }
  // A tree's centre stays on land; its complete crown can overhang the bank.
  if(occupied||(k.alive && forestWaterCoverage(k.c)>=(uRenderV2>0?.05:.5)))k.alive=false;
  if(uRenderV2>0&&k.alive){
    float beachChoice=forestU8(groundHash(ivec3(cell,level*2+37),seed),0u);
    if(beachChoice<forestBeach(k.c))k.alive=false;
  }
  k.riparian=k.riparian&&k.alive;
  // Geometry only for live crowns. No early return: ANGLE/D3D11 miscompiled it here.
  k.needle=false;k.r=0.;k.h=0.;k.depth=0.;
  if(k.alive){
    k.needle=forestU8(h2,8u)<needle;
    vec3 kind=forestKind(st.trop,st.dry);
    float emergent=kind.y*groundSmooth(.9,.97,forestU8(h2,24u));
    // Capped to the reach of the 3×3 search: a wider crown would be sliced.
    k.r=min(rho*s*(.8+.4*forestU8(h,24u))*(1.+.1*k.edge)*(beyond>0.?.75:1.)*(1.+.6*emergent+.3*krumm),1.14*s);
    // Tropical canopies spread their heights into layers.
    k.h=height*(mix(.82,.66,kind.y)+mix(.36,.6,kind.y)*forestU8(h2,16u))*(1.+.45*emergent);
    k.depth=k.r*(k.needle?mix(3.2,1.1,krumm):mix(.55,.22,kind.z));
  }
  return k;
}
// Fruit trees use the forest crown primitive on the parcel-aligned 8 m grid.
vec2 orchardGrid(vec2 world,vec2 rows){return vec2(dot(world,rows),dot(world,vec2(-rows.y,rows.x)))/8.;}
ForestCrown orchardCrown(ivec2 cell,ForestStand st){
  ForestCrown k;uint h=groundHash(ivec3(cell,877),uMaterialSeed);k.id=groundHash(ivec3(cell,878),uMaterialSeed);
  vec2 q=(vec2(cell)+.5+(vec2(forestU8(h,0u),forestU8(h,8u))-.5)*.12)*8.;
  k.c=st.rows*q.x+vec2(-st.rows.y,st.rows.x)*q.y;
  k.r=2.3+.4*forestU8(h,16u);k.h=6.+1.2*forestU8(k.id,16u);k.depth=k.r*.8;
  k.needle=false;k.riparian=false;k.edge=0.;
  vec4 detail=orchardDetail(k.c);vec2 c2=detail.gb*2.-1.;float a=.5*atan(c2.y,c2.x);vec2 rows=vec2(cos(a),sin(a));
  k.alive=int(groundOccupation(k.c).z)==4&&dot(rows,st.rows)>.9999&&detail.a*6.>k.r*1.2
    &&forestHeightGate(forestField(k.c,0.).g*50.)>.5&&forestWaterCoverage(k.c)<.05;
  return k;
}
// Independent harmonics keep conifer branch tips uneven, without a regular six-sided rim.
float forestOutline(ForestCrown k,vec2 n,float aa){
  uint h=k.id*0x9e3779b9u;vec2 a=vec2(forestU8(h,0u),forestU8(h,8u))*6.2831853;float amp=k.needle?.07:.13;
  // Crowns are round: the two-fold harmonic (ovalness) stays small, and on a broadleaf the three-fold one too (at
  // .6 the crown read as a rounded triangle); a conifer keeps it for its bough tips.
  const float OVAL=.35;float lobes=k.needle?.6:.28;
  vec4 shape=vec4(OVAL*cos(a.x),OVAL*sin(a.x),lobes*cos(a.y),lobes*sin(a.y))*amp;
  vec2 c2=vec2(n.x*n.x-n.y*n.y,2.*n.x*n.y),c3=vec2(n.x*(4.*n.x*n.x-3.),n.y*(3.-4.*n.y*n.y));
  float star=groundSmooth(1.5,5.,k.r/max(aa,1e-4));
  vec2 c5=vec2(c2.x*c3.x-c2.y*c3.y,c2.x*c3.y+c2.y*c3.x);
  vec2 c7=vec2(c2.x*c5.x-c2.y*c5.y,c2.x*c5.y+c2.y*c5.x);
  vec2 phase=vec2(shape.x*shape.z-shape.y*shape.w,shape.x*shape.w+shape.y*shape.z)/(OVAL*lobes*amp*amp);
  float tips=k.needle?star*((.02+.012*forestU8(h,16u))*dot(c5,phase)+.015*dot(c7,shape.zw)/(lobes*amp)+.015*dot(n,shape.xy)/(OVAL*amp)):0.;
  // From above a conifer is a dense rounded crown whose rim is a chain of soft bough clusters, never spikes.
  float boughs=0.;
  if(k.needle&&star>0.){
    float branches=8.+floor(forestU8(h,16u)*4.);
    float lobe=.5+.5*cos(atan(n.y,n.x)*branches+a.x);
    boughs=star*(-.035+.055*lobe);
  }
  return k.r*(1.+dot(c2,shape.xy)+dot(c3,shape.zw)*(k.needle?mix(.3,.8,star):1.)+tips+boughs);
}
struct ForestHit{float cover;float top;float second;vec2 slope;float rel;vec2 local;float r;bool needle;bool riparian;float edge;uint id;int level;float near;float ink;};
// Overhead canopy and shrub watercolor sprites, stripped of hue at packing time.
// Same crown hash, two levels and 3x3 neighbourhood as the analytic Render3D.
vec2 forestBrush(ForestCrown k,ForestStand st,vec2 d,float aa,float s){
  float extent=min(1.22*k.r,1.12*s);vec2 uv=d/(2.*extent)+.5;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec2(0.,.5);
  int family=st.orchard?1:st.trop>.5?2:k.needle?0:1;
  if(!st.orchard&&st.dry>.35&&uMaterialClimate.x>10.&&forestU8(k.id,16u)<.35)family=3;
  // Low physical canopies are shrubs, chosen from the candidate's own height
  // (fixed centre and hash), never from its screen size: shrubs up to 3 m,
  // trees from 5.5 m. Dry scrub in arid climates, greener bank shrubs.
  uint hs=k.id*0x85ebca6bu;
  if(!st.orchard&&forestU8(hs,8u)<forestShrubShare(k.h))family=forestU8(hs,16u)<groundSmooth(.2,.7,st.dry)*(k.riparian?.3:1.)?5:4;
  // Mirror only: random rotations would turn trunks upside down.
  if((k.id&1u)==1u)uv.x=1.-uv.x;
  float layer=float(family*8+int((k.id>>4u)&7u));
  float lod=max(0.,log2(128.*aa/(2.*extent)));
  return textureLod(uForestBrushAtlas,vec3(uv,layer),lod).rg;
}
// A crown out of leaf is its limbs: narrower than the summer dome.
float forestLeafSpan(bool needle){return uRenderV2>0&&!needle?mix(.84,1.,v2SeasonLeaf()):1.;}
void forestCrowns(inout ForestHit hit,int level,float s,ForestStand st,float aa){
  ivec2 cell=ivec2(floor(level<0?orchardGrid(st.p,st.rows):st.p/s));ForestPatch lattice=forestPatchAround(cell,s);
  float umbrella=st.orchard?0.:forestKind(st.trop,st.dry).z;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    ForestCrown k;if(level<0)k=orchardCrown(cell+ivec2(i,j),st);else k=forestCrown(cell+ivec2(i,j),level,s,st,lattice);if(!k.alive)continue;
    vec2 d=st.p-k.c;
    if(k.needle&&uForestBrushes==0){vec2 lean=vec2(forestU8(k.id,16u),forestU8(k.id,24u))-.5;float reach=clamp(length(d)/max(k.r,.001),0.,1.);d-=lean*k.r*.24*(1.-reach);}
    float dist=length(d);
    if(dist>=2.*k.r+aa)continue;
    float r=k.r,a=0.,ink=.5;
    if(uForestBrushes==1){vec2 brushTexel=forestBrush(k,st,d,aa,s);a=brushTexel.r;ink=brushTexel.g;hit.near=min(hit.near,dist/r);if(a<.002)continue;}
    else {r=forestOutline(k,d/max(dist,1e-4),aa)*forestLeafSpan(k.needle);hit.near=min(hit.near,dist/r);if(dist>=r+aa)continue;a=clamp((r-dist)/aa+.5,0.,1.);}
    // Profiles: sharp-tipped cone, dome, or the flat top of a savanna umbrella.
    float delta=min(dist/r,1.),d2=delta*delta,tip=sqrt(d2+.006);
    float z=k.h-k.depth*(k.needle?tip:mix(d2,d2*d2,umbrella));
    // Union of translucent layers: overlapping painted foliage closes the
    // canopy as the Boolean model behind the τ table assumes (max() did not).
    hit.cover=1.-(1.-hit.cover)*(1.-a);
    if(z>hit.top){
      hit.second=hit.top;hit.top=z;
      float g=k.depth/k.r*(k.needle?delta/tip:mix(2.*delta,4.*delta*d2,umbrella));
      hit.slope=-g*d/max(dist,1e-4);hit.rel=delta;hit.local=d/r;hit.r=r;hit.needle=k.needle;hit.riparian=k.riparian;hit.edge=k.edge;hit.id=k.id;hit.level=level;hit.ink=ink;
    } else hit.second=max(hit.second,z);
  }
}
// Signed distance to a tapered capsule from a disc of radius ra at the origin to one of radius rb at ab (Quilez).
float forestTaper(vec2 p,vec2 ab,float ra,float rb){
  float h=dot(ab,ab),b=ra-rb;
  if(h<=b*b+1e-4)return length(p)-ra;
  vec2 q=vec2(abs(dot(p,vec2(ab.y,-ab.x))),dot(p,ab))/h,c=vec2(sqrt(h-b*b),b);
  float k=c.x*q.y-c.y*q.x;
  return k<0.?sqrt(h*dot(q,q))-ra:k>c.x?sqrt(h*(dot(q,q)+1.-2.*q.y))-rb:dot(c,q)-ra;
}
// Cast shadow of the crowns around the sunward point onto height zp. A spire's shadow is
// kept short (about its crown length) and as soft as a broadleaf one: buildings and broadleaves
// cast no long shadows on the map, so a long dark spire wedge reads as a glitch.
float forestShadow(ForestHit hit,int level,float s,ForestStand st,float aa,float zp,vec2 sun,float cot){
  // Spires centre the search on the broad foot of their wedge, not its thin apex.
  vec2 from=st.p+sun*max(st.height*mix(.75,.45,st.needle)-zp,0.)*cot;
  ivec2 cell=ivec2(floor(level<0?orchardGrid(from,st.rows):from/s));ForestPatch lattice=forestPatchAround(cell,s);float shade=0.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    ForestCrown k;if(level<0)k=orchardCrown(cell+ivec2(i,j),st);else k=forestCrown(cell+ivec2(i,j),level,s,st,lattice);
    if(!k.alive||(hit.level==level&&k.id==hit.id&&hit.cover>0.))continue;
    if(k.needle){
      // A spire is a cone down to its lower boughs: its shadow tapers from the tree's foot
      // to the apex shadow, a sharp dark wedge pointing away from the sun.
      float foot=min(k.h-k.depth,.1*k.h),apex=min((k.h-zp)*cot,1.6*k.r);if(apex<=0.)continue;
      float rb=k.r*clamp((k.h-max(foot,zp))/max(k.h-foot,1e-3),0.,1.);
      float low=max(foot-zp,0.)*cot;vec2 p=st.p-(k.c-sun*low);
      float wedge=forestTaper(p,-sun*(apex-low),.92*forestOutline(k,p/max(length(p),1e-4),aa)*rb/max(k.r,1e-3),.04*k.r);
      shade=max(shade,.9*clamp(-wedge/max(aa,.12*k.r+.04*apex)+.5,0.,1.));
      continue;
    }
    float caster=k.h-.5*k.depth,o=(caster-zp)*cot;if(o<=0.)continue;
    // A crown is a translucent volume, not an opaque disc: its ground shadow
    // has a broad penumbra even when the display resolves individual leaves.
    float penumbra=max(aa,(k.needle?.12:.22)*k.r+.055*o);
    vec2 d=st.p-(k.c-sun*o);float sd=length(d);if(sd>=1.3*k.r+penumbra)continue;
    shade=max(shade,clamp((.92*forestOutline(k,d/max(sd,1e-4),aa)-sd)/penumbra+.5,0.,1.));
  }
  return shade;
}
// Absolute climate palette of one crown type; only its ratios reach the display.
vec3 forestPalette(ForestStand st,float needle){
  vec3 broad=mix(vec3(.21,.31,.13),vec3(.16,.30,.11),st.trop);
  broad=mix(broad,vec3(.31,.32,.19),st.dry*(1.-.5*st.trop));
  return mix(broad,mix(vec3(.15,.25,.16),vec3(.20,.24,.15),st.dry),needle);
}
// Season as the V2 material reads it (0 winter, .5 summer): x leaf fall, y spring flush, z summer share. Summer outside V2.
vec3 forestSeason(){float t=6.2831853*(uRenderV2>0?uV2Season:.5),s=sin(t);return vec3(max(-s,0.),max(s,0.),.5-.5*cos(t));}
// Colour grade of a forest type. Render's guide already carries the climate and leaf state, and
// forestCrownColor divides the stand palette out, so without this every type keeps the same mean.
vec3 forestGrade(ForestStand st,float needle){
  vec3 kind=forestKind(st.trop,st.dry),season=forestSeason();
  vec3 temperate=mix(mix(vec3(1.02,1.04,.92),vec3(1.1,1.1,.82),season.y),vec3(1.5,.98,.5),.75*season.x);
  vec3 savanna=mix(vec3(1.12,1.,.66),vec3(.94,1.02,.76),season.z);
  vec3 broad=temperate*(1.-kind.x-kind.y-kind.z)+vec3(.58,.68,.66)*kind.x+vec3(.7,1.06,.62)*kind.y+savanna*kind.z;
  return mix(broad,mix(vec3(.60,.70,.70),vec3(.62,.76,.74),season.z),needle);
}
// Rendered canopy colour before snow: snow settles on the crown, it is no part of its grade.
vec3 forestGuide(){return uRenderV2>0?v2CrownGuide:renderGuideClosed;}
vec3 forestSnowed(vec3 crown,float load){return mix(crown,vec3(.84,.88,.90),load);}
// Mean snow load of a crown over fully snowy ground: the one value every level of detail integrates to (far canopy
// mean, mid stand, resolved crowns of forestCrownSnow). The calendar's crown snow runs from crowns that shed their
// snow (0: dark conifers, a light frost on limbs) to a fresh fall (1: laden boughs, rimed limbs).
float forestSnowLoad(float needle){float c=v2SeasonCrownSnow();return mix(mix(.2,.8,c),mix(.24,.62,c),needle);}
// Mean cover of a leafless broadleaf crown seen from above (limbs and twig haze over the ground): what
// forestBareCrown integrates to at every crown size, and the share an unresolved bare stand shows.
const float FOREST_BARE=.335;
// Share of a crown that shows from above: its foliage, or the limbs and twig haze of a leafless crown, so a bare
// stand is a grey-brown veil over its litter or snow at every zoom.
float forestCrownShow(float leaf){return leaf+FOREST_BARE*(1.-leaf);}
// Leafless wood (display RGB): the twig haze is a light grey-brown with a violet cast, the limb bark darker.
vec3 forestBareColor(float tint,float wood){return mix(vec3(.37,.33,.315),vec3(.20,.17,.155),wood)*(.88+.24*tint);}
// Coverage of a line of half-width w pixels at distance d pixels: an anti-aliased edge, dimmed below a pixel of
// width so a sub-pixel twig keeps its mean coverage instead of aliasing.
float forestLine(float d,float w){return clamp(max(w,.5)+.5-d,0.,1.)*min(2.*w,1.);}
// A leafless crown from above, x its cover, y the share of that cover which is wood (limbs, trunk) rather than twig
// haze. Resolved (radius over about 8 pixels): three to six main limbs leave the trunk at uneven angles, bend and fork
// once at their own radius, over a twig haze that thins to nothing at the rim, and the trunk is a small dark spot.
// Below that: a soft centre-weighted stipple without a rim. Both integrate to FOREST_BARE over the crown (measured
// .332 to .338 from 8 to 60 pixels), so the far mean is the same. One tree hash and one limb hash, no noise.
vec2 forestBareCrown(float rel,vec2 slope,float tint,float pixels){
  // 2 FOREST_BARE (1-rel^2) has the mean FOREST_BARE over the disc (area weight 2 rel); .25 is the mean wood share
  // of the resolved crown, so the stipple has its mean colour and snow load.
  vec2 bare=vec2(2.*FOREST_BARE*(1.-rel*rel),.25);
  float detail=groundSmooth(3.,8.,pixels);
  if(detail>0.){
    uint h=uint(tint*65536.)*0x9e3779b9u;
    float limbs=3.+floor(forestU8(h,0u)*4.);
    // Two low harmonics warp the polar angle: unevenly spaced limbs, no radial symmetry (1-.3-2*.15>0 keeps it monotone).
    float a=atan(slope.y,slope.x);
    a+=.3*sin(a+6.2831853*forestU8(h,8u))+.15*sin(2.*a+6.2831853*forestU8(h,16u));
    float v=a*limbs/6.2831853+forestU8(h,24u),s=floor(v+.5),o=v-s;
    // The nearest limb's own hash: bend, fork radius, fork spread and the side the branch leaves on.
    uint hl=((uint(mod(s,limbs))+1u)*0x85ebca6bu)^h;
    float rf=.3+.35*forestU8(hl,8u),spread=.18+.14*forestU8(hl,16u),side=forestU8(hl,24u)<.5?-1.:1.;
    o-=(forestU8(hl,0u)-.5)*.3*rel*rel+.035*sin(9.*rel+6.2831853*forestU8(hl,4u));
    // Past the fork one branch leaves at a wide angle, the other carries on almost straight.
    float t=max(rel-rf,0.),split=min(abs(o-side*spread*t),abs(o+side*.3*spread*t));
    float scale=6.2831853/limbs*rel*pixels;
    float limb=forestLine(split*scale,pixels*(.045-.035*rel)*(1.-.25*groundSmooth(0.,.1,t)));
    // Fine branchlets: three per limb sector, curving with the crown's own phase, faint and mostly sub-pixel: a haze.
    float o2=3.*v+.6*rel*sin(2.*a+6.2831853*forestU8(h,12u));o2-=floor(o2+.5);
    float twig=.5*forestLine(abs(o2)*scale/3.,pixels*.007)*groundSmooth(.2,.45,rel);
    float wood=max(limb,forestLine(rel*pixels,max(.05*pixels,.6)));
    float cover=1.-(1.-wood)*(1.-.45*(1.-rel*rel*rel))*(1.-twig);
    bare=mix(bare,vec2(cover,wood/max(cover,1e-3)),detail);
  }
  return bare;
}
vec3 forestCanopy(ForestStand st,float needle,vec2 jitter,float special){
  vec3 c=forestPalette(st,needle),kind=forestKind(st.trop,st.dry);float temperate=1.-kind.x-kind.y-kind.z;
  // Stand tone: young or disturbed stands lighter and yellower, old ones darker and bluer.
  float t=st.tone-.5;c*=1.+.34*t;
  c=mix(c,c*vec3(1.12,1.07,.78),max(t,0.)*.9);c=mix(c,c*vec3(.9,.97,1.08),max(-t,0.)*.7);
  float amp=mix(mix(.09,.14,temperate),.2,st.trop)*(1.-.45*needle);
  c*=1.+amp*jitter.x;
  c=mix(c,c*vec3(1.12,1.06,.72),max(jitter.y,0.)*amp*2.2);c=mix(c,c*vec3(.84,.97,1.12),max(-jitter.y,0.)*amp*1.6);
  // Deciduous crowns turn one by one, gold or red. Zero jitter is the stand mean, left to forestGrade.
  c*=mix(vec3(1.),jitter.y>0.?vec3(1.3,1.04,.62):vec3(1.3,.72,.66),abs(jitter.y)*forestSeason().x*temperate*(1.-needle)*(.6+.4*jitter.x));
  // Tropical canopies: a few flushing, flowering or senescent crowns.
  vec3 accent=special<.45?vec3(.40,.42,.19):special<.8?vec3(.40,.30,.22):vec3(.36,.38,.32);
  return mix(c,accent,st.trop*groundSmooth(.965,.99,fract(special*7.31))*.6);
}
// Crown colour as a residual of Render's own canopy colour (guide): the
// stand's mean palette maps onto it, crown type/tone/jitter modulate it.
vec3 forestCrownColor(ForestStand st,vec3 guide,float needle,vec2 jitter,float special){
  if(st.orchard)return mix(vec3(.25,.34,.15),vec3(.22,.37,.16),forestSeason().z)*(.86+.28*(jitter.x*.5+.5));
  return guide*forestGrade(st,needle)*forestCanopy(st,needle,jitter,special)/max(forestPalette(st,st.needle),vec3(.02));
}
vec3 forestFloor(vec3 ground,ForestStand st,float cold){
  vec3 litter=mix(vec3(.26,.21,.15),vec3(.24,.21,.15),st.needle);
  vec3 kind=forestKind(st.trop,st.dry);
  litter=mix(litter,vec3(.15,.24,.10),kind.y);
  // Dry woodlands stand on pale soil, not on a dark humus.
  litter=mix(litter,vec3(.6,.54,.42),kind.x+kind.z);
  // Boreal floors: moss in wet stands, pale lichen in dry ones.
  litter=mix(litter,mix(vec3(.27,.32,.18),vec3(.58,.58,.48),.7*st.dry),cold*st.needle);
  if(uRenderV2>0){
    // Conifer stands intercept the snowfall and shade their floor: under spruce the snow is thin and in shadow,
    // so a taiga stays dark over a white land instead of averaging to a pale grey.
    ground*=mix(1.,.42,v2GroundSnow*st.needle);
    litter=mix(litter,ground,v2GroundSnow*(1.-.6*st.needle));
  }
  return mix(ground,litter,.65*(1.-.6*st.dry));
}
// Detail belongs to the exposed surface, after the grass/litter blend. Tree
// crowns carry their own frequencies and never inherit the mineral pattern.
vec3 forestFloorAlbedo(vec3 color){return groundToLinear(color*(uRenderV2>0?v2FloorModulation:1.));}
// Litter and shade belong to a closed stand. Scattered desert shrubs leave the open ground as it is.
float forestClosure(float cover){return groundSmooth(.12,.45,cover);}
// Bank vegetation keeps its foliage greener than the dry climate palette.
vec3 forestRiparianTint(ForestStand st){ForestStand w=st;w.dry*=.45;return forestPalette(w,0.)*forestGrade(w,0.)/max(forestPalette(st,0.)*forestGrade(st,0.),vec3(.02));}
// Shadowed fraction s: remove the direct-light component of the normal.
vec3 forestTilt(vec3 n,vec3 l,float s){return normalize(mix(n,normalize(n-l*max(dot(n,l),0.)),clamp(s,0.,1.)));}
// Ground-independent forest state at one point: stand, applied occupation, crown legibility.
// Shared by applyForest and the map's canopy pass (which writes forestCanopyNear to textures).
struct ForestPrep{ForestStand st;float fp,lod,standLod,reveal,openA,openW,forcedA,hedgeA,humid,cold,radius,crownVis,fringe,galleryNear;bool valid;};
ForestPrep forestPrep(vec2 world,float footprint){
  ForestPrep p;p.valid=false;p.openA=0.;p.openW=1.;p.forcedA=0.;p.hedgeA=0.;
  vec2 uv=(world-uForestRect.xy)/uForestRect.z;
  if(uForest==0||any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return p;
  p.valid=true;
  p.fp=max(footprint,.02);vec2 fsize=vec2(textureSize(uForestField,0));float fcell=uForestRect.z/fsize.x;
  p.reveal=forestReveal(p.fp);
  // While partly revealed, distant stands come from a coarser (box, mean-preserving)
  // mip: clearings start as a soft low-frequency guide. From mid zoom the true mip
  // returns, or the stand edges would move and blur while crowns are already legible.
  p.lod=max(log2(p.fp/fcell),0.);p.standLod=p.lod+2.*(1.-p.reveal)*groundSmooth(4.,16.,p.fp);vec4 f=forestField(world,p.standLod);
  // Satellite: a water fragment takes the stand of the nearest bank (8 m around), so the crowns rooted
  // there are searched from it and drawn whole over the water instead of ending at the channel's empty stand.
  vec2 standAt=world;
  if(uQuality==0&&uRenderV2>0&&forestWaterCoverage(world)>.05)for(int i=0;i<8;i++){
    vec2 q=world+8.*vec2(cos(float(i)*.7853982),sin(float(i)*.7853982));vec4 g=forestField(q,p.standLod);
    if(g.r>f.r){f=g;standAt=q;}
  }
  ForestStand st;st.orchard=false;st.rows=vec2(1.,0.);st.p=world;st.cover=f.r;st.height=f.g*50.;st.needle=f.b;st.tone=f.a;
  float T=uMaterialClimate.x,P=uMaterialClimate.y;p.humid=P/max(20.*T+280.,120.);
  st.trop=groundSmooth(13.,19.,T-6.);st.dry=1.-groundSmooth(.8,2.,p.humid);
  p.cold=1.-groundSmooth(8.,16.,T+6.);
  // Clumping: savanna/dehesa trees scatter, closed forests and taiga form solid stands.
  // Wet tropical canopies stay continuous: their deficit shows as crown gaps, not stand holes.
  vec3 kind=forestKind(st.trop,st.dry);
  st.kappa=mix(.25,.78,groundSmooth(.9,1.8,p.humid))*mix(.55,1.,groundSmooth(3.,10.,st.height))*mix(1.,.85,st.needle)*(1.-.6*st.trop)*(1.-.5*kind.x)*(1.-.85*kind.z);
  st.open=-1e3;st.forced=-1e3;st.allow=0.;st.hedge=0.;
  if(uHasOccupation==1){
    vec2 ouv=(world-uOccupationRect.xy)/uOccupationRect.z;
    if(all(greaterThanEqual(ouv,vec2(0.)))&&all(lessThanEqual(ouv,vec2(1.)))){
      float texel=uOccupationRect.z/uOccupationN;
      vec3 o=groundOccupation(world);
      st.open=o.x;st.forced=o.y;
      int cls=int(o.z);st.orchard=cls==4;
      // Construction, lanes and clearings (classes 8, 9, 11) root no crown (forestCrown), but crowns rooted outside
      // may overhang them. No per-fragment class gate: a nearest-texel cut sliced crowns into staircases.
      // Trees retained in general open land and built reserves (class 7).
      st.allow=(cls==6?.12:cls==3?.05:cls==2?.02:cls==7?.03:0.)*forestHeightGate(st.height);
      st.hedge=(cls>=1&&cls<=3?.6:0.)*groundSmooth(3.,8.,st.height)*(1.-st.dry);
      float w=max(p.fp,.5*texel);p.openW=w;p.openA=clamp(st.open/w+.5,0.,1.);p.forcedA=clamp(st.forced/w+.5,0.,1.)*(1.-p.openA);
      p.hedgeA=p.openA-clamp((st.open-5.)/w+.5,0.,1.);
    }
  }
  if(st.orchard){
    // Natural and gallery cover are zero inside planted parcels at every LOD.
    st.cover=0.;st.needle=0.;st.kappa=0.;st.height=7.;st.allow=0.;st.hedge=0.;st.rows=orchardRows(world);
    p.openA=1.;p.forcedA=0.;p.hedgeA=0.;
  }
  p.st=st;
  // Stand statistics: share s = c/d of the ground in stands, crown cover d inside them.
  p.radius=st.orchard?2.5:forestRadius(st.height,st.needle,st.dry);
  // The illustrated sprites need more pixels than an analytic crown.
  p.crownVis=uForestBrushes==1?groundSmooth(2.,5.,p.radius/p.fp):groundSmooth(.9,2.,p.radius/p.fp);
  // Sparse arid cover resolves to a fine mottled trace, not broad flat paint.
  p.fringe=(1.-groundSmooth(.38,.85,p.humid))*(1.-p.crownVis);
  vec2 bank=forestBankAt(standAt);p.galleryNear=!st.orchard&&bank.x>-16.?forestBankDensity(bank.y):0.;
  return p;
}
float forestPrepCover(ForestPrep p){
  float cover=mix(p.st.cover,forestWoods(p.st.cover,p.st.height),p.forcedA);
  return mix(cover,cover*cover,p.fringe);
}
// Near crowns as one compact sample: placement (forestCrown) is unchanged, the
// crown itself is a lit dome with a per-tree tint (no leaf-clump relief).
struct ForestCanopy{float cover;float shade;float near;float rel;vec2 slope;float edge;float tint;float ink;bool needle;bool riparian;};
ForestCanopy forestCanopyNear(ForestPrep p,vec3 l){
  ForestCanopy c;c.cover=0.;c.shade=0.;c.near=9.;c.rel=1.;c.slope=vec2(0.);c.edge=0.;c.tint=.5;c.ink=.5;c.needle=false;c.riparian=false;
  if(uQuality>0||!p.valid||p.crownVis<=0.)return c;
  ForestStand st=p.st;float d=forestDensity(forestPrepCover(p),st.kappa);
  vec2 sun=length(l.xz)>1e-4?normalize(l.xz):vec2(0.);float cot=clamp(length(l.xz)/max(l.y,.05),0.,4.);
  // Explicit crowns on two lattice levels whose union keeps cover d, or the gallery density near a bank envelope.
  float dl=max(d,p.galleryNear),rho=forestRho(forestTau(dl));
  float level=clamp(2.*log2(p.radius/rho/2.),0.,5.999),l0=floor(level),w=level-l0;
  float s0=2.*exp2(l0*.5),s1=s0*1.41421356;
  if(st.orchard){l0=-1.;s0=8.;s1=8.;w=0.;}
  float d0=st.orchard?1.:1.-pow(1.-dl,1.-w),d1=st.orchard?0.:1.-pow(1.-dl,w);
  float aa=p.fp*.75;
  ForestHit hit;hit.cover=0.;hit.top=-1e9;hit.second=-1e9;hit.slope=vec2(0.);hit.rel=1.;hit.local=vec2(0.);hit.r=1.;hit.needle=false;hit.riparian=false;hit.edge=0.;hit.id=0u;hit.level=-1;hit.near=9.;hit.ink=.5;
  // One call site per crown pass (a loop, not two calls): ANGLE/D3D11 (FXC) compiles each call's inlined copy.
  for(int k=0;k<2;k++){if((k==0?d0:d1)>.002)forestCrowns(hit,int(l0)+k,k==0?s0:s1,st,aa);}
  float zp=hit.cover>0.?hit.top:0.;
  // Analytic crowns cast a soft dominant-level shadow; fantasy motifs carry their own painted shade.
  if(uForestBrushes==0){int dominant=w<.5?0:1;c.shade=forestShadow(hit,int(l0)+dominant,dominant==0?s0:s1,st,aa,zp,sun,cot);}
  // Layered canopies: lower crowns take the shade of the margin darkening, packed in the same byte.
  float under=forestKind(st.trop,st.dry).y*(1.-groundSmooth(.72,1.,hit.top/max(st.height,1.)));
  c.cover=hit.cover;c.near=hit.near;c.rel=hit.rel;c.slope=hit.slope;c.edge=max(hit.edge,under);c.ink=hit.ink;c.needle=hit.needle;c.riparian=hit.riparian;
  c.tint=forestU8(hit.id*0x9e3779b9u,0u);
  return c;
}
#ifdef AUX_TEXTURE
// Map: the auxiliary pass wrote forestCanopyNear for this pixel (forestCanopyPack layout, words xyz of uAux).
uniform int uHasAux;uniform highp usampler2D uAux;
ForestCanopy forestCanopyAt(ForestPrep p,vec3 l){
  ForestCanopy c;c.cover=0.;c.shade=0.;c.near=9.;c.rel=1.;c.slope=vec2(0.);c.edge=0.;c.tint=.5;c.ink=.5;c.needle=false;c.riparian=false;
  if(uHasAux==0)return c;
  uvec4 t=texelFetch(uAux,ivec2(gl_FragCoord.xy),0);
  vec2 a=unpackHalf2x16(t.x);vec4 b=auxUnpack4x8(t.z);
  c.cover=a.x;c.shade=a.y;c.slope=unpackHalf2x16(t.y);c.near=b.x*9.;c.rel=b.y;c.edge=b.z;
  float packed=b.w*4.+.002,flags=floor(packed);c.tint=packed-flags;c.ink=c.tint;c.needle=mod(flags,2.)>.5;c.riparian=mod(floor(flags*.5),2.)>.5;
  return c;
}
#else
ForestCanopy forestCanopyAt(ForestPrep p,vec3 l){return forestCanopyNear(p,l);}
#endif
// Auxiliary pass words xyz: cover/shade and slope as halves, near/rel/edge/flags+tint as bytes;
// brushes store their ink in place of the tint.
uvec3 forestCanopyPack(ForestCanopy c){
  float tint=min(uForestBrushes==1?c.ink:c.tint,.99);
  return uvec3(packHalf2x16(vec2(c.cover,c.shade)),packHalf2x16(c.slope),
    auxPack4x8(vec4(min(c.near,9.)/9.,c.rel,c.edge,((c.needle?1.:0.)+(c.riparian?2.:0.)+tint)/4.)));
}
// Stand-scale grain of a snowy conifer canopy once single crowns are below a pixel; faded before it aliases.
float forestSnowGrain(vec2 w,float scale,float fp){
  vec2 g=w/scale;ivec2 c=ivec2(floor(g));
  return forestPerlin(g-vec2(c),forestGradient(c),forestGradient(c+ivec2(1,0)),forestGradient(c+ivec2(0,1)),forestGradient(c+ivec2(1,1))).x*(1.-groundSmooth(scale*.12,scale*.3,fp));
}
// Snow lying on a resolved crown (Render v2): a cap on its top and sunward flank, where the dome faces the sky
// and the light, broken per crown by its bough or leaf-clump rhythm and its own tint: no lattice, band or shared
// orientation. The gaps between boughs and the shaded flank keep a thin load and stay dark, so a laden stand keeps
// its texture over the white floor; rime coats bare limbs more evenly. The cap widens with the calendar's crown
// snow: its area mean is .356 at 0 and .619 at 1 (measured over a crown), and the capped load is solved from it so
// that the crown's mean is forestSnowLoad. The amount is the local ground snow of the same fragment
// (v2GroundSnow), so crowns are white exactly where the floor is.
float forestCrownSnow(ForestCanopy hit,vec2 sun,float bough){
  float c=v2SeasonCrownSnow(),side=-dot(hit.slope,sun)/max(length(hit.slope),1e-3);
  float cap=groundSmooth(.2-.2*c,.8-.2*c,.75*(1.-hit.rel)+.35*max(side,0.)+.3*(bough-.5)+.3*(fract(hit.tint*9.71)-.5));
  float needle=hit.needle?1.:0.,thin=mix(mix(.15,.5,c),.12,needle);
  float hold=thin+(forestSnowLoad(needle)-thin)/mix(.356,.619,c)*cap;
  return v2GroundSnow*min(hold*(1.+.3*(fract(hit.tint*4.37)-.5)),.97);
}
${FOREST_CLUMP_GLSL}
// Same forest hit, outline, dome normal, seasonal limbs and shadow for the planted grid.
void applyOrchard(inout GroundMaterial m,ForestPrep p,vec3 light,ForestCanopy hit,vec3 leafClump,vec2 bare){
  ForestStand st=p.st;vec3 l=normalize(light),nGround=m.normal;
  float leaf=uRenderV2>0?v2SeasonLeaf():1.,snow=uRenderV2>0?v2GroundSnow*forestSnowLoad(0.):0.;
  // A planted parcel is open land: its floor is the open ground (with its snow), as the forest path rebuilds it for
  // open land, not the macro woods canopy, which under snow left a grey patch cut on the class texels.
  if(uRenderV2>0)m.albedo=forestFloorAlbedo(clamp(renderGuideOpen,0.,1.));
  vec3 crown=forestSnowed(mix(forestCrownColor(st,forestGuide(),0.,vec2(0.),0.),forestBareColor(.5,.25),1.-leaf),snow);
  // The unresolved crowns fade out with the smooth orchard share (applyGroundOccupation), not on the class texels.
  float cover=.31*forestCrownShow(leaf)*forestHeightGate(forestField(st.p,0.).g*50.)*v2OrchardShare;
  vec3 normal=nGround;float shade=cover*.45;
  if(p.crownVis>0.&&uQuality==0){
    float tint=hit.tint;
    float body=mix(bare.x,1.,leaf);
    float resolved=hit.cover*body;
    crown=forestCrownColor(st,forestGuide(),0.,vec2(tint*2.-1.,0.),0.);
    vec3 kind=forestKind(st.trop,st.dry);float fall=forestSeason().x*(1.-kind.x-kind.y-kind.z);
    crown=mix(crown,vec3(.47,.34,.12),fall*.65);
    // Leaf clumps of the foliage, strongest toward the rim; bare limbs carry none.
    float foliageDetail=leaf*mix(.55,1.,hit.rel);
    crown*=1.+.3*foliageDetail*leafClump.x;
    // Bare limbs hold little snow and stay dark over the white floor, the twig haze takes the rest of the mean load.
    crown=forestSnowed(mix(crown,forestBareColor(tint,bare.y),1.-leaf),min(snow*mix(1.,mix(1.2,.4,bare.y),1.-leaf),.97));
    if(uForestTrees.w>0.)crown*=mix(1.,.6,1.-groundSmooth(uForestTrees.z,uForestTrees.w,distance(st.p,uForestTrees.xy)));
    // A leafless crown is no dome: its limbs lie flat to the light.
    vec2 dome=hit.slope*mix(.2,1.,leaf);
    normal=normalize(vec3(-dome.x-foliageDetail*leafClump.y,1.,-dome.y-foliageDetail*leafClump.z));
    cover=mix(cover,resolved,p.crownVis);shade=mix(shade,hit.shade*mix(.25,1.,leaf),p.crownVis);
    forestResolvedCover=resolved*p.crownVis;
  }
  forestMapCover=cover;forestResolvedShade=shade;
  m.albedo=mix(m.albedo*(1.-.28*shade*(1.-cover)),groundToLinear(crown),cover);
  m.normal=normalize(mix(forestTilt(nGround,l,shade*.3),normal,cover));
  m.occlusion*=1.-.18*cover;m.roughness=mix(m.roughness,.9,cover);
}
void applyForest(inout GroundMaterial m,vec2 world,float footprint,vec3 light){
  forestResolvedCover=0.;forestResolvedShade=0.;forestMapCover=0.;
  ForestPrep p=forestPrep(world,footprint);
  if(!p.valid)return;
  // One canopy evaluation shared by the orchard and the forest paths (both need it exactly when crowns are visible
  // at full quality): the shader compilers inline every call, and without the auxiliary pass (3D) each call is the
  // whole near-crown search.
  ForestCanopy hit;vec3 leafClump=vec3(0.);
  // Leafless crown cover and wood share (forestBareCrown), also one evaluation; painted brushes keep a flat share.
  vec2 bare=vec2(FOREST_BARE,.25);
  if(p.crownVis>0.&&uQuality==0){
    hit=forestCanopyAt(p,normalize(light));
    // Leaf clumps once a crown spans a few pixels (painted brushes carry their own): one evaluation for both paths.
    if(uForestBrushes==0){
      if(hit.cover>0.&&p.radius>2.5*p.fp)leafClump=forestClump(world,p.radius,p.fp,hit.tint);
      if(uRenderV2>0){if(hit.cover>0.&&v2SeasonLeaf()<1.)bare=forestBareCrown(hit.rel,hit.slope,hit.tint,p.radius/max(p.fp,.01));}
    }
  }
  if(p.st.orchard){applyOrchard(m,p,light,hit,leafClump,bare);return;}
  ForestStand st=p.st;float fp=p.fp,openA=p.openA,forcedA=p.forcedA,hedgeA=p.hedgeA,crownVis=p.crownVis,radius=p.radius,reveal=p.reveal;
  // Crown share seen from above: foliage, plus the rimed limbs of leafless crowns under snow.
  float foliage=uRenderV2>0?forestCrownShow(v2Foliage):1.;
  // Render reference. Its colour, macro woods included, stays authoritative
  // while the forest is unresolved; k carries the Render3D ground detail
  // (rock tint, clasts, strata) from Render's colour onto its open guide.
  vec3 ground=groundToDisplay(m.albedo);
  vec3 k=uRenderV2>0?vec3(1.):clamp(ground/max(renderGuideColor,vec3(.02)),vec3(.25),vec3(4.));
  vec3 openGround=clamp(renderGuideOpen*k,0.,1.);
  vec3 refAlbedo=m.albedo;
  if(uQuality>0){
    // Field colour only: no crown candidates, shadows or brush-atlas reads.
    float cover=mix(st.cover,max(st.cover,.25*forestHeightGate(st.height)),forcedA);
    cover=mix(cover,st.allow*.7+min(hedgeA,.6)*st.hedge,openA);
    cover=max(cover,forestBankCover(world,fp)*(1.-.5*openA));
    float available=(1.-forestWaterCoverage(world))*(1.-v2ZoneBare);
    if(uRenderV2>0)available*=1.-clamp(renderGuideBeach/.8,0.,1.);
    cover=clamp(cover*foliage*available,0.,1.);
    vec3 mean=forestCrownColor(st,forestGuide(),st.needle,vec2(0.),0.);
    if(uRenderV2>0)mean=forestSnowed(mean,v2GroundSnow*forestSnowLoad(st.needle));
    vec3 floorColor=forestFloor(openGround,st,p.cold);
    float stand=forestClosure(st.cover)*(1.-openA)*available;
    m.albedo=mix(forestFloorAlbedo(mix(openGround,floorColor,stand)),groundToLinear(mean),cover);
    m.roughness=.9;m.occlusion=mix(m.occlusion,.85,stand);
    forestMapCover=cover;forestResolvedCover=cover;
    return;
  }
  // Mid zoom. While a crown is below about a pixel the stand mosaic is a density: soft dips, no outline. Once
  // crowns are about a pixel the stands end on a crisp line scalloped at crown scale, which the crowns then replace.
  // One noise on a fixed lattice serves the line and the sub-crown grain; it stops before it aliases.
  float patchDetail=uForestBrushes==1?crownVis:groundSmooth(.2,.7,radius/fp);
  float crisp=uForestBrushes==1?crownVis:groundSmooth(.5,1.4,radius/fp);
  float grainVis=(1.-crownVis)*groundSmooth(.35,1.2,radius/fp)*(1.-groundSmooth(6.,12.,fp));
  float edgeVis=(1.-crownVis)*crisp*(1.-groundSmooth(5.,10.,fp)),lobe=0.;
  if(st.cover>.002&&max(grainVis,edgeVis)>0.){vec2 g=world/FOREST_LOBE+vec2(17.3,-41.9);ivec2 c=ivec2(floor(g));
    lobe=forestPerlin(g-vec2(c),forestGradient(c),forestGradient(c+ivec2(1,0)),forestGradient(c+ivec2(0,1)),forestGradient(c+ivec2(1,1))).x;}
  float grain=lobe*grainVis,lobeShift=2.*radius*lobe*edgeVis;
  if(uHasOccupation==1)openA=clamp((st.open+lobeShift)/p.openW+.5,0.,1.);
  float hedgeShare=min(hedgeA/max(openA,1e-3),1.);
  // Applied occupation acts at every distance: open land replaces Render's
  // macro woods by its own tree share, applied woods add their weak prior.
  float refWoods=renderGuideWoods;
  if(uHasOccupation==1&&openA+forcedA>0.){
    float woods=mix(renderGuideWoods,st.allow*.7+hedgeShare*st.hedge*.6,openA);
    woods=mix(woods,max(woods,.25*forestHeightGate(st.height)),forcedA);
    if(uRenderV2>0){woods*=1.-clamp(renderGuideBeach/.8,0.,1.);refAlbedo=mix(forestFloorAlbedo(openGround),groundToLinear(v2MacroCanopy),woods);}
    else refAlbedo=groundToLinear(ground+(woods-renderGuideWoods)*(renderGuideClosed*k-openGround));
    refWoods=woods;
  }
  // The macro woods take their forest type too, so it reads at every zoom.
  refAlbedo*=mix(vec3(1.),groundToLinear(forestGrade(st,st.needle)),refWoods);
  // Riparian gallery over the reference: an area-filtered hint of the narrow
  // bank envelope, colour only (no stand paint, normal or shadow).
  float galleryArea=forestBankCover(world,fp)*(1.-.5*openA);
  if(uRenderV2>0)galleryArea*=foliage*(1.-clamp(renderGuideBeach/.8,0.,1.));
  vec3 galleryMean=vec3(0.);
  if(galleryArea>0.)galleryMean=groundToLinear(forestCrownColor(st,forestGuide(),0.,vec2(0.),0.)*forestRiparianTint(st));
  refAlbedo=mix(refAlbedo,galleryMean,mix(.5,1.,reveal)*galleryArea);
  // The whole material leaves the Render reference only as crowns or the stand
  // line become legible: a small (6 %) residual of the canonical stands before that.
  float krumm=forestKrummholz(st.height,st.needle);
  // Under snow the stand mosaic is the image: dark stands over white clearings. Its flat mean (the reference)
  // spreads the white clearings over the stands as a pale veil, so the 56 m patch mask shows wherever it resolves.
  float snowMosaic=uRenderV2>0?v2GroundSnow*(1.-groundSmooth(8.,20.,fp))*(1.-krumm):0.;
  reveal=max(reveal,snowMosaic);
  reveal*=mix(.06,1.,max(max(crownVis*crownVis,uForestBrushes==1?0.:patchDetail*(1.-krumm)),snowMosaic));
  if(uRenderV2>0&&v2MeanEnabled>.5){v2ForestReveal=reveal;if(reveal>0.)reveal=1.;}
  if(reveal<=0.){m.albedo=refAlbedo;return;}
  // A zero-cover fragment can still lie under a crown centred across the clearing boundary.
  if(st.cover<.002&&p.galleryNear<=0.&&uHasOccupation==0&&forestField(world,max(p.lod,1.)).r<.00001){m.albedo=mix(refAlbedo,forestFloorAlbedo(openGround),reveal);return;}
  vec3 l=normalize(light);vec2 sun=length(l.xz)>1e-4?normalize(l.xz):vec2(0.);float cot=clamp(length(l.xz)/max(l.y,.05),0.,4.);
  // Unresolved stand holes keep part of their depth only (a blend toward the stand share keeps the mean exactly).
  float patchVis=max((1.-groundSmooth(6.,14.,fp))*mix(.18,1.,patchDetail)*mix(.6,1.,crisp)*(1.-krumm),snowMosaic);
  float fringe=p.fringe,cover=forestPrepCover(p);
  float d=forestDensity(cover,st.kappa),share=cover/max(d,1e-3);
  vec3 nGround=m.normal;
  // Mid/far: AA stand mask over its mean, one sunward probe for stand shadows.
  vec2 q=world+sun*st.height*.6*cot;vec4 fq=forestField(q,p.standLod);
  float cq=mix(fq.r,fq.r*fq.r,fringe),dq=forestDensity(cq,st.kappa),sq=cq/max(dq,1e-3),mask=share,maskQ=sq;
  // Signed distance to the stand line (m, positive inside): the occupation line, and to first order the patch contour.
  float edgeSd=-st.open-lobeShift;
  if(patchVis>0.){
    vec2 pv=forestPatchThreshold(world),pq=forestPatchThreshold(q);
    // Below a pixel per crown the deficit is a density ramp, as wide as the threshold range allows at this share
    // (twice the distance to 0 or 1 keeps the mean of the evenly spread threshold exact). The cut sharpens as crowns resolve.
    float feather=mix(mix(clamp(2.*min(share,1.-share),.12,.5),.04,crisp),.015,crownVis);
    mask=mix(share,clamp((share-pv.x+pv.y*lobeShift)/max(pv.y*fp,feather)+.5,0.,1.),patchVis);
    maskQ=mix(sq,clamp((sq-pq.x)/max(pq.y*fp,feather)+.5,0.,1.),patchVis);
    edgeSd=min(edgeSd,(share-pv.x)/max(pv.y,1e-3)+lobeShift);
  }
  // Harper et al.: the darker margin, here before crowns resolve to carry it.
  float margin=(1.-clamp(edgeSd/(2.5*radius),0.,1.))*edgeVis;
  // Lone trees just outside the line, at most one per cell. A crown fits inside
  // its cell, so this needs one hash and no neighbour search.
  float lone=0.;
  if(edgeVis>0.&&edgeSd<0.&&edgeSd>-5.*radius){
    ivec2 c=ivec2(floor(world/FOREST_LONE));uint h=groundHash(ivec3(c,719),uMaterialSeed^0x2c1b3c6du);
    vec2 centre=(vec2(c)+.3+.4*vec2(forestU8(h,0u),forestU8(h,8u)))*FOREST_LONE;
    if(forestU8(h,16u)<.35*(1.+edgeSd/(5.*radius))*min(st.cover*3.,1.)*forestHeightGate(st.height))
      lone=clamp((min(radius,.3*FOREST_LONE)-distance(world,centre))/fp+.5,0.,1.)*edgeVis;
  }
  if(uRenderV2>0){float bare=1.-clamp(renderGuideBeach/.8,0.,1.);mask*=bare;lone*=bare;maskQ*=1.-forestBeach(q);}
  float natural=mask*d*(1.-openA),openTrees=openA*(st.allow*.7+hedgeShare*st.hedge*.6);
  float canopy=max(clamp(natural+openTrees,0.,1.),lone),stand=mask*(1.-openA)*forestClosure(st.cover);
  if(uRenderV2>0)canopy*=foliage;
  forestMapCover=canopy;
  float groundShadow=clamp(maskQ*dq*(1.-openA)+openTrees*.6,0.,1.);
  if(uRenderV2>0)groundShadow*=v2Foliage;
  vec3 litter=forestFloor(openGround,st,p.cold);
  // Render's canopy colour (its snow included) with the stand's tone residual.
  // Crowns carry the mean load of forestCrownSnow: laden boughs over the shaded floor of a conifer stand, rimed limbs.
  vec3 mean=forestCrownColor(st,forestGuide(),st.needle,vec2(0.),0.);
  // The leafless broadleaves' part of the shown crowns is twig haze, in the colour the resolved crowns average to.
  if(uRenderV2>0)mean=forestSnowed(mix(mean,forestBareColor(.5,.25),(1.-v2Foliage)*FOREST_BARE/max(foliage,1e-3)),v2GroundSnow*forestSnowLoad(st.needle));
  // Mean crown self-shading (normal tilt) and occlusion, matched to the crown band.
  float selfShade=mix(.24,.42,st.needle);
  vec3 albedo=mix(forestFloorAlbedo(mix(openGround,litter,stand)),groundToLinear(mean)*(1.+mix(.5,.9,st.needle)*grain)*(1.-.2*margin),canopy);
  // A snowy taiga keeps a dark, grainy texture at far zoom instead of a flat grey-green mean.
  if(uRenderV2>0&&v2GroundSnow>0.)albedo*=1.+v2GroundSnow*st.needle*stand*(.45*forestSnowGrain(world,38.,fp)+.3*forestSnowGrain(world,110.,fp));
  // Unresolved gallery crowns: their expected canopy fraction, colour and a slight occlusion only.
  albedo=mix(albedo,galleryMean,galleryArea*(1.-canopy));
  // Distant stand probes are an average, not a second hard cast-shadow motif.
  vec3 normal=forestTilt(nGround,l,clamp(canopy*selfShade*(1.-.8*grain)+(1.-canopy)*groundShadow*.25,0.,1.));
  float occlusion=mix(m.occlusion*mix(1.,.72,stand),.8,canopy)*(1.-.08*galleryArea);
  float roughness=mix(m.roughness,.9,canopy);
  if(crownVis>0.){
    // Water sees the crowns as displayed: resolved and revealed.
    forestResolvedCover=hit.cover*crownVis*(uRenderV2>0&&v2MeanEnabled>.5?v2ForestReveal:reveal);
    float shade=hit.shade;
    // A lit dome per crown with a per-tree tint; fantasy brushes keep their own luminance.
    float tint=hit.tint;
    vec2 jitter=vec2(tint,fract(tint*7.31))*2.-1.;float special=fract(tint*13.17);
    // Leaf fall thins a broadleaf crown down to its limbs. Conifers keep theirs, larches excepted.
    bool larch=uRenderV2>0&&hit.needle&&special<v2SeasonClimate().z;
    float leaf=uRenderV2>0&&(!hit.needle||larch)?v2SeasonLeaf():1.;
    if(leaf<1.){
      // Open limbs: the ground shows through and the cast shadow is the light one of bare branches.
      float body=mix(bare.x,1.,leaf);
      hit.cover*=body;shade*=mix(.25,1.,leaf);forestResolvedCover*=body;
    }
    forestResolvedShade=clamp(shade,0.,1.)*crownVis*(uRenderV2>0&&v2MeanEnabled>.5?v2ForestReveal:reveal);
    forestMapCover=mix(forestMapCover,forestResolvedCover,crownVis);
    float clump=uForestBrushes==1?(hit.ink-.5)*2.:0.;
    // A leafless crown is no lit dome: its limbs lie nearly flat to the light.
    vec2 slope=(uForestBrushes==1?.25:mix(.2,1.,leaf))*hit.slope;
    // Leaf clumps in the crown's colour and relief, strongest toward the rim: the whole effect on a broadleaf in
    // leaf, a light touch of colour on a spire (its whorls carry the relief), none on bare limbs.
    float foliageDetail=(hit.needle?.3:leaf)*mix(.55,1.,hit.rel);
    if(!hit.needle)slope+=foliageDetail*leafClump.yz;
    vec3 terrainNormal=uRenderV2>0?v2MacroNormal:nGround;
    vec2 macroSlope=-terrainNormal.xz/max(terrainNormal.y,.2);
    vec3 nCrown=normalize(vec3(-(macroSlope.x+slope.x),1.,-(macroSlope.y+slope.y)));
    // Shaded crowns keep their sky light (no black caps).
    nCrown=forestTilt(nCrown,l,shade*.3);
    float occCrown=uForestBrushes==1?.94:mix(.92,max(.6+.4*(1.-hit.rel*hit.rel),.5),leaf);
    float detailGain=uForestBrushes==1?.36:0.;
    // Branch whorls on a spire, once their rings span a few pixels.
    float branch=dot(hit.slope,jitter)*inversesqrt(1.+dot(hit.slope,hit.slope));
    float tiers=hit.rel*(19.+11.*special)+6.2831853*tint+.9*branch;
    // Boughs catch the light, the gaps between them fall dark, darkest at the trunk.
    float bough=abs(cos(atan(hit.slope.y,hit.slope.x)*(3.5+floor(tint*3.))+tint*6.2831853));
    float whorl=hit.needle&&uForestBrushes==0?(.10*(cos(tiers+1.2*sin(hit.rel*7.+tint*9.))+.35*cos(tiers*1.73+special*8.))+.05*(bough*bough-.45)*hit.rel-.12*(1.-hit.rel))*groundSmooth(2.,6.,radius/fp):0.;
    // A spire reads as a cone by its terminator: the sunward flank lit to the rim, the far flank in its own shade.
    vec3 flank=vec3(1.);
    if(hit.needle&&uForestBrushes==0){
      float side=-dot(hit.slope,sun)/max(length(hit.slope),1e-3);
      flank=vec3(mix(1.,mix(.66,1.34,groundSmooth(-.3,.3,side)),groundSmooth(.04,.2,hit.rel)*groundSmooth(1.,3.,radius/fp)));
      // A spire among broadleaves takes their stand's dark palette ratio: keep it a dark green, not black.
      flank*=mix(vec3(1.14,1.3,1.04),vec3(1.),st.needle);
    }
    vec3 crown=forestCrownColor(st,forestGuide(),hit.needle?1.:0.,jitter,special)*(1.+detailGain*clump+whorl)*flank*(1.-mix(.12,.3,st.trop)*hit.edge);
    crown*=1.+.3*foliageDetail*leafClump.x;
    if(hit.riparian)crown*=forestRiparianTint(st);
    // Near the camera a modelled tree stands on each crown: the painted crown under it becomes its ground shade.
    if(uForestTrees.w>0.)crown*=mix(1.,.6,1.-groundSmooth(uForestTrees.z,uForestTrees.w,distance(world,uForestTrees.xy)));
    if(uRenderV2>0){
      // Autumn turns each temperate broadleaf crown on its own: orange, rust or gold, a few still green.
      // The hue is absolute, its lightness follows the crown so the stand keeps its exposure.
      vec3 fallKind=forestKind(st.trop,st.dry);
      float fall=hit.needle?0.:forestSeason().x*(1.-fallKind.x-fallKind.y-fallKind.z);
      if(fall>0.){
        float pick=fract(tint*5.31),late=fract(tint*3.77);
        vec3 hue=pick<.38?vec3(.86,.46,.07):pick<.56?vec3(.64,.18,.07):pick<.86?vec3(.86,.66,.10):vec3(.30,.40,.12);
        float lift=pick<.38?1.35:pick<.56?1.08:pick<.86?1.4:1.;
        float lum=dot(crown,vec3(.2126,.7152,.0722)),hueLum=dot(hue,vec3(.2126,.7152,.0722));
        crown=mix(crown,hue*lum*lift/hueLum,fall*(pick<.86?.92:.4)*(.75+.25*late));
      }
      if(larch)crown=mix(crown,vec3(.70,.52,.17)*(.9+.2*tint),.85*forestSeason().x);
      crown=mix(crown,forestBareColor(tint,bare.y),1.-leaf);
      // Snow caps the top and lit flank of each crown and lies on its boughs or leaf clumps; the gaps stay dark.
      // Bare limbs hold little and stay dark against the white floor, the twig haze takes the rest of the mean load.
      crown=forestSnowed(crown,min(forestCrownSnow(hit,sun,hit.needle?bough:.64+foliageDetail*leafClump.x)*mix(1.,mix(1.2,.4,bare.y),1.-leaf),.97));
    }
    // Forest floor under and right around crowns; open ground beyond.
    float under=uForestBrushes==1?hit.cover:1.-groundSmooth(1.,1.8,hit.near);
    vec3 nearAlbedo=mix(forestFloorAlbedo(mix(openGround,litter,under)),groundToLinear(crown),hit.cover);
    vec3 nearNormal=normalize(mix(forestTilt(nGround,l,shade*.3),nCrown,hit.cover));
    float nearOcc=mix(m.occlusion*mix(1.,.72,under),occCrown,hit.cover);
    float nearRough=mix(m.roughness,.9,hit.cover);
    albedo=mix(albedo,nearAlbedo,crownVis);normal=normalize(mix(normal,nearNormal,crownVis));
    occlusion=mix(occlusion,nearOcc,crownVis);roughness=mix(roughness,nearRough,crownVis);
  }
  // The whole material response, not only its colour, leaves the Render reference.
  m.albedo=mix(refAlbedo,albedo,reveal);m.normal=normalize(mix(m.normal,normal,reveal));
  m.occlusion=mix(m.occlusion,occlusion,reveal);m.roughness=mix(m.roughness,roughness,reveal);
}
`;
