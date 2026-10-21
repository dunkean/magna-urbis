/** Render3D riparian gallery: a narrow bank-following envelope measured from
 * the displayed river geometry, stored on the canonical forest-field grid.
 * Routing water labels are widened safety buffers and never define it.
 * Own adaptation of riparian buffer structure (Naiman & Décamps 1997) with
 * a bounded segment-distance transform. Display only: never feeds terrain. */

/** Nine floats per segment, as the water renderer: ax, ay, bx, by, widthA, widthB, r, g, b (metres). */
export type RiverSegments = Float32Array;
export interface ForestBankGrid { x: number; y: number; width: number; n: number }
export interface ForestBankContext {
  /** Same uint as the forest field seed. */
  seed: number;
  /** Sea-level annual mean Celsius, annual precipitation mm. */
  climate: readonly [number, number];
  /** Land height in metres at a world position; <= 0 is sea. */
  heightAt: (wx: number, wy: number) => number;
  /** True inside a lake interior (eroded routing label). */
  lakeAt?: (wx: number, wy: number) => boolean;
}

/** Widest envelope, beyond the bank, in metres. */
export const FOREST_BANK_MAX_WIDTH = 48;
/** Reference offsets are encoded within ±range metres (127 steps). */
export const forestBankRange = (cell: number): number => FOREST_BANK_MAX_WIDTH + 3 * cell;
/** Gallery crown cover target, denser along wider reaches. */
export const forestBankDensity = (width: number): number => .55 + .35 * sstep(8, 36, width);
/** The outer part of the envelope thins (−60 % at its edge) instead of ending
 * as a hedge line; mean of that taper across the band (∫ smoothstep = .325). */
const EDGE_TAPER = .6, EDGE_MEAN = 1 - EDGE_TAPER * .325;
/** Low physical canopies are shrubs; trees take over smoothly by 5.5 m. */
export const FOREST_SHRUB_HEIGHTS = [3, 5.5] as const;

const clamp = (v: number, a = 0, b = 1): number => v < a ? a : v > b ? b : v;
function sstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
/** Share of shrub brushes for a candidate of this physical height (metres). */
export const forestShrubShare = (height: number): number => 1 - sstep(FOREST_SHRUB_HEIGHTS[0], FOREST_SHRUB_HEIGHTS[1], height);

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x9e3779b9) ^ Math.imul(y, 0x85ebca6b) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Value noise with quintic interpolation, roughly unit standard deviation. */
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v) * (2.6 / 2147483648) - 2.6;
}
const fbm = (x: number, y: number, wavelength: number, seed: number): number =>
  (noise(x / wavelength, y / wavelength, seed) + .5 * noise(x / wavelength * 2.03 + 17.1, y / wavelength * 2.03 - 9.4, seed + 1)) / 1.118;
/** Length of [a0, a1] ∩ [b0, b1]. */
const overlap = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Stable content key for river geometry. */
export function forestSegmentsKey(segments: RiverSegments | undefined): string {
  if (!segments?.length) return '-';
  let h = 0x811c9dc5;
  const bytes = new Uint8Array(segments.buffer, segments.byteOffset, segments.byteLength);
  // Colours (last three floats) do not affect banks; skip them.
  for (let k = 0; k < segments.length; k += 9) for (let b = k * 4; b < (k + 6) * 4; b++) h = Math.imul(h ^ bytes[b], 0x01000193);
  return `${segments.length / 9}.${(h >>> 0).toString(36)}`;
}

/** Bank raster on the forest grid, texel centres at x+(i+.5)·width/n. */
export interface ForestBank {
  /** RGBA8: RG offset from the texel centre to its reference point
   * (128 + 127·offset/range); B reach W from that point (2/m), so the envelope
   * margin is W − |offset|; A texel area of the land envelope × crown density,
   * mipmapped for unresolved views. Channels narrower than 1.5 texels refer to
   * their centreline (W = w + r): its closest-point map is affine across the
   * channel, so both banks keep sub-texel edges. Wider ones refer to their
   * nearest bank point (W = w). Bilinear offsets are exact on straight reaches. */
  rgba: Uint8Array;
  /** Gallery stature (m) and its weight 0..1, for the field's height channel. */
  stature: Float32Array; weight: Float32Array;
}

