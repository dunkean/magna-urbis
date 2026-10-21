import { describe, expect, it } from 'vitest';
import { FOREST_BANK_MAX_WIDTH, forestBankField, forestBankSample, forestShrubShare, svgPathSegments } from '../../rust/bridge/terrainForestRiparian';

describe('riparian gallery envelope follows displayed banks', () => {
  const arid = { seed: 728311, climate: [23, 150] as const, heightAt: () => 100 };
  /** Envelope extent beyond the bank on each side of a north-south river at x = centre. */
  const extents = (rgba: Uint8Array, grid: { x: number; y: number; width: number; n: number }, centre: number, half: number, wy: number): [number, number] => {
    const result: [number, number] = [0, 0];
    for (const [side, sign] of [[0, -1], [1, 1]] as const) {
      for (let d = 0; d <= FOREST_BANK_MAX_WIDTH + 4; d += .25) {
        if (forestBankSample(rgba, grid, centre + sign * (half + d), wy).margin > 0) result[side] = d;
      }
    }
    return result;
  };

  it('keeps a continuous narrow ribbon along both banks of a straight arid river', () => {
    const grid = { x: 0, y: 0, width: 12000, n: 750 };
    const bank = forestBankField(new Float32Array([6000, 0, 6000, 12000, 12, 12, 0, 0, 0]), grid, arid)!;
    const widths: number[] = [];
    for (let wy = 50; wy < 11950; wy += 23) widths.push(...extents(bank.rgba, grid, 6000, 6, wy));
    expect(Math.min(...widths)).toBeGreaterThan(6);
    expect(Math.max(...widths)).toBeLessThan(FOREST_BANK_MAX_WIDTH + .5);
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(8);
    // Nothing beyond the narrow strip: no broad moisture halo.
    for (let wy = 0; wy < 12000; wy += 97) for (const dx of [80, 150, 400, 2000]) {
      expect(forestBankSample(bank.rgba, grid, 6000 + dx, wy).margin).toBeLessThan(0);
      expect(forestBankSample(bank.rgba, grid, 6000 - dx, wy).margin).toBeLessThan(0);
    }
  });

  it('resolves both banks of a channel narrower than one texel', () => {
    const grid = { x: 0, y: 0, width: 40000, n: 1024 }, cell = grid.width / grid.n;
    // A 6 m stream, oblique to the 39 m texels.
    const bank = forestBankField(new Float32Array([5000, 0, 35000, 40000, 6, 6, 0, 0, 0]), grid, arid)!;
    for (let t = .05; t < .95; t += .013) {
      const cx = 5000 + 30000 * t, cy = 40000 * t, nx = .8, ny = -.6;
      for (const sign of [-1, 1]) {
        // Just outside the bank, and well outside the widest envelope.
        expect(forestBankSample(bank.rgba, grid, cx + sign * nx * 5, cy + sign * ny * 5).margin).toBeGreaterThan(0);
        expect(forestBankSample(bank.rgba, grid, cx + sign * nx * (3 + FOREST_BANK_MAX_WIDTH + 2), cy + sign * ny * (3 + FOREST_BANK_MAX_WIDTH + 2)).margin).toBeLessThan(0);
      }
    }
    // Area channel: two land bands of 8..48 m each, integrated across a row.
    for (let j = 40; j < grid.n - 40; j += 37) {
      let area = 0;
      for (let i = 0; i < grid.n; i++) area += bank.rgba[(j * grid.n + i) * 4 + 3] / 255 * cell;
      expect(area).toBeGreaterThan(.55 * 16 * .805 * .85);
      expect(area).toBeLessThan(2 * FOREST_BANK_MAX_WIDTH * 1.25 + cell);
    }
  });

  it('stays continuous along both banks of a meandering stream on coarse texels', () => {
    const grid = { x: 0, y: 0, width: 40000, n: 1024 }, segments: number[] = [];
    // 300 m amplitude, 1.2 km wavelength (bend radius ≈ 120 m), 25 m vertices, 8 m wide.
    const at = (t: number): [number, number] => [20000 + 300 * Math.sin(2 * Math.PI * t / 1200), t];
    for (let t = 5000; t < 15000; t += 25) segments.push(...at(t), ...at(t + 25), 8, 8, 0, 0, 0);
    const bank = forestBankField(Float32Array.from(segments), grid, arid)!;
    for (let t = 5100; t < 14900; t += 7) {
      const [x, y] = at(t), [x2, y2] = at(t + .5), len = Math.hypot(x2 - x, y2 - y), nx = (y2 - y) / len, ny = -(x2 - x) / len;
      for (const sign of [-1, 1]) {
        expect(forestBankSample(bank.rgba, grid, x + sign * nx * 7, y + sign * ny * 7).margin).toBeGreaterThan(0);
        expect(forestBankSample(bank.rgba, grid, x + sign * nx * 60, y + sign * ny * 60).margin).toBeLessThan(0);
      }
    }
  });

  it('is deterministic, excludes the sea and stays bounded to segment extents', () => {
    const grid = { x: 0, y: 0, width: 4000, n: 250 };
    const segments = new Float32Array([1000, 0, 1000, 4000, 8, 8, 0, 0, 0, 90000, 90000, 91000, 91000, 8, 8, 0, 0, 0]);
    const a = forestBankField(segments, grid, arid)!, b = forestBankField(segments, grid, arid)!;
    expect(a.rgba.every((v, i) => v === b.rgba[i])).toBe(true);
    const sea = forestBankField(segments, grid, { ...arid, heightAt: () => -3 })!;
    for (let o = 0; o < grid.n * grid.n; o++) expect(sea.rgba[o * 4 + 2] | sea.rgba[o * 4 + 3]).toBe(0);
    expect(forestBankField(undefined, grid, arid)).toBeUndefined();
  });

  it('flattens retained bank outlines through their crop transform', () => {
    const out: number[] = [];
    svgPathSegments('M0,0L10,0l0,10h-10Z', [2, 0, 0, 2, 100, 50], 0, out);
    expect(out.length).toBe(4 * 9);
    expect(out.slice(0, 4)).toEqual([100, 50, 120, 50]);
    expect(out.slice(27, 31)).toEqual([100, 70, 100, 50]);
  });

  it('selects shrubs from physical height only', () => {
    expect(forestShrubShare(2)).toBe(1);
    expect(forestShrubShare(3)).toBe(1);
    expect(forestShrubShare(4.2)).toBeGreaterThan(0);
    expect(forestShrubShare(4.2)).toBeLessThan(1);
    expect(forestShrubShare(6)).toBe(0);
  });
});
