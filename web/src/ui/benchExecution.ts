import { executionRuntime, executionProfiles } from './executionProfile';
import { LOCALE_KEY, savedLocale } from './shellLocale';
import { expectedWasmThreads, threadsIsolated, type WasmThreadsInfo } from '../../../rust/bridge/wasmThreads';
import { DEFAULT_PYTHON_SERVER } from '../../../rust/bridge/terrain';
import type { BenchTimings } from './benchTimings';
import type { RenderStats } from '../render/renderMode';

/** Execution group of the Rust bench shell: terrain generation backend, WASM threads, render mode and
 * relief source, plus the live state of the active atelier and its last-run stage timings. The host URL
 * (`?generation=&threads=&render=&source=`) is the single source of these choices; ateliers receive them
 * through applyExecutionOptions() and are reloaded when one changes. */
const KEYS = ['generation', 'threads', 'render', 'source'] as const;
type Key = typeof KEYS[number];
const overrides = new Map<Key, string>();
{
  const params = new URLSearchParams(location.search);
  for (const key of KEYS) { const value = params.get(key); if (value) overrides.set(key, value); }
}

/** Put the host's execution choices on an atelier URL. */
export function applyExecutionOptions(url: URL): URL {
  for (const [key, value] of overrides) {
    if (key === 'generation' && value === 'native' && executionRuntime.profile !== 'local') continue;
    if (key === 'threads' && executionRuntime.profile === 'local') continue;
    url.searchParams.set(key, value);
  }
  return url;
}

type Words = Record<string, string>;
const text: Record<'fr' | 'en', Words> = {
  fr: { generation: 'Terrain', threads: 'Threads', render: 'Rendu', source: 'Relief', timings: 'Temps', auto: 'auto', def: 'défaut',
    webgpuOff: 'WebGPU indisponible dans ce navigateur', nativeOnly: 'Nécessite le profil Local · Rust', engineOff: 'Moteur Rust hors ligne (npm run start:local)',
    pythonOff: 'Serveur Python hors ligne', pythonWeb: 'Source neuronale Python : profil Local · Rust seulement', noIsolation: 'Page non isolée (COOP/COEP) : pas de SharedArrayBuffer',
    nativeThreads: 'Le moteur natif est toujours multithread', noGl: 'WebGL2 indisponible', stage: 'Étape', ms: 'ms', none: 'Aucune mesure : lancez une génération.', cpu: 'CPU', gpu: 'GPU',
    neural: 'Python neuronal', procedural: 'Procédural', off: 'off (1 thread)', on: 'on (rayon)', pool: 'pool (workers)', multi: 'multithread', native: 'Rust natif',
    terrain: 'Relief', hydrology: 'Hydrologie', settlements: 'Implantations', roads: 'Routes', quarters: 'Quartiers', parcels: 'Parcelles', buildings: 'Bâtiments' },
  en: { generation: 'Terrain', threads: 'Threads', render: 'Render', source: 'Relief', timings: 'Timings', auto: 'auto', def: 'default',
    webgpuOff: 'WebGPU is unavailable in this browser', nativeOnly: 'Needs the Local · Rust profile', engineOff: 'Rust engine offline (npm run start:local)',
    pythonOff: 'Python server offline', pythonWeb: 'Python neural source: Local · Rust profile only', noIsolation: 'Page not cross-origin isolated (COOP/COEP): no SharedArrayBuffer',
    nativeThreads: 'The native engine is always multithreaded', noGl: 'WebGL2 unavailable', stage: 'Stage', ms: 'ms', none: 'No measurement yet: run a generation.', cpu: 'CPU', gpu: 'GPU',
    neural: 'Neural Python', procedural: 'Procedural', off: 'off (1 thread)', on: 'on (rayon)', pool: 'pool (workers)', multi: 'multithread', native: 'Native Rust',
    terrain: 'Terrain', hydrology: 'Hydrology', settlements: 'Settlements', roads: 'Roads', quarters: 'Quarters', parcels: 'Parcels', buildings: 'Buildings' },
};
const words = (): Words => text[savedLocale() === 'fr' ? 'fr' : 'en'];

