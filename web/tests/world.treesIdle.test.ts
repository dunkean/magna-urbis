import { expect, it, vi } from 'vitest';
import type { LiveFrame } from '../src/render/live/contract';
import { createFrameCamera, frameCamera } from '../src/render/world/camera';
import { TerrainHeights } from '../src/render/world/heights';
import type { TreeBlock } from '../src/render/world/treesBlocks';
import { createWorldTreesLayer } from '../src/render/world/treesLayer';
import { treeTriangleBudget } from '../src/render/world/treesRange';
import { TREE_STRIDE, type TreeInputs } from '../src/ui/terrain3dTrees';

// Use dense blocks to exercise the triangle ceiling while the real layer streams one block per slice.
vi.mock('../src/render/world/treesBlocks', async importOriginal => {
  const original = await importOriginal<typeof import('../src/render/world/treesBlocks')>();
  const { TREE_STRIDE } = await import('../src/ui/terrain3dTrees');
  const count = 6000,
    data = new Float32Array(count * TREE_STRIDE);
  for (let i = 0; i < count; i++) data.set([i % 96, Math.floor(i / 96), 20, 2, 15], i * TREE_STRIDE);
  const samples = { water: new Float64Array(), height: new Float64Array() };
  const block: TreeBlock = { data, count, samples },
    sparse: TreeBlock = { data: data.subarray(0, 100 * TREE_STRIDE), count: 100, samples };
  return {
    ...original,
    treeBlockSteps: function* (_inputs: TreeInputs, bx: number, by: number) {
      yield;
      return (bx + by) % 3 ? block : sparse;
    },
  };
});

it('keeps the submitted trees and their detail as neighbours stream in, then draws identical ranges for 1200 idle frames', () => {
  type Vao = { id: number; first: number };
  let clock = 0,
    id = 0,
    vao: Vao | null = null,
    level = 0,
    opacity = 0;
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  // Each VAO identifies one real streamed instance buffer. Record the first and last instance at each mesh level.
  const ranges = new Map<number, number[]>();
  const gl = new Proxy(
    {
      createVertexArray: () => ({ id: ++id, first: 0 }),
      bindVertexArray: (next: Vao | null) => {
        vao = next;
      },
      getProgramParameter: () => true,
      getUniformLocation: (_: unknown, name: string) => name,
      uniform1i: (name: string, value: number) => {
        if (name === 'uSegments') level = value;
      },
      uniform4f: (name: string, _x: number, _y: number, _z: number, w: number) => {
        if (name === 'uBlock') opacity = w;
      },
      bufferData: () => {
        if (vao) clock += 2;
      },
      vertexAttribPointer: (a: number, _n: number, _t: number, _s: boolean, _stride: number, offset: number) => {
        if (vao && a === 0) vao.first = offset / (TREE_STRIDE * 4);
      },
      drawElementsInstanced: (_mode: number, _indices: number, _type: number, _offset: number, count: number) => {
        const block = vao!;
        const end = block.first + count,
          prefix = ranges.get(block.id) ?? [0, 0, 0, opacity];
        if (block.first !== prefix[0]) throw new Error('Noncontiguous instance range');
        prefix[0] = end;
        if (level >= 4) prefix[1] = end;
        if (level === 6) prefix[2] = end;
        ranges.set(block.id, prefix);
      },
    } as Record<string, unknown>,
    { get: (target, name: string) => target[name] ?? (name.startsWith('create') ? () => ({}) : () => undefined) },
  ) as unknown as WebGL2RenderingContext;
  const heights = new TerrainHeights(new Float32Array(16).fill(20), 4, 2400, 0, 1),
    inputs: TreeInputs = { field: { x: 0, y: 0, width: 2400, n: 1, rgba: new Uint8Array([235, 110, 80, 255]), key: 'forest' }, seed: 5, climate: { temperature: 10, precipitation: 900 }, renderV2: 1, zone: 0, season: 0.5, water: () => 0, height: () => 20 },
    layer = createWorldTreesLayer(gl, { inputs: () => inputs, terrain: () => heights, distance: () => 600, shown: () => true, invalidate: () => {} }),
    camera = createFrameCamera(),
    view = { cx: 1200, cy: 1200, scale: 4, pitch: 0.3, yaw: 0 };
  frameCamera(camera, view, 1600, 900, 1600, 900, 1, heights);
  const frame = { gl, view, cssW: 1600, cssH: 900, width: 1600, height: 900, dpr: 1, camera } as unknown as LiveFrame;
  try {
    let previous = new Map<number, number[]>(),
      grew = 0,
      pending = false,
      hadSolidCrowns = false;
    // The clock advances past the slice deadline on each upload, exposing every intermediate draw.
    for (let i = 0; i < 180; i++) {
      ranges.clear();
      layer.draw(frame);
      pending ||= layer.pendingPresentation();
      hadSolidCrowns ||= [...ranges.values()].some(prefix => prefix[1] > 0);
      for (const [key, prefix] of previous) {
        const next = ranges.get(key);
        if (!next || next[0] !== prefix[0] || next[1] !== prefix[1] || next[2] !== prefix[2]) throw new Error('An already presented VAO changed its instance range or detail while idle');
        if (next[3] < prefix[3]) throw new Error('A streaming VAO faded out while idle');
      }
      if (ranges.size > previous.size) grew++;
      expect(layer.stats!().triangles).toBeLessThanOrEqual(treeTriangleBudget(600));
      previous = new Map(ranges);
      layer.work!(1, frame);
      clock += 16;
    }
    expect(grew).toBeGreaterThan(4);
    expect(pending).toBe(true);
    expect(layer.pendingPresentation()).toBe(false);
    expect(hadSolidCrowns).toBe(true); // Triangle pressure cannot force every close tree to a card.
    const stable = JSON.stringify([...ranges]);
    for (let i = 0; i < 1200; i++) {
      ranges.clear();
      layer.draw(frame);
      if (JSON.stringify([...ranges]) !== stable) throw new Error('Idle GPU instance ranges changed');
      if (layer.work!(1, frame)) throw new Error('Warm idle forest scheduled work');
      if (layer.pendingPresentation()) throw new Error('Warm idle forest still marked pending');
      clock += 32;
    }
  } finally {
    layer.dispose();
    now.mockRestore();
  }
});
