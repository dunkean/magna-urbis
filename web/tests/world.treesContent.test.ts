import { afterEach, describe, expect, it, vi } from 'vitest';
import { TreeContent, treeSamplesMatch } from '../src/render/world/treesContent';
import { treeBlockSteps } from '../src/render/world/treesBlocks';
import { treeBuildings } from '../src/render/world/treesBuildings';
import { createWorldTreesLayer } from '../src/render/world/treesLayer';
import { TerrainHeights } from '../src/render/world/heights';
import { createFrameCamera, frameCamera } from '../src/render/world/camera';
import type { LiveFrame } from '../src/render/live/contract';
import type { Building3dScene } from '../src/render/urbanBuildingGeometry';
import type { TreeInputs } from '../src/ui/terrain3dTrees';

function stand(): TreeInputs {
  const n = 128,
    rgba = new Uint8Array(n * n * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([235, 110, 80, 255], i);
  return { field: { x: 0, y: 0, width: 2400, n, rgba, key: 'landscape' }, seed: 5, climate: { temperature: 10, precipitation: 900 }, renderV2: 1, zone: 0, season: 0.5, water: () => 0, height: () => 20 };
}
function build(inputs: TreeInputs, bx = 12, by = 12) {
  const steps = treeBlockSteps(inputs, bx, by);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
afterEach(() => vi.unstubAllGlobals());

describe('tree block content', () => {
  it('ignores global keys and callback identities but catches local field, bank, beach and season edits', () => {
    const inputs = stand(),
      original = new TreeContent(inputs).key(12, 12);
    expect(new TreeContent({ ...inputs, field: { ...inputs.field, rgba: inputs.field.rgba.slice(), key: 'another-stage' }, water: () => 0 }).key(12, 12)).toBe(original);
    const rgba = inputs.field.rgba.slice();
    rgba[0] = 0;
    expect(new TreeContent({ ...inputs, field: { ...inputs.field, rgba } }).key(12, 12)).toBe(original);
    rgba[(64 * 128 + 64) * 4] = 0;
    expect(new TreeContent({ ...inputs, field: { ...inputs.field, rgba } }).key(12, 12)).not.toBe(original);
    expect(new TreeContent({ ...inputs, season: 0.75 }).key(12, 12)).not.toBe(original);
    const bank = new Uint8Array(rgba.length),
      beach = { x: 0, y: 0, width: 2400, n: 128, data: new Uint8Array(128 * 128) };
    const before = new TreeContent({ ...inputs, field: { ...inputs.field, bank, beach } }).key(12, 12);
    const afterBank = bank.slice();
    afterBank[(64 * 128 + 64) * 4 + 2] = 50;
    expect(new TreeContent({ ...inputs, field: { ...inputs.field, bank: afterBank, beach } }).key(12, 12)).not.toBe(before);
    const afterBeach = beach.data.slice();
    afterBeach[64 * 128 + 64] = 255;
    expect(new TreeContent({ ...inputs, field: { ...inputs.field, bank, beach: { ...beach, data: afterBeach } } }).key(12, 12)).not.toBe(before);
  });

  it('records water-rejected candidates, including blocks with no surviving tree', () => {
    const dry = stand(),
      wet = { ...dry, water: () => 1 },
      block = build(wet);
    expect(block.count).toBe(0);
    expect(block.samples.water.length).toBeGreaterThan(0);
    expect(treeSamplesMatch(block.samples, { ...wet, water: () => 1 })).toBe(true);
    expect(treeSamplesMatch(block.samples, dry)).toBe(false);
    const trees = build(dry);
    expect(trees.count).toBeGreaterThan(0);
    expect(treeSamplesMatch(trees.samples, { ...dry, height: () => 21 })).toBe(false);
    expect(treeSamplesMatch(trees.samples, { ...dry, height: () => undefined })).toBe(false);
  });

  it('limits footprint invalidation to nearby blocks and includes courtyard changes', () => {
    const inputs = stand(),
      shape = {
        outer: [
          { x: 1160, y: 1160 },
          { x: 1180, y: 1160 },
          { x: 1180, y: 1180 },
          { x: 1160, y: 1180 },
        ],
        holes: [],
      };
    const scene = { buildings: [{ footprint: [shape] }], materials: [] } as unknown as Building3dScene;
    const before = new TreeContent(inputs),
      after = new TreeContent(inputs, treeBuildings(scene));
    expect(after.key(12, 12)).not.toBe(before.key(12, 12));
    expect(after.key(3, 3)).toBe(before.key(3, 3));
  });

  it('retains installed buffers during validation and a changed replacement, with no frame-time sampling', () => {
    vi.stubGlobal('__muLayerDiagnostics', true);
    let inputs = stand();
    let heights = new TerrainHeights(new Float32Array(64 * 64).fill(20), 64, 2400, 0, 1);
    const gl = new Proxy({} as WebGL2RenderingContext, {
      get: (t, n) => {
        const target = t as unknown as Record<string | symbol, unknown>;
        return (target[n] ??= String(n).startsWith('get') ? vi.fn(() => true) : String(n).startsWith('create') ? vi.fn(() => ({})) : vi.fn());
      },
    });
    const layer = createWorldTreesLayer(gl, { inputs: () => inputs, terrain: () => heights, distance: () => 600, shown: () => true, invalidate: () => {} });
    const view = { cx: 1200, cy: 1200, scale: 4, pitch: 0.3, yaw: 0 },
      camera = createFrameCamera();
    frameCamera(camera, view, 1600, 900, 1600, 900, 1, heights);
    const frame = { gl, view, cssW: 1600, cssH: 900, dpr: 1, width: 1600, height: 900, camera, moving: false } as unknown as LiveFrame;
    const settle = () => {
      for (let i = 0; i < 4; i++) {
        layer.draw(frame);
        while (layer.work!(8, frame));
      }
      layer.draw(frame);
    };
    settle();
    const built = layer.stats!().built,
      calls = layer.stats!().drawCalls,
      uploads = vi.mocked(gl.bufferData).mock.calls.length;
    expect(built).toBeGreaterThan(0);
    expect(calls).toBeGreaterThan(0);
    const water = vi.fn(() => 0);
    inputs = { ...inputs, water, field: { ...inputs.field, rgba: inputs.field.rgba.slice(), key: 'settlements' } };
    heights = new TerrainHeights(heights.data.slice(), 64, 2400, 0, 1);
    layer.work!(0, frame);
    layer.draw(frame);
    expect(layer.stats!().drawCalls).toBe(calls);
    expect(vi.mocked(gl.deleteBuffer)).not.toHaveBeenCalled();
    settle();
    expect(layer.stats!().built).toBe(built);
    expect(vi.mocked(gl.bufferData).mock.calls.length).toBe(uploads);
    water.mockClear();
    layer.draw(frame);
    expect(water).not.toHaveBeenCalled();
    inputs = { ...inputs, season: 0.75 };
    layer.work!(0.001, frame);
    layer.draw(frame);
    expect(layer.stats!().drawCalls).toBe(calls);
    settle();
    expect(layer.stats!().built).toBeGreaterThan(built);
    expect(vi.mocked(gl.deleteBuffer)).toHaveBeenCalled();
    layer.dispose!();
  });
});
