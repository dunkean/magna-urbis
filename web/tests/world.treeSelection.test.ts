import { expect, it } from 'vitest';
import { treeBlockSteps } from '../src/render/world/treesBlocks';
import { TREE_STRIDE } from '../src/ui/terrain3dTrees';
import { TreeSelection } from '../src/render/world/treeSelection';

// Decode the open-addressed buckets sampled by the draped ground.
function owns(selection: TreeSelection, block: number, id: number): boolean {
  const h = Math.imul(id ^ Math.imul(block, 0x9e3779b9), 0x85ebca6b);
  id = (h ^ (h >>> 16)) >>> 0;
  const { data, width, height } = selection.image(),
    mask = width * height - 1;
  for (let index = id & mask; data[index * 2 + 1]; index = (index + 1) & mask) {
    if (data[index * 2] === id && data[index * 2 + 1] === block + 1) return true;
  }
  return false;
}

it('keeps unstreamed and over-budget crowns painted and restores retiring crowns', () => {
  const selection = new TreeSelection(),
    ids = Uint32Array.of(0, 8, 16),
    other = Uint32Array.of(8);
  selection.begin();
  selection.select(0, ids, 2);
  selection.select(1, other, 1);
  selection.end();
  const image = selection.image();
  expect([owns(selection, 0, 0), owns(selection, 0, 8), owns(selection, 1, 8)]).toEqual([true, true, true]);
  expect(owns(selection, 0, 16)).toBe(false);
  expect(owns(selection, 1, 0)).toBe(false);
  selection.begin();
  selection.select(0, ids, 2);
  selection.select(1, other, 1);
  selection.end();
  expect(selection.image()).toBe(image);
  selection.begin();
  selection.select(0, ids, 1);
  selection.end();
  expect(owns(selection, 0, 8)).toBe(false);
  expect(owns(selection, 1, 8)).toBe(false);
  expect(selection.image()).not.toBe(image);
});

it('keeps every emitted tropical crown with its lattice identity as large trees acquire relief first', () => {
  const rgba = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([236, 180, 12, 126], i);
  const inputs = { field: { x: 0, y: 0, width: 512, n: 16, rgba, key: 'rainforest' }, seed: 81, climate: { temperature: 26, precipitation: 2300 }, zone: 10, renderV2: 1, season: 0.5, water: () => 0, height: () => 10 };
  const blocks = treeBlockSteps(inputs, 2, 2);
  let next = blocks.next();
  while (!next.done) next = blocks.next();
  const { ids, data, count } = next.value;
  expect(count).toBeGreaterThan(10);
  expect(new Set(ids).size).toBe(count);
  for (let k = 0; k < count; k++) {
    const cell = ids![k],
      s = 2 * 2 ** ((cell >>> 16) * 0.5),
      at = k * TREE_STRIDE;
    expect(Math.floor((192 + data[at]) / s) & 255).toBe(cell & 255);
    expect(Math.floor((192 + data[at + 1]) / s) & 255).toBe((cell >>> 8) & 255);
    if (k) expect(data[at + 4]).toBeLessThanOrEqual(data[at + 4 - TREE_STRIDE]);
  }
});
