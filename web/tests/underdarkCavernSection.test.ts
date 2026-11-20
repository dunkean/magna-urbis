import { describe, expect, it } from 'vitest';
import { cavernField, cavernSectionHeights } from '../src/render/underdarkCavern';

describe('Underdark section relief', () => {
  it('keeps the floors and cuts the rock at the roof of its chamber', () => {
    const n = 24,
      data = new Float32Array(n * n),
      cave = new Uint8Array(n * n);
    // Rock mass on the western half, far above an open floor at 10 m.
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const rock = i < n / 2;
        data[j * n + i] = rock ? 500 : 10;
        cave[j * n + i] = rock ? 255 : 0;
      }
    const field = cavernField({ x: 0, y: 0, width: n * 20, n, data, cave }, 40)!,
      section = cavernSectionHeights(data, field);
    const floor = (n / 2) * n + n - 2,
      rock = (n / 2) * n + 2;
    expect(section[floor]).toBe(10);
    expect(section[rock]).toBeCloseTo(field.roof[rock], 3);
    expect(section[rock]).toBeGreaterThan(10);
    expect(section[rock]).toBeLessThan(500);
  });
});
