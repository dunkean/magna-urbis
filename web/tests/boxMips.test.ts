import { describe, expect, it } from 'vitest';
import { boxMips, patchedRasterMips, rasterMips } from '../src/ui/boxMips';

/** The previous per-component implementation, kept as the reference. */
function reference(data: Uint8Array, width: number, height: number, channels: number, layers = 1): Uint8Array[] {
  const levels = [data];
  while (width > 1 || height > 1) {
    const w = Math.max(1, width >> 1),
      h = Math.max(1, height >> 1),
      previous = levels[levels.length - 1],
      next = new Uint8Array(w * h * channels * layers);
    for (let l = 0; l < layers; l++)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          for (let c = 0; c < channels; c++) {
            const x0 = Math.min(width - 1, 2 * x),
              x1 = Math.min(width - 1, 2 * x + 1),
              y0 = Math.min(height - 1, 2 * y),
              y1 = Math.min(height - 1, 2 * y + 1);
            const at = (px: number, py: number): number => previous[((l * height + py) * width + px) * channels + c];
            next[((l * h + y) * w + x) * channels + c] = (at(x0, y0) + at(x1, y0) + at(x0, y1) + at(x1, y1) + 2) >> 2;
          }
    levels.push(next);
    width = w;
    height = h;
  }
  return levels;
}

describe('boxMips', () => {
  it('matches the reference chain on odd sizes, channels and layers', () => {
    let seed = 3;
    for (const [w, h, channels, layers] of [
      [64, 64, 4, 1],
      [37, 21, 2, 3],
      [1, 9, 4, 1],
      [128, 7, 1, 2],
    ]) {
      const data = Uint8Array.from({ length: w * h * channels * layers }, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24);
      expect(boxMips(data, w, h, channels, layers).map(l => l.data)).toEqual(reference(data, w, h, channels, layers));
    }
  });
});

describe('patchedRasterMips', () => {
  it('gives the chain of the patched raster, changed only above the patched texels', () => {
    const n = 96,
      previous = Uint8Array.from({ length: n * n * 4 }, (_, i) => (i * 37) & 255),
      next = previous.slice(),
      rects = [
        { x: 10, y: 5, width: 7, height: 3 },
        { x: 60, y: 70, width: 30, height: 20 },
      ];
    for (const r of rects) for (let j = r.y; j < r.y + r.height; j++) for (let i = r.x; i < r.x + r.width; i++) next[(j * n + i) * 4] ^= 0x5a;
    const before = rasterMips(previous, n, n, 4).map(l => l.slice()),
      { levels, changed } = patchedRasterMips(previous, next, n, n, 4, rects);
    expect(levels).toEqual(boxMips(next, n, n, 4).map(l => l.data));
    expect(rasterMips(next, n, n, 4)).toBe(levels);
    // The previous chain is left as it was.
    expect(rasterMips(previous, n, n, 4)).toEqual(before);
    levels.forEach((level, mip) => {
      const w = Math.max(1, n >> mip);
      for (let t = 0; t < level.length / 4; t++) {
        const x = t % w,
          y = Math.floor(t / w),
          inside = changed[mip].some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
        if (!inside) expect(level.subarray(t * 4, t * 4 + 4)).toEqual(before[mip].subarray(t * 4, t * 4 + 4));
      }
    });
  });
});
