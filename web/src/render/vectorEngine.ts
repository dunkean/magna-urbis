/**
 * Vector engine policy (design: web/out/vector-gpu-2026-11-12/DESIGN.md section 3).
 * The map style code draws through one Canvas 2D description; this module decides whether it is replayed on the
 * graphics card (recorded display list + WebGL2 rasterizer) or drawn by the processor. Preference `auto | gpu | cpu`
 * (URL `?vector=` over storage), demoted for the session on a context loss or a raster error. Slow GPU tiles
 * start a trial instead: the processor draws a few tiles, the faster engine stays, and the GPU is tried again later.
 */
import type { GpuRasterizer, VectorEngine, VectorEngineChoice } from './gpu/displayList';
import { sharedGpuRasterizer } from './gpu/glRaster';

export const VECTOR_ENGINE_CHOICES = ['auto', 'gpu', 'cpu'] as const;
export const VECTOR_ENGINE_STORAGE_KEY = 'magna-urbis-vector-engine';
/** Median raster time over the last GPU tiles above which `auto` tries the processor. Only replays that waited for
 * the graphics process count (`synced`): the others return before the GPU has drawn anything. */
const SLOW_RASTER_MS = 40,
  SLOW_WINDOW = 8,
  HISTORY = 64;
/** The processor keeps the map only when its tiles take less than this share of the GPU's (record + raster). */
const CPU_WINS = 0.8;
/** A trial the processor won gives the GPU another chance after this long, doubled at each new trial it loses
 * (a busy graphics process or first shader compiles pass; a weak card does not). */
const RETRY_MS = 30000,
  RETRY_MAX_MS = 300000;

export interface VectorEngineStats {
  preference: VectorEngineChoice;
  engine: VectorEngine;
  renderer: string;
  software: boolean;
  demoted?: string;
  gpuTiles: number;
  cpuTiles: number;
  fallbackTiles: number;
  lastFallback?: string;
  recordMs: number[];
  rasterMs: number[];
  cpuMs: number[];
  liveParts: Record<string, number>;
  liveSeries: Record<string, number[]>;
}

const valid = (value: unknown): value is VectorEngineChoice => VECTOR_ENGINE_CHOICES.includes(value as VectorEngineChoice);
const listeners = new Set<(engine: VectorEngine) => void>();
let stored: string | null = null;
try {
  stored = globalThis.localStorage?.getItem(VECTOR_ENGINE_STORAGE_KEY) ?? null;
} catch {
  /* Storage is optional. */
}
let override: VectorEngineChoice | null = null;
if (typeof location !== 'undefined') {
  const v = new URLSearchParams(location.search).get('vector');
  if (valid(v)) override = v;
}
let preference: VectorEngineChoice = valid(stored) ? stored : 'auto';
/** In memory only: a reload gives the GPU another chance (a latched session demotion kept fixed tabs on the CPU). */
let demoted: string | undefined;
/** Set while `demoted` is a slow-tile trial: the GPU tile time it started from, the processor tiles drawn since,
 * and when the GPU is tried again once the processor has won. */
let trial: { gpuMs: number; cpu: number[]; retryAt?: number } | undefined;
let retryMs = RETRY_MS;
/** Median processor tile time of the last trial: the GPU is not put on trial again while it stays below it. */
let cpuReference: number | undefined;
/** Raster and whole-tile (record + raster) times of the GPU tiles whose replay waited for the graphics process. */
let syncedRaster: number[] = [],
  syncedTile: number[] = [];
try {
  globalThis.sessionStorage?.removeItem(`${VECTOR_ENGINE_STORAGE_KEY}-demoted`);
} catch {
  /* Session storage is optional. */
}
/** The last rasterizer handed out (null: unavailable). Created on the first browser query, never at import;
 * sharedGpuRasterizer recreates a lost one, so a renewed GPU choice after a context loss gets a fresh context. */