/**
 * Bounded closest-bank transform: each segment only visits texels within its
 * own extent plus the envelope reach, never all segments × texels.
 * Undefined without segments.
 */
export function forestBankField(segments: RiverSegments | undefined, grid: ForestBankGrid, context: ForestBankContext): ForestBank | undefined {
  if (!segments?.length) return undefined;
  const N = grid.n, cell = grid.width / N, seed = context.seed >>> 0, [T, P] = context.climate;
  const reach = forestBankRange(cell);
  // Signed bank distance (negative in the channel), half width, centreline and bank points.
  const bank = new Float32Array(N * N).fill(Infinity), half = new Float32Array(N * N), point = new Float32Array(N * N * 4);
  for (let k = 0; k + 8 < segments.length; k += 9) {
    const ax = segments[k], ay = segments[k + 1], bx = segments[k + 2], by = segments[k + 3];
    const ra = Math.max(0, segments[k + 4] * .5), rb = Math.max(0, segments[k + 5] * .5);
    if (![ax, ay, bx, by, ra, rb].every(Number.isFinite)) continue;
    const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
    // Long segments are split so each box stays a thin band around its piece.
    const pieces = Math.max(1, Math.ceil(Math.sqrt(length2) / (8 * cell)));
    for (let p = 0; p < pieces; p++) {
      const t0 = p / pieces, t1 = (p + 1) / pieces, pad = Math.max(ra, rb) + reach;
      const x0 = ax + dx * t0, x1 = ax + dx * t1, y0 = ay + dy * t0, y1 = ay + dy * t1;
      const left = Math.max(0, Math.floor((Math.min(x0, x1) - pad - grid.x) / cell - .5));
      const right = Math.min(N - 1, Math.ceil((Math.max(x0, x1) + pad - grid.x) / cell - .5));
      const top = Math.max(0, Math.floor((Math.min(y0, y1) - pad - grid.y) / cell - .5));
      const bottom = Math.min(N - 1, Math.ceil((Math.max(y0, y1) + pad - grid.y) / cell - .5));
      for (let j = top; j <= bottom; j++) {
        const wy = grid.y + (j + .5) * cell;
        for (let i = left; i <= right; i++) {
          const wx = grid.x + (i + .5) * cell;
          const t = length2 ? clamp(((wx - ax) * dx + (wy - ay) * dy) / length2, t0, t1) : 0;
          const r = ra + (rb - ra) * t, cx = ax + t * dx, cy = ay + t * dy, dc = Math.sqrt((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy)), s = dc - r, o = j * N + i;
          // Land texels keep their nearest bank; channel texels the bank of
          // their deepest capsule, so polyline joints stay in the water.
          if (s < bank[o]) {
            bank[o] = s; half[o] = r;
            const ux = dc > 1e-6 ? (wx - cx) / dc : length2 ? -dy / Math.sqrt(length2) : 1, uy = dc > 1e-6 ? (wy - cy) / dc : length2 ? dx / Math.sqrt(length2) : 0;
            point[4 * o] = cx - wx; point[4 * o + 1] = cy - wy; point[4 * o + 2] = cx + ux * r - wx; point[4 * o + 3] = cy + uy * r - wy;
          }
        }
      }
    }
  }
  const humid = P / Math.max(20 * T + 280, 120), wet = sstep(.45, 1.6, humid);
  // Box footprint projected on the bank normal, averaged over directions (4/π).
  const e = .5 * cell * 1.273;
  const byte = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : v * 255 + .5) | 0;
  const offset = (v: number): number => clamp(Math.round(128 + 127 * v / reach), 1, 255);
  const rgba = new Uint8Array(N * N * 4).fill(255), stature = new Float32Array(N * N), weight = new Float32Array(N * N);
  for (let o = 0; o < N * N; o++) {
    const s = bank[o];
    rgba[o * 4 + 2] = rgba[o * 4 + 3] = 0;
    if (!(s < reach)) continue;
    const i = o % N, j = (o - i) / N, wx = grid.x + (i + .5) * cell, wy = grid.y + (j + .5) * cell, r = half[o];
    // Offsets stay valid over sea and lake interiors, so the bilinear
    // reference stays exact at a coast; only their envelope width is zero.
    const narrow = 2 * r < 1.5 * cell, ref = narrow ? 4 * o : 4 * o + 2;
    rgba[o * 4] = offset(point[ref]); rgba[o * 4 + 1] = offset(point[ref + 1]);
    if (context.heightAt(wx, wy) <= 0 || context.lakeAt?.(wx, wy)) continue;
    // Along-bank variation: ~400 m reaches, finely modulated at ~90 m.
    // Bounded below, so noise varies the ribbon rather than breaking it.
    const reachNoise = fbm(wx, wy, 400, seed + 101), fine = noise(wx / 90 + 3.1, wy / 90 - 7.7, seed + 103);
    const shelter = sstep(.15, 1.25, fbm(wx + 5310, wy - 2270, 1100, seed + 107) + .35 * sstep(4, 40, r));
    let w = 7 + 19 * sstep(-1.5, 1.5, .8 * reachNoise + .35 * fine);
    w = Math.min(FOREST_BANK_MAX_WIDTH, (w + Math.min(10, .2 * r)) * (1 + .5 * wet) * (1 + .18 * shelter));
    const d = Math.max(0, s);
    // Low shrubs on ordinary desert banks; taller gallery trees in sheltered
    // or wetter reaches and along larger rivers, lower towards the outer edge.
    const shrub = 1.3 + 1.5 * sstep(-1, 1, noise(wx / 60 - 11.3, wy / 60 + 5.9, seed + 109));
    const tree = 7 + 9 * wet + Math.min(6, .12 * r);
    stature[o] = (shrub + (tree - shrub) * clamp(shelter * (.6 + .4 * wet))) * (1 - .4 * clamp(d / w));
    weight[o] = 1 - sstep(w, w + cell, d);
    // Land band [r, r+w] on each side of the centreline, area-weighted per texel.
    const centre = s + r, area = (overlap(centre - e, centre + e, r, r + w) + overlap(centre - e, centre + e, -r - w, -r)) / (2 * e);
    const reachW = narrow ? w + r : w;
    rgba[o * 4 + 2] = Math.min(255, Math.round(2 * reachW));
    rgba[o * 4 + 3] = byte(area * forestBankDensity(reachW) * EDGE_MEAN);
  }
  return { rgba, stature, weight };
}

