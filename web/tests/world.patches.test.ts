import { describe, expect, it } from 'vitest';
import { createFrameCamera, frameCamera } from '../src/render/world/camera';
import { drapeTier } from '../src/render/world/footprint';
import { TerrainHeights } from '../src/render/world/heights';
import { MAX_PATCHES, PatchList, lodEyeHeight, morphStart, patchLevels, patchRatio, selectPatches, type PatchQuery } from '../src/render/world/patches';
import type { View } from '../src/render/view';

const W = 1600,
  H = 900,
  MAP = 40000,
  LEVELS = patchLevels(2048);

function selection(view: View, ratio = 3) {
  const camera = createFrameCamera();
  frameCamera(camera, view, W, H, W, H, 1);
  const query: PatchQuery = { mapSize: MAP, levels: LEVELS, ratio, low: 0, high: 0, tanX: W / (2 * camera.focal), tanY: H / (2 * camera.focal) },
    list = new PatchList();
  selectPatches(list, camera, query);
  return { camera, query, list };
}
/** Side of the squares of a tier. */
const side = (tier: number): number => MAP / 2 ** tier;

describe('terrain patches', () => {
  it('has as many levels as the height grid has detail', () => {
    // 2048 heights: the finest cell is half a height cell, 64 of them per node, so 2048 / 32 = 64 = 2^6 nodes across.
    expect(patchLevels(2048)).toBe(7);
    expect(patchLevels(1024)).toBe(6);
    expect(patchLevels(16)).toBe(1);
  });

  it('covers what the camera sees once, with a bounded number of squares', () => {
    for (const view of [
      { cx: 20000, cy: 20000, scale: 0.02, pitch: 0.2 },
      { cx: 14000, cy: 26000, scale: 0.4, pitch: 1.0, yaw: 0.6 },
      { cx: 31000, cy: 9000, scale: 6, pitch: 1.22, yaw: -2.2 },
      { cx: 20000, cy: 20000, scale: 100, pitch: 1.22, yaw: 3 },
    ] as View[]) {
      const { camera, list } = selection(view);
      expect(list.overflow).toBe(false);
      expect(list.count).toBeGreaterThan(0);
      expect(list.count).toBeLessThan(400);
      expect(list.count).toBeLessThanOrEqual(MAX_PATCHES);
      // Ground points across the screen, back from their pixels: each lies in exactly one square.
      const { eye, right, up, forward, target } = camera;
      for (let sy = 0.02; sy < 1; sy += 0.12)
        for (let sx = 0.02; sx < 1; sx += 0.12) {
          const u = ((sx - 0.5) * W) / camera.focal,
            v = ((0.5 - sy) * H) / camera.focal,
            dz = forward[2] + u * right[2] + v * up[2];
          if (dz > -1e-3) continue;
          const t = (target[2] - eye[2]) / dz,
            x = eye[0] + (forward[0] + u * right[0] + v * up[0]) * t,
            y = eye[1] + (forward[1] + u * right[1] + v * up[1]) * t;
          if (x <= 0 || y <= 0 || x >= MAP || y >= MAP) continue;
          let holders = 0;
          for (let i = 0; i < list.count; i++) {
            const size = side(list.tier[i]);
            if (x >= list.ix[i] * size && x < (list.ix[i] + 1) * size && y >= list.iy[i] * size && y < (list.iy[i] + 1) * size) holders++;
          }
          expect(holders).toBe(1);
        }
    }
  });

  it('keeps every square inside the range of its level, where the morph closes the seams', () => {
    for (const ratio of [3, 4.2, 5]) {
      const { camera, list } = selection({ cx: 17000, cy: 24000, scale: 1.5, pitch: 1.15, yaw: 0.9 }, ratio),
        eyeHeight = lodEyeHeight(camera),
        top = LEVELS - 1;
      let finest = Infinity,
        coarsest = 0;
      for (let i = 0; i < list.count; i++) {
        const tier = list.tier[i],
          size = side(tier),
          node = size * 2,
          x = list.ix[i] * size,
          y = list.iy[i] * size;
        const dx = Math.max(x - camera.eye[0], 0, camera.eye[0] - x - size),
          dy = Math.max(y - camera.eye[1], 0, camera.eye[1] - y - size),
          nearest = Math.hypot(dx, dy, eyeHeight),
          farthest = Math.hypot(Math.max(Math.abs(x - camera.eye[0]), Math.abs(x + size - camera.eye[0])), Math.max(Math.abs(y - camera.eye[1]), Math.abs(y + size - camera.eye[1])), eyeHeight);
        const level = top - tier + 1;
        // Beyond the range of the level below: where it meets that level, its neighbour is fully morphed onto its grid.
        if (level > 0) expect(nearest).toBeGreaterThan((ratio * node) / 2);
        // Its node reaches within the range of its level, so no point of it is past that range by more than the
        // diagonal of the node: before the start of the level above's morph, whose vertices have not moved there.
        if (level < top) {
          expect(farthest).toBeLessThanOrEqual((ratio + Math.SQRT2) * node + 1e-6);
          expect((ratio + Math.SQRT2) * node).toBeLessThanOrEqual(morphStart(ratio) * ratio * node * 2);
        }
        finest = Math.min(finest, level);
        coarsest = Math.max(coarsest, level);
      }
      // A close, tilted view uses several levels: fine at the eye, coarse at the horizon.
      expect(coarsest - finest).toBeGreaterThanOrEqual(3);
    }
  });

  it('scales the range of a level with the focal length, within bounds', () => {
    expect(patchRatio(600, 'full')).toBe(3);
    expect(patchRatio(1536, 'full')).toBeCloseTo(4, 12);
    expect(patchRatio(4000, 'full')).toBe(5);
    expect(patchRatio(4000, 'light')).toBe(3);
    // The morph leaves room for the diagonal of a node at every ratio.
    for (const ratio of [3, 4, 5]) expect(morphStart(ratio)).toBeGreaterThan(0.5 + Math.SQRT1_2 / ratio);
    for (const ratio of [3, 4, 5]) expect(morphStart(ratio)).toBeLessThan(0.8);
  });
});

