import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerrainGpu } from '../src/ui/terrainGpu';

afterEach(() => vi.unstubAllGlobals());

describe('WebGPU capture readiness', () => {
  it.each([false, true])('requires the final pipeline for groundOverlay=%s and restores display state', groundOverlay => {
    const copy = vi.fn(), canvas = { getContext: () => ({ drawImage: copy }) };
    vi.stubGlobal('document', { createElement: () => canvas });
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const view = { view: { cx: 1, cy: 2, scale: 1 }, width: 4, height: 4 };
    const details = [{ layer: {}, fadeStart: 1 }], enhanced = [{}], look = { mapWidth: 100, contours: true };
    const surface = { canvas: {} }, draw = vi.fn();
    // Exercise the public capture without constructing a GPU device. Draw's last argument controls
    // whether a pending look is synchronously completed or replaced by the preview pipeline.
    const renderer = Object.assign(Object.create(TerrainGpu.prototype), {
      base: {}, gpu: { lost: false }, view, details, enhanced, look,
      captureSurface: () => surface, draw, release: vi.fn(),
    });
    renderer.captureRegion({ x: 0, y: 0, width: 100 }, 32, false, true, undefined, groundOverlay);
    expect(draw.mock.calls[0]).toEqual([1, 1, surface, true]);
    expect(copy).toHaveBeenCalledWith(surface.canvas, 0, 0);
    expect(draw.mock.calls[1]).toEqual([]);
    expect(renderer.view).toBe(view);
    expect(renderer.details).toBe(details);
    expect(renderer.enhanced).toBe(enhanced);
    expect(renderer.look).toBe(look);
  });
});
