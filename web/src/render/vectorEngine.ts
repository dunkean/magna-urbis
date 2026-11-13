/**
 * Vector engine policy (design: web/out/vector-gpu-2026-11-12/DESIGN.md section 3).
 * The map style code draws through one Canvas 2D description; this module decides whether it is replayed on the
 * graphics card (recorded display list + WebGL2 rasterizer) or drawn by the processor. Preference `auto | gpu | cpu`
 * (URL `?vector=` over storage), demoted for the session on a context loss, a raster error or slow GPU tiles.
 */
import type { GpuRasterizer, VectorEngine, VectorEngineChoice } from './gpu/displayList';
import { sharedGpuRasterizer } from './gpu/glRaster';

export const VECTOR_ENGINE_CHOICES = ['auto', 'gpu', 'cpu'] as const;
export const VECTOR_ENGINE_STORAGE_KEY = 'magna-urbis-vector-engine';
/** Median raster time over the last GPU tiles above which `auto` goes back to the processor. */
const SLOW_RASTER_MS = 40, SLOW_WINDOW = 8, HISTORY = 64;

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
try { stored = globalThis.localStorage?.getItem(VECTOR_ENGINE_STORAGE_KEY) ?? null; } catch { /* Storage is optional. */ }
let override: VectorEngineChoice | null = null;
if (typeof location !== 'undefined') { const v = new URLSearchParams(location.search).get('vector'); if (valid(v)) override = v; }
let preference: VectorEngineChoice = valid(stored) ? stored : 'auto';
/** In memory only: a reload gives the GPU another chance (a latched session demotion kept fixed tabs on the CPU). */
let demoted: string | undefined;
try { globalThis.sessionStorage?.removeItem(`${VECTOR_ENGINE_STORAGE_KEY}-demoted`); } catch { /* Session storage is optional. */ }
/** The last rasterizer handed out (null: unavailable). Created on the first browser query, never at import;
 * sharedGpuRasterizer recreates a lost one, so a renewed GPU choice after a context loss gets a fresh context. */
let rasterizer: GpuRasterizer | null | undefined;
let gpuTiles = 0, cpuTiles = 0, fallbackTiles = 0, lastFallback: string | undefined;
let recordMs: number[] = [], rasterMs: number[] = [], cpuMs: number[] = [];

const push = (list: number[], value: number): void => { list.push(value); if (list.length > HISTORY) list.shift(); };
const emit = (): void => { const engine = getVectorEngine(); for (const listener of listeners) listener(engine); };

export const getVectorEnginePreference = (): VectorEngineChoice => override ?? preference;

function rasterizerOrNull(): GpuRasterizer | null {
  if (rasterizer === undefined || rasterizer?.lost) {
    if (typeof document === 'undefined') return null;
    try { rasterizer = sharedGpuRasterizer(); } catch { rasterizer = null; }
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
export const vectorRasterizer = (): GpuRasterizer | null => getVectorEngine() === 'gpu' ? rasterizerOrNull() : null;

/** The rasterizer if one was created, whatever the engine now is (releases must reach its textures even after a demotion). */
export const existingGpuRasterizer = (): GpuRasterizer | null => rasterizer ?? null;

export function setVectorEnginePreference(choice: VectorEngineChoice): void {
  override = null; preference = choice;
  try { globalThis.localStorage?.setItem(VECTOR_ENGINE_STORAGE_KEY, choice); } catch { /* Private mode remains usable. */ }
  // An explicit choice supersedes the URL for this browser and future reloads, and gives the GPU another chance.
  if (typeof history !== 'undefined' && typeof location !== 'undefined') {
    const url = new URL(location.href); url.searchParams.delete('vector');
    try { history.replaceState(history.state, '', url); } catch { /* Sandboxed hosts may disallow history changes. */ }
  }
  if (choice !== 'cpu' && demoted !== undefined) demoted = undefined;
  emit();
}

export function onVectorEngineChange(listener: (engine: VectorEngine) => void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}

function demote(reason: string): void {
  if (demoted !== undefined) return;
  demoted = reason || 'unknown';
  console.warn(`Vector engine: GPU disabled for this page, the processor draws the map (${demoted}).`);
  emit();
}

export function noteGpuTile(record: number, raster: number): void {
  gpuTiles++; push(recordMs, record); push(rasterMs, raster);
  if (getVectorEnginePreference() !== 'auto' || rasterMs.length < SLOW_WINDOW) return;
  const recent = rasterMs.slice(-SLOW_WINDOW).sort((a, b) => a - b);
  const median = (recent[SLOW_WINDOW / 2 - 1] + recent[SLOW_WINDOW / 2]) / 2;
  if (median > SLOW_RASTER_MS) demote(`slow GPU tiles (median ${median.toFixed(0)} ms)`);
}
export function noteCpuTile(ms: number): void { cpuTiles++; push(cpuMs, ms); }
/** A tile the recorder cannot represent: drawn on the processor, the engine stays. */
export function noteGpuFallback(reason: string): void { fallbackTiles++; lastFallback = reason; }
/** Context loss or a raster error: the processor takes over for the session. */
export function noteGpuFailure(error: unknown): void {
  demote(error instanceof Error ? error.message : String(error));
}

/** Slowest live frame part seen since the last reset (ms), for diagnosing pan/zoom hitches. */
let liveParts: Record<string, number> = {};
/** Records `now - since` under `part` (kept as a maximum) and returns now. */
export function noteLivePart(part: string, since: number): number {
  const t = performance.now(), ms = t - since; liveParts[part] = Math.max(liveParts[part] ?? 0, ms);
  if (part === 'frame' || part === 'ground') { const list = liveSeries[part] ??= []; if (list.length < 4000) list.push(ms); }
  return t;
}
/** Largest count seen since the last reset (profiling: draw calls, clip rebuilds per replay). */
export function noteLiveCount(part: string, n: number): void { liveParts[part] = Math.max(liveParts[part] ?? 0, n); }
/** Every live frame's work and ground submit time since the last reset (profiling). */
let liveSeries: Record<string, number[]> = {};
export function vectorEngineStats(): VectorEngineStats {
  const engine = getVectorEngine(), raster = rasterizer ?? null;
  return { preference: getVectorEnginePreference(), engine, renderer: raster?.renderer ?? '', software: raster?.software ?? false,
    ...(demoted !== undefined ? { demoted } : {}), gpuTiles, cpuTiles, fallbackTiles,
    ...(lastFallback !== undefined ? { lastFallback } : {}), recordMs: [...recordMs], rasterMs: [...rasterMs], cpuMs: [...cpuMs], liveParts: { ...liveParts }, liveSeries: { ...liveSeries } };
}

export function resetVectorEngineStats(): void {
  gpuTiles = cpuTiles = fallbackTiles = 0; lastFallback = undefined; recordMs = []; rasterMs = []; cpuMs = []; liveParts = {}; liveSeries = {};
}

/** Debug and parity scripts drive the engine through this hook. */
if (typeof document !== 'undefined') {
  (globalThis as unknown as Record<string, unknown>).__muVectorEngine = {
    get: getVectorEngine, preference: getVectorEnginePreference, set: setVectorEnginePreference, stats: vectorEngineStats, reset: resetVectorEngineStats };
}
