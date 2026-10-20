import { describe, expect, it } from 'vitest';
import { gridHeight, raycastGrid, type TerrainPickGrid } from '../src/ui/terrain3dPicking';

const grid = (height: TerrainPickGrid['height'], cells = 4): TerrainPickGrid => ({
  x: 0, y: 0, width: 4, cells, height, clip: { x: 0, y: 0, width: 4 },
});

describe('3D ruler terrain picking', () => {
  it('hits an inclined plane at its physical coordinates', () => {
    // h = x + 2y, ray = (1, 10, 1) + t(.1, -1, .2): 10-t = 3+.5t.
    const mesh = grid((x, y) => x + 2 * y);
    expect(raycastGrid(mesh, [1, 10, 1], [.1, -1, .2])).toBeCloseTo(14 / 3, 8);
  });

  it('selects the first mountain face along a horizontal ray', () => {
    const mesh = grid(x => x === 2 ? 4 : 0);
    expect(raycastGrid(mesh, [-1, 2, 2], [1, 0, 0])).toBeCloseTo(2.5, 8);
  });

  it('uses mesh triangles rather than a bilinear saddle', () => {
    const mesh = grid((x, y) => x * y * 4, 1);
    expect(gridHeight(mesh, 1, 1)).toBe(0);
    expect(gridHeight(mesh, 3, 3)).toBe(2);
    expect(raycastGrid(mesh, [3, 10, 3], [0, -1, 0])).toBeCloseTo(8, 8);
  });

  it('accepts vertical rays on grid corners and the terrain boundary', () => {
    const mesh = grid(() => 2);
    expect(raycastGrid(mesh, [2, 10, 2], [0, -1, 0])).toBe(8);
    expect(raycastGrid(mesh, [4, 10, 4], [0, -1, 0])).toBe(8);
  });

  it('rejects sky, outward rays and points beyond the terrain', () => {
    const mesh = grid(() => 0);
    expect(raycastGrid(mesh, [2, 10, 2], [0, 1, 0])).toBeNull();
    expect(raycastGrid(mesh, [5, 10, 2], [0, -1, 0])).toBeNull();
    expect(raycastGrid(mesh, [5, 10, 2], [1, -1, 0])).toBeNull();
    expect(gridHeight(mesh, 5, 2)).toBeNull();
  });

  it('respects clipped fallback quadrants', () => {
    const mesh = { ...grid(() => 0), clip: { x: 2, y: 2, width: 2 } };
    expect(raycastGrid(mesh, [1, 10, 1], [0, -1, 0])).toBeNull();
    expect(raycastGrid(mesh, [3, 10, 3], [0, -1, 0])).toBe(10);
    expect(gridHeight(mesh, 1, 1)).toBeNull();
  });

  it('crosses cells in both directions and handles diagonal corners', () => {
    const mesh = grid(() => 0);
    expect(raycastGrid(mesh, [5, 2, 5], [-1, -1, -1])).toBe(2);
    expect(raycastGrid(mesh, [-1, 2, -1], [1, -1, 1])).toBe(2);
  });
});
