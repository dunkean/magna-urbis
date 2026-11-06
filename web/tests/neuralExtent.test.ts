import { describe, expect, it, vi } from 'vitest';
import { fitNeuralSurface, neuralWindow } from '../../rust/bridge/terrainAdjust';
import { TerrainRefinementSession } from '../src/ui/terrainRefinement';
import { createInfiniteRefinementProvider } from '../src/surface/adapters/infiniteRefinement';

describe('physical neural extent', () => {
  it('registers the actual width when a legacy caller passes the old 40 km constant', () => {
    expect(neuralWindow(40000, 100000, 'scale', true, 255)).toEqual({ x: 0, y: 0, width: 100000, heightScale: 1 });
    const heights = new Float32Array([1, 2, 3, 4]);
    expect(fitNeuralSurface(heights, 100000, 100000, 'crop', true, 0)).toBe(heights);
    expect(() => fitNeuralSurface(heights, 40000, 100000, 'scale', true, 0)).toThrow(/extent must match/);
  });

  it('rejects an oversized optional refinement before encoding or fetching', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(TerrainRefinementSession.create('http://example.test',
        { x: 0, y: 0, width: 200000, n: 1501, data: new Float32Array(0) }, { seed: '42' }))
        .rejects.toThrow(/1500²/);
      await expect(createInfiniteRefinementProvider('http://example.test',
        { width: 200000, n: 1501, data: new Float32Array(1501 ** 2) }, { seed: '42' }, fetcher))
        .rejects.toThrow(/1500²/);
      await expect(createInfiniteRefinementProvider('http://example.test',
        { width: 200000, n: 6667, data: new Float32Array(0) }, { seed: '42' }, fetcher))
        .rejects.toThrow(/1500²/);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
