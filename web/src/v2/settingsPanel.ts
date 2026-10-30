/** Settings › compute and rendering backends. Shows what this machine can do and what each
 * generation actually used; unavailable choices stay visible, disabled, with the reason. */
import { detectPlatform, loopbackServer, type PlatformCapabilities } from './platform';
import { getRenderMode, setRenderMode, onRenderMode, type RenderMode, type RenderStats } from '../render/renderMode';
import { registerMessages, setText, translate } from './i18n';
import { iconImg, type IconId } from './stageIcons';
import type { V2Settings } from './contracts';
import { runtimeChoiceStates, runtimeValues, setRuntimeChoice, type RuntimeKey } from './runtimeChoices';

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
  execution: copy('Execution', 'Exécution'), engine: copy('Engine', 'Moteur'), compute: copy('Compute', 'Calcul'), neuralRuntime: copy('Neural runtime', 'Runtime neuronal'),
  advanced: copy('Advanced overrides', 'Forçages avancés'), follow: copy('Follow engine', 'Suivre le moteur'),
  engRust: copy('Rust · in the browser', 'Rust · dans le navigateur'), engNative: copy('Rust · native service', 'Rust · service natif'), engTs: copy('TypeScript · classic', 'TypeScript · classique'),
  cAuto: copy('Automatic · best available', 'Automatique · meilleur disponible'), cCpu: copy('CPU', 'CPU'), cGpu: copy('GPU', 'GPU'),
  nAuto: copy('Follow engine (browser / native)', 'Suivre le moteur (navigateur / natif)'), nPython: copy('Python / PyTorch server', 'Serveur Python / PyTorch'),
  sampling: copy('Terrain sampling', 'Échantillonnage du relief'), sCpu: copy('CPU · Rust reference', 'CPU · référence Rust'), sGpu: copy('GPU · FP32', 'GPU · FP32'),
  genCompute: copy('Procedural generation compute', 'Calcul de génération procédurale'), gCpu: copy('CPU · reference', 'CPU · référence'), gFine: copy('GPU · fine noise FP32', 'GPU · bruit fin FP32'),
  gAll: copy('GPU · all noise FP32', 'GPU · tous les bruits FP32'), gEro: copy('GPU · erosion FP32', 'GPU · érosion FP32'),
  hydrology: copy('Hydrology compute', 'Calcul de l’hydrologie'), hAuto: copy('Automatic', 'Automatique'),
  city: copy('City builder', 'Constructeur de villes'), uTs: copy('Classic · TypeScript', 'Classique · TypeScript'), uRust: copy('Rust · browser WASM', 'Rust · WASM du navigateur'), uNative: copy('Rust · native service', 'Rust · service natif'),
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
let advancedOpen = false;
const listeners = new Set<(status: BackendStatus) => void>();
export const backendStatus = (): BackendStatus => status;
export const onBackendStatus = (listener: (status: BackendStatus) => void): (() => void) => { listeners.add(listener); return () => listeners.delete(listener); };

export interface SettingsPanelBindings { localServer(): string; pythonServer(): string; log(message: string): void; getSettings?(): V2Settings; onRuntimeChange?(): void; busy?(): boolean }
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
    section(T.execution);
    if (bindings.getSettings) {
      const settings = bindings.getSettings(), values = runtimeValues(settings);
      const states = runtimeChoiceStates(settings, { checked: s.checked, webgpu: s.webgpu, native: s.native.available, python: s.python.available });
      const busy = bindings.busy?.() ?? false;
      const choice = (parent: HTMLElement, key: RuntimeKey, label: string, options: [string, string][]) => {
        const wrap = document.createElement('div'); wrap.className = 'backend-control'; wrap.dataset.runtimeChoice = key;
        const id = `exec-${key}`, name = document.createElement('label'); name.htmlFor = id; setText(name, label);
        const element = select(id, values[key], options.map(([value, text]) => [value, text, states[key][value]?.enabled === false ? states[key][value].reason : undefined] as [string, string, string | undefined]), value => { setRuntimeChoice(settings, key, value); bindings.onRuntimeChange?.(); render(); });
        element.disabled = busy; wrap.append(name, element); parent.append(wrap);
      };
      const exec = document.createElement('div'); exec.className = 'backend-execution'; exec.id = 'settings-execution'; host.append(exec);
      choice(exec, 'engine', T.engine, [['rust', T.engRust], ['native', T.engNative], ['typescript', T.engTs]]);
      choice(exec, 'compute', T.compute, [['auto', T.cAuto], ['cpu', T.cCpu], ['gpu', T.cGpu]]);
      choice(exec, 'neural', T.neuralRuntime, [['auto', T.nAuto], ['python', T.nPython]]);
      const adv = document.createElement('details'); adv.className = 'backend-advanced'; adv.open = advancedOpen; adv.ontoggle = () => { advancedOpen = adv.open; };
      const summary = document.createElement('summary'); setText(summary, T.advanced); adv.append(summary); exec.append(adv);
      choice(adv, 'sampling', T.sampling, [['', T.follow], ['wasm', T.sCpu], ['gpu-f32', T.sGpu]]);
      choice(adv, 'generationCompute', T.genCompute, [['', T.follow], ['cpu', T.gCpu], ['gpu', T.gFine], ['gpu-all', T.gAll], ['gpu-erosion', T.gEro]]);
      choice(adv, 'hydrology', T.hydrology, [['auto', T.hAuto], ['cpu', T.cCpu], ['gpu', T.cGpu]]);
      choice(adv, 'urban', T.city, [['', T.follow], ['typescript', T.uTs], ['rust', T.uRust], ['native', T.uNative]]);
    }
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
