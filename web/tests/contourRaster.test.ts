import { afterEach, describe, expect, it, vi } from 'vitest';
import { contourRaster, contourRasterSide, contourRasterUrl, type ContourRasterLook } from '../src/render/contourRaster';

afterEach(() => vi.unstubAllGlobals());

describe('one retained contour plate', () => {
  it('caps its fixed definition independently of zoom and screen pixel ratio', () => {
    expect(contourRasterSide(4000)).toBe(8000);
    expect(contourRasterSide(128000)).toBe(8192);
    expect(contourRasterSide(200)).toBe(1024);
  });

  it('strokes each set only once, reuses the same pixels and encoded bench image, and invalidates on pigment or terrain changes', () => {
    const ctx = { setTransform: vi.fn(), stroke: vi.fn(), lineWidth: 0, globalAlpha: 1 };
    const create = vi.fn(() => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: vi.fn(() => 'data:image/png;base64,plate') }));
    vi.stubGlobal('document', { createElement: create });
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(public data: string) {}
      },
    );
    const paths = { thin: 'M0,0L1,1', index: 'M0,1L1,0' };
    const look: ContourRasterLook = { color: '#402000', opacity: 0.5, thinWeight: 1, indexWeight: 1, topographic: true };
    const plate = contourRaster(paths, 4000, look);
    expect(plate.metresPerTexel).toBe(0.5);
    for (let frame = 0; frame < 20; frame++) expect(contourRaster(paths, 4000, { ...look })).toBe(plate);
    expect(create).toHaveBeenCalledOnce();
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(contourRasterUrl(plate)).toBe(contourRasterUrl(plate));
    expect(plate.canvas.toDataURL).toHaveBeenCalledOnce();
    expect(contourRaster(paths, 4000, { ...look, color: '#003300' })).not.toBe(plate);
    expect(contourRaster({ ...paths }, 4000, look)).not.toBe(plate);
  });
});
