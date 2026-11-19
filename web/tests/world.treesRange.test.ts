import { describe, expect, it, vi } from 'vitest';
import type { LiveFrame } from '../src/render/live/contract';
import { createFrameCamera, frameCamera } from '../src/render/world/camera';
import { TerrainHeights } from '../src/render/world/heights';
import { createWorldTreesLayer } from '../src/render/world/treesLayer';
import { TREE_MAX_BLOCKS, treeMemoryBudget, treeTriangleBudget } from '../src/render/world/treesRange';
import { TREE_DISTANCE_DEFAULT, TREE_DISTANCE_MAX, clampTreeDistance, type TreeInputs } from '../src/ui/terrain3dTrees';

function glMock(): WebGL2RenderingContext {
  return new Proxy({} as WebGL2RenderingContext, {
    get(target, name) {
      const t = target as unknown as Record<string | symbol, unknown>;
      return (t[name] ??= name === 'getProgramParameter' ? vi.fn(() => true) : String(name).startsWith('create') || name === 'getUniformLocation' ? vi.fn(() => ({})) : vi.fn());
    },
  });
}

describe('world tree range', () => {
  it('preserves the default and scales triangles, blocks and GPU memory for the extended range', () => {
    expect(TREE_DISTANCE_DEFAULT).toBe(600);
    expect(TREE_DISTANCE_MAX).toBeGreaterThan(1500);
    expect(clampTreeDistance(Infinity)).toBe(600);
    expect(clampTreeDistance(100000)).toBe(TREE_DISTANCE_MAX);
    expect(treeTriangleBudget(600)).toBe(250000);
    expect(treeTriangleBudget(TREE_DISTANCE_MAX)).toBeLessThanOrEqual(2100000);
    expect(treeTriangleBudget(TREE_DISTANCE_MAX)).toBeGreaterThan(2000000);
    expect(treeMemoryBudget(600)).toBe(16 * 1024 ** 2);
    expect(treeMemoryBudget(TREE_DISTANCE_MAX)).toBeGreaterThan(treeMemoryBudget(1500));
    expect(TREE_MAX_BLOCKS).toBeGreaterThan((2 * Math.PI * TREE_DISTANCE_MAX ** 2) / 96 ** 2);
  });

  it('does no hidden work, suspends pending blocks before a hidden draw and reuses the cache on return', () => {
    const gl = glMock(),
      heights = new TerrainHeights(new Float32Array(16).fill(100), 4, 40000, 0, 1),
      camera = createFrameCamera(),
      inputs: TreeInputs = { field: { x: 0, y: 0, width: 40000, n: 1, rgba: new Uint8Array([235, 100, 100, 255]), key: 'stand' }, seed: 5, climate: { temperature: 10, precipitation: 900 }, renderV2: 1, zone: 0, season: 0.5, water: () => 0, height: () => 100 };
    let shown = false;
    const source = vi.fn(() => inputs),
      layer = createWorldTreesLayer(gl, { inputs: source, terrain: () => heights, distance: () => 600, shown: () => shown, invalidate: () => {} });
    const view = (scale: number, cx = 20000): LiveFrame => {
      const view = { cx, cy: 20000, scale, pitch: 0.96, yaw: 0.3 };
      frameCamera(camera, view, 1600, 900, 1600, 900, 1, heights);
      return { gl, camera, view, cssW: 1600, cssH: 900, width: 1600, height: 900, dpr: 1 } as unknown as LiveFrame;
    };
    let frame = view(8);
    expect(layer.work!(8, frame)).toBe(false);
    expect(source).not.toHaveBeenCalled();
    shown = true;
    for (let pass = 0; pass < 4; pass++) {
      layer.draw(frame);
      while (layer.work!(8, frame));
    }
    layer.draw(frame);
    expect(layer.stats!().drawCalls).toBeGreaterThan(0);
    expect(layer.stats!().triangles).toBeLessThanOrEqual(treeTriangleBudget(600));
    const bytes = layer.stats!().bytes,
      uploads = vi.mocked(gl.bufferData).mock.calls.length;
    // Request uncached blocks, then zoom out before work gets to process that request.
    layer.draw(view(8, 21000));
    frame = view(0.3);
    expect(layer.work!(Infinity, frame)).toBe(false);
    layer.draw(frame);
    expect(layer.stats!().drawCalls).toBe(0);
    expect(layer.stats!().opacity).toBe(0);
    expect(layer.stats!().bytes).toBe(bytes);
    expect(vi.mocked(gl.bufferData).mock.calls.length).toBe(uploads);
    frame = view(8);
    layer.draw(frame);
    while (layer.work!(8, frame));
    layer.draw(frame);
    expect(layer.stats!().drawCalls).toBeGreaterThan(0);
    expect(vi.mocked(gl.bufferData).mock.calls.length).toBe(uploads);
    shown = false;
    expect(layer.work!(Infinity, frame)).toBe(false);
    layer.dispose();
  });
});
