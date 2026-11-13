import { unzlibSync } from 'fflate';
import sheet from './assets/parchment-symbols.json';
import type { CanvasLike } from './canvas';

/** Hand-drawn parchment symbols (assets/parchment-symbols.json, see PROVENANCE.md): two masks per cell, ink and wash.
 * The colours come from the palette at draw time, so biomes and seasons tint the same strokes. */
export const SYMBOL_CELLS = {
  tuft: [0, 1, 2, 3], reed: [4, 5, 6, 7], heath: [8, 9, 10], gorse: 11, tree: 12, orchard: 13, stones: 14, boulder: 15,
} as const;

let masks: Uint8Array | undefined;
const rgb = (h: string): [number, number, number] => { const v = parseInt(h.slice(1, 7), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

/** One tint (ink colour, wash colour, wash strength) of the sheet. Every cell lives in one atlas canvas (2 px
 * transparent gutters), so a run of stamps shares one image source: the GPU vector engine draws it as one instanced batch. */
export class ParchmentSymbols {
  private atlas: CanvasImageSource | null | undefined;
  private stride = 0; private columns = 1;
  constructor(private ink: string, private wash: string, private washAlpha: number, private makeCanvas: (w: number, h: number) => CanvasLike | null) {}

  private sheetImage(): CanvasImageSource | null {
    if (this.atlas !== undefined) return this.atlas;
    this.atlas = null;
    if (!/^#[\da-f]{6}/i.test(this.ink) || !/^#[\da-f]{6}/i.test(this.wash)) return null;
    masks ??= unzlibSync(Uint8Array.from(atob(sheet.zlib), c => c.charCodeAt(0)));
    const n = sheet.size, cells = Math.floor(masks.length / (n * n * 2)), stride = n + 2, columns = Math.ceil(Math.sqrt(cells));
    const rows = Math.ceil(cells / columns), canvas = this.makeCanvas(columns * stride, rows * stride), cx = canvas?.getContext('2d');
    if (!canvas || !cx) return null;
    const image = cx.createImageData(columns * stride, rows * stride), [ir, ig, ib] = rgb(this.ink), [wr, wg, wb] = rgb(this.wash), w = columns * stride;
    for (let cell = 0; cell < cells; cell++) {
      const base = cell * n * n * 2, ox = (cell % columns) * stride + 1, oy = Math.floor(cell / columns) * stride + 1;
      for (let i = 0; i < n * n; i++) {
        const ai = masks[base + i * 2] / 255, aw = masks[base + i * 2 + 1] / 255 * this.washAlpha * (1 - ai), a = ai + aw;
        if (a <= 0) continue;
        const o = ((oy + Math.floor(i / n)) * w + ox + i % n) * 4;
        image.data[o] = (ir * ai + wr * aw) / a; image.data[o + 1] = (ig * ai + wg * aw) / a; image.data[o + 2] = (ib * ai + wb * aw) / a;
        image.data[o + 3] = Math.min(255, a * 255);
      }
    }
    cx.putImageData(image, 0, 0);
    this.stride = stride; this.columns = columns;
    return this.atlas = canvas as unknown as CanvasImageSource;
  }

  /** Stamp a cell centred on (x, y), `size` map units wide. */
  draw(ctx: CanvasRenderingContext2D, cell: number, x: number, y: number, size: number): void {
    const image = this.sheetImage(); if (!image) return;
    const n = sheet.size, sx = (cell % this.columns) * this.stride + 1, sy = Math.floor(cell / this.columns) * this.stride + 1;
    ctx.drawImage(image, sx, sy, n, n, x - size / 2, y - size / 2, size, size);
  }
}
