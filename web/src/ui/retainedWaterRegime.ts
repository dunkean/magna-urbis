/** Seasonal water regime (waterRegime.ts) on the retained water banks of City Bench (retainedWaterGeometry.ts).
 *
 * Retained water is a set of filled bank outlines, without the river network: the size of a course is read from the
 * banks themselves. The banks are rasterized over the whole map, the distance to the nearest bank gives each water
 * cell the half-width of its channel (the largest bank distance around it), and the width gives the course's size `q`
 * on an absolute scale (W0 a brook, W1 a large regional river), so a desert town's river dries unless it is a large
 * exotic trunk. Dryness and ice are then smoothed over about 100 m of water (normalized blur), so a course dries or
 * freezes gradually along its channel and never switches state at a junction. The dry season of a dry climate also
 * exposes the shore of wide water (lakes, broad trunks).
 *
 * Output: whole-map fields, sampled bilinearly by the painters below. Material water compositors read a regime code
 * (regimeRgb); ink styles and 3D tiles get the map symbols (wadi, intermittent course, ice) through alpha masks. */
import type { TerrainStyle } from '../../../rust/bridge/terrainRender';
import { riverState, waterClimate, waterRegimeActive, type WaterClimate, type WaterSeason } from '../render/waterRegime';
import type { RetainedWaterPath } from '../render/retainedWaterGeometry';
import { regimeInk } from './vectorWaterRender';

/** Channel widths (m) of the smallest drawn brook and of a large regional trunk. */
const W0 = 4, W1 = 120;
/** Reach of the channel half-width search and of the smoothing (m). */
const HALF_REACH = 70, SMOOTH = 45;

export interface RetainedRegime {
  climate: WaterClimate; width: number;
  /** Regime code over the whole map, opaque: r running water (1 − dry), g open water (1 − ice), b 0 (regimeRgb). */
  code: HTMLCanvasElement;
  /** Alpha masks over the whole map: water kept as running water, wadi bed, intermittent course, ice. */
  wet: HTMLCanvasElement; dry: HTMLCanvasElement; intermittent: HTMLCanvasElement; ice: HTMLCanvasElement;
  frozen: boolean; drying: boolean;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number): number => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Squared Euclidean distance transform (Felzenszwalb), in place on an n×n grid. */
function edt(f: Float64Array, n: number): void {
  const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), g = new Float64Array(n);
  const pass = (get: (i: number) => number, set: (i: number, value: number) => void): void => {
    for (let i = 0; i < n; i++) g[i] = get(i);
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + g[v[k]]; }
    for (let i = 0; i < n; i++) set(i, d[i]);
  };
  for (let x = 0; x < n; x++) pass(i => f[i * n + x], (i, value) => { f[i * n + x] = value; });
  for (let y = 0; y < n; y++) pass(i => f[y * n + i], (i, value) => { f[y * n + i] = value; });
}

/** Square max filter of radius r cells (separable, van Herk / Gil-Werman). */
function maxFilter(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n), w = 2 * r + 1, line = new Float32Array(n + 2 * r), left = new Float32Array(n + 2 * r), right = new Float32Array(n + 2 * r);
  const run = (read: (i: number) => number, write: (i: number, value: number) => void): void => {
    const m = n + 2 * r;
    for (let i = 0; i < m; i++) { const j = i - r; line[i] = j >= 0 && j < n ? read(j) : 0; }
    for (let i = 0; i < m; i++) left[i] = i % w === 0 ? line[i] : Math.max(left[i - 1], line[i]);
    for (let i = m - 1; i >= 0; i--) right[i] = i === m - 1 || (i + 1) % w === 0 ? line[i] : Math.max(right[i + 1], line[i]);
    for (let j = 0; j < n; j++) write(j, Math.max(right[j], left[j + 2 * r]));
  };
  for (let y = 0; y < n; y++) run(i => src[y * n + i], (i, value) => { tmp[y * n + i] = value; });
  for (let x = 0; x < n; x++) run(i => tmp[i * n + x], (i, value) => { out[i * n + x] = value; });
  return out;
}

/** Three box passes of radius r cells (about a Gaussian), in place. */
function blur(values: Float32Array, n: number, r: number): void {
  const line = new Float32Array(n);
  for (let pass = 0; pass < 3; pass++) for (let axis = 0; axis < 2; axis++) for (let a = 0; a < n; a++) {
    const at = (i: number): number => axis ? i * n + a : a * n + i;
    for (let i = 0; i < n; i++) line[i] = values[at(i)];
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += line[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < n; i++) {
      values[at(i)] = sum / (2 * r + 1);
      sum += line[Math.min(n - 1, i + r + 1)] - line[Math.max(0, i - r)];
    }
  }
}

function canvas(n: number): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = c.height = n; return c; }

const memo = new WeakMap<readonly RetainedWaterPath[], { key: string; regime: RetainedRegime | undefined }>();
/** Regime of the retained water for a zone and season; undefined when the season leaves every course running and
 * open (the sediment tint alone needs no field). Memoized per path set and climate. */
