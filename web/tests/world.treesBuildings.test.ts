import { describe, expect, it } from 'vitest';
import type { Polygon } from '../../rust/bridge/housesContract';
import type { Building3dScene } from '../src/render/urbanBuildingGeometry';
import { treeBuildings } from '../src/render/world/treesBuildings';
import { treeBlockSteps, TREES_BLOCK } from '../src/render/world/treesBlocks';
import { TREE_STRIDE, type TreeInputs } from '../src/ui/terrain3dTrees';

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
const scene = (shapes: Polygon[]): Building3dScene => ({ buildings: [{ footprint: shapes }], materials: [] }) as unknown as Building3dScene;

describe('world tree building clearance', () => {
  it('indexes a scene once, rejects walls and small crowns, and keeps courtyard interiors', () => {
    const town = scene([{ outer: square(-10, -10, 100), holes: [square(10, 10, 40)] }]),
      index = treeBuildings(town)!;
    expect(treeBuildings(town)).toBe(index);
    expect(index.keeps(0, 0, 1)).toBe(false);
    expect(index.keeps(-10, 0, 1)).toBe(false);
    expect(index.keeps(-12, 0, 2.5)).toBe(false);
    expect(index.keeps(-14, 0, 20)).toBe(true);
    expect(index.keeps(30, 30, 2)).toBe(true);
    expect(index.keeps(11, 30, 2)).toBe(false);
    expect(index.keeps(200, 200, 2)).toBe(true);
  });

  it('filters both shuffled instance copies without moving the surviving painted-crown centres', () => {
    const rgba = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([235, 110, 80, 255], i);
    const inputs: TreeInputs = { field: { x: 0, y: 0, width: 400, n: 32, rgba, key: 'stand' }, seed: 5, climate: { temperature: 10, precipitation: 900 }, renderV2: 1, zone: 0, season: 0.5, water: () => 0, height: () => 20 };
    const index = treeBuildings(scene([{ outer: square(120, 120, 32), holes: [] }]))!;
    const build = (filtered: boolean) => {
      const work = treeBlockSteps(inputs, 1, 1, filtered ? index : undefined);
      let step = work.next();
      while (!step.done) step = work.next();
      return step.value;
    };
    const original = build(false),
      filtered = build(true),
      survivors = new Set<string>();
    expect(filtered.count).toBeLessThan(original.count);
    expect(filtered.count).toBeGreaterThan(0);
    for (let i = 0; i < original.count * TREE_STRIDE; i += TREE_STRIDE) survivors.add(Array.from(original.data.subarray(i, i + TREE_STRIDE)).join(','));
    for (let i = 0; i < filtered.data.length; i += TREE_STRIDE) {
      expect(index.keeps(filtered.data[i] + TREES_BLOCK, filtered.data[i + 1] + TREES_BLOCK, filtered.data[i + 3])).toBe(true);
      expect(survivors.has(Array.from(filtered.data.subarray(i, i + TREE_STRIDE)).join(','))).toBe(true);
    }
    expect(filtered.cells.at(-1)).toBe(filtered.count);
    expect(filtered.data.length).toBe(2 * filtered.count * TREE_STRIDE);
  });
});
