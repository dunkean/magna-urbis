/** Rest-plan preparation shares the compositor's nonblocking GPU queue limit. */
import { afterEach, expect, it, vi } from 'vitest';
import { createLiveCompositor } from '../src/render/live/compositor';
import { liveStats } from '../src/render/live/liveStats';

vi.mock('../src/render/live/gpuTimer', () => ({ createGpuTimer: () => ({ init() {}, poll() {}, begin() {}, end() {}, contextLost() {}, dispose() {} }) }));
vi.mock('../src/render/live/rasterQuad', () => ({ createRasterQuad: () => ({ draw() {}, dispose() {} }), dropRaster() {}, uploadRaster() {} }));
vi.mock('../src/render/live/isolatedGroup', () => ({ createIsolatedGroup: () => ({ probe() {}, ensure: () => true, target: { fbo: {}, resolve: {}, texture: {} }, drop() {}, contextLost() {}, failed: false }) }));
vi.mock('../src/render/world/mapDrape', () => ({
  MapDrape: class {
    stats = {};
    tiles = {};
    work() {
      return false;
    }
    forget() {}
    contextLost() {}
    dispose() {}
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture() {
  let now = 0,
    behind = true;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const constants = new Map<PropertyKey, number>();
  const calls = {
    isContextLost: () => false,
    getExtension: () => null,
    getParameter: (key: number) => (key === gl.RENDERER ? 'NVIDIA RTX 5090' : key === gl.MAX_SAMPLES ? 4 : 8192),
    fenceSync: vi.fn(() => ({})),
    clientWaitSync: vi.fn(() => (behind ? gl.TIMEOUT_EXPIRED : gl.ALREADY_SIGNALED)),
    deleteSync: vi.fn(),
    flush: vi.fn(),
  };
  const gl = new Proxy(calls, {
    get(target, key) {
      if (key in target) return target[key as keyof typeof calls];
      if (/^[A-Z_0-9]+$/.test(String(key))) {
        if (!constants.has(key)) constants.set(key, constants.size + 1);
        return constants.get(key);
      }
      return () => {};
    },
  }) as unknown as WebGL2RenderingContext;
  const canvas = Object.assign(new EventTarget(), { style: {}, getContext: () => gl, remove() {} });
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('requestIdleCallback', () => 1);
  vi.stubGlobal('cancelIdleCallback', () => {});
  const compositor = createLiveCompositor({ invalidate() {}, quality: () => 'full', relief: () => undefined, mapSize: () => 1000, restPending: () => true })!;
  const work = vi.fn(() => {
    now += 1;
    return false;
  });
  compositor.setLayer('overlay', { name: 'overlay', ready: () => true, work, draw() {}, dispose() {} });
  return {
    compositor,
    work,
    calls,
    complete: () => {
      behind = false;
    },
  };
}

it('keeps a rest layer pending until the preceding preparation has reached the GPU', () => {
  const f = fixture();
  try {
    expect(f.compositor.advanceLayer('overlay', 2)).toBe(false);
    expect(f.calls.fenceSync).toHaveBeenCalledOnce();
    expect(f.calls.flush).toHaveBeenCalledOnce();
    expect(f.compositor.advanceLayer('overlay', 2)).toBe(true);
    expect(f.work).toHaveBeenCalledOnce();
    expect(liveStats().pending.overlay).toBe(true);
    expect(f.calls.clientWaitSync).toHaveBeenLastCalledWith(expect.anything(), 0, 0);
    f.complete();
    expect(f.compositor.advanceLayer('overlay', 2)).toBe(false);
    expect(f.work).toHaveBeenCalledTimes(2);
    expect(f.calls.deleteSync).toHaveBeenCalledOnce();
    expect(liveStats().pending.overlay).toBe(false);
  } finally {
    f.compositor.dispose();
  }
});

it('also holds frame preparation behind a rest-plan submission', () => {
  const f = fixture();
  try {
    f.compositor.advanceLayer('overlay', 2);
    f.compositor.draw({ cx: 500, cy: 500, scale: 1 }, 800, 600, 1, false);
    expect(f.work).toHaveBeenCalledOnce();
    f.complete();
    f.compositor.draw({ cx: 500, cy: 500, scale: 1 }, 800, 600, 1, false);
    expect(f.work).toHaveBeenCalledTimes(2);
  } finally {
    f.compositor.dispose();
  }
});
