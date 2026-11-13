import type { TerrainData } from '../../../rust/bridge/terrain';
import type { Relief } from '../gen/options';
import type { World } from '../gen/types';
import { sampleGrid, slopeGrid, gradientAt, type Grid } from '../gen/core/grid';
import { contourSet, CONTOUR_INTERVAL } from './contours';
import { contourLevels } from '../../../rust/bridge/renderGeometry';
import { chaikin, simplify, polylineLength } from '../gen/core/geom';

export interface CityContourPaths { step: number; thin: string; index: string }
/** One square of fine contours (Path2D strings); neighbours share their border samples, so lines meet. */
export interface FineBlock { thin: string; index: string }
interface Entry { terrain: TerrainData; world: World; relief: Relief; slope: number; range: number; paths: Map<string, CityContourPaths>; smoothed: Map<number, Float32Array>; blocks: Map<string, FineBlock>; pending: Set<string>; idle?: number; warmScale?: number; last?: Map<boolean, CityContourPaths> }
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
/** Half the normal interval/spacing, with at least a dozen levels across low-relief terrain.
 * The slope floor still leaves roughly nine screen pixels between lines on steep ground. */
export function topographicContourInterval(relief: Relief, scale: number, slope = 0, range = Infinity): number {
  const thinning = Math.max(1, 2 ** Math.max(0, Math.floor(Math.log2(1 / Math.max(1e-6, scale) / 4))));
  const base = Math.min(cityContourInterval(relief, scale, slope) / 2, Math.max(.1, range / 12) * thinning);
  return Math.max(base, slope * LINE_GAP_PX / 2 / Math.max(1e-6, scale));
}
/** Slope that most of the land stays under: steep gullies must not thin the lines of the whole map. */
function typicalSlope(data: Float32Array): number {
  const stride = Math.max(1, Math.floor(data.length / 20000)), sample: number[] = [];
  for (let i = 0; i < data.length; i += stride) sample.push(data[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.floor(sample.length * .75)] ?? 0;
}
/** Same Float32 samples/percentile as slopeGrid + typicalSlope, without a page-sized slope raster. */
function typicalTerrainSlope(height: Grid): number {
  const stride = Math.max(1, Math.floor(height.data.length / 20000)), sample: number[] = [];
  for (let i = 0; i < height.data.length; i += stride) {
    const [gx, gy] = gradientAt(height, i % height.w, Math.floor(i / height.w));
    sample.push(Math.fround(Math.hypot(gx, gy)));
  }
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
  if (!entry || entry.relief !== relief || entry.world.terrain.height.data !== terrain.height
    || entry.world.terrain.height.w !== terrain.resolution || entry.world.terrain.height.cell !== terrain.width / terrain.resolution) {
    const started = performance.now();
    const height = { w: terrain.resolution, h: terrain.resolution, cell: terrain.width / terrain.resolution, data: terrain.height };
    const asyncPage = typeof document !== 'undefined' && typeof Worker !== 'undefined' && !workerFailed;
    const slope = asyncPage ? { ...height, data: new Float32Array() } : slopeGrid(height);
    let lo = Infinity, hi = -Infinity;
    for (const value of terrain.height) if (value > 0) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
    entry = { terrain, world: { terrain: { height, slope }, options: { relief } } as unknown as World, relief,
      slope: asyncPage ? typicalTerrainSlope(height) : typicalSlope(slope.data), range: Math.max(0, hi - lo),
      paths: new Map(), smoothed: new Map(), blocks: new Map(), pending: new Set() }; cache.set(terrain, entry);
    performance.measure('displayprep:contour-metadata:build', { start: started });
  }
  return entry;
}
/** The height field smoothed at the scale it is read (cached per radius). */
function smoothedFor(entry: Entry, metresPerPixel: number): Float32Array {
  const height = entry.world.terrain.height, radius = Math.min(10, Math.max(1, Math.round(metresPerPixel * 5 / height.cell)));
  // Worker normally owns this; a worker-unavailable fallback still needs the exact slope raster.
  if (entry.world.terrain.slope.data.length !== height.data.length) entry.world.terrain.slope = slopeGrid(height);
  let data = entry.smoothed.get(radius);
  if (!data) {
    data = smoothedHeight(height, radius); entry.smoothed.set(radius, data);
    if (entry.smoothed.size > 3) entry.smoothed.delete(entry.smoothed.keys().next().value!);
  }
  return data;
}
const pathData = (lines: { pts: { x: number; y: number }[]; closed: boolean }[]): string => lines.map(path => path.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('') + (path.closed ? 'Z' : '')).join('');
const reliefOf = (landform: string): Relief => landform === 'flat' || landform === 'hills' || landform === 'valley' ? landform : 'mountains';

/**
 * How the contours of a vector map follow the zoom. `fixed` is the V1 map (render/contours.ts): one set traced once for
 * the whole map at the relief's base interval, many thin lines from the start; a zoom only changes their screen weight,
 * never the lines, so it repaints nothing. `zoom` re-selects interval and smoothing per zoom band (cityContourInterval).
 */
export type ContourDetail = 'fixed' | 'zoom';
/** V1 interval (CONTOUR_INTERVAL); a topographic sheet keeps at least a dozen levels over low relief. `sparse` (cadastre): half as many lines. */
export function fixedContourInterval(relief: Relief, topographic = false, range = Infinity, sparse = false): number {
  const base = CONTOUR_INTERVAL[relief] * (sparse ? 2 : 1);
  if (!topographic || !(range > 0) || !Number.isFinite(range)) return base;
  const wanted = range / 12, decade = 10 ** Math.floor(Math.log10(wanted));
  const nice = [...NICE_STEPS].reverse().map(n => n * decade).find(step => step <= wanted * 1.001) ?? decade;
  return Math.max(.5, Math.min(base, nice));
}
function contourKey(entry: Entry, scale: number, topographic = false, detail: ContourDetail = 'zoom', sparse = false): { key: string; step: number; metresPerPixel: number } {
  if (detail === 'fixed') return { key: `fixed:${topographic}:${sparse}`, step: fixedContourInterval(entry.relief, topographic, entry.range, sparse), metresPerPixel: 0 };
  const metresPerPixel = 2 ** Math.round(Math.log2(1 / Math.max(1e-6, scale)));
  const step = topographic ? topographicContourInterval(entry.relief, 1 / metresPerPixel, entry.slope, entry.range) : cityContourInterval(entry.relief, scale, entry.slope);
  return { key: `${topographic}:${step}:${metresPerPixel}`, step, metresPerPixel };
}

export type ContourView = { minX: number; minY: number; maxX: number; maxY: number };
/** UTF-8 encoded canonical SVG path commands; no point-object graph crosses the worker boundary. */
export interface TypedContourPaths { step: number; thin: Uint8Array; index: Uint8Array }
export type ContourWorkerRequest = { id: number; landform: string; scale: number; topographic?: boolean; detail?: ContourDetail; sparse?: boolean; fine?: ContourView; terrain?: Pick<TerrainData, 'height' | 'resolution' | 'width' | 'caveMask'> };
export type ContourWorkerResponse = { id: number; paths?: TypedContourPaths; blocks?: { key: string; thin: Uint8Array; index: Uint8Array }[]; error?: string };
let warmer: Worker | undefined, workerEntry: WeakRef<Entry> | undefined, warmId = 0, workerFailed = false;
interface ContourJob { entry: Entry; key: string; ready: Set<() => void>; background: boolean; scale: number; topographic: boolean; fine: boolean; detail: ContourDetail }
const warming = new Map<number, ContourJob>();
const canQueue = (): boolean => typeof document !== 'undefined' && typeof Worker !== 'undefined' && !workerFailed;
const decode = new TextDecoder();
function queueContours(entry: Entry, scale: number, key: string, topographic: boolean, ready?: () => void, fine?: ContourView, background = false, detail: ContourDetail = 'zoom', sparse = false): void {
  for (const job of warming.values()) if (job.entry === entry && job.key === key) {
    if (ready) job.ready.add(ready);
    if (!background && job.background) { job.background = false; entry.pending.add(key); }
    return;
  }
  try {
    ensureWarmer();
    const id = ++warmId, t = entry.terrain;
    const request: ContourWorkerRequest = { id, landform: entry.relief, scale, topographic, fine, ...(detail === 'fixed' ? { detail, sparse } : {}) };
    if (workerEntry?.deref() !== entry) {
      request.terrain = { height: t.height, resolution: t.resolution, width: t.width, caveMask: t.caveMask }; workerEntry = new WeakRef(entry);
    }
    if (!background) entry.pending.add(key);
    warming.set(id, { entry, key, ready: new Set(ready ? [ready] : []), background, scale, topographic, fine: !!fine, detail });
    warmer!.postMessage(request);
  } catch { stopWarmer(); ready?.(); }
}
function ensureWarmer(): void {
  if (warmer) return;
  warmer = new Worker(new URL('./cityContourWorker.ts', import.meta.url), { type: 'module' });
  warmer.onmessage = ({ data }: MessageEvent<ContourWorkerResponse>) => {
    const job = warming.get(data.id); if (!job) return;
    warming.delete(data.id); job.entry.pending.delete(job.key);
    if (data.paths) {
      const paths = { step: data.paths.step, thin: decode.decode(data.paths.thin), index: decode.decode(data.paths.index) };
      job.entry.paths.set(job.key, paths);
      // A fixed set is the only one of its map: no zoom band to prewarm, and it is not the fallback of the zoom bands.
      if (!job.background && job.detail === 'zoom') { (job.entry.last ??= new Map()).set(job.topographic, paths); warmNeighbours(job.entry, job.scale, job.topographic); }
    }
    if (data.blocks) for (const block of data.blocks) {
      if (job.entry.blocks.size >= FINE_BLOCK_LIMIT) job.entry.blocks.delete(job.entry.blocks.keys().next().value!);
      job.entry.blocks.set(block.key, { thin: decode.decode(block.thin), index: decode.decode(block.index) });
    }
    if (data.error) stopWarmer();
    for (const ready of job.ready) ready();
  };
  warmer.onerror = stopWarmer;
  warmer.onmessageerror = stopWarmer;
}
/** Only requested work gates visible completion; speculative neighbour bands do not. */
export const cityContoursPending = (terrain: TerrainData | undefined): number => terrain ? cache.get(terrain)?.pending.size ?? 0 : 0;
export function cityContourPathsPending(terrain: TerrainData, landform: string, scale: number, topographic = true, detail: ContourDetail = 'zoom', sparse = false): boolean {
  const entry = cache.get(terrain);
  return !!entry && entry.relief === reliefOf(landform) && (entry.pending.has(contourKey(entry, scale, topographic, detail, sparse).key)
    || [...warming.values()].some(job => job.entry === entry && job.fine && job.scale === scale));
}
/** Prewarm just two adjacent bands, only after the first requested level has landed. */
function warmNeighbours(entry: Entry, scale: number, topographic = false): void {
  if (!canQueue() || typeof requestIdleCallback === 'undefined') return;
  entry.warmScale = scale;
  if (entry.idle !== undefined) return;
  entry.idle = requestIdleCallback(() => {
    entry.idle = undefined;
    // Every zoom level of the map, nearest first, once, in the worker: a zoom then only picks a prepared set instead of
    // tracing the whole map again (the per-level interval and smoothing are what change between levels).
    const at = Math.log2(entry.warmScale!), lo = Math.floor(Math.log2(Math.max(1e-6, 800 / entry.terrain.width))) - 1, hi = Math.log2(WARM_MAX_SCALE);
    const levels: number[] = [];
    for (let e = lo; e <= hi; e++) levels.push(e);
    levels.sort((a, b) => Math.abs(a - at) - Math.abs(b - at));
    for (const e of levels) {
      const next = 2 ** e, { key } = contourKey(entry, next, topographic);
      if (!entry.paths.has(key)) queueContours(entry, next, key, topographic, undefined, undefined, true);
    }
  });
}
/** Closest zoom (screen px per metre) whose contours are prepared ahead; closer views trace on demand. */
const WARM_MAX_SCALE = 4;
function stopWarmer(): void {
  workerFailed = true; warmer?.terminate(); warmer = undefined; workerEntry = undefined;
  const jobs = [...warming.values()]; warming.clear();
  for (const job of jobs) { job.entry.pending.delete(job.key); for (const ready of job.ready) ready(); }
}

/** Same samples, slope filtering and index levels as Terrain Bench, without repainting its raster; smoothing follows the zoom. */
export function cityContourPaths(terrain: TerrainData, landform: string, scale: number, topographic = false, onReady?: () => void, detail: ContourDetail = 'zoom', sparse = false): CityContourPaths {
  if (terrain.caveMask.length || landform === 'cavern') return { step: 0, thin: '', index: '' };
  const relief = reliefOf(landform);
  const entry = entryOf(terrain, relief);
  if (detail === 'fixed') return fixedContourPaths(entry, terrain, topographic, sparse, onReady);
  // One detail level per doubling of the zoom, so the cache stays small and a zoom step does not redraw every line.
  const { metresPerPixel, step, key } = contourKey(entry, scale, topographic), retained = entry.paths.get(key);
  if (onReady) for (const job of warming.values()) if (job.entry === entry && job.fine) job.ready.add(onReady);
  if (retained) { (entry.last ??= new Map()).set(topographic, retained); warmNeighbours(entry, scale, topographic); return retained; }
  // Ordinary contours of the live view stay synchronous (tens of milliseconds, often already prepared by the neighbour
  // prewarm below): an asynchronous level landing later bumped the overlay's contour revision, which keys every raster
  // tile, so each zoom redrew the whole map twice. Topographic levels and callers that wait (onReady) use the worker.
  if (canQueue() && (topographic || onReady)) {
    queueContours(entry, scale, key, topographic, onReady);
    return entry.last?.get(topographic) ?? { step, thin: '', index: '' };
  }
  const height = entry.world.terrain.height;
  const world = { ...entry.world, terrain: { ...entry.world.terrain, height: { ...height, data: smoothedFor(entry, metresPerPixel) } } } as World;
  const contours = contourSet(world, Math.min(terrain.width / 1600, metresPerPixel * 1.5), step, topographic ? Math.min(1, step / CONTOUR_INTERVAL[relief]) : 1);
  const paths = { step, thin: pathData(contours.thin), index: pathData(contours.index) };
  entry.paths.set(key, paths); return paths;
}

/** The V1 set (`fixed`): whole map, once, in the worker on a page; lightly smoothed (the V1 grid had no 1024-sample steps). */
function fixedContourPaths(entry: Entry, terrain: TerrainData, topographic: boolean, sparse: boolean, onReady?: () => void): CityContourPaths {
  const { key, step } = contourKey(entry, 0, topographic, 'fixed', sparse), retained = entry.paths.get(key);
  if (retained) return retained;
  if (canQueue()) {
    queueContours(entry, 0, key, topographic, onReady, undefined, false, 'fixed', sparse);
    return { step, thin: '', index: '' };
  }
  const height = entry.world.terrain.height;
  const world = { ...entry.world, terrain: { ...entry.world.terrain, height: { ...height, data: smoothedFor(entry, height.cell / 5) } } } as World;
  const contours = contourSet(world, terrain.width / 1600, step, topographic ? Math.min(1, step / CONTOUR_INTERVAL[entry.relief]) : 1);
  const paths = { step, thin: pathData(contours.thin), index: pathData(contours.index) };
  entry.paths.set(key, paths); return paths;
}

/** Async captures wait for the same retained paths as the live overlay. */
export function cityContourPathsReady(terrain: TerrainData, landform: string, scale: number, topographic = true, detail: ContourDetail = 'zoom', sparse = false): Promise<CityContourPaths> {
  return new Promise(resolve => {
    const ready = () => resolve(cityContourPaths(terrain, landform, scale, topographic, undefined, detail, sparse));
    const paths = cityContourPaths(terrain, landform, scale, topographic, ready, detail, sparse), entry = cache.get(terrain);
    if (!entry || !entry.pending.has(contourKey(entry, scale, topographic, detail, sparse).key)) resolve(paths);
  });
}

/** Grid samples per side of a fine block (about 280 m on a 6 km map at 1024 samples). */
const FINE_BLOCK = 48;
const FINE_BLOCK_LIMIT = 256;
export interface CityFineContours { step: number; blocks: FineBlock[] }
/**
 * Contours of a close view, below the base interval (cityContourInterval `fine`): only the blocks under `view` are traced,
 * each over its own height range, so a 1 m interval never walks the whole map. Undefined when the view keeps the base interval.
 */
export function cityFineContours(terrain: TerrainData, landform: string, scale: number, view: ContourView, onReady?: () => void): CityFineContours | undefined {
  if (terrain.caveMask.length || landform === 'cavern') return undefined;
  const relief = reliefOf(landform), entry = entryOf(terrain, relief), step = cityContourInterval(relief, scale, entry.slope, true);
  if (step >= baseInterval(relief) * .999) return undefined;
  const metresPerPixel = 2 ** Math.round(Math.log2(1 / Math.max(1e-6, scale))), height = entry.world.terrain.height, span = FINE_BLOCK * height.cell;
  const last = Math.ceil((height.w - 1) / FINE_BLOCK) - 1;
  const bx0 = Math.max(0, Math.floor(view.minX / span)), bx1 = Math.min(last, Math.floor(view.maxX / span));
  const by0 = Math.max(0, Math.floor(view.minY / span)), by1 = Math.min(last, Math.floor(view.maxY / span));
  if (bx1 < bx0 || by1 < by0 || (bx1 - bx0 + 1) * (by1 - by0 + 1) > 64) return undefined;
  if (canQueue() && onReady) {
    const blocks: FineBlock[] = [];
    let missing = false;
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      const block = entry.blocks.get(`${step}:${metresPerPixel}:${bx}:${by}`);
      if (block) blocks.push(block); else missing = true;
    }
    if (!missing) return { step, blocks };
    const key = `fine:${step}:${metresPerPixel}:${bx0}:${by0}:${bx1}:${by1}`;
    queueContours(entry, scale, key, false, onReady, view);
    return undefined;
  }
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
/** Captures can await requested fine blocks without starting synchronous page smoothing. */
export function cityFineContoursReady(terrain: TerrainData, landform: string, scale: number, view: ContourView): Promise<CityFineContours | undefined> {
  return new Promise(resolve => {
    const ready = () => resolve(cityFineContours(terrain, landform, scale, view));
    const fine = cityFineContours(terrain, landform, scale, view, ready);
    if (fine || !cityContourPathsPending(terrain, landform, scale, false)) resolve(fine);
  });
}
/** Worker transport for fine blocks; computed by the identical synchronous builder in that realm. */
export function cityFineContourBlocks(terrain: TerrainData, landform: string, scale: number, view: ContourView): { key: string; block: FineBlock }[] {
  const fine = cityFineContours(terrain, landform, scale, view);
  if (!fine) return [];
  const entry = entryOf(terrain, reliefOf(landform));
  const requested = new Set(fine.blocks);
  return [...entry.blocks].filter(([, block]) => requested.has(block)).map(([key, block]) => ({ key, block }));
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
