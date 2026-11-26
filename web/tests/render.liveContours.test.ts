import { describe, expect, it, vi } from 'vitest';
import { createContourInk, type ContourInkSource } from '../src/render/live/contourInk';
import { createLiveRasterizer } from '../src/render/gpu/liveRasterizer';
import { RecordingCanvas, RecordingContext } from '../src/render/gpu/recorder';
import type { ContourTint, LiveRasterizer } from '../src/render/gpu/contract';
import type { LiveFrame } from '../src/render/live/contract';

vi.mock('../src/render/gpu/liveRasterizer', () => ({ createLiveRasterizer: vi.fn() }));

function fixture() {
  const tint: ContourTint = { rgba: [0.4, 0.2, 0.1, 0.5] };
  const canvas = new RecordingCanvas(4000, 4000),
    ctx = canvas.getContext('2d')! as unknown as RecordingContext;
  ctx.drawContourImage({ width: 8192, height: 8192 } as HTMLCanvasElement, tint, 0, 0, 8192, 8192, 0, 0, 4000, 4000);
  const initial: ContourInkSource = { terrain: {}, list: canvas.finish() };
  let source: ContourInkSource | null | undefined = initial;
  const raster = {
    prepareSteps: vi.fn(function* () {
      yield;
      yield;
    }),
    warm: vi.fn(() => true),
    replayLive: vi.fn(),
    lastStats: () => ({ drawCalls: 1, triangles: 2, ms: 0.1, clips: 0, ops: 1 }),
    liveTally: () => ({ late: 0, fan: 0, stroke: 0, sprite: 2 }),
    bytes: () => 4096,
    dispose: vi.fn(),
    dropContext: vi.fn(),
  } as unknown as LiveRasterizer;
  vi.mocked(createLiveRasterizer).mockReturnValue(raster);
  const ink = createContourInk({} as WebGL2RenderingContext, () => source)!;
  const frame = (scale = 1, x = 0, dpr = 1): LiveFrame => ({ view: { cx: x, cy: 0, scale }, worldToPixel: [scale * dpr, scale * dpr, -x * scale * dpr, 0], width: 1000, height: 800, quality: 'full' }) as unknown as LiveFrame;
  return {
    initial,
    tint,
    ink,
    raster,
    frame,
    source: (value: typeof source) => {
      source = value;
    },
  };
}

describe('retained overlay contours', () => {
  it('uploads once across tint, zoom, pan and pixel-ratio changes, retaining sprite identity', () => {
    const f = fixture();
    expect(f.ink.work(1000, f.frame())).toBe(false);
    f.ink.draw(f.frame());
    const parts = vi.mocked(f.raster.replayLive).mock.calls[0][0],
      ops = parts[0].list.ops.slice();
    f.tint.rgba = [0.2, 0.3, 0.1, 0.8];
    for (const scale of [0.01, 0.12, 0.8, 1, 4, 32]) {
      const frame = f.frame(scale, 350, 2);
      expect(f.ink.work(1000, frame)).toBe(false);
      f.ink.draw(frame);
      const shown = vi.mocked(f.raster.replayLive).mock.lastCall![0];
      expect(shown[0].list.ops[0]).toBe(ops[0]);
      expect(shown[0].list.ops).toHaveLength(1);
      expect(shown[0].list.ops[0].type).toBe('sprites');
      expect(shown[0].list.ops[0]).toMatchObject({ contourTint: { rgba: [0.2, 0.3, 0.1, 0.8] } });
      expect(shown[0].post).toEqual([scale * 2, 0, 0, scale * 2, -700 * scale, 0]);
    }
    expect(f.raster.prepareSteps).toHaveBeenCalledTimes(1);
    expect(f.ink.stats()).toMatchObject({ drawCalls: 1, late: 0, bytes: 4096, strokeTriangles: 0, spriteTriangles: 2, ops: 1 });
  });

  it('toggles visibility without uploading the retained image again', () => {
    const f = fixture();
    f.ink.work(1000, f.frame());
    f.source(undefined);
    f.ink.work(1000, f.frame());
    f.ink.draw(f.frame());
    expect(f.raster.replayLive).not.toHaveBeenCalled();
    f.source(f.initial);
    f.ink.work(1000, f.frame());
    f.ink.draw(f.frame());
    expect(f.raster.prepareSteps).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.raster.replayLive).mock.lastCall![0][0].list).toBe(f.initial.list);
  });

  it('waits for worker paths and programs, and prepares again only after context loss or terrain replacement', () => {
    const f = fixture();
    f.source(null);
    expect(f.ink.work(1000, f.frame())).toBe(true);
    expect(f.ink.ready()).toBe(false);
    f.source(f.initial);
    vi.mocked(f.raster.warm).mockReturnValueOnce(false);
    expect(f.ink.work(1000, f.frame())).toBe(true);
    expect(f.ink.work(1000, f.frame())).toBe(false);
    f.ink.contextLost();
    expect(f.ink.ready()).toBe(false);
    expect(f.ink.work(1000, f.frame())).toBe(false);
    expect(f.raster.prepareSteps).toHaveBeenCalledTimes(2);
    f.source({ ...f.initial, terrain: {} });
    expect(f.ink.work(1000, f.frame())).toBe(false);
    expect(f.raster.dispose).toHaveBeenCalledOnce();
    expect(f.raster.prepareSteps).toHaveBeenCalledTimes(3);
  });
});
