import { RasterTileCache } from './rasterTiles';

/** Drape tile edge in pixels. Each tile repaints a 16 px gutter and a whole ground pass (woods, land): 256 px tiles
 * paint 1.27x their area instead of 1.56x at 128 px, with a quarter of the per-tile passes. */
const DRAPE_TILE_PIXELS = 256;
interface Box { minX: number; minY: number; maxX: number; maxY: number }
/** Physical drape refinement shares the overlay's small, world-aligned raster tile scheme.
 * Whole-tile capture painting remains with the caller; live fills yield between cache misses. */
export class DrapeTiles {
  private cache = new RasterTileCache<HTMLCanvasElement>(48 * 1024 * 1024);

  *paint(target: HTMLCanvasElement, box: Box, key: string,
    paint: (target: HTMLCanvasElement, box: Box) => boolean): Generator<void, boolean> {
    const density = target.width / (box.maxX - box.minX), pixels = DRAPE_TILE_PIXELS, gutter = 16, span = pixels / density;
    const ctx = target.getContext('2d')!;
    const x0 = Math.floor(box.minX / span), y0 = Math.floor(box.minY / span);
    const x1 = Math.ceil(box.maxX / span), y1 = Math.ceil(box.maxY / span);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const id = `${key}|${density}|${x},${y}`;
      let image = this.cache.get(id);
      if (!image) {
        const area = { minX: x * span - gutter / density, minY: y * span - gutter / density,
          maxX: (x + 1) * span + gutter / density, maxY: (y + 1) * span + gutter / density };
        image = document.createElement('canvas'); image.width = image.height = pixels + 2 * gutter;
        paint(image, area);
        const retained = image;
        this.cache.put(id, { value: image, bounds: area, bytes: image.width * image.height * 4,
          release: () => { retained.width = retained.height = 0; } });
      }
      const left = Math.round((x * span - box.minX) * density), top = Math.round((y * span - box.minY) * density);
      ctx.drawImage(image, gutter, gutter, pixels, pixels, left, top, pixels, pixels);
      yield;
    }
    return true;
  }

  clear(): void { this.cache.clear(); }
}
