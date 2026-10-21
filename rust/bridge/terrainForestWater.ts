import type { TerrainData } from './terrain';
import type { ForestWaterRaster } from './terrainMaterialRaster';
import { hydrologySegments } from './hydrologyRender';
import { riverSegments } from '../../web/src/ui/vectorWaterRender';
import { lakeField, lakeSample, type LakeField } from '../../web/src/ui/lakeGeometry';
import { paintRetainedWater, retainedWaterPaths } from '../../web/src/render/retainedWaterGeometry';

export interface ForestWaterDisplay {
  showLakes: boolean; showOxbows: boolean; riverArea: number; riverMode: 'vector' | 'grid';
}
const caches = new WeakMap<object, Map<string, ForestWaterRaster>>();
let sourceId = 0;
const retainedCaches = new Map<string, { width: number; rasters: Map<string, ForestWaterRaster> }>();
let retainedCanvas: HTMLCanvasElement | undefined;

/** Retained decor stores the drawn bank polygons, with nested SVG crop frames.
 * Parse those exact paths once on the main thread; workers receive the resulting
 * alpha raster rather than reading the wider settlement routing labels. */
export function forestRetainedWater(svg: string, mapWidth: number, region: Pick<TerrainData, 'x' | 'y' | 'width' | 'resolution'>, showLakes = true): ForestWaterRaster | undefined {
  if (!svg || typeof document === 'undefined' || typeof Path2D === 'undefined') return undefined;
  if (!showLakes) svg = svg.replace(/<path\b[^>]*class="water-lakes"[^>]*\/>/g, '');
  const pixel = region.width / region.resolution, gutter = Math.ceil(64 / pixel);
  const n = Math.min(2048, region.resolution + 2 * gutter), width = region.width + 2 * gutter * pixel;
  const x = region.x - gutter * pixel, y = region.y - gutter * pixel;
  const key = [x, y, width, n].join(':');
  let cache = retainedCaches.get(svg);
  if (!cache || cache.width !== mapWidth) {
    cache = { width: mapWidth, rasters: new Map() }; retainedCaches.set(svg, cache);
    while (retainedCaches.size > 3) retainedCaches.delete(retainedCaches.keys().next().value!);
  }
  const found = cache.rasters.get(key);
  if (found) return found;
  const paths = retainedWaterPaths(svg, mapWidth);
  retainedCanvas ??= document.createElement('canvas'); retainedCanvas.width = retainedCanvas.height = n;
  const context = retainedCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  paintRetainedWater(context, paths, { x, y, width, height: width }, { width: n, height: n }, '#ffffff');
  const rgba = context.getImageData(0, 0, n, n).data, alpha = new Uint8Array(n * n);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  const raster = { x, y, width, n, alpha, key: `forest-retained-water:${++sourceId}:${key}` };
  cache.rasters.set(key, raster);
  while (cache.rasters.size > 3) cache.rasters.delete(cache.rasters.keys().next().value!);
  return raster;
}

const riverCaches = new WeakMap<object, Map<string, Float32Array>>();
/** Displayed river centrelines and widths (nine floats per segment, as the
 * water renderer) for the forest's narrow bank envelope. Stable identity per
 * water source and display options, so the field key and worker copy stay cheap. */
export function forestRiverSegments(source: TerrainData, display: ForestWaterDisplay): Float32Array | undefined {
  const vector = source.water, hydro = !vector && !source.hydrologyError ? source.hydrology : undefined;
  const identity = vector ?? hydro;
  if (!identity) return undefined;
  const key = [display.showLakes, display.showOxbows, display.riverArea, display.riverMode].join(':');
  let cache = riverCaches.get(identity);
  if (!cache) { cache = new Map(); riverCaches.set(identity, cache); }
  let segments = cache.get(key);
  if (!segments) {
    segments = vector ? riverSegments(vector, { ...display, style: 'render3d', overlay: 'none' }) : hydrologySegments(hydro!, '#ffffff');
    cache.set(key, segments);
    while (cache.size > 3) cache.delete(cache.keys().next().value!);
  }
  return segments;
}

/** Actual visible water, without the settlement routing buffer. Coverage is only
 * used to reject tree centres: crowns remain free to overhang the river banks.
 * The 64 m gutter keeps those decisions independent of a camera crop's edge. */
