import { describe, expect, it } from 'vitest';
import { buildForestField, DEFAULT_FOREST_SETTINGS } from '../../rust/bridge/terrainForest';

describe('forest banks use displayed water, independently of routing buffers', () => {
  const n = 64, width = 4000;
  const height = { x: 0, y: 0, width, n, data: new Float32Array(n * n).fill(100) };
  const settings = { ...DEFAULT_FOREST_SETTINGS, clearings: 0 };

  it('keeps complete canopy under widened river and lake cells for the water compositor', () => {
    const water = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
      water[y * n + 30] = 3;
      water[y * n + 31] = 3;
      water[y * n + 32] = 2;
    }
    const input = { seed: 32831, climate: [16, 600] as const, height, water };
    const a = buildForestField(input, settings), b = buildForestField(input, settings);
    expect(a.rgba.every((value, index) => value === b.rgba[index])).toBe(true);
    // These coarse cells include dry banks by design. Their canopy must remain
    // available behind the precise, independently rendered water geometry.
    let minimum = 255;
    for (let y = 0; y < a.n; y++) for (let x = 0; x < a.n; x++) {
      const sourceX = Math.floor((x + .5) / a.n * n);
      if (sourceX >= 30 && sourceX <= 32) minimum = Math.min(minimum, a.rgba[(y * a.n + x) * 4]);
    }
    expect(minimum).toBeGreaterThan(0);
  });

  it('retains the sea-level and disabled-forest exclusions', () => {
    const sea = { ...height, data: new Float32Array(n * n).fill(-5) };
    for (const field of [
      buildForestField({ seed: 32831, climate: [16, 600], height: sea }, settings),
      buildForestField({ seed: 32831, climate: [16, 600], height }, { ...settings, enabled: false }),
    ]) {
      let maximum = 0;
      for (let i = 0; i < field.rgba.length; i += 4) maximum = Math.max(maximum, field.rgba[i]);
      expect(maximum).toBe(0);
    }
  });

  it('varies arid gallery-forest width along a straight river without camera-dependent randomness', () => {
    const riverN = 256, riverWidth = 12000, water = new Uint8Array(riverN * riverN);
    for (let y = 0; y < riverN; y++) water[y * riverN + riverN / 2] = 3;
    const input = { seed: 728311, climate: [23, 150] as const,
      height: { x: 0, y: 0, width: riverWidth, n: riverN, data: new Float32Array(riverN * riverN).fill(100) }, water };
    const a = buildForestField(input, settings), b = buildForestField(input, settings);
    expect(a.rgba.every((value, index) => value === b.rgba[index])).toBe(true);
    const widths: number[] = [];
    for (let y = 10; y < a.n - 10; y++) {
      let coveredWidth = 0;
      for (let x = 0; x < a.n; x++) coveredWidth += a.rgba[(y * a.n + x) * 4] / 255 * riverWidth / a.n;
      widths.push(coveredWidth);
    }
    // Integrated canopy is equivalent to a fully covered width in metres.
    // Broad alluvial stands and sparse banks must differ appreciably, even
    // with a straight channel, flat relief and the clearing control disabled.
    expect(Math.max(...widths)).toBeGreaterThan(2 * Math.min(...widths));
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(100);
  });
});