describe('draped tile tier', () => {
  const TILE = 512;
  it('is the tier of the top view when the camera looks straight down', () => {
    for (const [scale, dpr] of [
      [0.02, 1],
      [0.37, 2],
      [5, 1.5],
    ]) {
      const focal = 1100 * dpr,
        depth = 1100 / scale;
      const topView = Math.max(0, Math.ceil(Math.log2((scale * dpr) / (TILE / MAP)) - 1e-9));
      expect(drapeTier(focal, depth, MAP, TILE, 20, 20)).toBe(topView);
    }
  });
  it('is finer near the eye, coarser far away, and never past the square or the finest tier', () => {
    const near = drapeTier(1500, 200, MAP, TILE, 20, 20);
    expect(drapeTier(1500, 400, MAP, TILE, 20, 20)).toBe(near - 1);
    expect(drapeTier(1500, 3200, MAP, TILE, 20, 20)).toBe(near - 4);
    expect(drapeTier(1500, 200, MAP, TILE, 3, 20)).toBe(3);
    expect(drapeTier(1500, 200, MAP, TILE, 20, 5)).toBe(5);
    expect(drapeTier(1500, 1e9, MAP, TILE, 20, 20)).toBe(0);
  });
});

describe('terrain heights', () => {
  it('reads the control grid as its B-spline surface, clamped at the floor and exaggerated', () => {
    const n = 8,
      ramp = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ramp[j * n + i] = -30 + 20 * i + 5 * j;
    const heights = new TerrainHeights(ramp, n, 800, -Infinity, 1);
    // A B-spline reproduces a plane away from the clamped edges: height at (x, y) = -30 + 20 * (x / 100 - 0.5) + 5 * (y / 100 - 0.5).
    expect(heights.heightAt(350, 420)).toBeCloseTo(-30 + 20 * 3 + 5 * 3.7, 4);
    expect(heights.low).toBe(-30);
    expect(heights.high).toBe(-30 + 20 * 7 + 5 * 7);
    const drawn = new TerrainHeights(ramp, n, 800, 0, 2);
    expect(drawn.heightAt(350, 420)).toBeCloseTo(2 * (-30 + 20 * 3 + 5 * 3.7), 4);
    expect(drawn.heightAt(60, 60)).toBe(0);
    expect(drawn.low).toBe(0);
    expect(drawn.high).toBe(2 * (-30 + 20 * 7 + 5 * 7));
    // Clamped at the map edge.
    expect(drawn.heightAt(-500, 420)).toBe(drawn.heightAt(0, 420));
  });
});
