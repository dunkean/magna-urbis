/**
 * The modelled trees of the world view in blocks of the map, without GL: the instances of one block (the 3D view's
 * builder, ui/terrain3dTrees.ts, in its area mode: every tree of the block, nothing around an eye), and what a frame
 * draws of a block by the size its trees take on screen: which lathe (treesShader.ts), how many of its trees. The GPU
 * side is treesLayer.ts.
 *
 * A block is built once per content (field, occupation, season, terrain) whatever the camera does: the eye moving or
 * turning builds nothing. Its instances are shuffled, so a frame draws a prefix of them to thin a far block evenly.
 *
 * Detail follows the projected size, never the eye's distance: the eye moves away and up as the camera tilts at a
 * fixed scale (camera.ts), so a rule on its distance changed the trees around the target with the pitch.
 */
import { buildNearTreesSteps, TREE_BLOCK, TREE_STRIDE, type TreeInputs } from '../../ui/terrain3dTrees';
import { TREE_LATHES } from './treesShader';

/** Side of a block of trees (m): a multiple of the builder's own block. About 600 trees in a dense stand. */
export const TREES_BLOCK = 4 * TREE_BLOCK;
/** Height of the tree a block's screen size is measured with (m): a typical stand tree. */
export const TREE_SIZE_M = 15;
/** Levels by the CSS pixels that tree spans: the full lathe from 60 px, the light one from 20 px, impostors from 2 px;
 * nothing under (the painted crowns of the ground carry the forest). */
const LATHE_PIXELS = [60, 20, 2];
/** Under this size a cell draws a share (pixels / THIN_PIXELS)^2 of its trees: about as many per screen area. */
const THIN_PIXELS = 5;
/** Cells of a block per side: its trees are stored cell by cell (TREE_BLOCK, 24 m), so a frame gives each part of a
 * near block its own level and thinning, as ranges of one buffer. */
export const TREE_CELLS = TREES_BLOCK / TREE_BLOCK;

/** The trees of one block: instances (positions relative to its north-west corner) cell by cell, row by row, in a
 * shuffled order inside each cell; `cells[c]` .. `cells[c + 1]` are the instances of cell c. */
export interface TreeBlock {
  /** Instances, twice: cell by cell (`cells`), then the whole block in one shuffled order, whose prefixes thin a block
   * drawn at one level evenly. */
  data: Float32Array;
  count: number;
  cells: Int32Array;
}

/** The instances of the block (bx, by). One step per 24 m of the block. */
export function* treeBlockSteps(inputs: TreeInputs, bx: number, by: number): Generator<void, TreeBlock> {
  const minX = bx * TREES_BLOCK,
    minY = by * TREES_BLOCK;
  const trees = yield* buildNearTreesSteps(inputs, { x: minX, y: minY, forwardX: 0, forwardY: 1, area: { minX, minY, maxX: minX + TREES_BLOCK, maxY: minY + TREES_BLOCK } });
  const count = trees.length / TREE_STRIDE,
    out = new Float32Array(2 * trees.length),
    cellOf = new Uint8Array(count),
    cells = new Int32Array(TREE_CELLS * TREE_CELLS + 1);
  // Counting sort by cell.
  for (let i = 0; i < count; i++) {
    const cx = Math.min(TREE_CELLS - 1, Math.max(0, Math.floor((trees[i * TREE_STRIDE] - minX) / TREE_BLOCK))),
      cy = Math.min(TREE_CELLS - 1, Math.max(0, Math.floor((trees[i * TREE_STRIDE + 1] - minY) / TREE_BLOCK)));
    cellOf[i] = cy * TREE_CELLS + cx;
    cells[cellOf[i] + 1]++;
  }
  for (let c = 0; c < TREE_CELLS * TREE_CELLS; c++) cells[c + 1] += cells[c];
  const order = new Uint32Array(count),
    fill = cells.slice(0, TREE_CELLS * TREE_CELLS);
  for (let i = 0; i < count; i++) order[fill[cellOf[i]]++] = i;
  // Fisher-Yates inside each cell on a hash of the block: the same order for the same block, so a prefix of a cell thins
  // it evenly.
  let state = (Math.imul(bx, 0x9e3779b1) ^ Math.imul(by, 0x85ebca77) ^ 0x2545f491) >>> 0;
  for (let c = 0; c < TREE_CELLS * TREE_CELLS; c++)
    for (let i = cells[c + 1] - 1; i > cells[c]; i--) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      const j = cells[c] + (state % (i - cells[c] + 1)),
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
  // The second copy: the cell order shuffled as a whole.
  const whole = new Uint32Array(count);
  for (let i = 0; i < count; i++) whole[i] = i;
  for (let i = count - 1; i > 0; i--) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1),
      t = whole[i];
    whole[i] = whole[j];
    whole[j] = t;
  }
  const half = count * TREE_STRIDE;
  for (let i = 0; i < count; i++) out.copyWithin(half + i * TREE_STRIDE, whole[i] * TREE_STRIDE, whole[i] * TREE_STRIDE + TREE_STRIDE);
  return { data: out, count, cells };
}

/** Level (TREE_LATHES) of trees whose nearest spans `pixels` CSS pixels (TREE_SIZE_M); -1: too small to draw. */
export function treeLathe(pixels: number): number {
  for (let i = 0; i < TREE_LATHES.length; i++) if (pixels >= LATHE_PIXELS[i]) return i;
  return -1;
}
/** Level of trees whose nearest spans `pixels` when the levels are `coarser` times coarser (the frame's budget): a tree
 * drawn at all (treeLathe) stays drawn, as an impostor at the coarsest. */
export function treeLevel(pixels: number, coarser: number): number {
  if (treeLathe(pixels) < 0) return -1;
  const level = treeLathe(pixels / coarser);
  return level < 0 ? TREE_LATHES.length - 1 : level;
}
/** Trees drawn of `count` whose nearest spans `pixels`: all from THIN_PIXELS, then a share. */
export function treeDrawCount(count: number, pixels: number): number {
  return pixels >= THIN_PIXELS ? count : Math.ceil((count * pixels * pixels) / (THIN_PIXELS * THIN_PIXELS));
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
