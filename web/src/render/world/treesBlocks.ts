/**
 * The modelled trees of the world view in blocks of the map, without GL: the instances of one block (the 3D view's
 * builder, ui/terrain3dTrees.ts, in its area mode: every tree of the block, nothing around an eye), and what a frame
 * draws of a block at a distance: which lathe (treesShader.ts), how many of its trees. The GPU side is treesLayer.ts.
 *
 * A block is built once per content (field, occupation, season, terrain) whatever the camera does: the eye moving or
 * turning builds nothing. Its instances are shuffled, so a frame draws a prefix of them to thin a far block evenly
 * (the 3D view thinned its far ring by distance in the same proportion, (full / distance)^2).
 */
import { buildNearTreesSteps, TREE_BLOCK, TREE_STRIDE, type TreeInputs, type TreeLimits } from '../../ui/terrain3dTrees';
import { TREE_LATHES } from './treesShader';

/** Side of a block of trees (m): a multiple of the builder's own block. About 600 trees in a dense stand. */
export const TREES_BLOCK = 4 * TREE_BLOCK;
/** Lathe by distance, as a share of the tree distance: full within 30 %, middle within 60 %, far to the end. */
const LATHE_SHARE = [0.3, 0.6, 1];

/** The instances of the block (bx, by): positions relative to its north-west corner, in a shuffled order. One step per
 * 24 m of the block. */
export function* treeBlockSteps(inputs: TreeInputs, bx: number, by: number): Generator<void, Float32Array> {
  const minX = bx * TREES_BLOCK,
    minY = by * TREES_BLOCK;
  const trees = yield* buildNearTreesSteps(inputs, { x: minX, y: minY, forwardX: 0, forwardY: 1, area: { minX, minY, maxX: minX + TREES_BLOCK, maxY: minY + TREES_BLOCK } });
  const count = trees.length / TREE_STRIDE,
    out = new Float32Array(trees.length);
  // Fisher-Yates on a hash of the block: the same order for the same block.
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  let state = (Math.imul(bx, 0x9e3779b1) ^ Math.imul(by, 0x85ebca77) ^ 0x2545f491) >>> 0;
  for (let i = count - 1; i > 0; i--) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1),
      t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  for (let i = 0; i < count; i++) {
    const from = order[i] * TREE_STRIDE,
      to = i * TREE_STRIDE;
    for (let k = 0; k < TREE_STRIDE; k++) out[to + k] = trees[from + k];
    out[to] -= minX;
    out[to + 1] -= minY;
  }
  return out;
}

/** Lathe of a block whose nearest point is `distance` (m) from the eye, horizontally; -1 beyond the tree distance. */
export function treeLathe(distance: number, limits: TreeLimits): number {
  for (let i = 0; i < TREE_LATHES.length; i++) if (distance <= LATHE_SHARE[i] * limits.far) return i;
  return -1;
}
/** Trees drawn of a block of `count` whose nearest point is `distance` from the eye: all within `full`, then
 * (full / distance)^2 of them. */
export function treeDrawCount(count: number, distance: number, limits: TreeLimits): number {
  return distance <= limits.full ? count : Math.ceil((count * limits.full * limits.full) / (distance * distance));
}

/** What changes the trees of a block: the inputs' content (the water cover function is the inputs' identity). */
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
