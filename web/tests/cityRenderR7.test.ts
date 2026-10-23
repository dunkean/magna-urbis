import { expect, it } from 'vitest';
import { clearCanvas2d } from '../src/render/cityCanvas';

// Invariant: an overlay frame empties the whole bitmap without one full-canvas clearRect
// (Chrome's overwrite fast path kept the first full-plan frame on screen, see clearCanvas2d).
it('clears every pixel of the overlay in strips, never with one full-canvas clearRect', () => {
  for (const [w, h] of [[980, 745], [1, 1], [1280, 2], [3, 7]]) {
    const rects: number[][] = [];
    const ctx = { canvas: { width: w, height: h }, setTransform: () => {}, clearRect: (...r: number[]) => { rects.push(r); } } as unknown as CanvasRenderingContext2D;
    clearCanvas2d(ctx, w, h);
    const covered = new Uint8Array(w * h);
    for (const [x, y, rw, rh] of rects) {
      expect(rw >= w && rh >= h && h > 1).toBe(false);
      for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) covered[j * w + i] = 1;
    }
    expect(covered.every(v => v === 1)).toBe(true);
  }
});
