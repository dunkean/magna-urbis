/** Render3D forest: one canonical CPU control field per applied tile, plus a
 * world-space GLSL appearance sampled identically by the top-down view, the
 * perspective view and the raster export. Own procedural model (no ported
 * code); ideas from Boolean-model coverage, crown allometry (Jucker et al.
 * 2017), forest-edge structure (Harper et al. 2005) and the growing-season
 * treeline isotherm (Körner & Paulsen 2004). Display only: never feeds terrain. */

export interface ForestSettings { enabled: boolean; density: number; clearings: number }
/** density 0..2 (1 = climate potential), clearings 0..1. */
export const DEFAULT_FOREST_SETTINGS: ForestSettings = { enabled: true, density: 1, clearings: .45 };
/** Occupation RGBA8: R/G signed distance to open/forest land, encoded
 * clamp(128+16d) in native texels (positive inside); B class id (0 none,
 * 1 field, 2 meadow, 3 pasture, 4 orchard, 5 garden, 6 commons, 7 built);
 * A 255 inside applied polygons. */
export interface ForestOccupation { x: number; y: number; width: number; n: number; rgba: Uint8Array; key: string }
/** RGBA8 world raster on the height layer's square: R canopy cover 0..1,
 * G potential canopy height 0..50 m (also where cover is 0), B needleleaf
 * fraction, A stand tone (age/disturbance, .5 neutral). Texel centres at
 * x+(i+.5)·width/n. Natural cover only: occupation is applied per fragment at
 * its native resolution, and only enters the key. */
export interface ForestField { x: number; y: number; width: number; n: number; rgba: Uint8Array; key: string }
export interface ForestFieldInput {
  /** Material seed, the same uint as uMaterialSeed (seedHash(settings.seed)). */
  seed: number;
  /** Sea-level annual mean Celsius, annual precipitation mm. */
  climate: readonly [number, number];
  height: { x: number; y: number; width: number; n: number; data: Float32Array };
  /** Routing-grid codes: 0 land, 1 sea, 2 lake, 3 river. Freshwater hint only;
   * its deliberately widened safety buffer must not define visible banks. */
  water?: Uint8Array;
  occupation?: ForestOccupation;
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
/** Two-pass chamfer distance (metres) to texels where mask is set. */
function distance(mask: Uint8Array, n: number, cell: number): Float32Array {
  const d = new Float32Array(n * n), diagonal = cell * Math.SQRT2;
  for (let i = 0; i < n * n; i++) d[i] = mask[i] ? 0 : 1e9;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + cell);
    if (y > 0) { v = Math.min(v, d[i - n] + cell); if (x > 0) v = Math.min(v, d[i - n - 1] + diagonal); if (x < n - 1) v = Math.min(v, d[i - n + 1] + diagonal); }
    d[i] = v;
  }
  for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
    const i = y * n + x; let v = d[i];
    if (x < n - 1) v = Math.min(v, d[i + 1] + cell);
    if (y < n - 1) { v = Math.min(v, d[i + n] + cell); if (x < n - 1) v = Math.min(v, d[i + n + 1] + diagonal); if (x > 0) v = Math.min(v, d[i + n - 1] + diagonal); }
    d[i] = v;
  }
  return d;
}
function fnv(bytes: Uint8Array, hash = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193);
  return hash >>> 0;
}


let baseCache: { key: string; base: Float32Array } | undefined;
/** Deterministic in (seed, climate, heights, water, settings); no Math.random.
 * Terrain/climate terms vary at the height grid's scale and are evaluated on a
 * half-resolution base grid; clearings stay at full resolution. */
