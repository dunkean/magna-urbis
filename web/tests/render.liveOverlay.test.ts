/** Overlay contract regressions: recording, cache reuse and drape scheduling without a GL context. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOverlayRecording } from '../src/render/live/overlayRecording';
import { createOverlayRegions } from '../src/render/live/overlayRegions';
import { createOverlayLayer } from '../src/render/live/overlayLayer';
import { createLiveRasterizer } from '../src/render/gpu/liveRasterizer';
import type { BakedPrefix, DisplayList, LiveRasterizer } from '../src/render/gpu/contract';
import type { LiveFrame } from '../src/render/live/contract';
import type { DrapeCanvas } from '../src/render/world/contract';

vi.mock('../src/render/gpu/liveRasterizer', () => ({ createLiveRasterizer: vi.fn() }));

function fixture() {
  let now = 0,
    arrivals = 0,
    content = 'map',
    provisional = false;
  const raster: LiveRasterizer = {
    lost: false,
    maxBakeSize: 8192,
    prepare: vi.fn(),
    prepareSteps: vi.fn(function* (list) {
      raster.prepare(list);
      yield;
    }),
    bake: vi.fn((list: DisplayList, density, options): BakedPrefix => {
      options?.between?.({} as WebGLFramebuffer, list.width, list.height, [density, 0, 0, density, 2, 2]);
      return { texture: {}, width: list.width, height: list.height, box: [0, 0, list.width, list.height], bytes: 100 };
    }),
    bakeSteps: vi.fn(function* (list, density, options) {
      yield;
      return raster.bake(list, density, options);
    }),
    releaseBaked: vi.fn(),
    releaseBakeScratch: vi.fn(),
    replayLive: vi.fn(),
    dropContext: vi.fn(),
    bytes: () => 1234,
    lastStats: () => ({ drawCalls: 2, triangles: 4, ms: 1, clips: 1, ops: 2, synced: false }),
    liveTally: () => ({ fan: 3, stroke: 5, sprite: 7, late: 0 }),
    warm: vi.fn(() => true),
    dispose: vi.fn(),
  };
  vi.mocked(createLiveRasterizer).mockReturnValue(raster);
  const host: Parameters<typeof createOverlayLayer>[1] = {
    active: () => true,
    key: (scale, dpr, light) => `${content}|${scale}|${dpr}|${light}`,
    arrivals: () => arrivals,
    plan: (view, _w, _h, dpr, key) => {
      const rect = { minX: view.cx - 100, maxX: view.cx + 100, minY: -100, maxY: 100 };
      return {
        key,
        rect,
        scale: 2 ** (Math.round(2 * Math.log2(view.scale)) / 2),
        dpr,
        bands: [
          { ...rect, maxY: 0 },
          { ...rect, minY: 0 },
        ],
      };
    },
    record: vi.fn((plan, rect) => {
      const w = Math.ceil((rect.maxX - rect.minX) * plan.scale * plan.dpr),
        h = Math.ceil((rect.maxY - rect.minY) * plan.scale * plan.dpr);
      const op = { type: 'clear' as const, transform: [1, 0, 0, 1, 0, 0] as const, clip: null, x: 0, y: 0, w, h };
      const list: DisplayList = { width: w, height: h, ops: [op, op], marks: [{ name: 'crisp', at: 1 }], stats: { calls: 2, ops: 2, paths: 0, sprites: 0, recordMs: 0 } };
      return { list, rect, cx: (rect.minX + rect.maxX) / 2, cy: (rect.minY + rect.maxY) / 2, w, h, provisional };
    }),
    invalidate: vi.fn(),
    warm: vi.fn(() => true),
    now: () => now,
    settleMs: 150,
    maxWaitMs: 1500,
  };
  const gl = new Proxy({}, { get: () => vi.fn() }) as WebGL2RenderingContext;
  const layer = createOverlayLayer(gl, host)!;
  const frame = (cx = 0, scale = 1, moving = false): LiveFrame => ({
    gl,
    view: { cx, cy: 0, scale },
    cssW: 100,
    cssH: 100,
    width: 100,
    height: 100,
    dpr: 1,
    rect: { minX: cx - 50, maxX: cx + 50, minY: -50, maxY: 50 },
    worldToPixel: [scale, scale, 50 - cx * scale, 50],
    worldToClip: new Float32Array(9),
    camera: {} as LiveFrame['camera'],
    drape: undefined,
    target: null,
    now,
    moving,
    quality: 'full',
  });
  const tile = () => ({ rect: { minX: -25, maxX: 25, minY: -25, maxY: 25 }, scale: 1, dpr: 1, light: false, pixels: 50, step: 0, group: vi.fn(() => ({})), putGroup: vi.fn(), put: vi.fn(), provisional: vi.fn() }) satisfies DrapeCanvas;
  return {
    raster,
    host,
    layer,
    frame,
    tile,
    time: (value: number) => {
      now = value;
    },
    arrive: () => {
      arrivals++;
    },
    change: () => {
      content = 'other';
    },
    provisional: () => {
      provisional = true;
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('live overlay layer', () => {
  it('draws retained world ink between area prefixes and suffixes, including motion snapshots', () => {
    const f = fixture(),
      order: string[] = [];
    Object.assign(f.host, { ink: { ready: () => true, work: vi.fn(() => false), draw: () => order.push('ink'), stats: () => ({ drawCalls: 2, triangles: 8, ms: 1, late: 0 }), contextLost: vi.fn(), dispose: vi.fn() } });
    f.layer.work!(10000, f.frame());
    vi.mocked(f.raster.replayLive).mockImplementation(parts => {
      if (parts.every(part => part.list.ops.length === 0)) {
        order.push('prefix');
        expect(parts.every(part => !!part.baked)).toBe(true);
      } else {
        order.push('suffix');
        expect(parts.every(part => part.baked === undefined)).toBe(true);
      }
    });
    f.layer.draw(f.frame());
    expect(order).toEqual(['prefix', 'ink', 'suffix']);
    expect(f.layer.stats!()).toMatchObject({ drawCalls: 6, triangles: 16 });
    // A full snapshot keeps the prefix, world ink, and suffix in order, so moving frames replay one image.
    f.layer.work!(10000, f.frame(0, 1.3));
    expect(vi.mocked(f.raster.bake).mock.calls.some(([, , options]) => !!options?.under && !!options.between)).toBe(true);
    vi.mocked(f.raster.replayLive).mockImplementation(parts => {
      order.push('snapshot');
      expect(parts.every(part => part.list.ops.length === 0 && !!part.baked)).toBe(true);
    });
    order.length = 0;
    f.layer.draw(f.frame(0, 1, true));
    expect(order).toEqual(['snapshot']);
  });

  it('replays retained geometry once when only some bands have full motion snapshots', () => {
    const f = fixture(),
      draw = vi.fn();
    Object.assign(f.host, { ink: { ready: () => true, work: () => false, draw, stats: () => ({ drawCalls: 2, triangles: 8, ms: 1, late: 0 }), contextLost: vi.fn(), dispose: vi.fn() } });
    f.layer.work!(10000, f.frame());
    vi.mocked(f.raster.bake).mockReturnValueOnce(null);
    f.layer.work!(10000, f.frame(0, 1.3));
    draw.mockClear();
    vi.mocked(f.raster.replayLive).mockClear();
    f.layer.draw(f.frame(0, 1, true));
    expect(draw).toHaveBeenCalledOnce();
    expect(f.raster.replayLive).toHaveBeenCalledTimes(2);
    const suffix = vi.mocked(f.raster.replayLive).mock.lastCall![0];
    expect(suffix.every(part => part.baked === undefined && part.list.ops.length > 0)).toBe(true);
    expect(f.layer.stats!().snapshot).toBe(0);
  });

  it('records full bands before presenting, reports the same fields and draws prepared parts', () => {
    const f = fixture(),
      frame = f.frame();
    expect(f.layer.ready(frame)).toBe(false);
    expect(f.layer.work!(10000, frame)).toBe(false);
    expect(f.layer.ready(frame)).toBe(true);
    expect(f.layer.restExact!(frame)).toBe(true);
    expect((globalThis as { __muLiveOverlayWhy?: string }).__muLiveOverlayWhy).toBe('');
    expect(f.host.record).toHaveBeenCalledTimes(2);
    expect(vi.mocked(f.raster.bake).mock.calls.map(call => [call[1], call[2]?.samples])).toEqual([
      [1, 4],
      [1, 4],
    ]);
    f.layer.draw(frame);
    expect(f.layer.stats!()).toMatchObject({
      regions: 1,
      recorded: 2,
      bands: 2,
      baked: 2,
      empty: 0,
      snapshots: 0,
      draft: 0,
      pending: 0,
      bytes: 1234,
      cached: 0,
      cacheBytes: 0,
      drawCalls: 2,
      triangles: 4,
      ms: 1,
      fanTriangles: 3,
      strokeTriangles: 5,
      spriteTriangles: 7,
      lateTotal: 0,
      ratio: 1,
    });
    expect(f.raster.replayLive).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ post: [1, 0, 0, 1, -50, -50], scissor: [-50, -50, 150, 50] })]), null, 100, 100);
  });

  it('restores cached full regions immediately, preparing suffixes without recording', () => {
    const f = fixture();
    f.layer.work!(10000, f.frame());
    f.time(2000);
    expect(f.layer.work!(10000, f.frame(1000))).toBe(true);
    f.time(2200);
    expect(f.layer.work!(10000, f.frame(1000))).toBe(false);
    expect(f.layer.stats!()).toMatchObject({ regions: 2, recorded: 4, cached: 1, cacheBytes: 200 });
    vi.mocked(f.raster.prepare).mockClear();
    f.time(2400);
    expect(f.layer.work!(10000, f.frame())).toBe(false);
    expect(f.raster.prepare).toHaveBeenCalledTimes(2);
    expect(f.host.record).toHaveBeenCalledTimes(4);
    expect(f.layer.stats!()).toMatchObject({ cacheHits: 1, cached: 1, cacheBytes: 200, restoreMs: 0 });
    expect(f.layer.restExact!(f.frame())).toBe(true);
  });

  it('shows a bounded draft during motion and replaces it at rest', () => {
    const f = fixture();
    f.layer.work!(10000, f.frame(0, 1, true));
    expect(vi.mocked(f.raster.bake).mock.calls.every(call => call[2]?.samples === 2)).toBe(true);
    expect(f.layer.restExact!(f.frame())).toBe(false);
    expect((globalThis as { __muLiveOverlayWhy?: string }).__muLiveOverlayWhy).toBe('draft');
    f.time(200);
    f.layer.work!(10000, f.frame());
    expect(f.layer.restExact!(f.frame())).toBe(true);
    expect(f.layer.stats!()).toMatchObject({ regions: 2, recorded: 4, draft: 0, cached: 0 });
    expect(f.raster.releaseBaked).toHaveBeenCalledTimes(2);
  });

  it('keeps a pending recording across a nearby scale bucket and respects work slices', () => {
    const f = fixture();
    expect(f.layer.work!(0, f.frame())).toBe(true);
    expect(f.host.record).toHaveBeenCalledTimes(1);
    f.time(10);
    f.layer.work!(10000, f.frame(0, Math.SQRT2, true));
    expect(f.host.record).toHaveBeenCalledTimes(2);
    expect(f.layer.ready(f.frame(0, Math.SQRT2))).toBe(true);
    expect(f.layer.stats!().regions).toBe(1);
  });

  it('makes snapshots ahead of far replay and draws the snapshot quads', () => {
    const f = fixture();
    f.layer.work!(10000, f.frame());
    f.time(10);
    f.layer.work!(10000, f.frame(0, 2, true));
    expect(f.layer.stats!()).toMatchObject({ snapshots: 2, pending: 0 });
    expect(
      vi
        .mocked(f.raster.bake)
        .mock.calls.slice(2)
        .every(call => call[2]?.samples === 2 && !!call[2]?.under),
    ).toBe(true);
    f.layer.draw(f.frame(0, 2, true));
    expect(f.layer.stats!()).toMatchObject({ snapshot: 1, replayedFar: 0, ratio: 2 });
    const parts = vi.mocked(f.raster.replayLive).mock.calls.at(-1)![0];
    expect(parts.every(part => part.list.ops.length === 0 && !!part.baked)).toBe(true);
  });

  it('reuses existing snapshots near their recorded scale only during motion, without baking in draw', () => {
    const f = fixture();
    f.layer.work!(10000, f.frame());
    f.time(10);
    f.layer.work!(10000, f.frame(0, 2, true));
    vi.mocked(f.raster.bake).mockClear();
    vi.mocked(f.raster.prepare).mockClear();
    f.layer.draw(f.frame(0, 1, true));
    let parts = vi.mocked(f.raster.replayLive).mock.calls.at(-1)![0];
    expect(parts.every(part => part.list.ops.length === 0 && !!part.baked)).toBe(true);
    expect(f.raster.bake).not.toHaveBeenCalled();
    expect(f.raster.prepare).not.toHaveBeenCalled();
    expect(f.layer.restExact!(f.frame())).toBe(true);
    f.layer.draw(f.frame());
    parts = vi.mocked(f.raster.replayLive).mock.calls.at(-1)![0];
    expect(parts.every(part => part.list.ops.length > 0)).toBe(true);
    expect(f.layer.stats!().snapshot).toBe(0);
  });

  it('latches an unrecordable key until invalidation', () => {
    const f = fixture();
    vi.mocked(f.host.record).mockReturnValue(undefined);
    expect(f.layer.work!(10000, f.frame())).toBe(false);
    expect(f.layer.work!(10000, f.frame())).toBe(false);
    expect(f.host.record).toHaveBeenCalledTimes(1);
    f.layer.invalidate!();
    f.layer.work!(10000, f.frame());
    expect(f.host.record).toHaveBeenCalledTimes(2);
  });

  it('rebuilds provisional regions when their missing products arrive', () => {
    const f = fixture();
    f.provisional();
    f.layer.work!(10000, f.frame());
    expect(f.layer.restExact!(f.frame())).toBe(true);
    f.arrive();
    expect(f.layer.restExact!(f.frame())).toBe(false);
    expect((globalThis as { __muLiveOverlayWhy?: string }).__muLiveOverlayWhy).toBe('provisional');
    f.layer.work!(10000, f.frame());
    expect(f.layer.stats!().regions).toBe(2);
  });

  it('lets matching drape tiles wait for and reuse the pending top-view region', () => {
    const f = fixture(),
      tile = f.tile();
    f.layer.work!(0, f.frame());
    expect(f.layer.drape!.ready(tile)).toBe(false);
    f.layer.work!(10000, f.frame());
    const recorded = vi.mocked(f.host.record).mock.calls.length;
    expect(f.layer.drape!.ready(tile)).toBe(true);
    expect(f.layer.drape!.paint(tile)).toBe(false);
    expect(f.host.record).toHaveBeenCalledTimes(recorded);
    expect(tile.putGroup).toHaveBeenCalledWith(1);
    expect(f.raster.replayLive).toHaveBeenCalledWith(expect.any(Array), expect.any(Object), 50, 50);
    const revision = f.layer.drape!.revision();
    f.layer.invalidate!();
    expect(f.layer.drape!.revision()).toBe(revision + 1);
    f.change();
    expect(f.layer.drape!.revision()).toBe(revision + 2);
  });

  it('records independent drape tiles in whole-row bands and releases each bake', () => {
    const f = fixture(),
      tile = f.tile();
    tile.rect = { minX: 500, maxX: 600, minY: 500, maxY: 600 };
    expect(f.layer.drape!.paint(tile)).toBe(true);
    expect(vi.mocked(f.host.record).mock.calls[0][1]).toEqual({ minX: 500, maxX: 600, minY: 500, maxY: 548 });
    tile.step = 1;
    let more = true;
    for (let i = 0; more && i < 20; i++) more = f.layer.drape!.paint(tile) === true;
    expect(more).toBe(false);
    expect(f.raster.releaseBaked).toHaveBeenCalledTimes(vi.mocked(f.host.record).mock.calls.length);
    expect(tile.put).toHaveBeenCalled();
  });

  it('keeps rendering decisions independent of probe fields and supports recording without a sink', () => {
    const f = fixture();
    f.layer.work!(10000, f.frame());
    Object.assign(f.layer.stats!(), { failed: 1, pending: 1, draft: 1, bands: 0, cached: 99 });
    (globalThis as { __muLiveOverlayWhy?: string }).__muLiveOverlayWhy = 'external probe write';
    expect(f.layer.ready(f.frame())).toBe(true);
    expect(f.layer.restExact!(f.frame())).toBe(true);
    expect(f.layer.work!(10000, f.frame())).toBe(false);
    expect(f.host.record).toHaveBeenCalledTimes(2);

    const retained = createOverlayRegions(f.raster, f.host);
    const recording = createOverlayRecording(f.raster, f.host, retained);
    recording.track(f.frame(), 0);
    expect(recording.work(f.frame(), 0, 10000)).toBe(false);
    expect(retained.shown?.draft).toBe(false);
    expect(retained.shown?.parts.length).toBe(2);
    expect(f.host.record).toHaveBeenCalledTimes(4);
  });

  it('does no top-view recording, snapshots or host warming in a tilted frame, including motion', () => {
    const f = fixture();
    f.layer.work!(10000, f.frame());
    vi.mocked(f.host.record).mockClear();
    vi.mocked(f.raster.bake).mockClear();
    vi.mocked(f.host.warm).mockClear();
    for (const moving of [true, false]) {
      const frame = { ...f.frame(10000, 8, moving), camera: { tilted: true } as LiveFrame['camera'] };
      expect(f.layer.work!(10000, frame)).toBe(false);
    }
    expect(f.host.record).not.toHaveBeenCalled();
    expect(f.raster.bake).not.toHaveBeenCalled();
    expect(f.host.warm).not.toHaveBeenCalled();
  });

  it('cancels an unfinished recording on a new tile without painting its partial list', () => {
    const f = fixture(),
      tile = f.tile(),
      cancelled = vi.fn();
    tile.rect = { minX: 500, maxX: 600, minY: 500, maxY: 600 };
    f.host.recordSteps = function* () {
      try {
        for (;;) yield;
      } finally {
        cancelled();
      }
    };
    expect(f.layer.drape!.paint(tile)).toBe(true);
    tile.rect = { minX: 600, maxX: 700, minY: 500, maxY: 600 };
    expect(f.layer.drape!.paint(tile)).toBe(true);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(tile.put).not.toHaveBeenCalled();
    expect(f.raster.bake).not.toHaveBeenCalled();
    f.layer.dispose();
    expect(cancelled).toHaveBeenCalledTimes(2);
  });

  it('forgets resources on context loss without deleting their dead handles', () => {
    const f = fixture();
    f.layer.work!(10000, f.frame());
    f.layer.contextLost!();
    expect(f.raster.releaseBaked).not.toHaveBeenCalled();
    expect(f.raster.dropContext).toHaveBeenCalledTimes(1);
    expect(f.layer.ready(f.frame())).toBe(false);
    f.layer.work!(10000, f.frame());
    expect(f.layer.ready(f.frame())).toBe(true);
    expect(f.layer.stats!()).toMatchObject({ regions: 2, failed: 0 });
  });
});
