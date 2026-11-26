/**
 * Breadcrumb journal of this device: what the page did around a failure, kept across reloads and crashes (localStorage,
 * the last few sessions). A phone cannot show a console; Settings › Performance copies this text for a bug report.
 *
 * It records only page events (visibility and lifecycle, lost and restored graphics contexts, the performance level,
 * the view presenting the map, runs, notices shown, errors, long tasks), never map content or recipes.
 */
import { MAP_GPU_FAILED_EVENT, MAP_GPU_LIGHTER_EVENT } from '../ui/glContextRecovery';
import { liveStats } from '../render/live/liveStats';
import { machineSummary, onMachineDecision } from './machineTier';

const KEY = 'magna-urbis-journal';
/** Sessions kept: the one that failed is usually the one before the reload. */
const SESSIONS = 4;
/** Entries kept per session (the newest). */
const ENTRIES = 200;
/** A main-thread task at least this long is a freeze the user saw. */
const LONG_TASK_MS = 500;
type Entry = [seconds: number, what: string, detail?: string];
interface Session {
  at: string;
  build: string;
  device: string;
  entries: Entry[];
}

let sessions: Session[] = [],
  current: Session | undefined;
const started = typeof performance === 'undefined' ? 0 : performance.now();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    /* Storage is optional: the journal then lives in memory for this session. */
  }
}
/** Adds one line, written at once: the next event may be the crash. */
export function note(what: string, detail?: unknown): void {
  if (!current) return;
  const text = detail === undefined ? undefined : String(detail).slice(0, 240);
  current.entries.push(text === undefined ? [Math.round((performance.now() - started) / 100) / 10, what] : [Math.round((performance.now() - started) / 100) / 10, what, text]);
  if (current.entries.length > ENTRIES) current.entries.shift();
  save();
}
/** The journal as text, newest session first. */
export function journalText(): string {
  return [...sessions]
    .reverse()
    .map(session => [`# ${session.at} · build ${session.build} · ${session.device}`, ...session.entries.map(([t, what, detail]) => `${t.toFixed(1)}s ${what}${detail === undefined ? '' : ` · ${detail}`}`)].join('\n'))
    .join('\n\n');
}

const describe = (target: EventTarget | null): string => {
  const node = target as Partial<HTMLCanvasElement> | null;
  return node?.id || node?.className || node?.tagName?.toLowerCase() || 'canvas';
};

/** Starts the session and its listeners. Called once, before the page mounts. */
export function startJournal(build: string): void {
  if (current || typeof window === 'undefined' || typeof document === 'undefined') return;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Session[];
    if (Array.isArray(stored)) sessions = stored.filter(session => Array.isArray(session?.entries)).slice(-(SESSIONS - 1));
  } catch {
    sessions = [];
  }
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  current = { at: new Date().toISOString(), build, device: `${innerWidth}x${innerHeight}@${devicePixelRatio} · ${navigator.hardwareConcurrency} threads · ${memory ?? '?'} GB · ${navigator.userAgent}`, entries: [] };
  sessions.push(current);
  note('start', `${document.visibilityState} · discarded ${String((document as Document & { wasDiscarded?: boolean }).wasDiscarded ?? '?')} · isolated ${String((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated)} · webgpu ${'gpu' in navigator}`);

  document.addEventListener('visibilitychange', () => note(document.visibilityState));
  for (const type of ['freeze', 'resume']) document.addEventListener(type, () => note(type));
  for (const type of ['pagehide', 'pageshow'] as const) window.addEventListener(type, event => note(type, event.persisted ? 'persisted' : undefined));
  window.addEventListener('error', event => {
    if (event instanceof ErrorEvent) note('error', `${event.message} @ ${(event.filename ?? '').split('/').pop()}:${event.lineno}`);
  });
  window.addEventListener('unhandledrejection', event => note('rejection', event.reason instanceof Error ? event.reason.message : event.reason));
  // Context events do not bubble, but they are captured on the way down to a canvas that is in the page.
  for (const type of ['webglcontextlost', 'webglcontextrestored', 'webglcontextcreationerror'])
    document.addEventListener(type, event => note(type, `${describe(event.target)}${'statusMessage' in event && event.statusMessage ? ` · ${String(event.statusMessage)}` : ''}`), true);
  for (const type of [MAP_GPU_LIGHTER_EVENT, MAP_GPU_FAILED_EVENT]) window.addEventListener(type, () => note(type));
  onMachineDecision(decision => note('level', `${decision.level} · ${decision.reason} · ${machineSummary()}`));

  // The run state and the notices of the page, read from its own elements: no page module has to report here.
  const watch = (selector: string, options: MutationObserverInit, read: (node: HTMLElement) => void): void => {
    const attach = (): boolean => {
      const node = document.querySelector<HTMLElement>(selector);
      if (node) new MutationObserver(() => read(node)).observe(node, options);
      return !!node;
    };
    if (!attach()) window.addEventListener('load', attach, { once: true });
  };
  let busy = '';
  watch('#app', { attributes: true, attributeFilter: ['aria-busy'] }, app => {
    const next = app.getAttribute('aria-busy') === 'true' ? 'run started' : 'run ended';
    if (next !== busy && (busy || next === 'run started')) note((busy = next));
  });
  let toast = '';
  watch('#toast', { childList: true, subtree: true, characterData: true }, node => {
    const text = node.textContent?.trim() ?? '';
    if (text && text !== toast) note('toast', (toast = text));
  });
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (entry.duration >= LONG_TASK_MS) note('long task', `${Math.round(entry.duration)} ms`);
      }).observe({ type: 'longtask', buffered: false });
    } catch {
      /* Long tasks are not reported by this browser. */
    }
  }
  // Which view presents the map, and why the compositor does not, when that changes.
  let live = '';
  setInterval(() => {
    if (document.hidden) return;
    const stats = liveStats(),
      next = stats.active ? 'compositor' : (stats.reason ?? 'fallback');
    if (next !== live) note('view', (live = next));
  }, 3000);
}
