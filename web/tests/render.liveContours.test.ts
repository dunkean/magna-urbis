import { describe, expect, it, vi } from 'vitest';
import { createContourInk, type ContourInkSource } from '../src/render/live/contourInk';
import { createLiveRasterizer } from '../src/render/gpu/liveRasterizer';
import { RecordingCanvas } from '../src/render/gpu/recorder';
import { RecOnlyPath2D } from '../src/render/gpu/path';
import type { LiveRasterizer } from '../src/render/gpu/contract';
import type { LiveFrame } from '../src/render/live/contract';

vi.mock('../src/render/gpu/liveRasterizer', () => ({ createLiveRasterizer: vi.fn() }));

function fixture() {
  const path = new RecOnlyPath2D();
  path.moveTo(0, 0);
  path.lineTo(20, 30);
  const canvas = new RecordingCanvas(1, 1),
    ctx = canvas.getContext('2d')!;
  ctx.lineWidth = 1;
  ctx.stroke(path);
  ctx.lineWidth = 2;
  ctx.stroke(path);
  const initial: ContourInkSource = { terrain: {}, list: canvas.finish(), color: [0.3, 0.2, 0.1, 1], opacity: 0.4, thinWeight: 1, indexWeight: 1 };
  let source: ContourInkSource | null | undefined = initial;
  const raster = {
    prepareSteps: vi.fn(function* () {
      yield;
      yield;
    }),
    warm: vi.fn(() => true),
    replayLive: vi.fn(),
    lastStats: () => ({ drawCalls: 2, triangles: 4, ms: 0.1, clips: 0, ops: 2 }),
    liveTally: () => ({ late: 0, fan: 0, stroke: 4, sprite: 0 }),
    bytes: () => 4096,
    dispose: vi.fn(),
    dropContext: vi.fn(),
  } as unknown as LiveRasterizer;
  vi.mocked(createLiveRasterizer).mockReturnValue(raster);
  const ink = createContourInk({} as WebGL2RenderingContext, () => source)!;
  const frame = (scale = 1, x = 0, dpr = 1): LiveFrame => ({ view: { cx: x, cy: 0, scale }, worldToPixel: [scale * dpr, scale * dpr, -x * scale * dpr, 0], width: 1000, height: 800, quality: 'full' }) as unknown as LiveFrame;
  return {
    initial,
    ink,
    raster,
    frame,
    source: (value: typeof source) => {
      source = value;
    },
  };
}

describe('retained overlay contours', () => {
  it('uploads once across arbitrary zoom, pan and pixel-ratio changes, retaining op and path identity', () => {
    const f = fixture();
    expect(f.ink.work(1000, f.frame())).toBe(false);
    f.ink.draw(f.frame());
    const parts = vi.mocked(f.raster.replayLive).mock.calls[0][0],
      ops = parts[0].list.ops.slice();
    for (const scale of [0.01, 0.12, 0.8, 1, 4, 32]) {
      const frame = f.frame(scale, 350, 2);
      expect(f.ink.work(1000, frame)).toBe(false);
      f.ink.draw(frame);
      const shown = vi.mocked(f.raster.replayLive).mock.lastCall![0];
      expect(shown[0].list.ops[0]).toBe(ops[0]);
      expect(shown[0].list.ops[1]).toBe(ops[1]);
      expect(shown[0].post).toEqual([scale * 2, 0, 0, scale * 2, -700 * scale, 0]);
    }
    expect(f.raster.prepareSteps).toHaveBeenCalledTimes(1);
    expect(f.ink.stats()).toMatchObject({ drawCalls: 2, late: 0, bytes: 4096, strokeTriangles: 4, ops: 2 });
  });

  it('changes the look and toggles visibility without preparing geometry again', () => {
    const f = fixture();
    f.ink.work(1000, f.frame());
    f.source(undefined);
    f.ink.work(1000, f.frame());
    f.ink.draw(f.frame());
    expect(f.raster.replayLive).not.toHaveBeenCalled();
    f.source({ ...f.initial, color: [1, 0, 0, 1], opacity: 0.2 });
    f.ink.work(1000, f.frame());
    f.ink.draw(f.frame());
    expect(f.raster.prepareSteps).toHaveBeenCalledTimes(1);
    const op = vi.mocked(f.raster.replayLive).mock.lastCall![0][0].list.ops[1];
    expect(op.type === 'stroke' && op.paint).toEqual({ kind: 'color', rgba: [1, 0, 0, 1] });
    expect(op.type === 'stroke' && op.alpha).toBe(0.2);
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
