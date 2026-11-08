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

/** One tint (ink colour, wash colour, wash strength) of the sheet; sprites are built lazily, one canvas per cell. */
export class ParchmentSymbols {
  private sprites = new Map<number, CanvasImageSource | null>();
  constructor(private ink: string, private wash: string, private washAlpha: number, private makeCanvas: (w: number, h: number) => CanvasLike | null) {}

  sprite(cell: number): CanvasImageSource | null {
    let found = this.sprites.get(cell);
    if (found !== undefined) return found;
    found = null;
    const n = sheet.size, canvas = this.makeCanvas(n, n), cx = canvas?.getContext('2d');
    if (canvas && cx && /^#[\da-f]{6}/i.test(this.ink) && /^#[\da-f]{6}/i.test(this.wash)) {
      masks ??= unzlibSync(Uint8Array.from(atob(sheet.zlib), c => c.charCodeAt(0)));
      const image = cx.createImageData(n, n), [ir, ig, ib] = rgb(this.ink), [wr, wg, wb] = rgb(this.wash);
      const base = cell * n * n * 2;
      for (let i = 0; i < n * n; i++) {
        const ai = masks[base + i * 2] / 255, aw = masks[base + i * 2 + 1] / 255 * this.washAlpha * (1 - ai), a = ai + aw;
        if (a <= 0) continue;
        image.data[i * 4] = (ir * ai + wr * aw) / a; image.data[i * 4 + 1] = (ig * ai + wg * aw) / a; image.data[i * 4 + 2] = (ib * ai + wb * aw) / a;
        image.data[i * 4 + 3] = Math.min(255, a * 255);
      }
      cx.putImageData(image, 0, 0);
      found = canvas as unknown as CanvasImageSource;
    }
    this.sprites.set(cell, found);
    return found;
  }

  /** Stamp a cell centred on (x, y), `size` map units wide. */
  draw(ctx: CanvasRenderingContext2D, cell: number, x: number, y: number, size: number): void {
    const image = this.sprite(cell);
    if (image) ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
  }
}
