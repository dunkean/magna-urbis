/** Settings › compute and rendering backends. Shows what this machine can do and what each
 * generation actually used; unavailable choices stay visible, disabled, with the reason. */
import { detectPlatform, loopbackServer, type PlatformCapabilities } from './platform';
import { getRenderMode, setRenderMode, onRenderMode, type RenderMode, type RenderStats } from '../render/renderMode';
import { registerMessages, setText, translate } from './i18n';
import { iconImg, type IconId } from './stageIcons';

export type ThreadsMode = 'auto' | 'on' | 'off' | 'pool';
export interface BackendStatus {
  checked: boolean;
  webgpu: boolean; adapter?: string;
  isolated: boolean; sharedMemory: boolean; cores: number;
  threads: ThreadsMode;
  /** Published by the WASM packaging when it starts (`window.magnaWasmThreads`); absent before. */
  wasmThreads?: unknown;
  native: { available: boolean; server: string; capabilities: string[]; error?: string };
  python: { available: boolean; server: string; loaded: boolean; message?: string; error?: string };
  render: { mode: RenderMode; path?: 'gpu' | 'cpu'; reason?: string };
}
const copy = (en: string, fr: string) => { registerMessages({ [en]: { en, fr } }); return en; };
const T = {
  browser: copy('Compute in this browser', 'Calcul dans ce navigateur'), local: copy('Local services', 'Services locaux'), drawing: copy('Map rendering', 'Rendu de la carte'),
  wasm: copy('Rust / WASM', 'Rust / WASM'), webgpu: copy('WebGPU', 'WebGPU'), native: copy('Native Rust engine', 'Moteur Rust natif'), python: copy('Python neural server', 'Serveur neuronal Python'),
  render: copy('Render path', 'Chemin de rendu'), available: copy('Available', 'Disponible'), unavailable: copy('Unavailable', 'Indisponible'), online: copy('Online', 'En ligne'), offline: copy('Offline', 'Hors ligne'),
  checking: copy('Checking…', 'Vérification…'), active: copy('Active', 'Actif'),
  threads: copy('Threads', 'Threads'), reload: copy('Reload to apply', 'Recharger pour appliquer'),
  single: copy('Single thread', 'Un seul thread'), multi: copy('Threads (shared memory)', 'Threads (mémoire partagée)'), pool: copy('Worker pool', 'Pool de workers'), auto: copy('Automatic', 'Automatique'),
  isolation: copy('Needs cross-origin isolation (COOP / COEP headers or the coi service worker). This page is not isolated.', 'Nécessite l’isolation cross-origin (en-têtes COOP / COEP ou service worker coi). Cette page n’est pas isolée.'),
  noGpu: copy('No WebGPU adapter: the browser or driver does not expose one. CPU generation stays available.', 'Aucun adaptateur WebGPU : le navigateur ou le pilote n’en expose pas. Le calcul CPU reste disponible.'),
  gpuMode: copy('GPU · WebGL2 everywhere possible', 'GPU · WebGL2 partout où c’est possible'), cpuMode: copy('CPU · Canvas 2D', 'CPU · Canvas 2D'), autoMode: copy('Automatic', 'Automatique'),
  noNative: copy('No Magna Urbis Rust service answered on this address. Start it with npm run dev:v2:local.', 'Aucun service Rust Magna Urbis ne répond à cette adresse. Lancez-le avec npm run dev:v2:local.'),
  noPython: copy('No Python/CUDA neural service answered on this address (npm run neural:python).', 'Aucun service neuronal Python/CUDA ne répond à cette adresse (npm run neural:python).'),
  refresh: copy('Check again', 'Vérifier à nouveau'),
  cores: copy('{n} logical cores', '{n} cœurs logiques'), lastPath: copy('Last frame: {path}', 'Dernière image : {path}'),
  used: copy('The log of each generation records the backend actually used.', 'Le journal de chaque génération indique le moteur réellement utilisé.'),
};