export function buildForestField(input: ForestFieldInput, settings: ForestSettings = DEFAULT_FOREST_SETTINGS): ForestField {
  const layer = input.height, [T, P] = input.climate, seed = input.seed >>> 0;
  const N = forestFieldResolution(layer.width), cell = layer.width / N, n = layer.n, source = layer.width / n;
  const density = clamp(settings.density, 0, 2), clearings = clamp(settings.clearings, 0, 1);
  const terrainKey = `forest4:${seed}:${T}:${P}:${layer.x},${layer.y},${layer.width},${n}:${fnv(new Uint8Array(layer.data.buffer, layer.data.byteOffset, layer.data.byteLength)).toString(36)}`
    + `:${input.water ? fnv(input.water).toString(36) : '-'}`;
  const key = `${terrainKey}:${settings.enabled ? 1 : 0}:${density}:${clearings}:${input.occupation?.key ?? '-'}`;
  const rgba = new Uint8Array(N * N * 4), data = layer.data;
  const heightAt = (wx: number, wy: number): number => {
    if (n < 2) return data[0];
    const gx = clamp(wx / source - .5, 0, n - 1), gy = clamp(wy / source - .5, 0, n - 1);
    const x0 = Math.min(n - 2, Math.floor(gx)), y0 = Math.min(n - 2, Math.floor(gy)), fx = gx - x0, fy = gy - y0, k = y0 * n + x0;
    return (data[k] * (1 - fx) + data[k + 1] * fx) * (1 - fy) + (data[k + n] * (1 - fx) + data[k + n + 1] * fx) * fy;
  };
  const waterAt = (wx: number, wy: number): number => input.water?.[clamp(Math.floor(wy / source), 0, n - 1) * n + clamp(Math.floor(wx / source), 0, n - 1)] ?? 0;
  // Base grid: heights (bilinear, cell-centred) and fresh water. Reused while
  // only density/clearings change, so slider edits rebuild the full-res pass only.
  const B = Math.max(16, Math.ceil(N / 2)), bcell = layer.width / B;
  const base = baseCache?.key === terrainKey ? baseCache.base : new Float32Array(B * B * 5);
  if (baseCache?.key !== terrainKey) {
    const h = new Float32Array(B * B), fresh = new Uint8Array(B * B);
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const wx = (i + .5) * bcell, wy = (j + .5) * bcell, o = j * B + i;
      h[o] = heightAt(wx, wy); fresh[o] = waterAt(wx, wy) >= 2 ? 1 : 0;
    }
    const near = blur(h, B, Math.round(150 / bcell)), far = blur(h, B, Math.round(600 / bcell));
    const toWater = distance(fresh, B, bcell);
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
      const local = T - .0065 * Math.max(z, 0), grow = local + 6 + growBoost, cold = local - 6, humid0 = P / Math.max(20 * local + 280, 120);
      const gx = i / step, gy = j / step, cx = Math.min(M - 2, Math.floor(gx)), cy = Math.min(M - 2, Math.floor(gy)), fx = gx - cx, fy = gy - cy;
      const c00 = (cy * M + cx) * 6, c10 = c00 + 6, c01 = c00 + M * 6, c11 = c01 + 6;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      for (let c = 0; c < 6; c++) noise6[c] = coarse[c00 + c] * w00 + coarse[c10 + c] * w10 + coarse[c01 + c] * w01 + coarse[c11 + c] * w11;
      const stand = noise6[0], disturbed = sstep(1.05, 1.5, noise6[1]), conifer = noise6[2], toneNoise = noise6[3];
      // Valleys gather water, ridges drain (as earthMaterial); rivers and lakes
      // feed gallery forest where the climate alone is too dry.
      let humid = humid0 * (1 + .7 * valley * (1 - sstep(1.5, 3, humid0)) - .18 * ridge) * Math.exp(.12 * noise6[4]);
      // Moisture access varies along the bank: broad alluvial reaches alternate
      // with narrow dry/sandy banks, rather than a fixed-width green ribbon.
      const bank = noise((layer.x + (i + .5) * bcell) / 210 + 17.3, (layer.y + (j + .5) * bcell) / 210 - 41.9, seed + 71);
      const riparianWidth = 55 + 220 * sstep(-1.2, 1.2, .75 * noise6[1] + .6 * bank);
      const riparianStrength = .35 + .85 * sstep(-1, 1, .5 * noise6[4] + .7 * bank);
      const riparian = Math.exp(-toWater[o] / riparianWidth) * riparianStrength;
      humid += 1.5 * riparian * (1 - sstep(1.1, 2.4, humid));
      // Ragged treeline: ~6.4 °C growing-season isotherm, higher in sheltered gullies.
      const treeline = grow + .9 * noise6[5] + .7 * valley - .5 * ridge;
      const thermal = sstep(5, 8.5, treeline), moisture = sstep(.38, 1.25, humid), steep = 1 - sstep(.75, 1.4, slope);
      const coverMax = .6 + .38 * sstep(.8, 2.2, humid);
      // Boreal wet flats open into bog and fen.
      const bog = valley * (1 - sstep(.02, .08, slope)) * sstep(1.6, 3, humid) * (1 - sstep(11, 17, grow)) * (1 - wTropRegion);
      let cover = thermal * moisture * steep * coverMax * (1 - .6 * bog) * (1 - .2 * ridge * (1 - moisture));
      // Wet tropical disturbance mostly lowers and lightens the canopy (height, tone) rather than opening it.
      cover = clamp(cover * (1 + .22 * stand) + .05 * stand * cover * (1 - cover)) * (1 - .3 * disturbed * (1 - .7 * wTropRegion));
      // Clearings open gentle ground and ridges first and keep steep slopes (zero-mean bias).
      const gentle = 1 - sstep(.05, .25, slope), rugged = sstep(.35, .8, slope);
      // Includes the 400 m clearing octave; the 200 m octave is added at full resolution.
      const bias = .45 * (ridge - valley) + .3 * (gentle - .5) - .6 * rugged + .35 * stand + .45 * noise6[4] + noise(layer.x / 400 + (i + .5) * bcell / 400, layer.y / 400 + (j + .5) * bcell / 400, seed + 41) / 1.077;
      // Potential height: climate productivity, valley boost, young regrowth patches.
      const thermalHeight = .5 * sstep(5.5, 9.5, grow) + .5 * sstep(9, 22, grow);
      let height = 3 + 31 * Math.pow(sstep(.4, 2.8, humid), .8) * thermalHeight;
      height *= (1 + .16 * stand) * (1 - .55 * disturbed) * (1 + .15 * valley - .12 * ridge) * (.35 + .65 * sstep(5, 9, treeline));
      const needle = clamp(1 - sstep(10, 19, grow) + .3 * conifer + .35 * (1 - sstep(.7, 1.4, humid)) * (1 - wTropRegion) - wTropRegion - .7 * riparian * (1 - sstep(4, 12, cold + 20)));
      // Independent of cover and height, so closed tropical canopies still vary.
      const tone = clamp(.5 + (.16 + .1 * wTropRegion) * toneNoise + .22 * disturbed - .05 * valley);
      const b = o * 5;
      base[b] = cover; base[b + 1] = bias; base[b + 2] = height; base[b + 3] = needle; base[b + 4] = tone;
    }
    baseCache = { key: terrainKey, base };
  }
  // Full resolution: clearings 100–400 m (thresholded fbm), signed sea exclusion.
  // Target opened share of the potential forest. Closed wet tropical forest stays mostly closed (CHMv2 tropical
  // windows show no ≥ 1 ha opening, a known smoothing bias), so it keeps 15 %: ~2.7 % at the default.
  // The terrain bias widens the noise to a ~1.15 standard deviation.
  const clearedFraction = .4 * clearings * (1 - .85 * sstep(13, 19, T - 6)), threshold = 1.15 * upperQuantile(Math.max(clearedFraction, 1e-4));
  const byte = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : v * 255 + .5) | 0;
  for (let j = 0; j < N; j++) {
    const wy = (j + .5) * cell, gy = clamp(wy / bcell - .5, 0, B - 1), y0 = Math.min(B - 2, Math.floor(gy)), fy = gy - y0;
    for (let i = 0; i < N; i++) {
      const wx = (i + .5) * cell, o = j * N + i, gx = clamp(wx / bcell - .5, 0, B - 1), x0 = Math.min(B - 2, Math.floor(gx)), fx = gx - x0;
      const b00 = (y0 * B + x0) * 5, b10 = b00 + 5, b01 = b00 + B * 5, b11 = b01 + 5;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const at = (c: number): number => base[b00 + c] * w00 + base[b10 + c] * w10 + base[b01 + c] * w01 + base[b11 + c] * w11;
      const opened = clearedFraction <= 0 ? 0 : sstep(threshold - .25, threshold + .25, .4 * noise((layer.x + wx) / 200 + 31.7, (layer.y + wy) / 200 - 17.3, seed + 41 + 0x9e37) / 1.077 + at(1));
      let cover = at(0) * (1 - opened);
      if (density !== 1) cover = 1 - Math.pow(1 - Math.min(cover, .999), density);
      // Water labels come from the routing raster: narrow rivers deliberately
      // occupy at least 1.2 cells there. Applying that safety buffer to canopy
      // creates square clear corridors and slices crowns along cell edges.
      // Keep those labels for riparian moisture only; the shared water pass
      // composites the actual river/lake banks over complete crowns.
      if (!settings.enabled || heightAt(wx, wy) <= 0) cover = 0;
      rgba[o * 4] = byte(cover); rgba[o * 4 + 1] = byte(at(2) / 50); rgba[o * 4 + 2] = byte(at(3)); rgba[o * 4 + 3] = byte(at(4));
    }
  }
  return { x: layer.x, y: layer.y, width: layer.width, n: N, rgba, key };
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

