/** Render mode of the city display and frame statistics for the bench.
 * `render=gpu|cpu|auto`: URL parameter, persisted in localStorage. gpu draws everything WebGL2 can
 * (only comparisons and the parchment hatching stay on Canvas 2D), cpu forces the Canvas 2D path,
 * auto uses WebGL2 whenever the frame allows it. */
export type RenderMode = 'gpu' | 'cpu' | 'auto';
export interface RenderStats {
  path: 'gpu' | 'cpu'; mode: RenderMode; ms: number; drawCalls: number; frames: number;
  /** Fill/street/building primitives Canvas 2D still painted in the last city frame (0 in a GL frame). */
  canvas2dFills?: number; reason?: string;
  /** Last 3D building pass: draw calls, drawn sectors, triangles. */
  buildings3d?: { drawCalls: number; sectors: number; triangles: number };
}
const KEY = 'magna.renderMode';
const valid = (v: unknown): v is RenderMode => v === 'gpu' || v === 'cpu' || v === 'auto';
const listeners = new Set<() => void>();
let mode: RenderMode | undefined;
export function getRenderMode(): RenderMode {
  if (mode) return mode;
  let value: unknown;
  try { value = new URLSearchParams(location.search).get('render'); } catch { /* no location */ }
  if (!valid(value)) { try { value = localStorage.getItem(KEY); } catch { /* storage blocked */ } }
  return mode = valid(value) ? value : 'auto';
}
export function setRenderMode(next: RenderMode): void {
  mode = next;
  try { localStorage.setItem(KEY, next); } catch { /* storage blocked */ }
  try { const url = new URL(location.href); url.searchParams.set('render', next); history.replaceState(history.state, '', url); } catch { /* no history */ }
  for (const l of listeners) l();
}
export const onRenderMode = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Why Canvas 2D still draws the plan although the mode allows WebGL (null: GL draws). */
export function cityGlBlocker(o: { mode: RenderMode; compare: boolean; parchment: boolean; ready: boolean }): string | null {
  if (o.mode === 'cpu') return 'mode-cpu';
  if (o.compare) return 'comparison';
  if (o.parchment) return 'parchment';
  if (!o.ready) return 'gl-not-ready';
  return null;
}
const stats: RenderStats = { path: 'cpu', mode: 'auto', ms: 0, drawCalls: 0, frames: 0 };
export function reportRenderStats(patch: Partial<RenderStats>): RenderStats {
  Object.assign(stats, patch, { mode: getRenderMode(), frames: stats.frames + (patch.path ? 1 : 0) });
  if (typeof window !== 'undefined') (window as unknown as { magnaRenderStats?: RenderStats }).magnaRenderStats = stats;
  return stats;
}