function readThreads(): ThreadsMode {
  const value = new URLSearchParams(location.search).get('threads');
  return value === 'on' || value === 'off' || value === 'pool' ? value : 'auto';
}
let status: BackendStatus = {
  checked: false, webgpu: false, isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
  sharedMemory: typeof SharedArrayBuffer !== 'undefined', cores: navigator.hardwareConcurrency || 1, threads: readThreads(),
  native: { available: false, server: 'http://127.0.0.1:8791', capabilities: [] }, python: { available: false, server: 'http://127.0.0.1:8793', loaded: false },
  render: { mode: getRenderMode() },
};
const listeners = new Set<(status: BackendStatus) => void>();
export const backendStatus = (): BackendStatus => status;
export const onBackendStatus = (listener: (status: BackendStatus) => void): (() => void) => { listeners.add(listener); return () => listeners.delete(listener); };

export interface SettingsPanelBindings { localServer(): string; pythonServer(): string; log(message: string): void }
/** Probes are read-only: GET /status on the loopback services, a WebGPU adapter request. */
export async function refreshBackends(bindings: SettingsPanelBindings): Promise<BackendStatus> {
  let caps: PlatformCapabilities;
  const localServer = loopbackServer(bindings.localServer()), pythonServer = loopbackServer(bindings.pythonServer());
  caps = await detectPlatform({ profile: 'local', localServer, pythonServer, onProgress: event => bindings.log(event.message) });
  const stats = (window as unknown as { magnaRenderStats?: RenderStats }).magnaRenderStats;
  status = { ...status, checked: true, webgpu: caps.webgpu, adapter: caps.adapterName,
    isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated, sharedMemory: typeof SharedArrayBuffer !== 'undefined',
    wasmThreads: (window as unknown as { magnaWasmThreads?: unknown }).magnaWasmThreads,
    native: { available: caps.local.available, server: caps.local.server, capabilities: caps.local.capabilities, error: caps.local.error },
    python: { available: caps.python.available, server: caps.python.server, loaded: caps.python.loaded, message: caps.python.message, error: caps.python.error },
    render: { mode: getRenderMode(), path: stats?.path, reason: stats?.reason } };
  listeners.forEach(listener => listener(status));
  return status;
}

