import { describe, expect, it } from 'vitest';
import { boxMips } from '../src/ui/boxMips';

/** The previous per-component implementation, kept as the reference. */
function reference(data: Uint8Array, width: number, height: number, channels: number, layers = 1): Uint8Array[] {
  const levels = [data];
  while (width > 1 || height > 1) {
    const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1), previous = levels[levels.length - 1], next = new Uint8Array(w * h * channels * layers);
    for (let l = 0; l < layers; l++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < channels; c++) {
      const x0 = Math.min(width - 1, 2 * x), x1 = Math.min(width - 1, 2 * x + 1), y0 = Math.min(height - 1, 2 * y), y1 = Math.min(height - 1, 2 * y + 1);
      const at = (px: number, py: number): number => previous[((l * height + py) * width + px) * channels + c];
      next[((l * h + y) * w + x) * channels + c] = (at(x0, y0) + at(x1, y0) + at(x0, y1) + at(x1, y1) + 2) >> 2;
    }
    levels.push(next); width = w; height = h;
  }
  return levels;
}

describe('boxMips', () => {
  it('matches the reference chain on odd sizes, channels and layers', () => {
    let seed = 3;
    for (const [w, h, channels, layers] of [[64, 64, 4, 1], [37, 21, 2, 3], [1, 9, 4, 1], [128, 7, 1, 2]]) {
      const data = Uint8Array.from({ length: w * h * channels * layers }, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24);
      expect(boxMips(data, w, h, channels, layers).map(l => l.data)).toEqual(reference(data, w, h, channels, layers));
    }
  });
});