/** Emitted before NEURAL_EARTH_MATERIAL_GLSL: disables its macro canopy when uForest==1. */
export const FOREST_PRELUDE_GLSL = `
#define RENDER3D_FOREST
uniform int uForest;
uniform int uForestBrushes; uniform highp sampler2DArray uForestBrushAtlas;
uniform sampler2D uForestField; uniform vec3 uForestRect;
uniform int uHasOccupation; uniform sampler2D uOccupation; uniform vec3 uOccupationRect; uniform float uOccupationN;
float forestWaterCoverage(vec2 world);
`;

/** Needs GROUND_FIELD_GLSL (GroundMaterial, groundHash, groundSmooth) and uMaterialSeed/uMaterialClimate. */
export const FOREST_GLSL = `
float forestResolvedCover=0.;
const float forestTauTable[33]=float[33](${list(FOREST_TAU_TABLE)});
const float forestPatchCdf[17]=float[17](${list(PATCH_CDF)});
const float forestCrownCdf[17]=float[17](${list(CROWN_CDF)});
// Patch-noise lattice; crown lattices are 2·√2^L metres (L = 0..6), all ≤ λ/3.
const float FOREST_PATCH=56.;
float forestLookup17(float x,int table){
  float u=clamp(x,0.,1.)*16.;int k=min(int(u),15);
  float a=table==0?forestPatchCdf[k]:forestCrownCdf[k],b=table==0?forestPatchCdf[k+1]:forestCrownCdf[k+1];
  return mix(a,b,u-float(k));
}
float forestTau(float d){float u=clamp(d,0.,.985)*32.;int k=min(int(u),31);return mix(forestTauTable[k],forestTauTable[k+1],u-float(k));}
float forestRho(float tau){return .5+.4*max(0.,(tau-.55)/.45);}
float forestU8(uint h,uint shift){return (float((h>>shift)&255u)+.5)/256.;}
vec2 forestGradient(ivec2 c){uint h=groundHash(ivec3(c,991),uMaterialSeed^0x6a09e667u);return vec2(float(h&255u),float((h>>8u)&255u))*(1./128.)+(.5/128.-1.);}
// 2D gradient noise from four corner gradients: (value, d/dx, d/dy) in lattice units.
vec3 forestPerlin(vec2 f,vec2 g00,vec2 g10,vec2 g01,vec2 g11){
  float n00=dot(g00,f),n10=dot(g10,f-vec2(1.,0.)),n01=dot(g01,f-vec2(0.,1.)),n11=dot(g11,f-1.),k=n00-n10-n01+n11;
  vec2 u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);
  vec2 g=g00+u.x*(g10-g00)+u.y*(g01-g00)+u.x*u.y*(g00-g10-g01+g11)+du*vec2(n10-n00+u.y*k,n01-n00+u.x*k);
  return vec3(n00+u.x*(n10-n00)+u.y*(n01-n00)+u.x*u.y*k,g);
}
// Uniform lattice threshold at p and its gradient magnitude (1/m).
vec2 forestPatchThreshold(vec2 p){
  vec2 g=p/FOREST_PATCH;ivec2 c=ivec2(floor(g));
  vec3 n=forestPerlin(g-vec2(c),forestGradient(c),forestGradient(c+ivec2(1,0)),forestGradient(c+ivec2(0,1)),forestGradient(c+ivec2(1,1)));
  float u=clamp(n.x*.6+.5,0.,1.),x=u*16.;int k=min(int(x),15);
  return vec2(forestLookup17(u,0),(forestPatchCdf[k+1]-forestPatchCdf[k])*16.*.6*length(n.yz)/FOREST_PATCH);
}
// Explicit LOD: no implicit derivatives after non-uniform returns.
vec4 forestField(vec2 world,float lod){return textureLod(uForestField,(world-uForestRect.xy)/uForestRect.z,lod);}
// Filtered per-fragment state for the far material. Resolved crowns sample
// their fixed world centres so every pixel takes the same candidate decision.
struct ForestStand{
  vec2 p;float cover;float height;float needle;float tone;
  float kappa;float trop;float dry;
  float open;float forced;float allow;float hedge;
};
float forestDensity(float c,float kappa){return clamp(c+kappa*(.985-c),c,.985);}
// Applied woods are a weak prior: a 25 % cover floor where trees grow, natural variation above it.
float forestWoods(float c,float h){return max(c,.25*groundSmooth(2.,6.,h));}
// Shared corner gradients of the lattice noise around one 3×3 crown neighbourhood.
struct ForestPatch{ivec2 base;vec2 g[9];};
ForestPatch forestPatchAround(ivec2 cell,float s){
  ForestPatch q;q.base=ivec2(floor(vec2(cell-1)*s/FOREST_PATCH));
  for(int j=0;j<3;j++)for(int i=0;i<3;i++)q.g[j*3+i]=forestGradient(q.base+ivec2(i,j));
  return q;
}
float forestPatchValue(ForestPatch q,vec2 p){
  vec2 g=p/FOREST_PATCH-vec2(q.base);ivec2 c=clamp(ivec2(floor(g)),ivec2(0),ivec2(1));int k=c.y*3+c.x;
  return clamp(forestPerlin(g-vec2(c),q.g[k],q.g[k+1],q.g[k+3],q.g[k+4]).x*.6+.5,0.,1.);
}
// One crown: centre, mean radius, outline harmonics, height, crown depth.
struct ForestCrown{vec2 c;float r;float h;float depth;bool needle;bool alive;float edge;uint id;};
ForestCrown forestCrown(ivec2 cell,int level,float s,ForestStand st,ForestPatch lattice){
  ForestCrown k;uint seed=uMaterialSeed^0x2c1b3c6du;
  uint h=groundHash(ivec3(cell,level*2),seed),h2=groundHash(ivec3(cell,level*2+1),seed);k.id=h2;
  k.c=(vec2(cell)+.15+.7*vec2(forestU8(h,0u),forestU8(h,8u)))*s;
  // Sample a candidate at its fixed world centre. Fragment-varying lattice
  // probabilities/radii can otherwise switch half-way through a drawing,
  // leaving a sliced crown or only a thin strip of its painted foot.
  vec4 centre=forestField(k.c,0.);float cover=centre.r,height=centre.g*50.,needle=centre.b;
  float open=-1e3,forced=-1e3,allow=0.,hedge=0.;
  if(uHasOccupation==1){
    vec2 ouv=(k.c-uOccupationRect.xy)/uOccupationRect.z;
    if(all(greaterThanEqual(ouv,vec2(0.)))&&all(lessThanEqual(ouv,vec2(1.)))){
      vec2 dist=(textureLod(uOccupation,ouv,0.).rg*255.-128.)/16.*uOccupationRect.z/uOccupationN;
      open=dist.x;forced=dist.y;
      int cls=int(texelFetch(uOccupation,clamp(ivec2(ouv*uOccupationN),ivec2(0),ivec2(int(uOccupationN)-1)),0).b*255.+.5);
      allow=cls==4?.45:cls==5?.22:cls==6?.12:cls==3?.05:cls==2?.02:cls==7?.03:0.;
      hedge=(cls>=1&&cls<=3?.6:0.)*groundSmooth(3.,8.,height)*(1.-st.dry);
    }
  }
  if(forced>0.)cover=forestWoods(cover,height);
  float kappa=st.kappa*mix(.55,1.,groundSmooth(3.,10.,height))/mix(.55,1.,groundSmooth(3.,10.,st.height))
    *mix(1.,.6,needle)/mix(1.,.6,st.needle);
  float density=forestDensity(cover,kappa),share=cover/max(density,1e-3);
  float radius=mix((.24*height+1.)*(1.+.45*st.dry),.14*height+.9,needle);
  float centreLevel=clamp(2.*log2(radius/forestRho(forestTau(density))/2.),0.,5.999);
  float weight=max(0.,1.-abs(centreLevel-float(level)));
  float tau=forestTau(1.-pow(1.-density,weight)),q=min(1.,tau/.55),rho=forestRho(tau);
  float threshold=forestLookup17(.8*forestPatchValue(lattice,k.c)+.2*forestU8(h2,0u),1);
  k.alive=false;
  if(open>0.){
    // Trees left in open land: scattered field trees, orchards, hedgerows.
    k.alive=forestU8(h2*0x27d4eb2du,24u)<allow+(open<5.?hedge:0.);k.edge=1.;
  } else {
    k.alive=forestU8(h,16u)<q&&threshold<share;
    // Harper et al.: stand margins are denser and darker.
    k.edge=1.-groundSmooth(0.,.1,share-threshold);
  }
  // A tree's centre stays on land; its complete crown can overhang the bank.
  if(k.alive && forestWaterCoverage(k.c)>=.5)k.alive=false;
  // Geometry only for live crowns. No early return: ANGLE/D3D11 miscompiled it here.
  k.needle=false;k.r=0.;k.h=0.;k.depth=0.;
  if(k.alive){
    k.needle=forestU8(h2,8u)<needle;
    k.r=rho*s*(.8+.4*forestU8(h,24u))*(1.+.1*k.edge)*(open>0.?.75:1.);
    float emergent=st.trop*groundSmooth(.9,.97,forestU8(h2,24u));
    k.h=height*(.82+.36*forestU8(h2,16u))*(1.+.35*emergent);
    k.depth=k.r*(k.needle?1.6:.55);
  }
  return k;
}
// Outline radius along the unit direction n: elliptic and trefoil harmonics, smaller for conifers.
float forestOutline(ForestCrown k,vec2 n){
  uint h=k.id*0x9e3779b9u;vec2 a=vec2(forestU8(h,0u),forestU8(h,8u))*6.2831853;float amp=k.needle?.07:.13;
  vec4 shape=vec4(cos(a.x),sin(a.x),.6*cos(a.y),.6*sin(a.y))*amp;
  vec2 c2=vec2(n.x*n.x-n.y*n.y,2.*n.x*n.y),c3=vec2(n.x*(4.*n.x*n.x-3.),n.y*(3.-4.*n.y*n.y));
  return k.r*(1.+dot(c2,shape.xy)+dot(c3,shape.zw));
}
struct ForestHit{float cover;float top;float second;vec2 slope;float rel;vec2 local;float r;bool needle;float edge;uint id;int level;float near;float ink;};
// The existing Fantasy watercolor silhouettes, stripped of hue at packing time.
// Same crown hash, two levels and 3x3 neighbourhood as the analytic Render3D.
vec2 forestBrush(ForestCrown k,ForestStand st,vec2 d,float aa,float s){
  float extent=min(1.22*k.r,1.12*s);vec2 uv=d/(2.*extent)+.5;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec2(0.,.5);
  int family=st.trop>.5?2:k.needle?0:1;
  if(st.dry>.35&&uMaterialClimate.x>10.&&forestU8(k.id,16u)<.35)family=3;
  // Mirror only: random rotations would turn trunks upside down.
  if((k.id&1u)==1u)uv.x=1.-uv.x;
  float layer=float(family*8+int((k.id>>4u)&7u));
  float lod=max(0.,log2(128.*aa/(2.*extent)));
  return textureLod(uForestBrushAtlas,vec3(uv,layer),lod).rg;
}
void forestCrowns(inout ForestHit hit,int level,float s,ForestStand st,float aa){
  ivec2 cell=ivec2(floor(st.p/s));ForestPatch lattice=forestPatchAround(cell,s);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    ForestCrown k=forestCrown(cell+ivec2(i,j),level,s,st,lattice);if(!k.alive)continue;
    vec2 d=st.p-k.c;float dist=length(d);
    if(dist>=2.*k.r+aa)continue;
    float r=k.r,a=0.,ink=.5;
    if(uForestBrushes==1){vec2 brushTexel=forestBrush(k,st,d,aa,s);a=brushTexel.r;ink=brushTexel.g;hit.near=min(hit.near,dist/r);if(a<.002)continue;}
    else {r=forestOutline(k,d/max(dist,1e-4));hit.near=min(hit.near,dist/r);if(dist>=r+aa)continue;a=clamp((r-dist)/aa+.5,0.,1.);}
    float delta=min(dist/r,1.);
    float z=k.h-k.depth*(k.needle?sqrt(delta*delta+.015):delta*delta);
    hit.cover=max(hit.cover,a);
    if(z>hit.top){
      hit.second=hit.top;hit.top=z;
      float g=k.needle?1.6*delta/sqrt(delta*delta+.015):1.1*delta;
      hit.slope=-g*d/max(dist,1e-4);hit.rel=delta;hit.local=d/r;hit.r=r;hit.needle=k.needle;hit.edge=k.edge;hit.id=k.id;hit.level=level;hit.ink=ink;
    } else hit.second=max(hit.second,z);
  }
}
// Cast shadow of the crowns around the sunward point onto height zp.
float forestShadow(ForestHit hit,int level,float s,ForestStand st,float aa,float zp,vec2 sun,float cot){
  vec2 from=st.p+sun*max(st.height*.75-zp,0.)*cot;
  ivec2 cell=ivec2(floor(from/s));ForestPatch lattice=forestPatchAround(cell,s);float shade=0.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    ForestCrown k=forestCrown(cell+ivec2(i,j),level,s,st,lattice);
    if(!k.alive||(hit.level==level&&k.id==hit.id&&hit.cover>0.))continue;
    float caster=k.h-.5*k.depth,o=(caster-zp)*cot;if(o<=0.)continue;
    // A crown is a translucent volume, not an opaque disc: its ground shadow
    // has a broad penumbra even when the display resolves individual leaves.
    float penumbra=max(aa,.22*k.r+.055*o);
    vec2 d=st.p-(k.c-sun*o);float sd=length(d);if(sd>=1.3*k.r+penumbra)continue;
    shade=max(shade,clamp((.92*forestOutline(k,d/max(sd,1e-4))-sd)/penumbra+.5,0.,1.));
  }
  return shade;
}
vec3 forestCanopy(ForestStand st,float needle,vec2 jitter,float special){
  vec3 broad=mix(vec3(.21,.31,.13),vec3(.16,.30,.11),st.trop);
  broad=mix(broad,vec3(.31,.32,.19),st.dry*(1.-.5*st.trop));
  vec3 c=mix(broad,mix(vec3(.15,.25,.16),vec3(.20,.24,.15),st.dry),needle);
  // Stand tone: young or disturbed stands lighter and yellower, old ones darker and bluer.
  float t=st.tone-.5;c*=1.+.34*t;
  c=mix(c,c*vec3(1.12,1.07,.78),max(t,0.)*.9);c=mix(c,c*vec3(.9,.97,1.08),max(-t,0.)*.7);
  float amp=mix(.09,.2,st.trop)*(1.-.45*needle);
  c*=1.+amp*jitter.x;
  c=mix(c,c*vec3(1.12,1.06,.72),max(jitter.y,0.)*amp*2.2);c=mix(c,c*vec3(.84,.97,1.12),max(-jitter.y,0.)*amp*1.6);
  // Tropical canopies: a few flushing, flowering or senescent crowns.
  vec3 accent=special<.45?vec3(.40,.42,.19):special<.8?vec3(.40,.30,.22):vec3(.36,.38,.32);
  return mix(c,accent,st.trop*groundSmooth(.965,.99,fract(special*7.31))*.6);
}
vec3 forestFloor(vec3 ground,ForestStand st,float cold){
  vec3 litter=mix(vec3(.26,.21,.15),vec3(.24,.21,.15),st.needle);
  litter=mix(litter,vec3(.15,.24,.10),st.trop);
  // Boreal floors: moss in wet stands, pale lichen in dry ones.
  litter=mix(litter,mix(vec3(.27,.32,.18),vec3(.58,.58,.48),.7*st.dry),cold*st.needle);
  return mix(ground,litter,.65*(1.-.6*st.dry));
}
// Shadowed fraction s: remove the direct-light component of the normal.
vec3 forestTilt(vec3 n,vec3 l,float s){return normalize(mix(n,normalize(n-l*max(dot(n,l),0.)),clamp(s,0.,1.)));}
void applyForest(inout GroundMaterial m,vec2 world,float footprint,vec3 light){
  forestResolvedCover=0.;
  vec2 uv=(world-uForestRect.xy)/uForestRect.z;
  if(uForest==0||any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return;
  float fp=max(footprint,.02);vec2 fsize=vec2(textureSize(uForestField,0));float fcell=uForestRect.z/fsize.x;
  float lod=max(log2(fp/fcell),0.);vec4 f=forestField(world,lod);
  ForestStand st;st.p=world;st.cover=f.r;st.height=f.g*50.;st.needle=f.b;st.tone=f.a;
  float T=uMaterialClimate.x,P=uMaterialClimate.y,humid=P/max(20.*T+280.,120.);
  st.trop=groundSmooth(13.,19.,T-6.);st.dry=1.-groundSmooth(.8,2.,humid);
  float cold=1.-groundSmooth(8.,16.,T+6.);
  // Clumping: savanna/dehesa trees scatter, closed forests form solid stands; conifer stands stay open.
  // Wet tropical canopies stay continuous: their deficit shows as crown gaps, not stand holes.
  st.kappa=mix(.25,.78,groundSmooth(.9,1.8,humid))*mix(.55,1.,groundSmooth(3.,10.,st.height))*mix(1.,.6,st.needle)*(1.-.6*st.trop);
  st.open=-1e3;st.forced=-1e3;st.allow=0.;st.hedge=0.;
  float openA=0.,forcedA=0.,hedgeA=0.;
  if(uHasOccupation==1){
    vec2 ouv=(world-uOccupationRect.xy)/uOccupationRect.z;
    if(all(greaterThanEqual(ouv,vec2(0.)))&&all(lessThanEqual(ouv,vec2(1.)))){
      float texel=uOccupationRect.z/uOccupationN;
      vec2 o=textureLod(uOccupation,ouv,0.).rg;
      // Signed distances in metres (positive inside).
      vec2 dist=(o*255.-128.)/16.*texel;
      st.open=dist.x;st.forced=dist.y;
      int cls=int(texelFetch(uOccupation,clamp(ivec2(ouv*uOccupationN),ivec2(0),ivec2(int(uOccupationN)-1)),0).b*255.+.5);
      // Trees kept in open classes: field, meadow, pasture, orchard, garden, commons, built.
      st.allow=cls==4?.45:cls==5?.22:cls==6?.12:cls==3?.05:cls==2?.02:cls==7?.03:0.;
      st.hedge=(cls>=1&&cls<=3?.6:0.)*groundSmooth(3.,8.,st.height)*(1.-st.dry);
      float w=max(fp,.5*texel);openA=clamp(st.open/w+.5,0.,1.);forcedA=clamp(st.forced/w+.5,0.,1.)*(1.-openA);
      hedgeA=openA-clamp((st.open-5.)/w+.5,0.,1.);
    }
  }
  // A zero-cover fragment can still lie under a crown centred across the
  // clearing boundary. The coarser mip covers that neighbouring support;
  // rejecting from the current texel alone slices otherwise stable crowns.
  if(st.cover<.002&&uHasOccupation==0&&forestField(world,max(lod,1.)).r<.00001)return;
  vec3 l=normalize(light);vec2 sun=length(l.xz)>1e-4?normalize(l.xz):vec2(0.);float cot=clamp(length(l.xz)/max(l.y,.05),0.,4.);
  // Stand statistics: share s = c/d of the ground in stands, crown cover d inside them.
  float radius=mix((.24*st.height+1.)*(1.+.45*st.dry),.14*st.height+.9,st.needle);
  // Stand patches keep full contrast only while their crowns are resolved: small unresolved crowns
  // (short boreal stands) fade to softer, mean-preserving patches instead of flat hard blobs.
  // At distance use a broad, softly filtered stand boundary rather than a binary
  // threshold. Keep real applied field edges in their own signed-distance mask.
  // The oblique artwork needs more pixels than an analytic crown. Keep its
  // tiny trunks/alpha holes out of the unresolved band instead of a dot grid.
  float crownVis=uForestBrushes==1?groundSmooth(2.,5.,radius/fp):groundSmooth(.9,2.,radius/fp);
  float patchDetail=uForestBrushes==1?crownVis:groundSmooth(.6,2.5,radius/fp);
  float patchVis=(1.-groundSmooth(6.,14.,fp))*mix(.18,1.,patchDetail);
  // Sparse desert gallery forest should resolve to a fine mottled trace, not a
  // broad constant-width painted ribbon. Taper its unresolved sparse fringe
  // continuously; near crowns and the canonical field keep their real cover.
  float fringe=(1.-groundSmooth(.38,.85,humid))*(1.-crownVis);
  float cover=mix(st.cover,forestWoods(st.cover,st.height),forcedA);
  cover=mix(cover,cover*cover,fringe);
  float d=forestDensity(cover,st.kappa),share=cover/max(d,1e-3);
  vec3 ground=groundToDisplay(m.albedo);vec3 nGround=m.normal;
  // Mid/far: AA stand mask over its mean, one sunward probe for stand shadows.
  vec2 q=world+sun*st.height*.6*cot;vec4 fq=forestField(q,lod);
  float cq=mix(fq.r,fq.r*fq.r,fringe),dq=forestDensity(cq,st.kappa),sq=cq/max(dq,1e-3),mask=share,maskQ=sq;
  if(patchVis>0.){
    vec2 pv=forestPatchThreshold(world),pq=forestPatchThreshold(q);
    float feather=mix(.16,.015,crownVis);
    mask=mix(share,clamp((share-pv.x)/max(pv.y*fp,feather)+.5,0.,1.),patchVis);
    maskQ=mix(sq,clamp((sq-pq.x)/max(pq.y*fp,feather)+.5,0.,1.),patchVis);
  }
  // Sub-crown grain between the crown band and the mean: crown-scale noise whose amplitude fades
  // with spacing/footprint (≈ the variance of unresolved crowns), so the transition never aliases.
  float grainVis=(1.-crownVis)*groundSmooth(.35,1.2,radius/fp),grain=0.;
  if(grainVis>0.){vec2 g=world/(1.6*radius)+vec2(17.3,-41.9);ivec2 c=ivec2(floor(g));
    grain=forestPerlin(g-vec2(c),forestGradient(c),forestGradient(c+ivec2(1,0)),forestGradient(c+ivec2(0,1)),forestGradient(c+ivec2(1,1))).x*grainVis;}
  float natural=mask*d*(1.-openA),openTrees=openA*(st.allow*.7+hedgeA/max(openA,1e-3)*st.hedge*.6);
  float canopy=clamp(natural+openTrees,0.,1.),stand=mask*(1.-openA);
  float groundShadow=clamp(maskQ*dq*(1.-openA)+openTrees*.6,0.,1.);
  vec3 litter=forestFloor(ground,st,cold);
  float snow=groundSmooth(.62,.85,min(ground.r,ground.b));
  vec3 mean=forestCanopy(st,st.needle,vec2(0.),0.);mean=mix(mean,vec3(.80,.84,.86),snow*mix(.12,.3,st.needle));
  // Mean crown self-shading (normal tilt) and occlusion, matched to the crown band.
  float selfShade=mix(.24,.42,st.needle);
  vec3 farAlbedo=mix(groundToLinear(mix(ground,litter,stand)),groundToLinear(mean)*(1.+.5*grain),canopy);
  // Distant stand probes are an average, not a second hard cast-shadow motif.
  vec3 farNormal=forestTilt(nGround,l,clamp(canopy*selfShade*(1.-.8*grain)+(1.-canopy)*groundShadow*.25,0.,1.));
  float farOcc=mix(m.occlusion*mix(1.,.72,stand),.8,canopy);
  float farRough=mix(m.roughness,.9,canopy);
  if(crownVis<=0.){m.albedo=farAlbedo;m.normal=farNormal;m.occlusion=farOcc;m.roughness=farRough;return;}
  // Near: explicit crowns on two lattice levels whose union keeps cover d.
  float rho=forestRho(forestTau(d));
  float level=clamp(2.*log2(radius/rho/2.),0.,5.999),l0=floor(level),w=level-l0;
  float s0=2.*exp2(l0*.5),s1=s0*1.41421356;
  float d0=1.-pow(1.-d,1.-w),d1=1.-pow(1.-d,w);
  float aa=fp*.75;
  ForestHit hit;hit.cover=0.;hit.top=-1e9;hit.second=-1e9;hit.slope=vec2(0.);hit.rel=1.;hit.local=vec2(0.);hit.r=1.;hit.needle=false;hit.edge=0.;hit.id=0u;hit.level=-1;hit.near=9.;hit.ink=.5;
  if(d0>.002)forestCrowns(hit,int(l0),s0,st,aa);
  if(d1>.002)forestCrowns(hit,int(l0)+1,s1,st,aa);
  forestResolvedCover=hit.cover*crownVis;
  float zp=hit.cover>0.?hit.top:0.,shade=0.;
  // Analytic crowns cast a soft dominant-level shadow. Fantasy motifs already
  // contain an oblique painted contact shade: projecting that drawing again
  // creates detached copies of trees rather than a coherent ground shadow.
  if(uForestBrushes==0){
    if(w<.5)shade=forestShadow(hit,int(l0),s0,st,aa,zp,sun,cot);else shade=forestShadow(hit,int(l0)+1,s1,st,aa,zp,sun,cot);
  }
  // Crown surface: leaf clumps (broadleaf) or branch whorls (conifers), rim and trough occlusion.
  uint hc=hit.id*0x9e3779b9u;
  vec2 jitter=vec2(forestU8(hc,0u),forestU8(hc,8u))*2.-1.;float special=forestU8(hc,16u),phase=forestU8(hc,24u)*6.2831853;
  float clumpVis=groundSmooth(2.5,7.,hit.r/fp),clump;vec2 dClump;
  if(uForestBrushes==1){
    // Reuse the selected crown's alpha/luminance sample: no reconstruction or
    // lookup whose biome, scale or coordinates could drift at a stand edge.
    clump=(hit.ink-.5)*2.;dClump=vec2(0.);
  } else if(hit.needle){
    // Straight radial branch ridges seen from above (a twist reads as a pinwheel).
    float rel=length(hit.local),angle=atan(hit.local.y,hit.local.x)*7.+phase;
    clump=cos(angle)*rel;
    vec2 radial=hit.local/max(rel,1e-3),tangent=vec2(-radial.y,radial.x);
    dClump=(-sin(angle)*7.*tangent*rel/max(rel,.05)+cos(angle)*radial)/hit.r;
  } else {
    vec2 a=hit.local*6.5;
    vec3 ph=vec3(phase,phase*1.7,phase*2.3),arg=vec3(a.x,.5*a.x+.866*a.y,-.5*a.x+.866*a.y)+ph;
    clump=(cos(arg.x)+cos(arg.y)+cos(arg.z))/3.;
    vec3 sn=sin(arg);dClump=-6.5*vec2(sn.x+.5*sn.y-.5*sn.z,.866*(sn.y+sn.z))/(3.*hit.r);
    // Finer leaf clusters (rotated, ~2.3× frequency), only once a crown spans many pixels.
    float fine=groundSmooth(8.,20.,hit.r/fp);
    if(fine>0.){
      vec2 b=mat2(.62,-.78,.78,.62)*hit.local*15.;
      vec3 arg2=vec3(b.x,.5*b.x+.866*b.y,-.5*b.x+.866*b.y)+ph.zxy*1.3;
      vec3 sn2=sin(arg2);clump=mix(clump,.65*clump+.35*(cos(arg2.x)+cos(arg2.y)+cos(arg2.z))/3.,fine);
      dClump+=fine*.35*(-15./(3.*hit.r))*(mat2(.62,.78,-.78,.62)*vec2(sn2.x+.5*sn2.y-.5*sn2.z,.866*(sn2.y+sn2.z)));
    }
  }
  // The artwork supplies most of its shading; a shallow crown normal retains
  // volume without wrapping a full circular dome over an oblique drawing.
  vec2 slope=uForestBrushes==1?.25*hit.slope:hit.slope+clumpVis*dClump*hit.r*(hit.needle?.14:.16);
  vec2 macroSlope=-nGround.xz/max(nGround.y,.2);
  vec3 nCrown=normalize(vec3(-(macroSlope.x+slope.x),1.,-(macroSlope.y+slope.y)));
  // Shaded crowns keep their sky light (no black caps).
  nCrown=forestTilt(nCrown,l,shade*.3);
  float trough=hit.second>-1e8?1.-.3*exp(-(hit.top-hit.second)/max(.25*hit.r,.1)):1.;
  float occCrown=uForestBrushes==1?.94:max((.6+.4*(1.-hit.rel*hit.rel))*trough*(1.-.25*clumpVis*max(-clump-.15,0.)),.5);
  float detailGain=uForestBrushes==1?.36:.12;
  vec3 crown=forestCanopy(st,hit.needle?1.:0.,jitter,special)*(1.+detailGain*clumpVis*clump)*(1.-.12*hit.edge);
  crown=mix(crown,vec3(.80,.84,.86),snow*mix(.12,.3,hit.needle?1.:0.)*(1.-hit.rel));
  // Forest floor under and right around crowns; open ground beyond.
  float under=uForestBrushes==1?hit.cover:1.-groundSmooth(1.,1.8,hit.near);
  vec3 nearAlbedo=mix(groundToLinear(mix(ground,litter,under)),groundToLinear(crown),hit.cover);
  vec3 nearNormal=normalize(mix(forestTilt(nGround,l,shade*.3),nCrown,hit.cover));
  float nearOcc=mix(m.occlusion*mix(1.,.72,under),occCrown,hit.cover);
  float nearRough=mix(m.roughness,.9,hit.cover);
  m.albedo=mix(farAlbedo,nearAlbedo,crownVis);m.normal=normalize(mix(farNormal,nearNormal,crownVis));
  m.occlusion=mix(farOcc,nearOcc,crownVis);m.roughness=mix(farRough,nearRough,crownVis);
}
`;
