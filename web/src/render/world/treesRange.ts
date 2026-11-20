/** Capacity of the block-based world trees (treesLayer). The distance slider pays for a larger forest without
 * changing the 600 m default; the separate 3D view's fixed-lathe instance ceiling remains in terrain3dTrees. */
import { TREE_DISTANCE_MAX, clampTreeDistance } from '../../ui/terrain3dTrees';
import { TREES_BLOCK } from './treesBlocks';

/** Two discs (target and eye ground point), including the blocks straddling each boundary. */
export const TREE_MAX_BLOCKS = Math.ceil((2 * Math.PI * (TREE_DISTANCE_MAX + TREES_BLOCK * Math.SQRT2) ** 2) / TREES_BLOCK ** 2);
/** Larger ranges allow more silhouettes, with a fixed ceiling even at the 5 km setting. */
export const treeTriangleBudget = (metres: number): number => Math.min(2100000, 250000 * (clampTreeDistance(metres) / 600) ** 2);
/** One 48-byte instance per tree. Keep the previous number of blocks in half the GPU memory. */
export const treeMemoryBudget = (metres: number): number => Math.min(256, 16 * (clampTreeDistance(metres) / 600) ** 2) * 1024 * 1024;
