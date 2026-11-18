/**
 * Measurement of the 2D display: `globalThis.__muLive` (LiveStats, contract.ts), defined when this module loads.
 *
 * The compositor writes its frames here (CPU and GPU time, what each layer did); the page adds the units of work that
 * held the main thread too long. Read by scripts/nav_fps_probe.mjs and from the console.
 */
import { LIVE_LAYER_ORDER, type LiveStats } from './contract';

/** Samples kept per series. */
const SERIES = 4000;
export const pushSample = (list: number[], value: number): void => {
  list.push(value);
  if (list.length > SERIES) list.shift();
};

const stats: LiveStats = {
  active: false,
  reason: 'no frame yet',
  frames: 0,
  frameMs: [],
  gpuMs: [],
  layers: {},
  pending: {},
  layerMs: {},
  slow: [],
  reset() {
    stats.frames = 0;
    stats.frameMs.length = 0;
    stats.gpuMs.length = 0;
    stats.slow!.length = 0;
    for (const name of LIVE_LAYER_ORDER) {
      const series = stats.layerMs![name];
      if (series) series.length = 0;
    }
  },
};
if (typeof document !== 'undefined') (globalThis as unknown as Record<string, unknown>).__muLive = stats;
export const liveStats = (): LiveStats => stats;

/** A unit of work that held the main thread for SLOW_MS or more since `since` goes to the journal (LiveStats.slow). */
const SLOW_MS = 20;
export function noteLiveUnit(what: string, since: number): void {
  const now = performance.now(),
    ms = now - since;
  if (ms < SLOW_MS) return;
  const slow = stats.slow!;
  slow.push([what, Math.round(ms * 10) / 10, Math.round(since)]);
  if (slow.length > 64) slow.shift();
}
/** The fallback view presented the frame of the 2D view. */
export function noteFallbackFrame(reason: string): void {
  stats.active = false;
  stats.reason = reason;
}
