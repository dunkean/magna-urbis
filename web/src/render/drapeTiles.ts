import { RasterTileCache } from './rasterTiles';

/** Drape tile edge in pixels. Each tile repaints a 16 px gutter and a whole ground pass (woods, land): 256 px tiles
 * paint 1.27x their area instead of 1.56x at 128 px, with a quarter of the per-tile passes. */
const DRAPE_TILE_PIXELS = 256;
interface Box { minX: number; minY: number; maxX: number; maxY: number }
/** Physical drape refinement shares the overlay's small, world-aligned raster tile scheme.
 * Whole-tile capture painting remains with the caller; live fills yield between cache misses. */
export class DrapeTiles {
  private cache = new RasterTileCache<HTMLCanvasElement>(48 * 1024 * 1024);
  /** Squares painted with provisional content (e.g. contours still in their worker), with the callers that drew them. */
  private waiting = new Map<string, Set<() => void>>();

  /** The painter calls `defer()` when it draws provisional content and calls the returned function once that content is
   * outdated: the square leaves the cache and every caller that drew it gets `onStale` (once), to repaint its tile. */
  *paint(target: HTMLCanvasElement, box: Box, key: string,
    paint: (target: HTMLCanvasElement, box: Box, defer: () => () => void) => boolean, onStale?: () => void): Generator<void, boolean> {
    const density = target.width / (box.maxX - box.minX), pixels = DRAPE_TILE_PIXELS, gutter = 16, span = pixels / density;
    const ctx = target.getContext('2d')!;
    const x0 = Math.floor(box.minX / span), y0 = Math.floor(box.minY / span);
    const x1 = Math.ceil(box.maxX / span), y1 = Math.ceil(box.maxY / span);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const id = `${key}|${density}|${x},${y}`;
      let image = this.cache.get(id);
      if (image) { if (onStale) this.waiting.get(id)?.add(onStale); }
      else {
        const area = { minX: x * span - gutter / density, minY: y * span - gutter / density,
          maxX: (x + 1) * span + gutter / density, maxY: (y + 1) * span + gutter / density };
        const fresh = document.createElement('canvas'); fresh.width = fresh.height = pixels + 2 * gutter;
        let listeners: Set<() => void> | undefined, outdated = false;
        paint(fresh, area, () => {
          const own = listeners ??= new Set(onStale ? [onStale] : []);
          return () => {
            if (outdated) return;
            outdated = true;
            if (this.waiting.get(id) === own) this.waiting.delete(id);
            this.cache.delete(id, fresh);
            for (const listener of own) listener();
          };
        });
        image = fresh;
        // Content outdated during the paint itself is drawn once and not kept.
        if (!outdated) {
          const own = listeners;
          this.cache.put(id, { value: fresh, bounds: area, bytes: fresh.width * fresh.height * 4,
            release: () => { fresh.width = fresh.height = 0; if (own && this.waiting.get(id) === own) this.waiting.delete(id); } });
          if (own) this.waiting.set(id, own);
        }
      }
      const left = Math.round((x * span - box.minX) * density), top = Math.round((y * span - box.minY) * density);
      ctx.drawImage(image, gutter, gutter, pixels, pixels, left, top, pixels, pixels);
      yield;
    }
    return true;
  }

  clear(): void { this.cache.clear(); this.waiting.clear(); }
}
