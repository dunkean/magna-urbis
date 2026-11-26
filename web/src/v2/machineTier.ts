/** Machine performance policy used by page startup, the navigation sampler and Settings › Performance.
 * Four levels; `tier` is their coarse view for 3D availability, tree distance and volume buildings.
 * ?machine=capable|slow|veryslow forces detection for tests, but never overrides a saved recipe, project, city code or explicit style selection.
 * Missing optional hints are neutral. No benchmark or GPU work is added to the startup critical path.
 * Desktop Auto reads hardware hints and one navigation sample. Handheld Auto starts from its learned level and moves by
 * measured navigation windows: GPU names do not tell phones apart.
 */
import type { PresetId } from '../render/composition';
import { SOFTWARE_GL } from '../render/softwareGl';
import { handheldDevice } from '../../../rust/bridge/deviceClass';
export type MachineTier = 'capable' | 'slow' | 'veryslow';
export type PerformanceLevel = 'minimal' | 'economy' | 'balanced' | 'high';
export type PerformancePreference = 'auto' | 'economy' | 'balanced' | 'high';
export type MachineReason = 'normal' | 'forced' | 'preference' | 'software' | 'webgl' | 'compositor' | 'resources' | 'frames' | 'graphics';
export interface MachineDecision {
  tier: MachineTier;
  level: PerformanceLevel;
  reason: MachineReason;
  handheld: boolean;
}
/** The desktop hardware verdict, before levels. */
export type TierDecision = Pick<MachineDecision, 'tier' | 'reason'>;
/** What a handheld learned from its navigation: its level and the highest level it may climb back to. */
export interface LearnedPerformance {
  level: PerformanceLevel;
  ceiling: PerformanceLevel;
  /** The level came down because the map lost its GPU context, not from slow frames. */
  graphics?: boolean;
}
export interface MachineSignals {
  webgl2: boolean;
  compositor?: boolean;
  renderer?: string;
  cores?: number;
  memory?: number;
  adapter?: { name?: string; maxTextureDimension2D?: number; maxStorageBufferBindingSize?: number };
  frameMs?: number;
}
export const PERFORMANCE_STORAGE_KEY = 'magna-urbis-performance';
export const PERFORMANCE_AUTO_KEY = 'magna-urbis-performance-auto';
export const PERFORMANCE_LEVELS: readonly PerformanceLevel[] = ['minimal', 'economy', 'balanced', 'high'];
export const PERFORMANCE_PREFERENCES: readonly PerformancePreference[] = ['auto', 'economy', 'balanced', 'high'];
/** Four logical threads alone are inconclusive; combine with RAM or a restricted/integrated GPU. */
export const LOW_CPU_THREADS = 4;
/** Browser memory is rounded and often capped at 8 GiB; only <=4 GiB is a resource constraint. */
export const LOW_MEMORY_GB = 4;
/** Two threads and <=2 GiB together justify the CPU-only minimal renderer. */
export const VERY_LOW_CPU_THREADS = 2;
/** Together with the thread threshold, <=2 GiB leaves little room for compositor surfaces. */
export const VERY_LOW_MEMORY_GB = 2;
/** A handheld reaches High only with 8 GiB or an unreported memory (Safari never reports it). */
export const HIGH_MEMORY_GB = 8;
/** An 8192 texture ceiling is a supporting hint, never proof of a slow GPU by itself. */
export const LOW_TEXTURE_LIMIT = 8192;
/** The WebGPU minimum storage binding size is a supporting restriction, not a speed measurement. */
export const LOW_STORAGE_LIMIT = 128 * 1024 * 1024;
/** Sustained navigation above ~30 ms cannot provide a fluid full-quality map. */
export const SLOW_FRAME_MS = 34;
/** Sustained navigation above 80 ms warrants the independent minimal view. */
export const VERY_SLOW_FRAME_MS = 80;
/** A handheld window at or under 20 ms (50 fps) has room for the next level. */
export const FAST_FRAME_MS = 20;
/** Sample twenty actual foreground navigation frames, excluding startup and idle gaps. */
export const FRAME_SAMPLE_COUNT = 20;
/** A window's twenty frames come within ten seconds of its first one. */
const FRAME_SAMPLE_WINDOW_MS = 10000;
/** Handheld windows per session: enough to settle (a demotion takes two), bounded so the level does not keep moving. */
export const HANDHELD_WINDOWS = 8;
/** Adapter hints must never postpone default selection for longer than half a second. */
const ADAPTER_HINT_WAIT_MS = 500;
const integrated = /intel.*(?:uhd|hd graphics|iris)|mali|adreno|radeon.*(?:graphics|[67]\d0m)/i;
const rank = (level: PerformanceLevel): number => PERFORMANCE_LEVELS.indexOf(level);
export const levelTier = (level: PerformanceLevel): MachineTier => (level === 'minimal' ? 'veryslow' : level === 'high' ? 'capable' : 'slow');
const tierLevel = (tier: MachineTier): PerformanceLevel => (tier === 'veryslow' ? 'minimal' : tier === 'slow' ? 'economy' : 'high');
export const forcedMachineTier = (value: string | null): MachineTier | undefined => (value === 'capable' || value === 'slow' || value === 'veryslow' ? value : undefined);
/** Limits no preference lifts: the live compositor cannot run. */
function hardLimit(s: MachineSignals): MachineReason | undefined {
  const renderer = `${s.renderer ?? ''} ${s.adapter?.name ?? ''}`;
  if (SOFTWARE_GL.test(renderer) || /\bwarp\b/i.test(renderer)) return 'software';
  if (!s.webgl2) return 'webgl';
  if (s.compositor === false) return 'compositor';
  return undefined;
}
/** Desktop Auto: hardware hints and the one-shot navigation sample. */
export function decideMachineTier(s: MachineSignals, force?: MachineTier): TierDecision {
  if (force) return { tier: force, reason: 'forced' };
  const limit = hardLimit(s);
  if (limit) return { tier: 'veryslow', reason: limit };
  if (s.frameMs && s.frameMs >= VERY_SLOW_FRAME_MS) return { tier: 'veryslow', reason: 'frames' };
  if (s.cores && s.cores <= VERY_LOW_CPU_THREADS && s.memory && s.memory <= VERY_LOW_MEMORY_GB) return { tier: 'veryslow', reason: 'resources' };
  const lowCpu = !!s.cores && s.cores <= LOW_CPU_THREADS,
    lowMemory = !!s.memory && s.memory <= LOW_MEMORY_GB;
  const gpu = s.adapter;
  const lowGpu = integrated.test(`${s.renderer ?? ''} ${gpu?.name ?? ''}`) || !!(gpu?.maxTextureDimension2D && gpu.maxTextureDimension2D <= LOW_TEXTURE_LIMIT && gpu.maxStorageBufferBindingSize && gpu.maxStorageBufferBindingSize <= LOW_STORAGE_LIMIT);
  return (lowCpu && lowMemory) || (lowGpu && (lowCpu || lowMemory)) ? { tier: 'slow', reason: 'resources' } : s.frameMs && s.frameMs >= SLOW_FRAME_MS ? { tier: 'slow', reason: 'frames' } : { tier: 'capable', reason: 'normal' };
}
/** The preset an untouched recipe shows at a level: Minimal needs the CPU renderer, Economy the fast Satellite/Parchment. */
export function machineDefaultPreset(level: PerformanceLevel, full: PresetId): PresetId {
  return level === 'minimal' ? 'minimal' : level === 'economy' && (full === 'satellite' || full === 'parchment') ? `${full}-light` : full;
}
/** A handheld without a learned level: Economy only when both CPU and memory are known to be small. */
export const handheldStartLevel = (cores?: number, memory?: number): PerformanceLevel => (cores && memory && cores <= LOW_CPU_THREADS && memory <= LOW_MEMORY_GB ? 'economy' : 'balanced');
const demoted = (state: LearnedPerformance, level: PerformanceLevel): LearnedPerformance => (level === state.level ? state : { level, ceiling: level });
/** One measured navigation window on a handheld; returns `state` itself when nothing changes. */
export function handheldWindowStep(state: LearnedPerformance, meanMs: number, first: boolean, memory?: number): LearnedPerformance {
  const r = rank(state.level);
  if (meanMs >= VERY_SLOW_FRAME_MS) return demoted(state, r > rank('economy') ? 'economy' : 'minimal');
  if (meanMs >= SLOW_FRAME_MS) return demoted(state, r > rank('economy') ? PERFORMANCE_LEVELS[r - 1] : state.level);
  const up = PERFORMANCE_LEVELS[r + 1];
  if (meanMs <= FAST_FRAME_MS && !first && up && rank(up) <= rank(state.ceiling) && (up !== 'high' || memory === undefined || memory >= HIGH_MEMORY_GB)) return { level: up, ceiling: state.ceiling };
  return state;
}
/** The display probe saw long navigation tasks: one step down, never below Economy. */
export const handheldStruggleStep = (state: LearnedPerformance): LearnedPerformance => handheldWindowStep(state, SLOW_FRAME_MS, true);
export interface PerformanceContext {
  preference: PerformancePreference;
  handheld: boolean;
  learned?: LearnedPerformance;
  force?: MachineTier;
}
/** URL force, then hard limits, then an explicit preference, then the device's automatic level. */
export function decidePerformance(s: MachineSignals, c: PerformanceContext): MachineDecision {
  const made = (level: PerformanceLevel, reason: MachineReason): MachineDecision => ({ tier: levelTier(level), level, reason, handheld: c.handheld });
  if (c.force) return made(tierLevel(c.force), 'forced');
  const limit = hardLimit(s);
  if (limit) return made('minimal', limit);
  if (c.preference !== 'auto') return made(c.preference, 'preference');
  if (!c.handheld) {
    const desktop = decideMachineTier(s);
    return made(tierLevel(desktop.tier), desktop.reason);
  }
  if (c.learned) return made(c.learned.level, rank(c.learned.level) >= rank('balanced') ? 'normal' : c.learned.graphics ? 'graphics' : 'frames');
  const start = handheldStartLevel(s.cores, s.memory);
  return made(start, start === 'economy' ? 'resources' : 'normal');
}
function readPreference(): PerformancePreference {
  try {
    const stored = globalThis.localStorage?.getItem(PERFORMANCE_STORAGE_KEY);
    return PERFORMANCE_PREFERENCES.includes(stored as PerformancePreference) ? (stored as PerformancePreference) : 'auto';
  } catch {
    return 'auto';
  }
}
/** Minimal is learned for the session only: the next visit retries the compositor from Economy. */
function readLearned(): LearnedPerformance | undefined {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(PERFORMANCE_AUTO_KEY) ?? 'null') as Partial<LearnedPerformance> | null;
    if (!value || !PERFORMANCE_LEVELS.includes(value.level!) || !PERFORMANCE_LEVELS.includes(value.ceiling!) || rank(value.level!) > rank(value.ceiling!)) return undefined;
    const floor = (level: PerformanceLevel): PerformanceLevel => (level === 'minimal' ? 'economy' : level);
    return { level: floor(value.level!), ceiling: floor(value.ceiling!), ...(value.graphics === true ? { graphics: true } : {}) };
  } catch {
    return undefined;
  }
}
function store(key: string, value: string | undefined): void {
  try {
    if (value === undefined) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    /* Storage is optional: the level then holds for this session. */
  }
}
let decision: MachineDecision = { tier: 'capable', level: 'high', reason: 'normal', handheld: false },
  protectedStyle = false;
