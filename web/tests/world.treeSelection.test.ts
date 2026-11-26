import { expect, it } from 'vitest';
import { TreeSelection } from '../src/render/world/treeSelection';

// Decode the same open-addressed buckets read by the auxiliary terrain pass.
function owns(selection: TreeSelection, block: number, id: number): boolean {
  const { data, width, height } = selection.image(),
    mask = width * height - 1;
  for (let index = id & mask; data[index * 2 + 1]; index = (index + 1) & mask) {
    if (data[index * 2] === id && data[index * 2 + 1] === block + 1) return true;
  }
  return false;
}

it('keeps unstreamed and over-budget crowns painted and releases their tiles on retirement', () => {
  const selection = new TreeSelection(),
    ids = Uint32Array.of(0, 8, 16),
    other = Uint32Array.of(8);
  selection.begin();
  selection.select(0, ids, 2);
  selection.select(1, other, 1);
  selection.end();
  const image = selection.image(),
    stamp = selection.stamp(0, 0, 64, 32);
  expect([owns(selection, 0, 0), owns(selection, 0, 8), owns(selection, 1, 8)]).toEqual([true, true, true]);
  expect(owns(selection, 0, 16)).toBe(false);
  expect(owns(selection, 1, 0)).toBe(false);
  selection.begin();
  selection.select(0, ids, 2);
  selection.select(1, other, 1);
  selection.end();
  expect(selection.image()).toBe(image);
  expect(selection.stamp(0, 0, 64, 32)).toBe(stamp);
  selection.begin();
  selection.select(0, ids, 1);
  selection.end();
  expect(owns(selection, 0, 8)).toBe(false);
  expect(owns(selection, 1, 8)).toBe(false);
  expect(selection.stamp(0, 0, 64, 32)).toBeGreaterThan(stamp);
  expect(selection.stamp(4096, 4096, 64, 32)).toBe(0);
});
