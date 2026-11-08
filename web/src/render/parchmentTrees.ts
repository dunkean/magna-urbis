import { unzlibSync } from 'fflate';
import sheet from './assets/parchment-trees.json';
import type { CanvasLike } from './canvas';

/** Engraved tree symbols for the parchment woods (assets/parchment-trees.json, see PROVENANCE.md): an ink mask and a crown
 * fill mask per cell, 6x6 cells. Colours come from the palette at draw time (canopy.ts tints, shades and casts the shadow). */
export const TREE_CELLS = {
  // Cells 8, 14 (open feathery ash), 20 and 34 have open outlines: their crown fill is incomplete, so they are not used.
  broadleaf: [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16, 17],
  fruit: [18, 19, 21, 22, 23],
  coniferPlan: [24, 25, 26],
  coniferSide: [27, 28, 29],
  clump: [30, 31, 32, 33, 35],
} as const;
export const TREE_SPRITE = sheet.size;

let masks: Uint8Array | undefined;
const sprites = new Map<string, CanvasImageSource | null>();

/** One mask channel of a cell (`ink` strokes or crown `fill`) as a canvas in a single colour. */
export function treeMask(cell: number, channel: 'ink' | 'fill', color: string, makeCanvas: (w: number, h: number) => CanvasLike | null): CanvasImageSource | null {
  const key = `${cell}:${channel}:${color}`;
  let found = sprites.get(key);
  if (found !== undefined) return found;
  found = null;
  const n = sheet.size, canvas = makeCanvas(n, n), cx = canvas?.getContext('2d'), m = /^#([\da-f]{6})/i.exec(color);
  if (canvas && cx && m) {
    masks ??= unzlibSync(Uint8Array.from(atob(sheet.zlib), c => c.charCodeAt(0)));
    const v = parseInt(m[1], 16), image = cx.createImageData(n, n), base = cell * n * n * 2 + (channel === 'ink' ? 0 : 1);
    for (let i = 0; i < n * n; i++) {
      image.data[i * 4] = (v >> 16) & 255; image.data[i * 4 + 1] = (v >> 8) & 255; image.data[i * 4 + 2] = v & 255;
      image.data[i * 4 + 3] = masks[base + i * 2];
    }
    cx.putImageData(image, 0, 0);
    found = canvas as unknown as CanvasImageSource;
  }
  sprites.set(key, found);
  return found;
}