export function retainedRegime(paths: readonly RetainedWaterPath[], width: number, season: WaterSeason | undefined): RetainedRegime | undefined {
  if (!season?.zone || !paths.length || !(width > 0)) return;
  const climate = waterClimate(season);
  if (!waterRegimeActive(climate) || (climate.aridity <= 0 && climate.ice <= 0)) return;
  const key = JSON.stringify([width, climate]), found = memo.get(paths);
  if (found?.key === key) return found.regime;
  const regime = computeRegime(paths, width, climate);
  memo.set(paths, { key, regime });
  return regime;
}

function computeRegime(paths: readonly RetainedWaterPath[], width: number, climate: WaterClimate): RetainedRegime | undefined {
  const n = Math.max(64, Math.min(2048, Math.round(width / 2))), cell = width / n;
  const mask = canvas(n), mctx = mask.getContext('2d', { willReadFrequently: true })!;
  mctx.setTransform(1 / cell, 0, 0, 1 / cell, 0, 0); mctx.fillStyle = '#fff';
  for (const item of paths) mctx.fill(item.path, item.rule);
  const alpha = mctx.getImageData(0, 0, n, n).data, cells = n * n;
  const water = new Uint8Array(cells), f = new Float64Array(cells);
  let any = false;
  for (let i = 0; i < cells; i++) { water[i] = alpha[i * 4 + 3] >= 128 ? 1 : 0; f[i] = water[i] ? 1e20 : 0; if (water[i]) any = true; }
  if (!any) return;
  edt(f, n);
  const dist = new Float32Array(cells);
  for (let i = 0; i < cells; i++) dist[i] = water[i] ? Math.sqrt(f[i]) * cell : 0;
  const half = maxFilter(dist, n, Math.max(1, Math.round(HALF_REACH / cell)));
  // Seasonal state per water cell, weighted for the normalized blur (outside cells take the nearby water's state).
  const dryW = new Float32Array(cells), iceW = new Float32Array(cells), weight = new Float32Array(cells), span = Math.log(W1 / W0);
  for (let i = 0; i < cells; i++) {
    if (!water[i]) continue;
    const q = clamp01(Math.log(Math.max(2 * half[i], W0 * .3) / W0) / span), s = riverState(climate, q, 0);
    dryW[i] = s.dry; iceW[i] = s.ice; weight[i] = 1;
  }
  const r = Math.max(1, Math.round(SMOOTH / 3 / cell));
  blur(dryW, n, r); blur(iceW, n, r); blur(weight, n, r);
  const trunk = riverState(climate, 1, 0), ring = 80 * climate.drop;
  const m = Math.min(n, 1024), code = canvas(m), wet = canvas(m), dry = canvas(m), intermittent = canvas(m), ice = canvas(m);
  const images = [code, wet, dry, intermittent, ice].map(c => c.getContext('2d')!.createImageData(m, m));
  let frozen = false, drying = false;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const i = Math.min(n - 1, Math.floor((y + .5) * n / m)) * n + Math.min(n - 1, Math.floor((x + .5) * n / m)), o = (y * m + x) * 4, w = weight[i];
    let d = w > 1e-3 ? dryW[i] / w : trunk.dry, c = w > 1e-3 ? iceW[i] / w : trunk.ice;
    // Dry season: wide water draws down, leaving a pale exposed shore inside its bank.
    if (ring > 1 && water[i]) { const reach = ring * smooth(18, 60, half[i]); if (reach > 1) d = Math.max(d, 1 - smooth(.6 * reach, reach, dist[i])); }
    const wadi = smooth(.55, .85, d), inter = smooth(.25, .5, d) * (1 - wadi), frost = smooth(.35, .6, c);
    if (water[i]) { if (frost > .01) frozen = true; if (wadi + inter > .01) drying = true; }
    const values = [0, (1 - Math.max(wadi, .65 * inter)) * (1 - frost), wadi, inter, frost];
    images[0].data.set([Math.round(255 * (1 - d)), Math.round(255 * (1 - c)), 0, 255], o);
    for (let k = 1; k < 5; k++) images[k].data.set([255, 255, 255, Math.round(255 * values[k])], o);
  }
  [code, wet, dry, intermittent, ice].forEach((c, k) => c.getContext('2d')!.putImageData(images[k], 0, 0));
  return { climate, width, code, wet, dry, intermittent, ice, frozen, drying };
}

let scratch: HTMLCanvasElement | undefined;
/** Draw `draw` (in the context's map transform) masked by a whole-map alpha field, then composite it over `ctx`. */
function masked(ctx: CanvasRenderingContext2D, field: HTMLCanvasElement, width: number, draw: (c: CanvasRenderingContext2D) => void): void {
  const target = ctx.canvas as HTMLCanvasElement, s = scratch ??= document.createElement('canvas');
  if (s.width !== target.width) s.width = target.width;
  if (s.height !== target.height) s.height = target.height;
  const c = s.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.setLineDash([]); c.clearRect(0, 0, s.width, s.height);
  c.setTransform(ctx.getTransform()); c.lineCap = c.lineJoin = 'round';
  draw(c);
  c.globalCompositeOperation = 'destination-in'; c.globalAlpha = 1; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(field, 0, 0, width, width);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(s, 0, 0); ctx.restore();
}

