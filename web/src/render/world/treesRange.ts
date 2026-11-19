/** Capacity of the block-based world trees (treesLayer). The distance slider pays for a larger forest without
 * changing the 600 m default; the separate 3D view's fixed-lathe instance ceiling remains in terrain3dTrees. */
import { TREE_DISTANCE_MAX, clampTreeDistance } from '../../ui/terrain3dTrees';
import { TREES_BLOCK } from './treesBlocks';

/** Two discs (target and eye ground point), including the blocks straddling each boundary. */
export const TREE_MAX_BLOCKS = Math.ceil((2 * Math.PI * (TREE_DISTANCE_MAX + TREES_BLOCK * Math.SQRT2) ** 2) / TREES_BLOCK ** 2);
/** Most blocks draw whole; spare capacity covers the cell runs of blocks crossing detail thresholds. */
export const TREE_MAX_DRAWS = TREE_MAX_BLOCKS * 2;
export const treeTriangleBudget = (metres: number): number => Math.min(10000000, 250000 * (clampTreeDistance(metres) / 600) ** 2);
/** Instance buffers contain two orders of each block (96 bytes/tree). More range retains more blocks, capped at
 * 512 MiB; eviction still protects every block drawn in the current frame. */
export const treeMemoryBudget = (metres: number): number => Math.min(512, 32 * (clampTreeDistance(metres) / 600) ** 2) * 1024 * 1024;
