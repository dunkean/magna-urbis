import { afterEach, describe, expect, it, vi } from 'vitest';
import { GpuCaptures } from '../src/ui/terrain/gpu/captures';
import { patchBackgroundCapture } from '../src/ui/terrain/backgroundCapture';

afterEach(() => vi.unstubAllGlobals());

describe('WebGPU capture readiness', () => {
  it('updates only the affected background pixels using the original capture density', () => {
    const drawImage = vi.fn(),
      image = { width: 1024, getContext: () => ({ drawImage }) } as unknown as HTMLCanvasElement,
      patch = {} as HTMLCanvasElement,
      capture = vi.fn(() => patch);
    expect(patchBackgroundCapture(image, 2048, [], 32, capture)).toBe(true);
    expect(capture).not.toHaveBeenCalled();
    expect(patchBackgroundCapture(image, 2048, [{ minX: 100, minY: 200, maxX: 140, maxY: 220 }], 32, capture)).toBe(true);
    expect(capture).toHaveBeenCalledWith({ x: 36, y: 136, width: 168 }, 84);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(patch, 32, 32, 20, 10, 50, 100, 20, 10);
    expect(patchBackgroundCapture(image, 2048, [{ minX: 0, minY: 0, maxX: 2048, maxY: 2048 }], 32, capture)).toBe(false);
    expect(capture).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('requires the final pipeline for groundOverlay=%s and restores the display after', groundOverlay => {
    const copy = vi.fn(),
      configure = vi.fn(),
      canvas = { getContext: () => ({ drawImage: copy, configure }) };
    vi.stubGlobal('document', { createElement: () => canvas });
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const details = [{ layer: {}, fadeStart: 1 }],
      look = { mapWidth: 100, contours: true },
      draw = vi.fn(() => true),
      restore = vi.fn(() => expect(copy).toHaveBeenCalled());
    // Exercise the capture without a GPU device: the redraw request carries the capture's own look, view and layers.
    const captures = new GpuCaptures({ device: {}, canvasFormat: 'bgra8unorm' } as never, { draw, liveTargets: {} } as never, { details, enhanced: [{}] } as never);
    captures.region(look as never, { x: 0, y: 0, width: 100 }, 32, false, restore, undefined, groundOverlay);
    expect(draw).toHaveBeenCalledTimes(1);
    const request = (draw.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    // A missing pipeline is created synchronously: never a stand-in look in a capture.
    expect(request).toMatchObject({ wait: true, offscreen: true, pixelRatio: 1, stylePixelRatio: 1, details: [], enhanced: [], capturing: false, tile: false });
    expect(request.look).toMatchObject({ mesh3d: true, frame: false, groundCapture: groundOverlay, contours: !groundOverlay });
    expect(request.view).toEqual({ view: { cx: 50, cy: 50, scale: 0.32 }, width: 32, height: 32 });
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({ alphaMode: groundOverlay ? 'premultiplied' : 'opaque' }));
    expect(copy).toHaveBeenCalledWith((request.surface as { canvas: unknown }).canvas, 0, 0);
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