const fillAll = (c: CanvasRenderingContext2D, paths: readonly RetainedWaterPath[]): void => { for (const item of paths) c.fill(item.path, item.rule); };
const strokeAll = (c: CanvasRenderingContext2D, paths: readonly RetainedWaterPath[]): void => { for (const item of paths) c.stroke(item.path); };

/**
 * The regime on a context transformed to map metres:
 * - `code`: the coverage in the regime code, for a material water compositor (RENDER_WATER_FS with uRegime);
 * - `cover`: the running water only, in `fill` (a material water cover, or the flat water of an ink style);
 * - `ink`: the map symbols of `style` over `cover`: running water, intermittent courses (pale water, dashed bank
 *   lines), wadis (flat sandy bed with a continuous bank edge), ice (pale sheet with an ink bank line);
 * - `symbols`: the same symbols without the running water (drawn by a material water elsewhere);
 * - `ground`: dry beds and exposed shores as ground albedo (3D material ground);
 * - `ice`: the ice as a decal over the finished ground (3D material ground).
 */
export function paintRetainedRegime(ctx: CanvasRenderingContext2D, paths: readonly RetainedWaterPath[], regime: RetainedRegime, mode: 'code' | 'cover' | 'ink' | 'symbols' | 'ground' | 'ice', fill: string, style: TerrainStyle = 'parchment'): void {
  const t = ctx.getTransform(), px = 1 / Math.max(1e-9, Math.hypot(t.a, t.b)), width = regime.width;
  if (mode === 'code') {
    ctx.save(); ctx.fillStyle = '#fff'; fillAll(ctx, paths);
    ctx.globalCompositeOperation = 'source-in'; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(regime.code, 0, 0, width, width); ctx.restore();
    return;
  }
  // The map needs an opaque base even where seasonal masks cross-fade; otherwise
  // their combined alpha exposes the captured ground/forest inside the channel.
  if (mode === 'ink') { ctx.fillStyle = fill; fillAll(ctx, paths); }
  if (mode === 'cover') masked(ctx, regime.wet, width, c => { c.fillStyle = fill; fillAll(c, paths); });
  if (mode === 'cover') return;
  if (mode === 'ink' || mode === 'symbols') {
    const ink = regimeInk(style, fill);
    if (regime.drying) {
      for (const field of [regime.intermittent, regime.dry]) masked(ctx, field, width, c => {
        c.fillStyle = ink.bed; fillAll(c, paths);
        // Clip the continuous edge to the bed so adjoining land stays untouched.
        c.save(); const clip = new Path2D(); for (const item of paths) clip.addPath(item.path); c.clip(clip);
        c.strokeStyle = ink.dry; c.lineWidth = 1.2 * px; strokeAll(c, paths); c.restore();
      });
    }
    if (regime.frozen) masked(ctx, regime.ice, width, c => {
      c.fillStyle = ink.ice; fillAll(c, paths);
      // The course keeps its water-ink bank line, so a frozen river still reads as a river.
      c.strokeStyle = fill; c.lineWidth = 1.4 * px; strokeAll(c, paths);
    });
    return;
  }
  if (mode === 'ground' && regime.drying) {
    masked(ctx, regime.dry, width, c => { c.fillStyle = regimeInk(style, fill).bed; fillAll(c, paths); });
    masked(ctx, regime.intermittent, width, c => { c.fillStyle = regimeInk(style, fill).bed; fillAll(c, paths); });
  }
  if (mode === 'ice' && regime.frozen) masked(ctx, regime.ice, width, c => {
    c.fillStyle = '#a9bac6'; fillAll(c, paths); c.strokeStyle = '#55697a'; c.lineWidth = Math.max(1.2 * px, 1.2); strokeAll(c, paths);
  });
}

/** City Bench retained water of one view: flat (no regime), the regime code (material compositors) or the ink
 * symbols. Context dimensions are pixels, region dimensions are world metres. Returns true when the canvas holds the
 * regime code (the compositor must decode it). */
export function paintRetainedWaterView(context: CanvasRenderingContext2D, paths: readonly RetainedWaterPath[], region: { x: number; y: number; width: number; height: number }, pixels: { width: number; height: number }, color: string, regime: RetainedRegime | undefined, painted: boolean, style: TerrainStyle): boolean {
  context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, pixels.width, pixels.height);
  context.setTransform(pixels.width / region.width, 0, 0, pixels.height / region.height, -region.x * pixels.width / region.width, -region.y * pixels.height / region.height);
  if (!regime) { context.fillStyle = color; fillAll(context, paths); return false; }
  paintRetainedRegime(context, paths, regime, painted ? 'code' : 'ink', color, style);
  return painted;
}