let rasterizer: GpuRasterizer | null | undefined;
let gpuTiles = 0,
  cpuTiles = 0,
  fallbackTiles = 0,
  lastFallback: string | undefined;
let recordMs: number[] = [],
  rasterMs: number[] = [],
  cpuMs: number[] = [];

const push = (list: number[], value: number): void => {
  list.push(value);
  if (list.length > HISTORY) list.shift();
};
const emit = (): void => {
  const engine = getVectorEngine();
  for (const listener of listeners) listener(engine);
};

export const getVectorEnginePreference = (): VectorEngineChoice => override ?? preference;

function rasterizerOrNull(): GpuRasterizer | null {
  if (rasterizer === undefined || rasterizer?.lost) {
    if (typeof document === 'undefined') return null;
    try {
      rasterizer = sharedGpuRasterizer();
    } catch {
      rasterizer = null;
    }
  }
  return rasterizer;
}

/** The engine the next tile uses. Node and workers (no document) always answer `cpu`. */
export function getVectorEngine(): VectorEngine {
  const choice = getVectorEnginePreference();
  if (choice === 'cpu' || demoted !== undefined || typeof document === 'undefined') return 'cpu';
  const raster = rasterizerOrNull();
  if (!raster || raster.lost) return 'cpu';
  // An explicit GPU choice may use a software rasterizer; auto never does.
  if (raster.software && choice !== 'gpu') return 'cpu';
  return 'gpu';
}

/** The rasterizer, only while the engine is gpu. */
export const vectorRasterizer = (): GpuRasterizer | null => (getVectorEngine() === 'gpu' ? rasterizerOrNull() : null);

/** The rasterizer if one was created, whatever the engine now is (releases must reach its textures even after a demotion). */
export const existingGpuRasterizer = (): GpuRasterizer | null => rasterizer ?? null;

export function setVectorEnginePreference(choice: VectorEngineChoice): void {
  override = null;
  preference = choice;
  try {
    globalThis.localStorage?.setItem(VECTOR_ENGINE_STORAGE_KEY, choice);
  } catch {
    /* Private mode remains usable. */
  }
  // An explicit choice supersedes the URL for this browser and future reloads, and gives the GPU another chance.
  if (typeof history !== 'undefined' && typeof location !== 'undefined') {
    const url = new URL(location.href);
    url.searchParams.delete('vector');
    try {
      history.replaceState(history.state, '', url);
    } catch {
      /* Sandboxed hosts may disallow history changes. */
    }
  }
  if (choice !== 'cpu' && demoted !== undefined) {
    demoted = undefined;
    trial = undefined;
  }
  emit();
}

