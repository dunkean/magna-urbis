import { describe, expect, it } from 'vitest';
import type { TerrainData } from '../../rust/bridge/terrain';
import { cityContourInterval, cityContourPaths } from '../src/render/cityContours';

function ramp(): TerrainData {
  const n = 32, height = Float32Array.from({ length: n * n }, (_, i) => i % n);
  return { height, resolution: n, width: n * 10, caveMask: new Uint8Array() } as TerrainData;
}

describe('City Bench contours', () => {
  it('keeps physical levels aligned to cell centres, with every fifth level indexed', () => {
    const paths = cityContourPaths(ramp(), 'flat', 1);
    expect(paths.step).toBe(2);
    expect(paths.thin).toContain('M25.00,'); // 2 m on the x / 10 ramp, sample origin 5 m.
    expect(paths.thin).not.toContain('M105.00,');
    expect(paths.index).toContain('M105.00,');
    expect(paths.index).toContain('M205.00,');
    expect(paths.index).toContain('M305.00,');
  });

  it('reuses geometry within a scale band and when returning to a previous interval', () => {
    const terrain = ramp(), close = cityContourPaths(terrain, 'flat', 1);
    expect(cityContourPaths(terrain, 'flat', 0.5)).toBe(close);
    const overview = cityContourPaths(terrain, 'flat', 0.05);
    expect(overview.step).toBe(8);
    expect(overview.thin).not.toContain('M25.00,');
    expect(cityContourPaths(terrain, 'flat', 1)).toBe(close);
    expect(cityContourPaths(ramp(), 'flat', 1)).not.toBe(close);
    expect(cityContourInterval('mountains', 1)).toBe(40);
  });

  it('drops near-flat contours and cavern terrain', () => {
    const terrain = ramp(); terrain.height = Float32Array.from(terrain.height, h => 1.99 + h * 0.001);
    expect(cityContourPaths(terrain, 'flat', 1).thin).toBe('');
    terrain.caveMask = new Uint8Array(32 * 32);
    expect(cityContourPaths(terrain, 'mountains', 1)).toEqual({ step: 0, thin: '', index: '' });
  });
});
