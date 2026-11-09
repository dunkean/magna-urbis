import { describe, expect, it } from 'vitest';
import { terrain3dPixelRatio, TERRAIN_3D_FRAME_PIXELS } from '../src/ui/terrain3dResolution';

describe('3D framebuffer memory budget', () => {
  it('keeps ordinary views at their requested resolution', () => {
    expect(terrain3dPixelRatio(1200, 850, 1)).toBe(1);
    expect(terrain3dPixelRatio(800, 600, 2)).toBe(2);
  });
  it.each([[3840, 2160, 2], [7680, 4320, 2], [2400, 1600, 3]])('bounds HiDPI allocations at %s×%s', (width, height, requested) => {
    const dpr = terrain3dPixelRatio(width, height, requested);
    const pixels = Math.floor(width * dpr) * Math.floor(height * dpr);
    expect(pixels).toBeLessThanOrEqual(TERRAIN_3D_FRAME_PIXELS);
    expect(pixels * 32).toBeLessThanOrEqual(128 * 1024 * 1024);
    expect(dpr).toBeGreaterThan(0);
  });
  it('respects device dimensions for wide canvases and invalid DPR input', () => {
    const ratio = terrain3dPixelRatio(12000, 300, 2, 2048);
    expect(Math.floor(12000 * ratio)).toBeLessThanOrEqual(2048);
    expect(terrain3dPixelRatio(800, 600, NaN)).toBe(1);
  });
});
