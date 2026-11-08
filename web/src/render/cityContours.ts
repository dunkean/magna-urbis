import type { TerrainData } from '../../../rust/bridge/terrain';
import type { Relief } from '../gen/options';
import type { World } from '../gen/types';
import { sampleGrid, slopeGrid } from '../gen/core/grid';
import { contourSet, CONTOUR_INTERVAL } from './contours';
import { contourLevels } from '../../../rust/bridge/renderGeometry';
import { chaikin, simplify, polylineLength } from '../gen/core/geom';

export interface CityContourPaths { step: number; thin: string; index: string }
/** One square of fine contours (Path2D strings); neighbours share their border samples, so lines meet. */
export interface FineBlock { thin: string; index: string }
interface Entry { terrain: TerrainData; world: World; relief: Relief; slope: number; paths: Map<string, CityContourPaths>; smoothed: Map<number, Float32Array>; blocks: Map<string, FineBlock> }
const cache = new WeakMap<TerrainData, Entry>();
/** Thin lines stay this many pixels apart on a typical slope: a contour map reads the shape, not a hatching. */
const LINE_GAP_PX = 18;
const NICE_STEPS = [1, 2, 5, 10];

/** Close views (screen pixels per metre above this) may split the base interval: a flat valley floor still reads its relief. */
const FINE_SCALE = 0.5;
/** Finer intervals as shares of the base one, the second from FINE_SCALE * 4; the base interval stays the index line. */
const FINE_DIVISORS = [5, 10] as const;
const baseInterval = (relief: Relief): number => CONTOUR_INTERVAL[relief] * (relief === 'mountains' ? 2 : 1);