export function onVectorEngineChange(listener: (engine: VectorEngine) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function demote(reason: string): void {
  // A failure ends a trial too: the processor then keeps the page.
  if (demoted !== undefined && !trial) return;
  demoted = reason || 'unknown';
  trial = undefined;
  console.warn(`Vector engine: GPU disabled for this page, the processor draws the map (${demoted}).`);
  emit();
}
const medianOf = (values: readonly number[]): number => {
  const sorted = values.slice(-SLOW_WINDOW).sort((a, b) => a - b);
  return (sorted[SLOW_WINDOW / 2 - 1] + sorted[SLOW_WINDOW / 2]) / 2;
};
function promote(why: string): void {
  demoted = undefined;
  trial = undefined;
  syncedRaster = [];
  syncedTile = [];
  console.info(`Vector engine: the GPU draws the map again (${why}).`);
  emit();
}

/** `synced`: the replay waited for the graphics process (GpuRasterizer.lastStats), so `raster` includes the GPU's time. */
export function noteGpuTile(record: number, raster: number, synced = true): void {
  gpuTiles++;
  push(recordMs, record);
  push(rasterMs, raster);
  if (!synced) return;
  push(syncedRaster, raster);
  push(syncedTile, record + raster);
  if (getVectorEnginePreference() !== 'auto' || demoted !== undefined || syncedRaster.length < SLOW_WINDOW) return;
  const median = medianOf(syncedRaster),
    tile = medianOf(syncedTile);
  // Slow against the fixed budget, and against the processor once a trial has measured it on this page.
  if (median <= SLOW_RASTER_MS || (cpuReference !== undefined && tile * CPU_WINS <= cpuReference)) return;
  demoted = `slow GPU tiles (median ${median.toFixed(0)} ms)`;
  trial = { gpuMs: tile, cpu: [] };
  console.warn(`Vector engine: the processor draws the map for now (${demoted}); the faster engine stays.`);
  emit();
}
export function noteCpuTile(ms: number): void {
  cpuTiles++;
  push(cpuMs, ms);
  if (!trial) return;
  push(trial.cpu, ms);
  if (trial.cpu.length < SLOW_WINDOW) return;
  // Compared on its last tiles for as long as the processor draws: the first ones may be light (a view at rest)
  // and the next ones a whole new style.
  const median = medianOf(trial.cpu);
  // The processor is not clearly faster: the slowness was not the GPU engine's (a busy graphics process, a heavy map).
  if (median >= trial.gpuMs * CPU_WINS) {
    cpuReference = median;
    promote(`processor tiles ${median.toFixed(0)} ms, GPU tiles ${trial.gpuMs.toFixed(0)} ms`);
    return;
  }
  if (trial.retryAt === undefined) {
    cpuReference = median;
    trial.retryAt = performance.now() + retryMs;
    retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
  } else if (performance.now() >= trial.retryAt) {
    cpuReference = undefined;
    promote('new try');
  }
}
/** A tile the recorder cannot represent: drawn on the processor, the engine stays. */
export function noteGpuFallback(reason: string): void {
  fallbackTiles++;
  lastFallback = reason;
}
/** Context loss or a raster error: the processor takes over for the session. */
export function noteGpuFailure(error: unknown): void {
  demote(error instanceof Error ? error.message : String(error));
}

/** Slowest live frame part seen since the last reset (ms), for diagnosing pan/zoom hitches. */
let liveParts: Record<string, number> = {};
/** Records `now - since` under `part` (kept as a maximum) and returns now. */
export function noteLivePart(part: string, since: number): number {
  const t = performance.now(),
    ms = t - since;
  liveParts[part] = Math.max(liveParts[part] ?? 0, ms);
  if (part === 'frame' || part === 'ground') {
    const list = (liveSeries[part] ??= []);
    if (list.length < 4000) list.push(ms);
  }
  return t;
}
/** Every live frame's work and ground submit time since the last reset (profiling). */
let liveSeries: Record<string, number[]> = {};
export function vectorEngineStats(): VectorEngineStats {
  const engine = getVectorEngine(),
    raster = rasterizer ?? null;
  return {
    preference: getVectorEnginePreference(),
    engine,
    renderer: raster?.renderer ?? '',
    software: raster?.software ?? false,
    ...(demoted !== undefined ? { demoted } : {}),
    gpuTiles,
    cpuTiles,
    fallbackTiles,
    ...(lastFallback !== undefined ? { lastFallback } : {}),
    recordMs: [...recordMs],
    rasterMs: [...rasterMs],
    cpuMs: [...cpuMs],
    liveParts: { ...liveParts },
    liveSeries: { ...liveSeries },
  };
}

export function resetVectorEngineStats(): void {
  gpuTiles = cpuTiles = fallbackTiles = 0;
  lastFallback = undefined;
  recordMs = [];
  rasterMs = [];
  cpuMs = [];
  liveParts = {};
  liveSeries = {};
  syncedRaster = [];
  syncedTile = [];
}

/** Debug and parity scripts drive the engine through this hook. */
if (typeof document !== 'undefined') {
  (globalThis as unknown as Record<string, unknown>).__muVectorEngine = { get: getVectorEngine, preference: getVectorEnginePreference, set: setVectorEnginePreference, stats: vectorEngineStats, reset: resetVectorEngineStats };
}
