/** Machine policy used by page startup and the navigation sampler. ?machine=capable|slow|veryslow
 * forces detection for tests, but never overrides a saved recipe, project, city code or explicit style selection.
 * Missing optional hints are neutral. No benchmark or GPU work is added to the startup critical path.
 */
import type { PresetId } from '../render/composition';
import { SOFTWARE_GL } from '../render/softwareGl';
export type MachineTier = 'capable' | 'slow' | 'veryslow';
export type MachineReason = 'normal' | 'forced' | 'software' | 'webgl' | 'resources' | 'frames';
export interface MachineDecision {
  tier: MachineTier;
  reason: MachineReason;
}
export interface MachineSignals {
  webgl2: boolean;
  renderer?: string;
  cores?: number;
  memory?: number;
  adapter?: { name?: string; maxTextureDimension2D?: number; maxStorageBufferBindingSize?: number };
  frameMs?: number;
}
/** Four logical threads alone are inconclusive; combine with RAM or a restricted/integrated GPU. */
export const LOW_CPU_THREADS = 4;
/** Browser memory is rounded and often capped at 8 GiB; only <=4 GiB is a resource constraint. */
export const LOW_MEMORY_GB = 4;
/** Two threads and <=2 GiB together justify the CPU-only minimal renderer. */
export const VERY_LOW_CPU_THREADS = 2;
/** Together with the thread threshold, <=2 GiB leaves little room for compositor surfaces. */
export const VERY_LOW_MEMORY_GB = 2;
/** An 8192 texture ceiling is a supporting hint, never proof of a slow GPU by itself. */
export const LOW_TEXTURE_LIMIT = 8192;
/** The WebGPU minimum storage binding size is a supporting restriction, not a speed measurement. */
export const LOW_STORAGE_LIMIT = 128 * 1024 * 1024;
/** Sustained navigation above ~30 ms cannot provide a fluid full-quality map. */
export const SLOW_FRAME_MS = 34;
/** Sustained navigation above 80 ms warrants the independent minimal view. */
export const VERY_SLOW_FRAME_MS = 80;
/** Sample twenty actual foreground navigation frames, excluding startup and idle gaps. */
export const FRAME_SAMPLE_COUNT = 20;
/** Only the first ten seconds of actual navigation contribute samples. */
const FRAME_SAMPLE_WINDOW_MS = 10000;
/** Adapter hints must never postpone default selection for longer than half a second. */
const ADAPTER_HINT_WAIT_MS = 500;
const integrated = /intel.*(?:uhd|hd graphics|iris)|mali|adreno|radeon.*(?:graphics|[67]\d0m)/i;
export const forcedMachineTier = (value: string | null): MachineTier | undefined => (value === 'capable' || value === 'slow' || value === 'veryslow' ? value : undefined);
export function decideMachineTier(s: MachineSignals, force?: MachineTier): MachineDecision {
  if (force) return { tier: force, reason: 'forced' };
  const renderer = `${s.renderer ?? ''} ${s.adapter?.name ?? ''}`;
  if (SOFTWARE_GL.test(renderer) || /\bwarp\b/i.test(renderer)) return { tier: 'veryslow', reason: 'software' };
  if (!s.webgl2) return { tier: 'veryslow', reason: 'webgl' };
  if (s.frameMs && s.frameMs >= VERY_SLOW_FRAME_MS) return { tier: 'veryslow', reason: 'frames' };
  if (s.cores && s.cores <= VERY_LOW_CPU_THREADS && s.memory && s.memory <= VERY_LOW_MEMORY_GB) return { tier: 'veryslow', reason: 'resources' };
  const lowCpu = !!s.cores && s.cores <= LOW_CPU_THREADS,
    lowMemory = !!s.memory && s.memory <= LOW_MEMORY_GB;
  const gpu = s.adapter;
  const lowGpu = integrated.test(`${s.renderer ?? ''} ${gpu?.name ?? ''}`) || !!(gpu?.maxTextureDimension2D && gpu.maxTextureDimension2D <= LOW_TEXTURE_LIMIT && gpu.maxStorageBufferBindingSize && gpu.maxStorageBufferBindingSize <= LOW_STORAGE_LIMIT);
  return (lowCpu && lowMemory) || (lowGpu && (lowCpu || lowMemory)) ? { tier: 'slow', reason: 'resources' } : s.frameMs && s.frameMs >= SLOW_FRAME_MS ? { tier: 'slow', reason: 'frames' } : { tier: 'capable', reason: 'normal' };
}
export function machineDefaultPreset(tier: MachineTier, full: PresetId): PresetId {
  return tier === 'veryslow' ? 'minimal' : tier === 'slow' && (full === 'satellite' || full === 'parchment') ? `${full}-light` : full;
}
let decision: MachineDecision = { tier: 'capable', reason: 'normal' },
  protectedStyle = false;
let signals: MachineSignals | undefined,
  force: MachineTier | undefined,
  samples: number[] = [];
let sampleUntil = 0;
const listeners = new Set<(decision: MachineDecision) => void>();
export const machineDecision = (): MachineDecision => ({ ...decision });
export const machineStyleProtected = (): boolean => protectedStyle;
export function protectMachineStyle(): void {
  protectedStyle = true;
}
export function onMachineDecision(listener: (decision: MachineDecision) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function publish(next: MachineDecision): void {
  decision = next;
  for (const listener of listeners) listener(next);
}
/** Called by consecutive moving live-compositor frames; only their first ten seconds are sampled. */
export function reportMachineFrame(ms: number): void {
  if (!signals || force || protectedStyle || samples.length >= FRAME_SAMPLE_COUNT) return;
  if (!sampleUntil) sampleUntil = performance.now() + FRAME_SAMPLE_WINDOW_MS;
  if (performance.now() > sampleUntil) return;
  samples.push(ms);
  if (samples.length === FRAME_SAMPLE_COUNT) {
    const next = decideMachineTier({ ...signals, frameMs: samples.reduce((a, b) => a + b, 0) / samples.length });
    // Style changes may dispose this compositor: publish only after its frame has returned.
    queueMicrotask(() => publish(next));
  }
}
/** Deferred by the boot module until after client initialization. A tiny temporary GL context is released immediately.
 * Optional WebGPU adapter hints have a bounded wait; absence of WebGPU never implies slow WebGL.
 */
export async function inspectMachine(): Promise<MachineDecision> {
  force = forcedMachineTier(new URLSearchParams(location.search).get('machine'));
  const canvas = document.createElement('canvas');
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
  } catch {
    /* Privacy policy can deny context creation. */
  }
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  signals = { webgl2: !!gl, renderer: gl ? String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)) : '', cores: navigator.hardwareConcurrency, memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory };
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  let timer: number | undefined;
  try {
    const adapter = await Promise.race([
      navigator.gpu?.requestAdapter(),
      new Promise<undefined>(resolve => {
        timer = window.setTimeout(resolve, ADAPTER_HINT_WAIT_MS);
      }),
    ]);
    if (adapter)
      signals.adapter = { name: [adapter.info?.vendor, adapter.info?.architecture, adapter.info?.device, adapter.info?.description].join(' '), maxTextureDimension2D: adapter.limits.maxTextureDimension2D, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize };
  } catch {
    /* Optional GPU hints: WebGL2 remains authoritative for map availability. */
  } finally {
    window.clearTimeout(timer);
  }
  publish(decideMachineTier(signals, force));
  return machineDecision();
}
