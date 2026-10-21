import { describe, expect, it } from 'vitest';
import { buildForestField, DEFAULT_FOREST_SETTINGS } from '../../rust/bridge/terrainForest';
import { forestBankSample } from '../../rust/bridge/terrainForestRiparian';

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

  it('applies density to gallery crowns without moving banks or mutating their cache', () => {
    const input = { seed: 728311, climate: [23, 150] as const, height,
      riverSegments: new Float32Array([2000, 0, 2000, width, 12, 12, 0, 0, 0]) };
    const full = buildForestField(input, settings);
    const half = buildForestField(input, { ...settings, density: .5 });
    const empty = buildForestField(input, { ...settings, density: 0 });
    const fullAgain = buildForestField(input, settings);
    const area = (bytes: Uint8Array): number => {
      let total = 0; for (let k = 3; k < bytes.length; k += 4) total += bytes[k]; return total;
    };
    expect(full.bankDensity).toBe(1);
    expect(half.bankDensity).toBe(.5);
    expect(empty.bank).toBeUndefined();
    expect(area(half.bank!)).toBeGreaterThan(0);
    expect(area(half.bank!)).toBeLessThan(area(full.bank!));
    expect(full.bank!.every((v, k) => k % 4 === 3 || v === half.bank![k])).toBe(true);
    expect(full.bank!.every((v, k) => v === fullAgain.bank![k])).toBe(true);
  });

  it('builds a narrow arid gallery from displayed river geometry, not a broad routing-label halo', () => {
    const riverN = 256, riverWidth = 12000, water = new Uint8Array(riverN * riverN);
    for (let y = 0; y < riverN; y++) water[y * riverN + riverN / 2] = 3;
    const height = { x: 0, y: 0, width: riverWidth, n: riverN, data: new Float32Array(riverN * riverN).fill(100) };
    const input = { seed: 728311, climate: [23, 150] as const, height, water, riverSegments: new Float32Array([6000, 0, 6000, 12000, 12, 12, 0, 0, 0]) };
    const a = buildForestField(input, settings), b = buildForestField(input, settings);
    expect(a.rgba.every((value, index) => value === b.rgba[index])).toBe(true);
    expect(a.bank && b.bank && a.bank.every((value, index) => value === b.bank![index])).toBe(true);
    const cell = riverWidth / a.n, grid = { x: 0, y: 0, width: riverWidth, n: a.n };
    let natural = 0, tallest = 0;
    for (let y = 0; y < a.n; y++) for (let x = 0; x < a.n; x++) {
      const o = (y * a.n + x) * 4, wx = (x + .5) * cell, wy = (y + .5) * cell;
      natural = Math.max(natural, a.rgba[o]);
      if (forestBankSample(a.bank!, grid, wx, wy).margin > 0) tallest = Math.max(tallest, a.rgba[o + 1] / 255 * 50);
    }
    // Desert cover stays near zero: the gallery lives only in the bank envelope.
    expect(natural).toBeLessThan(13);
    // Mostly low shrubs, a few sheltered gallery trees, never tall forest.
    expect(tallest).toBeGreaterThan(1);
    expect(tallest).toBeLessThan(17);
    for (let wy = 30; wy < riverWidth; wy += 211) {
      expect(forestBankSample(a.bank!, grid, 6006 + 4, wy).margin).toBeGreaterThan(0);
      expect(forestBankSample(a.bank!, grid, 6006 + 60, wy).margin).toBeLessThan(0);
    }
    // Without displayed geometry, routing river cells give a (wider) fallback envelope.
    const fallback = buildForestField({ ...input, riverSegments: undefined }, settings);
    expect(forestBankSample(fallback.bank!, grid, 6030, 6000).margin).toBeGreaterThan(0);
    expect(forestBankSample(fallback.bank!, grid, 6200, 6000).margin).toBeLessThan(0);
  });
});