/** CPU mirror of the shader's bilinear bank sample: distance to the reference
 * point and reach W (m); margin W − distance is positive inside the envelope.
 * Clamped edges, like the texture. */
export function forestBankSample(bank: Uint8Array, grid: ForestBankGrid, wx: number, wy: number): { distance: number; reach: number; margin: number } {
  const N = grid.n, cell = grid.width / N, range = forestBankRange(cell);
  const gx = clamp((wx - grid.x) / cell - .5, 0, N - 1), gy = clamp((wy - grid.y) / cell - .5, 0, N - 1);
  const x0 = Math.min(N - 2, Math.floor(gx)), y0 = Math.min(N - 2, Math.floor(gy)), fx = gx - x0, fy = gy - y0;
  const at = (c: number): number => {
    const k = (y0 * N + x0) * 4 + c, a = bank[k], b = bank[k + 4], d = bank[k + N * 4], e = bank[k + N * 4 + 4];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  };
  const distance = Math.hypot((at(0) - 128) * range / 127, (at(1) - 128) * range / 127), reach = at(2) / 2;
  return { distance, reach, margin: reach - distance };
}

/** Fallback without displayed geometry: centres of routing river cells, zero width.
 * Their widened labels make this envelope up to about half a routing cell wider. */
export function forestRoutingRiverSegments(water: Uint8Array, grid: ForestBankGrid): RiverSegments {
  const n = grid.n, cell = grid.width / n, out: number[] = [];
  for (let c = 0; c < n * n; c++) {
    if (water[c] !== 3) continue;
    const x = grid.x + (c % n + .5) * cell, y = grid.y + (Math.floor(c / n) + .5) * cell;
    out.push(x, y, x, y, 0, 0, 0, 0, 0);
  }
  return Float32Array.from(out);
}