let signals: MachineSignals | undefined,
  force: MachineTier | undefined,
  samples: number[] = [];
let sampleUntil = 0,
  sampleStart = 0,
  windows = 0,
  slowWindow = false;
let compositor: boolean | undefined;
let preference = readPreference(),
  handheld = false,
  learned: LearnedPerformance | undefined;
const listeners = new Set<(decision: MachineDecision) => void>();
export const machineDecision = (): MachineDecision => ({ ...decision });
export const machineStyleProtected = (): boolean => protectedStyle;
export const performancePreference = (): PerformancePreference => preference;
/** Guards only the preset swap of the untouched default recipe; levels still follow the machine. */
export function protectMachineStyle(): void {
  protectedStyle = true;
}
/** The autosave restored at startup is this device's own recipe: it follows the machine default like a fresh start. */
export function releaseMachineStyle(): void {
  protectedStyle = false;
}
export function onMachineDecision(listener: (decision: MachineDecision) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function publish(next: MachineDecision): void {
  decision = next;
  for (const listener of listeners) listener(next);
}
const decide = (): MachineDecision => decidePerformance({ ...signals!, compositor }, { preference, handheld, learned, force });
function refresh(): void {
  if (signals) publish(decide());
}
/** Choosing Auto again forgets what this handheld learned, so it measures afresh. */
export function setPerformancePreference(next: PerformancePreference): void {
  preference = next;
  store(PERFORMANCE_STORAGE_KEY, next);
  if (next === 'auto') {
    learned = undefined;
    windows = 0;
    slowWindow = false;
    samples = [];
    store(PERFORMANCE_AUTO_KEY, undefined);
  }
  refresh();
}
/** True once, on the first start that has no stored preference: it stores the current one (Auto by default). */
export function claimPerformancePreference(): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage || storage.getItem(PERFORMANCE_STORAGE_KEY) !== null) return false;
    storage.setItem(PERFORMANCE_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}
