import { unzlibSync } from 'fflate';
import sheet from './assets/parchment-symbols.json';
import { SPRITE_STRIDE, type SpriteTint } from './gpu/contract';
import { RecordingContext } from './gpu/recorder';
import type { CanvasLike } from './canvas';

/** Hand-drawn parchment symbols (assets/parchment-symbols.json, see PROVENANCE.md): two masks per cell, ink and wash.
 * The colours come from the palette at draw time, so biomes and seasons tint the same strokes. */
export const SYMBOL_CELLS = { tuft: [0, 1, 2, 3], reed: [4, 5, 6, 7], heath: [8, 9, 10], gorse: 11, tree: 12, orchard: 13, stones: 14, boulder: 15 } as const;

let masks: Uint8Array | undefined;
const rgb = (h: string): [number, number, number] => {
  const v = parseInt(h.slice(1, 7), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** One tint (ink colour, wash colour, wash strength) of the sheet. Every cell lives in one atlas canvas (2 px
 * transparent gutters). With null colours it stores coverage for the GPU pen shader. */
export class ParchmentSymbols {
  private atlas: CanvasImageSource | null | undefined;
  private stride = 0;
  private columns = 1;
  constructor(
    private readonly colors: readonly [ink: string, wash: string] | null,
    private washAlpha: number,
    private makeCanvas: (w: number, h: number) => CanvasLike | null,
  ) {}

  sheetImage(): CanvasImageSource | null {
    if (this.atlas !== undefined) return this.atlas;
    this.atlas = null;
    if (this.colors && !this.colors.every(color => /^#[\da-f]{6}/i.test(color))) return null;
    masks ??= unzlibSync(Uint8Array.from(atob(sheet.zlib), c => c.charCodeAt(0)));
    const n = sheet.size,
      cells = Math.floor(masks.length / (n * n * 2)),
      stride = n + 2,
      columns = Math.ceil(Math.sqrt(cells));
    const rows = Math.ceil(cells / columns),
      canvas = this.makeCanvas(columns * stride, rows * stride),
      cx = canvas?.getContext('2d');
    if (!canvas || !cx) return null;
    const image = cx.createImageData(columns * stride, rows * stride),
      [ir, ig, ib] = this.colors ? rgb(this.colors[0]) : [0, 0, 0],
      [wr, wg, wb] = this.colors ? rgb(this.colors[1]) : [0, 0, 0],
      w = columns * stride;
    for (let cell = 0; cell < cells; cell++) {
      const base = cell * n * n * 2,
        ox = (cell % columns) * stride + 1,
        oy = Math.floor(cell / columns) * stride + 1;
      for (let i = 0; i < n * n; i++) {
        const ai = masks[base + i * 2] / 255,
          aw = (masks[base + i * 2 + 1] / 255) * this.washAlpha * (1 - ai),
          a = ai + aw;
        if (a <= 0) continue;
        const o = ((oy + Math.floor(i / n)) * w + ox + (i % n)) * 4;
        if (!this.colors) {
          // Opaque data pixels preserve the two contributions through Canvas and premultiplied texture upload.
          // Quantise their sum once, as the coloured Canvas sheet does for its alpha.
          image.data[o] = masks[base + i * 2];
          image.data[o + 1] = Math.round(a * 255) - image.data[o];
          image.data[o + 3] = 255;
          continue;
        }
        image.data[o] = (ir * ai + wr * aw) / a;
        image.data[o + 1] = (ig * ai + wg * aw) / a;
        image.data[o + 2] = (ib * ai + wb * aw) / a;
        image.data[o + 3] = Math.min(255, a * 255);
      }
    }
    cx.putImageData(image, 0, 0);
    this.stride = stride;
    this.columns = columns;
    return (this.atlas = canvas as unknown as CanvasImageSource);
  }

  /** Stamp a cell centred on (x, y), `size` map units wide. */
  draw(ctx: CanvasRenderingContext2D, cell: number, x: number, y: number, size: number, tint?: SpriteTint): void {
    const image = this.sheetImage();
    if (!image) return;
    const n = sheet.size,
      sx = (cell % this.columns) * this.stride + 1,
      sy = Math.floor(cell / this.columns) * this.stride + 1;
    if (tint && ctx instanceof RecordingContext) ctx.drawImage(image, sx, sy, n, n, x - size / 2, y - size / 2, size, size, tint);
    else ctx.drawImage(image, sx, sy, n, n, x - size / 2, y - size / 2, size, size);
  }

  /** Instance attributes for the mask atlas in map metres, sorted in the Canvas painter's order. */
  instances(marks: { cell: number; x: number; y: number; size: number }[]): Float32Array {
    const data = new Float32Array(marks.length * SPRITE_STRIDE);
    marks.sort((a, b) => a.y - b.y);
    let i = 0;
    for (const { cell, x, y, size } of marks) {
      data[i] = (cell % this.columns) * this.stride + 1;
      data[i + 1] = Math.floor(cell / this.columns) * this.stride + 1;
      data[i + 2] = data[i + 3] = sheet.size;
      data[i + 4] = x - size / 2;
      data[i + 5] = y - size / 2;
      data[i + 6] = data[i + 7] = size;
      data[i + 8] = data[i + 11] = 1;
      data[i + 14] = 0.8;
      i += SPRITE_STRIDE;
    }
    return data;
  }
}