/** Lake interiors on a routing grid: the cell and its 8 neighbours are lake,
 * so a widened label never cuts the gallery where a river meets the shore. */
export function forestLakeInterior(water: Uint8Array | undefined, n: number, width: number): ((wx: number, wy: number) => boolean) | undefined {
  if (!water || !water.includes(2)) return undefined;
  const cell = width / n;
  return (wx, wy) => {
    const x = Math.floor(wx / cell), y = Math.floor(wy / cell);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = Math.min(n - 1, Math.max(0, x + i)), yy = Math.min(n - 1, Math.max(0, y + j));
      if (water[yy * n + xx] !== 2) return false;
    }
    return true;
  };
}

type Matrix = readonly [number, number, number, number, number, number];
/** Flattens an SVG path (M L H V Q C A Z, absolute or relative) into nine-float
 * segments of the given width. Arcs only occur as round caps and become chords. */
export function svgPathSegments(d: string, matrix: Matrix, width: number, out: number[]): void {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const [a, b, c, dd, e, f] = matrix;
  let x = 0, y = 0, sx = 0, sy = 0, command = '', i = 0;
  const edge = (x0: number, y0: number, x1: number, y1: number): void => {
    out.push(a * x0 + c * y0 + e, b * x0 + dd * y0 + f, a * x1 + c * y1 + e, b * x1 + dd * y1 + f, width, width, 0, 0, 0);
  };
  const curve = (points: number[]): void => {
    // De Casteljau samples at a fixed count: river banks are short spans.
    const steps = 8, degree = points.length / 2 - 1;
    let px = points[0], py = points[1];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, q = points.slice();
      for (let r = degree; r > 0; r--) for (let k = 0; k < r; k++) {
        q[2 * k] += (q[2 * k + 2] - q[2 * k]) * t; q[2 * k + 1] += (q[2 * k + 3] - q[2 * k + 1]) * t;
      }
      edge(px, py, q[0], q[1]); px = q[0]; py = q[1];
    }
  };
  const take = (count: number): number[] | undefined => {
    if (i + count > tokens.length) return undefined;
    const values = tokens.slice(i, i + count).map(Number);
    if (values.some(v => !Number.isFinite(v))) return undefined;
    i += count; return values;
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase(), upper = command.toUpperCase();
    const ox = relative ? x : 0, oy = relative ? y : 0;
    if (upper === 'Z') { if (x !== sx || y !== sy) edge(x, y, sx, sy); x = sx; y = sy; command = ''; continue; }
    const count = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, A: 7 }[upper];
    const v = count ? take(count) : undefined;
    if (!v) break;
    if (upper === 'M') { x = sx = v[0] + ox; y = sy = v[1] + oy; command = relative ? 'l' : 'L'; }
    else if (upper === 'L' || upper === 'H' || upper === 'V' || upper === 'A') {
      const nx = upper === 'V' ? x : upper === 'A' ? v[5] + ox : v[0] + ox;
      const ny = upper === 'H' ? y : upper === 'V' ? v[0] + oy : upper === 'A' ? v[6] + oy : v[1] + oy;
      edge(x, y, nx, ny); x = nx; y = ny;
    } else {
      const points = [x, y];
      for (let k = 0; k < v.length; k += 2) points.push(v[k] + ox, v[k + 1] + oy);
      curve(points); x = points[points.length - 2]; y = points[points.length - 1];
    }
  }
}

const retainedCache = new Map<string, RiverSegments>();
/** Retained decor rivers in the rebased map frame, including nested crop
 * viewBoxes: filled bank outlines become zero-width bank edges, stroked
 * channels keep their stroke width. Lakes and cosmetic strokes are excluded.
 * Main thread only (uses the SVG DOM for transforms). */