export interface BenchExecutionOptions {
  host: Element;
  /** Reload the active atelier on the (already updated) execution options. */
  reload(): void;
  /** Windows of the loaded ateliers, active first, to read live state and timings. */
  frames(): Window[];
}

const STAGE_ORDER = ['terrain', 'hydrology', 'settlements', 'roads', 'quarters', 'parcels', 'buildings'];

export function installBenchExecution({ host, reload, frames }: BenchExecutionOptions): void {
  const group = document.createElement('div');
  group.dataset.benchExecution = '';
  group.style.cssText = 'display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;font:12px system-ui;position:relative';
  const persist = (): void => {
    try {
      const url = new URL(location.href);
      for (const key of KEYS) { if (overrides.has(key)) url.searchParams.set(key, overrides.get(key)!); else url.searchParams.delete(key); }
      history.replaceState(history.state, '', url);
    } catch { /* No history. */ }
  };
  const select = (key: Key): HTMLSelectElement => {
    const s = document.createElement('select'); s.dataset.execKey = key;
    s.style.cssText = 'font:inherit;padding:3px;border:1px solid #879887;border-radius:3px;background:#f4f1e6;color:#273d33;max-width:130px';
    s.onchange = () => { if (s.value) overrides.set(key, s.value); else overrides.delete(key); persist(); reload(); refresh(); };
    return s;
  };
  const labelled = (control: HTMLSelectElement): { label: HTMLLabelElement; caption: Text } => {
    const label = document.createElement('label'); label.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap';
    const caption = document.createTextNode(''); label.append(caption, control); group.append(label);
    return { label, caption };
  };
  const generation = select('generation'), threads = select('threads'), render = select('render'), source = select('source');
  const parts = { generation: labelled(generation), threads: labelled(threads), render: labelled(render), source: labelled(source) };
  const live = document.createElement('small'); live.setAttribute('role', 'status'); live.dataset.execLive = ''; live.style.cssText = 'white-space:nowrap;opacity:.85';
  const button = document.createElement('button'); button.type = 'button'; button.dataset.execTimings = '';
  button.style.cssText = 'font:inherit;padding:3px 8px;border:1px solid #879887;border-radius:3px;background:transparent;color:inherit;cursor:pointer';
  const panel = document.createElement('div'); panel.hidden = true; panel.dataset.execPanel = '';
  panel.style.cssText = 'position:absolute;top:100%;right:0;z-index:20;margin-top:6px;min-width:280px;padding:10px 12px;background:#fffdf6;color:#273d33;border:1px solid #879887;border-radius:4px;box-shadow:0 4px 18px #0003';
  button.onclick = () => { panel.hidden = !panel.hidden; refresh(); };
  group.append(live, button, panel);
  host.append(group);

  let engine: 'checking' | 'online' | 'offline' = executionRuntime.profile === 'local' ? 'checking' : 'online';
  let python: 'checking' | 'online' | 'offline' = 'checking';
  const probe = (url: string, set: (value: 'online' | 'offline') => void): void => {
    void fetch(`${url}/status`, { signal: AbortSignal.timeout(4000) }).then(r => set(r.ok ? 'online' : 'offline'), () => set('offline')).then(refresh);
  };
  if (executionRuntime.profile === 'local') probe(executionRuntime.server, v => { engine = v; });
  probe(DEFAULT_PYTHON_SERVER, v => { python = v; });
  const webgpu = typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;
  const webgl = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();

  function fill(s: HTMLSelectElement, options: Array<[string, string, string?]>, current: string): void {
    s.replaceChildren(...options.map(([value, label, why]) => {
      const o = new Option(why ? `${label} ✕` : label, value); if (why) { o.disabled = true; o.title = why; } return o;
    }));
    s.value = options.some(([value, , why]) => value === current && !why) ? current : options[0][0];
    s.title = options.find(([value]) => value === s.value)?.[2] ?? '';
  }

  function liveInfo(): { threads?: WasmThreadsInfo; render?: RenderStats } {
    for (const win of frames()) {
      const w = win as Window & { magnaWasmThreads?: WasmThreadsInfo; magnaRenderStats?: RenderStats };
      try { if (w.magnaWasmThreads || w.magnaRenderStats) return { threads: w.magnaWasmThreads ?? expectedWasmThreads(), render: w.magnaRenderStats }; } catch { /* Restricted frame. */ }
    }
    return { threads: (window as Window & { magnaWasmThreads?: WasmThreadsInfo }).magnaWasmThreads };
  }

  function paintTimings(w: Words): void {
    const merged: Record<string, number> = {};
    for (const win of frames()) { try { Object.assign(merged, (win as Window & { magnaBenchTimings?: BenchTimings }).magnaBenchTimings?.stages ?? {}); } catch { /* Restricted frame. */ } }
    const keys = Object.keys(merged).sort((a, b) => {
      const ia = STAGE_ORDER.indexOf(a.split('.')[0]), ib = STAGE_ORDER.indexOf(b.split('.')[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    const rows = keys.map(key => {
      const [head, ...rest] = key.split('.');
      return `<tr data-stage="${key}"><td style="padding:1px 10px 1px 0">${rest.length ? '&nbsp;&nbsp;' : ''}${w[head] ?? head}${rest.length ? ` · ${rest.join('.')}` : ''}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${merged[key].toFixed(0)} ${w.ms}</td></tr>`;
    }).join('');
    panel.innerHTML = keys.length ? `<table style="border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left">${w.stage}</th><th style="text-align:right">${w.ms}</th></tr></thead><tbody>${rows}</tbody></table>` : `<small>${w.none}</small>`;
  }

  function refresh(): void {
    const w = words(), local = executionRuntime.profile === 'local';
    parts.generation.caption.textContent = `${w.generation} `; parts.threads.caption.textContent = `${w.threads} `;
    parts.render.caption.textContent = `${w.render} `; parts.source.caption.textContent = `${w.source} `;
    const gpuWhy = webgpu ? undefined : w.webgpuOff;
    const nativeWhy = !local ? w.nativeOnly : engine === 'offline' ? w.engineOff : undefined;
    const fallback = local ? 'native' : String(executionProfiles.web.generation);
    fill(generation, [['cpu', `${w.cpu} (WASM)`], ['gpu', `${w.gpu} · gpu`, gpuWhy], ['gpu-all', `${w.gpu} · gpu-all`, gpuWhy], ['gpu-erosion', `${w.gpu} · gpu-erosion`, gpuWhy], ['native', w.native, nativeWhy]], overrides.get('generation') ?? fallback);
    const threadsWhy = local ? w.nativeThreads : !threadsIsolated() ? w.noIsolation : undefined;
    fill(threads, [['auto', 'auto'], ['on', w.on], ['off', w.off], ['pool', w.pool]], local ? 'auto' : overrides.get('threads') ?? 'auto');
    threads.disabled = !!threadsWhy; parts.threads.label.title = threadsWhy ?? '';
    fill(render, [['auto', w.auto], ['gpu', 'GPU (WebGL2)', webgl ? undefined : w.noGl], ['cpu', 'CPU (Canvas 2D)']], overrides.get('render') ?? 'auto');
    const pythonWhy = !local ? w.pythonWeb : python === 'offline' ? w.pythonOff : undefined;
    fill(source, [['', w.def], ['procedural', w.procedural], ['neural-python', w.neural, pythonWhy]], overrides.get('source') ?? '');
    // The profile picker keeps both options; say why Local is not usable.
    const localOption = document.querySelector<HTMLOptionElement>('[data-execution-profile] option[value="local"]');
    if (localOption) localOption.title = engine === 'offline' ? w.engineOff : '';

    const info = liveInfo();
    const mode = local ? `${w.native} · ${w.multi}` : `WASM ${info.threads ? `${info.threads.mode}×${info.threads.threads}` : '—'}`;
    live.textContent = `${mode} · ${w.render.toLowerCase()} ${info.render?.path ?? '—'}${info.render?.ms ? ` ${info.render.ms.toFixed(1)} ms` : ''}`;
    live.title = JSON.stringify({ magnaWasmThreads: info.threads, magnaRenderStats: info.render, crossOriginIsolated: window.crossOriginIsolated }, null, 1);
    button.textContent = `⏱ ${w.timings}`;
    if (!panel.hidden) paintTimings(w);
  }

  window.addEventListener('magna-locale-change', refresh);
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 1000);
  refresh();
}
