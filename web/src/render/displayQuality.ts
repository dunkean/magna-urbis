/** Live recipe quality, browser fallback and URL override. Captures always stay full. */
export const DISPLAY_QUALITIES = ['auto', 'full', 'light'] as const;
export type DisplayQuality = typeof DISPLAY_QUALITIES[number];
export type ResolvedDisplayQuality = Exclude<DisplayQuality, 'auto'>;
export const DISPLAY_QUALITY_STORAGE_KEY = 'magna-urbis-display-quality';
type Change = { quality: ResolvedDisplayQuality; reason: 'auto' | 'preference' | 'appearance' };
const listeners = new Set<(change: Change) => void>();
const valid = (value: unknown): value is DisplayQuality => DISPLAY_QUALITIES.includes(value as DisplayQuality);
let stored: string | null = null;
try { stored = globalThis.localStorage?.getItem(DISPLAY_QUALITY_STORAGE_KEY) ?? null; } catch { /* Storage is optional. */ }
let override = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('quality');
if (override !== 'full' && override !== 'light') override = null;
let preference: DisplayQuality = valid(stored) ? stored : 'auto';
let appearanceQuality: ResolvedDisplayQuality = 'full';
let demoted = false, initialized = false, started = false, rendererName = '', probeUntil = 0, longTasks = 0;
try { demoted = globalThis.sessionStorage?.getItem(`${DISPLAY_QUALITY_STORAGE_KEY}-demoted`) === '1'; } catch { /* Session storage is optional. */ }
let observer: PerformanceObserver | undefined, probeTimer: ReturnType<typeof setTimeout> | undefined;
let probeFrame: number | undefined;
let previousFrame = 0, previousNavigation = 0, slowFrames = 0, frameCount = 0;

