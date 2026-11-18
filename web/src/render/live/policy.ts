/**
 * Live display policy (contract.ts): how the moving 2D view of the V2 is composed.
 *   compositor : one WebGL2 context draws ground, water, overlay, town and names from retained GPU resources;
 *   classic    : the stacked canvases of v2/benchRenderer.ts (terrain canvas + flattened 2D surface).
 * `?live=compositor|classic` over localStorage `magna-urbis-live`; default compositor. A browser preference, never
 * part of a saved recipe. The renderer still falls back to the classic path by itself when the compositor cannot
 * run (no WebGL2, software GL, CPU or illustrated ground): see `__muLive.reason`.
 */
import type { LiveMode } from './contract';

export const LIVE_MODES = ['compositor', 'classic'] as const;
export const LIVE_MODE_STORAGE_KEY = 'magna-urbis-live';

const valid = (value: unknown): value is LiveMode => LIVE_MODES.includes(value as LiveMode);
const listeners = new Set<(mode: LiveMode) => void>();
let stored: string | null = null;
try {
  stored = globalThis.localStorage?.getItem(LIVE_MODE_STORAGE_KEY) ?? null;
} catch {
  /* Storage is optional. */
}
let override: LiveMode | null = null;
if (typeof location !== 'undefined') {
  const v = new URLSearchParams(location.search).get('live');
  if (valid(v)) override = v;
}
let preference: LiveMode = valid(stored) ? stored : 'compositor';

export const getLiveMode = (): LiveMode => override ?? preference;

export function setLiveMode(mode: LiveMode): void {
  override = null;
  preference = mode;
  try {
    globalThis.localStorage?.setItem(LIVE_MODE_STORAGE_KEY, mode);
  } catch {
    /* Private mode remains usable. */
  }
  // An explicit choice supersedes the URL for this browser and future reloads.
  if (typeof history !== 'undefined' && typeof location !== 'undefined') {
    const url = new URL(location.href);
    url.searchParams.delete('live');
    try {
      history.replaceState(history.state, '', url);
    } catch {
      /* Sandboxed hosts may disallow history changes. */
    }
  }
  for (const listener of listeners) listener(mode);
}

export function onLiveModeChange(listener: (mode: LiveMode) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Debug and probe scripts drive the policy through this hook. */
if (typeof document !== 'undefined') {
  (globalThis as unknown as Record<string, unknown>).__muLiveMode = { get: getLiveMode, set: setLiveMode };
}