export function forestDisplayWater(source: TerrainData, display: ForestWaterDisplay, region: Pick<TerrainData, 'x' | 'y' | 'width' | 'resolution'> = source): ForestWaterRaster | undefined {
  const vector = source.water, hydro = !vector && !source.hydrologyError ? source.hydrology : undefined;
  const identity = vector ?? hydro;
  if (!identity) return undefined;
  const pixel = region.width / region.resolution, gutter = Math.ceil(64 / pixel);
  const n = Math.min(2048, region.resolution + 2 * gutter), width = region.width + 2 * gutter * pixel;
  const x = region.x - gutter * pixel, y = region.y - gutter * pixel, cell = width / n;
  const cacheKey = [x, y, width, n, display.showLakes, display.showOxbows, display.riverArea, display.riverMode].join(':');
  let cache = caches.get(identity);
  if (!cache) { cache = new Map(); caches.set(identity, cache); }
  const previous = cache.get(cacheKey);
  if (previous) return previous;
  const alpha = new Uint8Array(n * n);
  const mapWidth = vector?.hydro.width ?? hydro!.width;
  let lake: LakeField | undefined;
  if (display.showLakes && vector) lake = lakeField(vector.lake, vector.hydro.n);
  else if (display.showLakes && hydro) lake = { values: hydro.waterField, distance: hydro.waterField, n: hydro.resolution };
  if (lake) {
    const field = lake, sourceCell = mapWidth / field.n;
    for (let row = 0; row < n; row++) {
      const wy = y + (row + .5) * cell, iy = Math.floor(wy / sourceCell);
      if (iy < 0 || iy >= field.n) continue;
      for (let col = 0; col < n; col++) {
        const wx = x + (col + .5) * cell, ix = Math.floor(wx / sourceCell);
        if (ix < 0 || ix >= field.n) continue;
        const coarse = field.distance[iy * field.n + ix];
        if (Math.abs(coarse) > 3) { if (coarse > 0) alpha[row * n + col] = 255; continue; }
        // Rust's shoreline has no procedural perturbation. Its B-spline
        // coefficients are sampled with the same kernel as the live view.
        let d: number;
        if (vector) d = lakeSample(field, mapWidth, wx, wy);
        else {
          const gx = wx / sourceCell - .5, gy = wy / sourceCell - .5, bx = Math.floor(gx), by = Math.floor(gy);
          const weights = (t: number): number[] => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
          const sx = weights(gx - bx), sy = weights(gy - by); d = 0;
          for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
            const xx = bx + i - 1, yy = by + j - 1;
            d += (xx < 0 || yy < 0 || xx >= field.n || yy >= field.n ? -4 : field.values[yy * field.n + xx]) * sx[i] * sy[j];
          }
        }
        alpha[row * n + col] = Math.round(255 * Math.max(0, Math.min(1, d * sourceCell / cell + .5)));
      }
    }
  }
  const segments = forestRiverSegments(source, display)!;
  for (let k = 0; k < segments.length; k += 9) {
    const ax = segments[k], ay = segments[k + 1], bx = segments[k + 2], by = segments[k + 3];
    const ar = segments[k + 4] * .5, br = segments[k + 5] * .5, radius = Math.max(ar, br) + cell * .5;
    const left = Math.max(0, Math.floor((Math.min(ax, bx) - radius - x) / cell));
    const right = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + radius - x) / cell));
    const top = Math.max(0, Math.floor((Math.min(ay, by) - radius - y) / cell));
    const bottom = Math.min(n - 1, Math.ceil((Math.max(ay, by) + radius - y) / cell));
    const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
      const wx = x + (col + .5) * cell, wy = y + (row + .5) * cell;
      const t = length2 ? Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / length2)) : 0;
      const distance = Math.hypot(wx - ax - t * dx, wy - ay - t * dy), r = ar + (br - ar) * t;
      alpha[row * n + col] = Math.max(alpha[row * n + col], Math.round(255 * Math.max(0, Math.min(1, (r - distance) / cell + .5))));
    }
  }
  const raster = { x, y, width, n, alpha, key: `forest-water:${++sourceId}:${cacheKey}` };
  cache.set(cacheKey, raster);
  while (cache.size > 3) cache.delete(cache.keys().next().value!);
  return raster;
}