/** Round physical levels, thinned as the view widens; panning never changes them. With `fine`, close views go below the base interval. */
export function cityContourInterval(relief: Relief, scale: number, slope = 0, fine = false): number {
  const base = baseInterval(relief), floor = !fine || scale <= FINE_SCALE ? base : base / FINE_DIVISORS[scale > FINE_SCALE * 4 ? 1 : 0];
  const thinning = Math.max(0, Math.floor(Math.log2(1 / Math.max(1e-6, scale) / 4)));
  const wanted = Math.max(thinning ? base * 2 ** thinning : floor, slope * LINE_GAP_PX / Math.max(1e-6, scale));
  const decade = 10 ** Math.floor(Math.log10(wanted));
  return Math.max(floor, NICE_STEPS.map(n => n * decade).find(step => step >= wanted * .999) ?? wanted);
}
/** Slope that most of the land stays under: steep gullies must not thin the lines of the whole map. */
function typicalSlope(data: Float32Array): number {
  const stride = Math.max(1, Math.floor(data.length / 20000)), sample: number[] = [];
  for (let i = 0; i < data.length; i += stride) sample.push(data[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.floor(sample.length * .75)] ?? 0;
}
/** Box blur of the height field, three passes (close to a gaussian): lines flow at the scale they are read, without the grid's steps. */
function smoothedHeight(height: { w: number; h: number; data: Float32Array }, radius: number): Float32Array {
  const { w, h } = height; let from: Float32Array = height.data, to: Float32Array = new Float32Array(from.length);
  for (let pass = 0; pass < 6; pass++) {
    const horizontal = pass % 2 === 0, lines = horizontal ? h : w, size = horizontal ? w : h, stride = horizontal ? 1 : w, next = horizontal ? w : 1, span = 2 * radius + 1;
    for (let line = 0; line < lines; line++) {
      const origin = line * next; let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += from[origin + Math.min(size - 1, Math.max(0, i)) * stride];
      for (let i = 0; i < size; i++) {
        to[origin + i * stride] = sum / span;
        sum += from[origin + Math.min(size - 1, i + radius + 1) * stride] - from[origin + Math.max(0, i - radius) * stride];
      }
    }
    if (pass === 0) { from = to; to = new Float32Array(from.length); } else [from, to] = [to, from];
  }
  return from;
}

function entryOf(terrain: TerrainData, relief: Relief): Entry {
  let entry = cache.get(terrain);
  if (!entry || entry.relief !== relief) {
    const height = { w: terrain.resolution, h: terrain.resolution, cell: terrain.width / terrain.resolution, data: terrain.height }, slope = slopeGrid(height);
    entry = { terrain, world: { terrain: { height, slope }, options: { relief } } as unknown as World, relief, slope: typicalSlope(slope.data), paths: new Map(), smoothed: new Map(), blocks: new Map() }; cache.set(terrain, entry);
  }
  return entry;
}
/** The height field smoothed at the scale it is read (cached per radius). */
function smoothedFor(entry: Entry, metresPerPixel: number): Float32Array {
  const height = entry.world.terrain.height, radius = Math.min(10, Math.max(1, Math.round(metresPerPixel * 5 / height.cell)));
  let data = entry.smoothed.get(radius);
  if (!data) { data = smoothedHeight(height, radius); entry.smoothed.set(radius, data); }
  return data;
}
const reliefOf = (landform: string): Relief => landform === 'flat' || landform === 'hills' || landform === 'valley' ? landform : 'mountains';

/** Same samples, slope filtering and index levels as Terrain Bench, without repainting its raster; smoothing follows the zoom. */
export function cityContourPaths(terrain: TerrainData, landform: string, scale: number): CityContourPaths {
  if (terrain.caveMask.length || landform === 'cavern') return { step: 0, thin: '', index: '' };
  const relief = reliefOf(landform);
  const entry = entryOf(terrain, relief);
  // One detail level per doubling of the zoom, so the cache stays small and a zoom step does not redraw every line.
  const metresPerPixel = 2 ** Math.round(Math.log2(1 / Math.max(1e-6, scale))), step = cityContourInterval(relief, scale, entry.slope), key = `${step}:${metresPerPixel}`, retained = entry.paths.get(key);
  if (retained) return retained;
  const height = entry.world.terrain.height;
  const world = { ...entry.world, terrain: { ...entry.world.terrain, height: { ...height, data: smoothedFor(entry, metresPerPixel) } } } as World;
  const contours = contourSet(world, Math.min(terrain.width / 1600, metresPerPixel * 1.5), step);
  const pathData = (lines: typeof contours.thin): string => lines.map(path => path.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('') + (path.closed ? 'Z' : '')).join('');
  const paths = { step, thin: pathData(contours.thin), index: pathData(contours.index) };
  entry.paths.set(key, paths); return paths;
}

/** Grid samples per side of a fine block (about 280 m on a 6 km map at 1024 samples). */
const FINE_BLOCK = 48;
const FINE_BLOCK_LIMIT = 256;
export interface CityFineContours { step: number; blocks: FineBlock[] }
/**
 * Contours of a close view, below the base interval (cityContourInterval `fine`): only the blocks under `view` are traced,
 * each over its own height range, so a 1 m interval never walks the whole map. Undefined when the view keeps the base interval.
 */
export function cityFineContours(terrain: TerrainData, landform: string, scale: number, view: { minX: number; minY: number; maxX: number; maxY: number }): CityFineContours | undefined {
  if (terrain.caveMask.length || landform === 'cavern') return undefined;
  const relief = reliefOf(landform), entry = entryOf(terrain, relief), step = cityContourInterval(relief, scale, entry.slope, true);
  if (step >= baseInterval(relief) * .999) return undefined;
  const metresPerPixel = 2 ** Math.round(Math.log2(1 / Math.max(1e-6, scale))), height = entry.world.terrain.height, span = FINE_BLOCK * height.cell;
  const last = Math.ceil((height.w - 1) / FINE_BLOCK) - 1;
  const bx0 = Math.max(0, Math.floor(view.minX / span)), bx1 = Math.min(last, Math.floor(view.maxX / span));
  const by0 = Math.max(0, Math.floor(view.minY / span)), by1 = Math.min(last, Math.floor(view.maxY / span));
  if (bx1 < bx0 || by1 < by0 || (bx1 - bx0 + 1) * (by1 - by0 + 1) > 64) return undefined;
  const data = smoothedFor(entry, metresPerPixel), u = Math.min(terrain.width / 1600, metresPerPixel * 1.5), blocks: FineBlock[] = [];
  for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
    const key = `${step}:${metresPerPixel}:${bx}:${by}`;
    let block = entry.blocks.get(key);
    if (!block) {
      block = fineBlock(entry, data, bx, by, step, indexInterval(step), u);
      if (entry.blocks.size >= FINE_BLOCK_LIMIT) entry.blocks.delete(entry.blocks.keys().next().value!);
      entry.blocks.set(key, block);
    }
    blocks.push(block);
  }
  return { step, blocks };
}
/** Index lines every 5th level when that is a round height (1 m -> 5 m), else every 10th (0.5 m -> 5 m). */
function indexInterval(step: number): number {
  const five = 5 * step, mantissa = five / 10 ** Math.floor(Math.log10(five) + 1e-9);
  return NICE_STEPS.some(n => Math.abs(mantissa - n) < 1e-6) ? five : 10 * step;
}
function fineBlock(entry: Entry, data: Float32Array, bx: number, by: number, step: number, major: number, u: number): FineBlock {
  const { w, h, cell } = entry.world.terrain.height, slope = entry.world.terrain.slope;
  const x0 = bx * FINE_BLOCK, y0 = by * FINE_BLOCK, x1 = Math.min(w - 1, x0 + FINE_BLOCK), y1 = Math.min(h - 1, y0 + FINE_BLOCK), sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const sub = new Float32Array(sw * sh); let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const v = data[(y0 + y) * w + x0 + x]; sub[y * sw + x] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const levels: number[] = [];
  for (let i = Math.max(1, Math.ceil(lo / step)); i * step <= hi; i++) levels.push(i * step);
  if (!levels.length) return { thin: '', index: '' };
  // The near-flat rule of contourSet, scaled to the interval: a 1 m line keeps the ground spacing a 5 m line had.
  const minSlope = (entry.relief === 'flat' ? .004 : .012) * Math.min(1, step / CONTOUR_INTERVAL[entry.relief]);
  const lines = contourLevels(sub, sw, sh, levels, cell, x0 * cell + cell / 2, y0 * cell + cell / 2);
  let thin = '', index = '';
  for (let k = 0; k < levels.length; k++) {
    const indexLine = Math.abs(levels[k] / major - Math.round(levels[k] / major)) < 1e-6;
    for (const p of lines[k]) {
      if (p.pts.length < 2 || (p.closed && polylineLength(p.pts) < 35 * u)) continue;
      let sl = 0;
      for (const q of p.pts) sl += sampleGrid(slope, q.x, q.y);
      if (sl / p.pts.length < minSlope) continue;
      const pts = simplify(chaikin(p.pts, 3, p.closed), 0.35 * u);
      const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join('') + (p.closed ? 'Z' : '');
      if (indexLine) index += d; else thin += d;
    }
  }
  return { thin, index };
}
