/** Modelled world trees in view-independent blocks. Every distance draws ranges of the same shuffled array.
 * Detail and thinning follow the projected size of a stand tree in CSS pixels. */
import { buildNearTreesSteps, TREE_STRIDE, type TreeInputs } from '../../ui/terrain3dTrees';
import type { TreeBuildings } from './treesBuildings';
import type { TreeSamples } from './treesContent';

/** Side of a block of trees (m): a multiple of the builder's own block. About 600 trees in a dense stand. */
import { TREE_VOLUME_BLOCK as TREES_BLOCK } from '../../../../rust/bridge/treeOwnership';
export { TREES_BLOCK };
/** Height of the tree a block's screen size is measured with (m): a typical stand tree. */
export const TREE_SIZE_M = 15;
/** A block has one stable instance order for all distances and detail levels. */
export interface TreeBlock {
  data: Float32Array;
  count: number;
  ids?: Uint32Array;
  samples: TreeSamples;
}

/** The instances of the block (bx, by). One step per 24 m of the block. */
export function* treeBlockSteps(inputs: TreeInputs, bx: number, by: number, buildings?: TreeBuildings): Generator<void, TreeBlock> {
  const minX = bx * TREES_BLOCK,
    minY = by * TREES_BLOCK;
  const water: number[] = [],
    height: number[] = [];
  const emitted: number[] = [];
  const observed: TreeInputs = {
    ...inputs,
    emittedId: (_id, cell) => emitted.push(cell),
    water: (x, y) => {
      const value = inputs.water(x, y);
      water.push(x, y, value);
      return value;
    },
    height: (x, y) => {
      const value = inputs.height(x, y);
      height.push(x, y, value ?? NaN);
      return value;
    },
  };
  const trees = yield* buildNearTreesSteps(observed, { x: minX, y: minY, forwardX: 0, forwardY: 1, area: { minX, minY, maxX: minX + TREES_BLOCK, maxY: minY + TREES_BLOCK } });
  let count = 0;
  for (let i = 0; i < trees.length; i += TREE_STRIDE) {
    if (buildings && !buildings.keeps(trees[i], trees[i + 1], trees[i + 3])) continue;
    const to = count++ * TREE_STRIDE;
    emitted[to / TREE_STRIDE] = emitted[i / TREE_STRIDE];
    if (to !== i) trees.copyWithin(to, i, i + TREE_STRIDE);
    trees[to] -= minX;
    trees[to + 1] -= minY;
  }
  // Tall crowns acquire visible relief first. Preserve the lattice order for equal heights.
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => trees[b * TREE_STRIDE + 4] - trees[a * TREE_STRIDE + 4]);
  const ids = Uint32Array.from(order, i => emitted[i]);
  const data = new Float32Array(count * TREE_STRIDE);
  order.forEach((from, to) => data.set(trees.subarray(from * TREE_STRIDE, (from + 1) * TREE_STRIDE), to * TREE_STRIDE));
  return { data, count, ids, samples: { water: Float64Array.from(water), height: Float64Array.from(height) } };
}

const transition = (pixels: number, start: number, end: number): number => {
  const t = Math.min(1, Math.max(0, (pixels - start) / (end - start)));
  return t * t * (3 - 2 * t);
};
/** Cumulative shares upgraded from the impostor to a solid crown, then to the close mesh. */
export const treeSolidShare = (pixels: number): number => transition(pixels, 18, 38);
export const treeCloseShare = (pixels: number): number => transition(pixels, 64, 112);
/** Even very distant trees leave individually as their painted crowns take over. */
export const treeDrawShare = (pixels: number): number => Math.min(1, (pixels / 5) ** 2) * transition(pixels, 1, 2);
export function treeDrawCount(count: number, pixels: number): number {
  return Math.round(count * treeDrawShare(pixels));
}

/** Cheap publication stamp. TreeContent and the block's callback samples decide whether its contents changed. */
export function treeInputsKey(inputs: Omit<TreeInputs, 'height'>): string {
  return [
    inputs.field.key,
    inputs.occupation?.key,
    inputs.occupation?.detail?.key,
    inputs.seed,
    inputs.renderV2,
    inputs.zone,
    inputs.season,
    inputs.crownSnow,
    inputs.climateZone,
    JSON.stringify(inputs.calendar ?? {}),
    inputs.climate.temperature,
    inputs.climate.precipitation,
  ].join('|');
}
