/** View capability and defaults shared by the page controls, appearance resolver and script hook.
 * Machine defaults never become persisted preferences; explicit project/browser values win. */
import { TREE_DISTANCE_DEFAULT, TREE_DISTANCE_MIN } from '../ui/terrain3dTrees';
import { VIEW_DEPTH_DEFAULT } from '../render/world/viewDepth';
import type { MachineTier } from './machineTier';

export function machineViewDefaults(tier: MachineTier): { available: boolean; trees3d: boolean; treeDistance: number; viewDepth: number } {
  return { available: tier !== 'veryslow', trees3d: false, treeDistance: tier === 'capable' ? TREE_DISTANCE_DEFAULT : TREE_DISTANCE_MIN, viewDepth: VIEW_DEPTH_DEFAULT };
}
