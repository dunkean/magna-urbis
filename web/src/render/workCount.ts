/**
 * Units of display work, counted for the probes: `globalThis.__muWork` (name -> count since the page loaded). A probe
 * reads it before and after an action (a style switch, a zoom, a tilt) to see what was rebuilt, independently of
 * timings. Names: `town.*` (the GPU town: scene merges, packs, triangulations, uploads; the Canvas town's GL plan),
 * `volumes.*` (the tilted town), `contour.*` (extractions, chunked sets, chunks stroked).
 */
const counts: Record<string, number> = {};
if (typeof document !== 'undefined') (globalThis as unknown as Record<string, unknown>).__muWork = counts;
export function countWork(name: string, n = 1): void {
  counts[name] = (counts[name] ?? 0) + n;
}
