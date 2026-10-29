/** Last-run timings of the chain, one entry per stage, read by the shell's Execution panel and by
 * scripts/bench_matrix.mjs through `window.magnaBenchTimings`. Stages keep the milliseconds the code
 * already reported (terrain stage events, hydrology/settlement/road/urban `ms`); nothing is measured twice. */
export interface BenchTimings { stages: Record<string, number>; errors: string[]; updated: number }
declare global { interface Window { magnaBenchTimings?: BenchTimings } }

function registry(): BenchTimings {
  const w = window as Window;
  return w.magnaBenchTimings ??= { stages: {}, errors: [], updated: 0 };
}
export function recordStageMs(stage: string, ms: number | undefined): void {
  if (typeof window === 'undefined' || ms === undefined || !Number.isFinite(ms)) return;
  const t = registry(); t.stages[stage] = ms; t.updated = Date.now();
}
export function recordStageError(stage: string, message: string): void {
  if (typeof window === 'undefined') return;
  const t = registry(); t.errors.push(`${stage}: ${message}`); t.updated = Date.now();
}
/** Forget the stages starting with `prefix` (a new run of that part of the chain begins). */
export function resetStageMs(prefix: string): void {
  if (typeof window === 'undefined') return;
  const t = registry();
  for (const key of Object.keys(t.stages)) if (key === prefix || key.startsWith(`${prefix}.`)) delete t.stages[key];
  t.updated = Date.now();
}