export function forestRetainedRiverSegments(svg: string, mapWidth: number): RiverSegments | undefined {
  if (!svg || typeof document === 'undefined') return undefined;
  const key = `${mapWidth}:${svg}`, found = retainedCache.get(key);
  if (found) return found;
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('width', String(mapWidth)); host.setAttribute('height', String(mapWidth));
  host.setAttribute('viewBox', `0 0 ${mapWidth} ${mapWidth}`);
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
  host.innerHTML = svg; document.body.append(host);
  const out: number[] = [];
  try {
    const toHost = host.getScreenCTM()?.inverse();
    for (const node of Array.from(host.querySelectorAll<SVGPathElement>('path'))) {
      if (node.closest('defs,clipPath,mask,[class*="lake"]')) continue;
      const fill = node.getAttribute('fill'), stroke = node.getAttribute('stroke');
      const stroked = fill === 'none' && stroke && stroke !== 'none' && node.getAttribute('vector-effect') !== 'non-scaling-stroke';
      if (fill === 'none' && !stroked) continue;
      const screen = node.getScreenCTM(), m = screen && toHost ? toHost.multiply(screen) : node.getCTM();
      const matrix: Matrix = m ? [m.a, m.b, m.c, m.d, m.e, m.f] : [1, 0, 0, 1, 0, 0];
      const scale = m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1;
      svgPathSegments(node.getAttribute('d') ?? '', matrix, stroked ? Number(node.getAttribute('stroke-width') ?? 1) * scale : 0, out);
    }
  } finally { host.remove(); }
  const segments = Float32Array.from(out);
  retainedCache.set(key, segments);
  while (retainedCache.size > 3) retainedCache.delete(retainedCache.keys().next().value!);
  return segments;
}

/** Shared sampling of the bank raster (same rectangle as the forest field).
 * Needs FOREST_PRELUDE_GLSL (bank uniforms and uForestRect) and groundSmooth. */
export const FOREST_BANK_GLSL = `
float forestBankDensity(float w){float c=.55+.35*groundSmooth(8.,36.,w);return 1.-pow(1.-c,max(uForestBankDensity,0.));}
// Crown cover target at a point with (margin, reach): the outer band thins.
float forestBankGallery(vec2 b){return b.x>0.?forestBankDensity(b.y)*(1.-${EDGE_TAPER}*groundSmooth(.35,1.,1.-b.x/max(b.y,1.))):0.;}
// (envelope margin m, positive inside; reach W m) at lod 0. The bilinear
// offset to the reference point (centreline of a narrow channel, else the
// nearest bank point) is exact on straight reaches, so both banks of a channel
// narrower than one texel keep their own edge.
vec2 forestBankAt(vec2 world){
  if(uHasForestBank==0)return vec2(-1e3,0.);
  vec2 uv=(world-uForestRect.xy)/uForestRect.z;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec2(-1e3,0.);
  float range=${FOREST_BANK_MAX_WIDTH}.+3.*uForestRect.z/float(textureSize(uForestBank,0).x);
  vec4 t=textureLod(uForestBank,uv,0.);float w=t.b*255./2.;
  if(w<=0.)return vec2(-1e3,0.);
  return vec2(w-length((t.rg*255.-128.)*(range/127.)),w);
}
// Expected gallery canopy fraction over a footprint fp (m): the antialiased
// envelope while resolved, its mipmapped texel area beyond.
float forestBankCover(vec2 world,float fp){
  if(uHasForestBank==0)return 0.;
  vec2 uv=(world-uForestRect.xy)/uForestRect.z;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return 0.;
  float cell=uForestRect.z/float(textureSize(uForestBank,0).x),range=${FOREST_BANK_MAX_WIDTH}.+3.*cell;
  vec4 t=textureLod(uForestBank,uv,0.);float w=t.b*255./2.,margin=w-length((t.rg*255.-128.)*(range/127.));
  float sharp=step(.001,w)*clamp(margin/max(fp,.05)+.5,0.,1.)*forestBankDensity(w)*(1.-${EDGE_TAPER}*groundSmooth(.35,1.,1.-max(margin,0.)/max(w,1.)));
  float area=textureLod(uForestBank,uv,max(log2(fp/cell),0.)).a;
  return mix(sharp,area,groundSmooth(.5*cell,2.*cell,fp));
}
float forestShrubShare(float h){return 1.-groundSmooth(${FOREST_SHRUB_HEIGHTS[0]}.,${FOREST_SHRUB_HEIGHTS[1]},h);}
`;
