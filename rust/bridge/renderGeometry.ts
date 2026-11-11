// Render-side geometry in Rust (magna_urbis_core::render_geometry, WASM exports in
// rust/crates/wasm/src/render_geometry.rs): city ground clipping, coastal distance
// fields and contour lines. The renderer calls them synchronously, so every realm
// that draws loads the single-thread package first (`loadRenderGeometry`, started on
// import; V2 awaits it before generating and drawing). Never the threads package:
// these kernels are serial and the main thread cannot block on a rayon pool.
import type { Point, Shape } from './urban';
import { inWorker, loadCoreWasm, loadSingleWasm, onCoreWasmReset } from './wasmRuntime';

interface RenderGeometryWasm {
  render_city_canals(groups: Float64Array): Float64Array;
  render_city_ground_clip(n: number, width: number, water: Uint8Array, canals: Float64Array, subjects: Float64Array): Float64Array;
  render_coast_distances(height: Float32Array, n: number, cell: number, band: number): Float32Array;
  render_contour_levels(field: Float32Array, w: number, h: number, levels: Float64Array, cell: number, ox: number, oy: number): Float64Array;
}

let wasm: RenderGeometryWasm | undefined;
let loading: Promise<void> | undefined;
// Generation workers (created with `wasmWorkerOptions`, whose name carries `threads=`) load the core
// package anyway: they reuse it instead of compiling and instantiating a second 17 MB module.
const generationRealm = inWorker() && /(?:^|\s)threads=/.test((globalThis as { name?: string }).name ?? '');
/** Loads the single-thread package of this realm (once); a generation worker's core package. */
export function loadRenderGeometry(): Promise<void> {
  return loading ??= (generationRealm ? loadCoreWasm() : loadSingleWasm()).then(module => { wasm = module as unknown as RenderGeometryWasm; }, error => { loading = undefined; throw error; });
}
/** Whether the synchronous calls work in this realm. */
onCoreWasmReset(() => { wasm = undefined; loading = undefined; void loadRenderGeometry(); });
export const renderGeometryReady = (): boolean => wasm !== undefined;
// Started on import: a realm that draws long after loading never waits.
loadRenderGeometry().catch(() => { /* reported by the first synchronous call */ });
function core(): RenderGeometryWasm {
  if (!wasm) throw new Error('Render geometry WASM is not loaded yet: await loadRenderGeometry() before drawing.');
  return wasm;
}

type Ring = readonly Point[];
/** Flat shape list: [shapes, (rings, (points, x, y, ...)*)*]. */
function writeShapes(shapes: readonly (readonly Ring[])[]): Float64Array {
  let size = 1;
  for (const rings of shapes) { size++; for (const r of rings) size += 1 + 2 * r.length; }
  const out = new Float64Array(size);
  let at = 0;
  out[at++] = shapes.length;
  for (const rings of shapes) {
    out[at++] = rings.length;
    for (const r of rings) { out[at++] = r.length; for (const p of r) { out[at++] = p.x; out[at++] = p.y; } }
  }
  return out;
}
function readShapes(data: Float64Array, start: number): { shapes: Shape[]; end: number } {
  let at = start;
  const count = data[at++], shapes: Shape[] = [];
  for (let s = 0; s < count; s++) {
    const rings = data[at++], list: Point[][] = [];
    for (let k = 0; k < rings; k++) {
      const points = data[at++], ring: Point[] = new Array(points);
      for (let i = 0; i < points; i++, at += 2) ring[i] = { x: data[at], y: data[at + 1] };
      list.push(ring);
    }
    shapes.push({ outer: list[0] ?? [], holes: list.slice(1) });
  }
  return { shapes, end: at };
}

/** Canal pieces of the city's vector water (each group's rings xor-ed); `canals` input of `clipCityGround`. */
export function cityCanals(groups: readonly (readonly Ring[])[]): Shape[] {
  return readShapes(core().render_city_canals(writeShapes(groups)), 0).shapes;
}
const shapeRings = (s: Shape): Ring[] => [s.outer, ...s.holes];
/** Physical water raster of a city (wet = 1..3). */
export interface GroundRaster { n: number; width: number; water: Uint8Array }
/** Each subject minus the wet cells and the canals; the subject object itself when no water touches it. */
export function clipCityGround(raster: GroundRaster, canals: readonly Shape[], subjects: readonly Shape[]): Shape[][] {
  if (!subjects.length) return [];
  const data = core().render_city_ground_clip(raster.n, raster.width, raster.water, writeShapes(canals.map(shapeRings)), writeShapes(subjects.map(shapeRings)));
  const out: Shape[][] = [];
  let at = 0;
  for (const subject of subjects) {
    if (data[at] === -1) { out.push([subject]); at++; continue; }
    const { shapes, end } = readShapes(data, at);
    out.push(shapes); at = end;
  }
  return out;
}

/** Signed Euclidean distance to the sub-cell zero contour of an n × n field (texel centres at (i + 0.5) cell),
 * capped at the band; negative where the field is positive. */
export function coastDistances(height: Float32Array, n: number, cell: number, bandWidth: number): Float32Array {
  return core().render_coast_distances(height, n, cell, bandWidth);
}

export interface ContourLine { pts: Point[]; closed: boolean }
/** Marching-squares contour lines of several levels of one field (values > level are inside);
 * `origin` = world position of sample (0, 0). Closed lines do not repeat their first point. */
export function contourLevels(field: Float32Array, w: number, h: number, levels: readonly number[], cell: number, ox = 0, oy = 0): ContourLine[][] {
  if (!levels.length) return [];
  const data = core().render_contour_levels(field, w, h, Float64Array.from(levels), cell, ox, oy), out: ContourLine[][] = [];
  let at = 0;
  for (let l = 0; l < levels.length; l++) {
    const count = data[at++], paths: ContourLine[] = [];
    for (let p = 0; p < count; p++) {
      const closed = data[at++] === 1, points = data[at++], pts: Point[] = new Array(points);
      for (let i = 0; i < points; i++, at += 2) pts[i] = { x: data[at], y: data[at + 1] };
      paths.push({ pts, closed });
    }
    out.push(paths);
  }
  return out;
}
