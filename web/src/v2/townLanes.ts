import { handheldDevice } from '../../../rust/bridge/deviceClass';

/**
 * Towns the browser WASM engine (threads package) generates at once: they share one instance and their quarters run as
 * parallel items of its rayon pool. The count is bounded by the cores and by the memory of the towns that may run at
 * once (a browser tab holds about 4 GB, a handheld tab much less).
 */
/** Towns at most (as the native engine's town concurrency); a handheld has few fast cores. */
const MAX_LANES = 4,
  MAX_HANDHELD_LANES = 2;
/** WASM memory budget of the towns generated together (GB), under the tab limit with the page and the display workers;
 * a handheld tab is killed near 1-1.5 GB. */
const LANE_BUDGET_GB = 2.5,
  HANDHELD_LANE_BUDGET_GB = 1;
/** Estimated WASM memory of a town of `population` generated alongside others (GB). */
export const laneMemoryGB = (population: number): number => 0.3 + population * 14e-6;

/** `populations`: the towns of the run; `cores` / `memoryGB`: `navigator.hardwareConcurrency` / `deviceMemory`, absent on
 * iOS Safari and Firefox (then 4 GB on a handheld, 8 GB on a desktop). */
export function wasmTownLanes(populations: readonly number[], cores: number, memoryGB: number | undefined, handheld = handheldDevice()): number {
  const budget = Math.min(handheld ? HANDHELD_LANE_BUDGET_GB : LANE_BUDGET_GB, (memoryGB ?? (handheld ? 4 : 8)) / 2);
  const largest = [...populations].sort((a, b) => b - a);
  let lanes = Math.min(handheld ? MAX_HANDHELD_LANES : MAX_LANES, largest.length, Math.max(1, Math.floor(cores / 4)));
  // The heaviest towns may run together: they must fit the budget.
  while (lanes > 1 && largest.slice(0, lanes).reduce((sum, population) => sum + laneMemoryGB(population), 0) > budget) lanes--;
  return lanes;
}
