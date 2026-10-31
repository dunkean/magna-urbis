/** Vector content that has to be drawn as an image (an SVG decoded by the browser) is
 * rasterized for the current view, never once for the whole map and then stretched by
 * the zoom. A raster is reused while it covers the visible rectangle at a density
 * within a small factor of the screen's; otherwise a new one is requested for the
 * visible rectangle plus a pan margin, at the screen density. */
import type { Rect4 } from './view';

/** A raster of world region `x, y, width, height` (metres) at `density` pixels per metre. */
export interface ViewRasterRegion { x: number; y: number; width: number; height: number; density: number }

/** Coarsest accepted raster, relative to the screen density (pixels per metre). */
export const VIEW_RASTER_COARSE = 1.25;
/** Finest kept raster, relative to the screen density: beyond, a zoom-out re-rasterizes (memory). */
export const VIEW_RASTER_FINE = 2.5;
/** Largest raster side in pixels. */
export const VIEW_RASTER_MAX_PX = 8192;

/** Screen density a raster of `rect` can reach within `maxPx` (the screen's, except for views wider than the budget). */
export function viewRasterDensity(rect: Rect4, density: number, mapSize: number, maxPx = VIEW_RASTER_MAX_PX): number {
  const side = Math.max(Math.min(mapSize, rect.maxX) - Math.max(0, rect.minX), Math.min(mapSize, rect.maxY) - Math.max(0, rect.minY), 1e-9);
  return Math.min(density, maxPx / side);
}

/** Whether `raster` can draw `rect` at `density` screen pixels per metre without visible stretching.
 * `fine` bounds over-resolved rasters (Infinity for a kept whole-map raster). */
export function viewRasterFits(raster: ViewRasterRegion | undefined, rect: Rect4, density: number, mapSize: number, fine = VIEW_RASTER_FINE): boolean {
  if (!raster) return false;
  const wanted = viewRasterDensity(rect, density, mapSize);
  if (raster.density * VIEW_RASTER_COARSE < wanted || raster.density > wanted * fine) return false;
  // Only the part of the view on the map has to be covered.
  const minX = Math.max(0, rect.minX), minY = Math.max(0, rect.minY), maxX = Math.min(mapSize, rect.maxX), maxY = Math.min(mapSize, rect.maxY);
  if (maxX <= minX || maxY <= minY) return true;
  const eps = 1e-6 * mapSize;
  return raster.x <= minX + eps && raster.y <= minY + eps && raster.x + raster.width >= maxX - eps && raster.y + raster.height >= maxY - eps;
}

/** The region to rasterize for `rect` at `density`: the visible map part plus a pan margin of
 * half a view on each side, clamped to the map, and shrunk to fit VIEW_RASTER_MAX_PX. */
export function viewRasterRegion(rect: Rect4, density: number, mapSize: number, maxPx = VIEW_RASTER_MAX_PX): ViewRasterRegion {
  const clampX = (v: number): number => Math.max(0, Math.min(mapSize, v));
  const visible = { minX: clampX(rect.minX), minY: clampX(rect.minY), maxX: clampX(rect.maxX), maxY: clampX(rect.maxY) };
  const vw = Math.max(visible.maxX - visible.minX, 1 / density), vh = Math.max(visible.maxY - visible.minY, 1 / density);
  // Margin as large as fits: at most half a view per side.
  const room = Math.max(0, Math.min(0.5, (maxPx / density / Math.max(vw, vh) - 1) / 2));
  const minX = clampX(visible.minX - vw * room), minY = clampX(visible.minY - vh * room);
  const maxX = clampX(visible.minX + vw * (1 + room)), maxY = clampX(visible.minY + vh * (1 + room));
  // A view wider than the pixel budget keeps the budget (coarser but bounded).
  const side = Math.max(maxX - minX, maxY - minY);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, density: Math.min(viewRasterDensity(rect, density, mapSize, maxPx), maxPx / Math.max(side, 1e-9)) };
}
