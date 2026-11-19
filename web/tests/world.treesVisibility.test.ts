import { describe, expect, it } from 'vitest';
import type { LiveFrame } from '../src/render/live/contract';
import { createFrameCamera, frameCamera } from '../src/render/world/camera';
import { TerrainHeights } from '../src/render/world/heights';
import { TreeCoverage } from '../src/render/world/treesVisibility';

const relief = new TerrainHeights(new Float32Array(16).fill(100), 4, 40000, 0, 1);
function frame(scale: number, pitch = (55 * Math.PI) / 180, yaw = 0, dpr = 1, terrain = relief): LiveFrame {
  const camera = createFrameCamera(),
    view = { cx: 20000, cy: 20000, scale, pitch, yaw };
  frameCamera(camera, view, 1600, 900, 1600 * dpr, 900 * dpr, dpr, terrain);
  return { camera, view, cssW: 1600, cssH: 900, dpr } as unknown as LiveFrame;
}

describe('tree ground coverage', () => {
  it('hands the zoomed-out forest to the painted crowns and fades over a short zoom interval', () => {
    const coverage = new TreeCoverage();
    expect(coverage.opacity(frame(8), relief, 600)).toBe(1);
    expect(coverage.opacity(frame(0.3), relief, 600)).toBe(0);
    const fades = Array.from({ length: 81 }, (_, i) => coverage.opacity(frame(1 + i / 20), relief, 600));
    expect(fades.some(x => x > 0 && x < 1)).toBe(true);
    for (let i = 1; i < fades.length; i++) expect(fades[i]).toBeGreaterThanOrEqual(fades[i - 1]);
  });

  it('uses the selected radius and the frame camera, independent of device pixels and heading on flat ground', () => {
    const coverage = new TreeCoverage(),
      opacity = coverage.opacity(frame(2), relief, 600);
    expect(coverage.opacity(frame(2, undefined, 0, 2), relief, 600)).toBeCloseTo(opacity, 6);
    expect(coverage.opacity(frame(2, undefined, 1.2), relief, 600)).toBeCloseTo(opacity, 6);
    expect(coverage.opacity(frame(0.6), relief, 5000)).toBe(1);
    expect(coverage.opacity(frame(16, (70 * Math.PI) / 180), relief, 600)).toBe(1);
  });

  it('measures the terrain actually drawn rather than a constant eye-distance cutoff', () => {
    const coverage = new TreeCoverage(),
      data = Float32Array.from({ length: 64 }, (_, i) => 100 + Math.floor(i / 8) * 100),
      hills = new TerrainHeights(data, 8, 40000, 0, 4);
    const a = coverage.opacity(frame(2), relief, 600),
      b = coverage.opacity(frame(2, undefined, 0, 1, hills), hills, 600);
    expect(b).not.toBe(a);
  });
});