/** Compositor failures are capabilities, independent of an explicit style. Defer changes until its draw returns. */
export function reportMachineCompositor(available: boolean): void {
  if (compositor === available) return;
  compositor = available;
  queueMicrotask(refresh);
}
/** A handheld level change from a measurement; published after the compositor frame that measured it has returned.
 * Only frame windows are saved for later visits: a struggle is session-only. */
function learn(step: (state: LearnedPerformance) => LearnedPerformance, persist: boolean): void {
  const current: LearnedPerformance = learned ?? { level: handheldStartLevel(signals!.cores, signals!.memory), ceiling: 'high' },
    next = step(current);
  if (next === current) return;
  learned = next;
  if (persist) store(PERFORMANCE_AUTO_KEY, JSON.stringify(next));
  queueMicrotask(refresh);
}
/** Handheld: windows of twenty frames within ten seconds, each one a decision, at most HANDHELD_WINDOWS per session. */
function sampleHandheld(ms: number): void {
  if (preference !== 'auto' || windows >= HANDHELD_WINDOWS) return;
  const now = performance.now();
  if (!samples.length || now - sampleStart > FRAME_SAMPLE_WINDOW_MS) {
    samples = [];
    sampleStart = now;
  }
  samples.push(ms);
  if (samples.length < FRAME_SAMPLE_COUNT) return;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length,
    first = windows === 0;
  samples = [];
  windows++;
  // One slow window can be a burst of tile bakes or shader compilation: a demotion takes two in a row.
  const slow = mean >= SLOW_FRAME_MS,
    confirmed = slowWindow;
  slowWindow = slow && !confirmed;
  if (slow && !confirmed) return;
  learn(state => handheldWindowStep(state, mean, first, signals!.memory), true);
}
/** Called by consecutive moving live-compositor frames. Desktop samples only the first ten seconds, once. */
export function reportMachineFrame(ms: number): void {
  if (!signals || force) return;
  if (handheld) return sampleHandheld(ms);
  if (protectedStyle || samples.length >= FRAME_SAMPLE_COUNT) return;
  if (!sampleUntil) sampleUntil = performance.now() + FRAME_SAMPLE_WINDOW_MS;
  if (performance.now() > sampleUntil) return;
  samples.push(ms);
  if (samples.length === FRAME_SAMPLE_COUNT) {
    signals.frameMs = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Style changes may dispose this compositor: publish only after its frame has returned.
    queueMicrotask(refresh);
  }
}
/** The display probe saw navigation struggle: a handheld in Auto steps down for this session, never below Economy.
 * Long tasks before the first measured window (shader compilation, first tile bakes) are warm-up, and later ones never
 * become a lasting verdict. */
export function reportMachineStruggle(): void {
  if (!signals || force || !handheld || preference !== 'auto' || windows === 0) return;
  learn(handheldStruggleStep, false);
}
/** The map lost its GPU context for lack of resources (glContextRecovery.ts): measured evidence that the level is too
 * heavy for this handheld. One step down, never below Economy, kept for later visits. */
export function reportMachineGpuLoss(): void {
  if (!signals || force || !handheld || preference !== 'auto') return;
  learn(state => ({ ...handheldStruggleStep(state), graphics: true }), true);
}
/** Deferred by the boot module until after client initialization. A tiny temporary GL context is released immediately.
 * Optional WebGPU adapter hints have a bounded wait; absence of WebGPU never implies slow WebGL.
 */
export async function inspectMachine(): Promise<MachineDecision> {
  force = forcedMachineTier(new URLSearchParams(location.search).get('machine'));
  handheld = handheldDevice();
  learned = handheld ? readLearned() : undefined;
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
  refresh();
  return machineDecision();
}
