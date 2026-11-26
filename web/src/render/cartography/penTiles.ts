import { RasterTileCache, type RasterTile } from '../rasterTiles';
import type { SpriteTint } from '../gpu/contract';

type Pigment = 'sheetGrass' | 'sheetReed';
type Coverage = { pigment: Pigment; weights: Uint8Array; target: CanvasRenderingContext2D; revision: number; ink: string; wash: string };

/** Native Canvas tile replay. Red is the ink fraction of a covered texel, alpha its total
 * coverage after *all* stamps have been composited in order. The rest is wash. Keep those
 * two bytes alongside the displayed tile, within the shared layer budget. */
export class LayerTileCache extends RasterTileCache<CanvasImageSource | null> {
  private coverage = new WeakMap<CanvasImageSource, Coverage>();
  private readonly masks: RasterTileCache<Coverage>;
  private revision = 0;
  private scratch?: ImageData;

  constructor(
    bytes: number,
    private readonly inks: (pigment: Pigment) => SpriteTint,
  ) {
    super(bytes);
    this.masks = new RasterTileCache(bytes);
  }

  override get bytes(): number {
    return super.bytes + this.masks.bytes;
  }

  recordPen(target: CanvasRenderingContext2D, pigment: Pigment): void {
    const { width, height } = target.canvas;
    const image = target.getImageData(0, 0, width, height);
    const weights = new Uint8Array(width * height * 2);
    for (let i = 0, p = 0; i < weights.length; i += 2, p += 4) {
      weights[i] = image.data[p];
      weights[i + 1] = image.data[p + 3];
    }
    const tile = { target, weights, pigment, revision: this.revision, ink: '', wash: '' };
    this.coverage.set(target.canvas, tile);
    this.tint(tile, image, this.inks(pigment));
  }

  private tint(tile: Coverage, image: ImageData, [ink, wash]: SpriteTint): void {
    const out = image.data,
      weights = tile.weights;
    for (let i = 0, p = 0; i < weights.length; i += 2, p += 4) {
      out[p + 3] = weights[i + 1];
      if (!out[p + 3]) continue;
      const a = weights[i],
        b = 255 - a;
      out[p] = ink.rgba[0] * a + wash.rgba[0] * b;
      out[p + 1] = ink.rgba[1] * a + wash.rgba[1] * b;
      out[p + 2] = ink.rgba[2] * a + wash.rgba[2] * b;
    }
    tile.target.putImageData(image, 0, 0);
    tile.revision = this.revision;
    tile.ink = ink.css;
    tile.wash = wash.css;
  }

  override put(key: string, tile: RasterTile<CanvasImageSource | null>): void {
    const pen = tile.value && this.coverage.get(tile.value);
    super.put(key, {
      ...tile,
      release: () => {
        this.masks.delete(key);
        tile.release();
      },
    });
    if (pen) this.masks.put(key, { value: pen, bounds: tile.bounds, bytes: pen.weights.byteLength, release: () => this.coverage.delete(pen.target.canvas) });
    // The visible bitmaps must all survive the draw that allocated them. Sacrifice the oldest
    // masks first when the working set nearly fills the budget; their pixels last until the next date.
    this.masks.trim(this.maxBytes - super.bytes);
  }

  override get(key: string): CanvasImageSource | null | undefined {
    const source = super.get(key);
    const pen = source && this.masks.get(key);
    if (pen && pen.revision !== this.revision) {
      const tint = this.inks(pen.pigment);
      if (pen.ink === tint[0].css && pen.wash === tint[1].css) {
        pen.revision = this.revision;
        return source;
      }
      const { width, height } = pen.target.canvas;
      if (this.scratch?.width !== width || this.scratch.height !== height) this.scratch = pen.target.createImageData(width, height);
      this.tint(pen, this.scratch, tint);
    }
    return source;
  }

  changePalette(): void {
    this.revision++;
    this.retain(image => !image || this.coverage.has(image));
  }
}
