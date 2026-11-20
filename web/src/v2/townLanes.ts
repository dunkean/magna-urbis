/**
 * Towns the browser WASM engine (threads package) generates at once: they share one instance and their quarters run as
 * parallel items of its rayon pool. The count is bounded by the cores and by the memory of the towns that may run at
 * once (a browser tab holds about 4 GB).
 */
/** Towns at most (as the native engine's town concurrency). */
const MAX_LANES = 4;
/** WASM memory budget of the towns generated together (GB), under the tab limit with the page and the display workers. */
const LANE_BUDGET_GB = 2.5;
/** Estimated WASM memory of a town of `population` generated alongside others (GB). */
export const laneMemoryGB = (population: number): number => 0.3 + population * 14e-6;

/** `populations`: the towns of the run; `cores` / `memoryGB`: `navigator.hardwareConcurrency` / `deviceMemory`. */
export function wasmTownLanes(populations: readonly number[], cores: number, memoryGB: number | undefined): number {
  const budget = Math.min(LANE_BUDGET_GB, (memoryGB ?? 8) / 2);
  const largest = [...populations].sort((a, b) => b - a);
  let lanes = Math.min(MAX_LANES, largest.length, Math.max(1, Math.floor(cores / 4)));
  // The heaviest towns may run together: they must fit the budget.
  while (lanes > 1 && largest.slice(0, lanes).reduce((sum, population) => sum + laneMemoryGB(population), 0) > budget) lanes--;
  return lanes;
}