/** Renders the backend board into the Settings dialog. */
export function mountSettingsPanel(host: HTMLElement, bindings: SettingsPanelBindings): { render(): void } {
  host.classList.add('backend-board');
  const render = () => {
    const s = status; host.replaceChildren();
    const section = (title: string) => { const h = document.createElement('h3'); h.className = 'backend-section'; setText(h, title); host.append(h); };
    const row = (icon: IconId, name: string, state: 'ok' | 'off' | 'wait', stateText: string, detail: string, extra?: HTMLElement) => {
      const item = document.createElement('div'); item.className = 'backend-row'; item.dataset.state = state;
      const label = document.createElement('div'); label.className = 'backend-name'; const strong = document.createElement('strong'); setText(strong, name);
      const small = document.createElement('small'); small.dataset.l10nKeep = ''; small.textContent = detail; label.append(strong, small);
      const pill = document.createElement('span'); pill.className = 'backend-pill'; setText(pill, stateText);
      item.append(iconImg(icon, 30), label, pill); if (extra) item.append(extra); host.append(item);
    };
    const select = (id: string, current: string, options: [string, string, string | undefined][], onChange: (value: string) => void): HTMLSelectElement => {
      const element = document.createElement('select'); element.id = id;
      for (const [value, label, disabledReason] of options) { const option = document.createElement('option'); option.value = value; setText(option, label); option.disabled = !!disabledReason; if (disabledReason) option.title = translate(disabledReason); element.append(option); }
      element.value = current; element.onchange = () => onChange(element.value); return element;
    };
    section(T.browser);
    const threadsUnavailable = !s.isolated || !s.sharedMemory ? T.isolation : undefined;
    const threads = document.createElement('div'); threads.className = 'backend-control';
    const threadSelect = select('settings-threads', s.threads, [['auto', T.auto, undefined], ['off', T.single, undefined], ['on', T.multi, threadsUnavailable], ['pool', T.pool, threadsUnavailable]], value => {
      const url = new URL(location.href); if (value === 'auto') url.searchParams.delete('threads'); else url.searchParams.set('threads', value);
      reload.hidden = value === readThreads(); reload.onclick = () => { location.href = url.href; };
    });
    const reload = document.createElement('button'); reload.type = 'button'; reload.className = 'small'; reload.hidden = true; setText(reload, T.reload);
    const threadLabel = document.createElement('label'); threadLabel.htmlFor = threadSelect.id; setText(threadLabel, T.threads);
    if (threadsUnavailable) threads.title = translate(threadsUnavailable);
    threads.append(threadLabel, threadSelect, reload);
    const published = s.wasmThreads && typeof s.wasmThreads === 'object' ? Object.entries(s.wasmThreads as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') : '';
    row(s.threads === 'pool' ? 'backend-pool' : s.threads === 'on' ? 'backend-wasm-threads' : 'backend-wasm-single', T.wasm, 'ok', T.available,
      [translate(T.cores).replace('{n}', String(s.cores)), s.isolated ? 'crossOriginIsolated' : 'not isolated', published].filter(Boolean).join(' · '), threads);
    row('backend-webgpu', T.webgpu, s.checked ? s.webgpu ? 'ok' : 'off' : 'wait', s.checked ? s.webgpu ? T.available : T.unavailable : T.checking, s.webgpu ? s.adapter ?? 'WebGPU' : s.checked ? translate(T.noGpu) : '…');
    section(T.local);
    row('backend-native', T.native, s.checked ? s.native.available ? 'ok' : 'off' : 'wait', s.checked ? s.native.available ? T.online : T.offline : T.checking,
      s.native.available ? `${s.native.server} · ${s.native.capabilities.slice(0, 6).join(', ')}` : `${s.native.server} · ${translate(T.noNative)}`);
    row('backend-python', T.python, s.checked ? s.python.available ? 'ok' : 'off' : 'wait', s.checked ? s.python.available ? T.online : T.offline : T.checking,
      s.python.available ? `${s.python.server} · ${s.python.message ?? (s.python.loaded ? 'models loaded' : 'CUDA')}` : `${s.python.server} · ${translate(T.noPython)}`);
    section(T.drawing);
    const renderControl = document.createElement('div'); renderControl.className = 'backend-control';
    const renderLabel = document.createElement('label'); renderLabel.htmlFor = 'settings-render-mode'; setText(renderLabel, T.render);
    const renderSelect = select('settings-render-mode', getRenderMode(), [['auto', T.autoMode, undefined], ['gpu', T.gpuMode, undefined], ['cpu', T.cpuMode, undefined]], value => setRenderMode(value as RenderMode));
    renderControl.append(renderLabel, renderSelect);
    const stats = (window as unknown as { magnaRenderStats?: RenderStats }).magnaRenderStats;
    row(stats?.path === 'gpu' || getRenderMode() === 'gpu' ? 'backend-gpu' : 'backend-cpu', T.render, 'ok', T.active,
      stats ? translate(T.lastPath).replace('{path}', `${stats.path}${stats.reason ? ` (${stats.reason})` : ''} · ${stats.drawCalls} draw calls`) : `render=${getRenderMode()}`, renderControl);
    const note = document.createElement('p'); note.className = 'hint'; setText(note, T.used); host.append(note);
    const again = document.createElement('button'); again.type = 'button'; again.className = 'small'; setText(again, T.refresh); again.onclick = () => void refreshBackends(bindings).then(render); host.append(again);
  };
  onBackendStatus(render); onRenderMode(render);
  render(); return { render };
}
/** Header caption: the most capable available path, e.g. "Rust local · GPU". */
export function backendCaption(s: BackendStatus = status): string {
  const parts = [s.native.available ? 'Rust native' : 'WASM', s.webgpu ? 'GPU' : 'CPU'];
  if (s.python.available) parts.push('Python');
  return parts.join(' · ');
}