export const getDisplayQualityPreference = (): DisplayQuality => (override as DisplayQuality | null) ?? preference;
export const getDisplayQuality = (): ResolvedDisplayQuality => {
  if (override) return override as ResolvedDisplayQuality;
  if (appearanceQuality === 'light') return 'light';
  const choice = getDisplayQualityPreference();
  return choice === 'auto' ? demoted ? 'light' : 'full' : choice;
};
/** Set only from the live view owner, never while resolving controls or exports. */
export function setDisplayAppearanceQuality(quality: ResolvedDisplayQuality): void {
  if (appearanceQuality === quality) return;
  appearanceQuality = quality; emit('appearance');
}
/** Every non-live draw, including sheet screenshots, is exact and full quality. */
export const displayQualityFor = (live: boolean): ResolvedDisplayQuality => live ? getDisplayQuality() : 'full';
/** Shared shader ABI, including offscreen/capture draws and sheet screenshots. */
export const displayQualityUniform = (live: boolean): 0 | 1 => displayQualityFor(live) === 'light' ? 1 : 0;
export function onDisplayQualityChange(listener: (change: Change) => void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}
function emit(reason: Change['reason']): void {
  const change = { quality: getDisplayQuality(), reason };
  for (const listener of listeners) listener(change);
}
function stopProbe(): void {
  observer?.disconnect(); observer = undefined; clearTimeout(probeTimer); probeTimer = undefined;
  if (probeFrame !== undefined) cancelAnimationFrame(probeFrame); probeFrame = undefined;
}
function stepDown(): void {
  if (demoted || appearanceQuality === 'light' || getDisplayQualityPreference() !== 'auto') return;
  demoted = true;
  try { globalThis.sessionStorage?.setItem(`${DISPLAY_QUALITY_STORAGE_KEY}-demoted`, '1'); } catch { /* Keep the in-memory latch. */ }
  stopProbe(); emit('auto');
}
function staticHints(): void {
  if (typeof navigator === 'undefined') return;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const smallCpu = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 8 && memory !== undefined && memory <= 8;
  const integrated = /intel.*(?:uhd|iris)|(?:amd\s+)?radeon(?:\(tm\))?\s+(?:graphics|7\d0m)|apple\s+m[12](?!\d|\s+(?:pro|max|ultra))|mali|adreno|swiftshader|llvmpipe|software/i.test(rendererName);
  const discrete = /nvidia|geforce|quadro|radeon.*(?:\brx\b|\bpro\b)|intel.*arc/i.test(rendererName);
  const pixels = typeof window === 'undefined' ? 0 : window.innerWidth * window.innerHeight * (window.devicePixelRatio || 1) ** 2;
  if (integrated || smallCpu || pixels >= 4_000_000 && !discrete) stepDown();
}
/** Feed the existing map context's debug name; no extra WebGL context or shader compilation. */
export function reportDisplayRenderer(name: string): void { rendererName = name; if (initialized) staticHints(); }
/** Static hints apply on the first live display, before the navigation-only runtime probe starts. */
export function initializeDisplayQuality(): void {
  if (initialized) return;
  initialized = true;
  if (demoted && getDisplayQualityPreference() === 'auto') emit('auto'); else staticHints();
}
export function setDisplayQualityPreference(choice: DisplayQuality): void {
  override = null; preference = choice;
  try { globalThis.localStorage?.setItem(DISPLAY_QUALITY_STORAGE_KEY, choice); } catch { /* Private mode remains usable. */ }
  // An explicit choice supersedes the URL for this browser and future reloads.
  if (typeof history !== 'undefined' && typeof location !== 'undefined') {
    const url = new URL(location.href); url.searchParams.delete('quality');
    try { history.replaceState(history.state, '', url); } catch { /* Sandboxed hosts may disallow history changes. */ }
  }
  if (choice !== 'auto') stopProbe(); else if (initialized) staticHints();
  emit('preference');
}
/** A long task starting this long after the last view change is no longer the navigation's (the settle repaint runs at ~160 ms). */
const NAVIGATION_TASK_MS = 600;
/** Called only when the live camera changes, so loading/generation before navigation is excluded. */
export function noteDisplayNavigation(time = performance.now()): void {
  previousNavigation = time;
  if (started) return;
  started = true; probeUntil = time + 30_000;
  staticHints();
  if (getDisplayQualityPreference() !== 'auto' || demoted) return;
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver(list => {
        if (performance.now() > probeUntil) { stopProbe(); return; }
        // Only tasks caused by navigation (the move itself or its settle repaint) count: a style switch, a generation
        // or opening 3D during the probe window says nothing about whether the map can be navigated.
        for (const entry of list.getEntries()) {
          const sinceMove = entry.startTime - previousNavigation;
          if (entry.startTime < time || sinceMove < -50 || sinceMove > NAVIGATION_TASK_MS) continue;
          if (entry.duration > 1000 || entry.duration > 250 && ++longTasks >= 3) { stepDown(); break; }
        }
      });
      observer.observe({ type: 'longtask', buffered: false });
    } catch { observer = undefined; }
  }
  probeTimer = setTimeout(stopProbe, 30_000);
  if (typeof requestAnimationFrame === 'function') {
    const sample = (stamp: number): void => {
      probeFrame = undefined; noteDisplayFrame(stamp);
      if (!demoted && stamp < probeUntil && getDisplayQualityPreference() === 'auto') probeFrame = requestAnimationFrame(sample);
    };
    probeFrame = requestAnimationFrame(sample);
  }
}
/** Cheap fallback: sample only consecutive navigation frames, never idle or background gaps. */
export function noteDisplayFrame(time = performance.now()): void {
  if (!started || demoted || time > probeUntil || getDisplayQualityPreference() !== 'auto') return;
  const gap = time - previousFrame;
  if (typeof document !== 'undefined' && !document.hidden && time - previousNavigation < 200 && gap > 0 && gap < 250) {
    frameCount++; if (gap > 40) slowFrames++;
    if (frameCount >= 20 && slowFrames >= 12) stepDown();
  }
  previousFrame = time;
}
