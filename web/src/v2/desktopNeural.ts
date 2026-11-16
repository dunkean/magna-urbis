import { registerMessages, translate, setText } from './i18n';
import { loopbackServer } from './platform';

registerMessages({
  'Starting the neural service…': { en: 'Starting the neural service…', fr: 'Démarrage du service neuronal…' },
  'Could not start the neural service: {error}': { en: 'Could not start the neural service: {error}', fr: 'Impossible de démarrer le service neuronal : {error}' },
});

type Invoke = (command: string) => Promise<unknown>;
type DesktopWindow = Window & {
  __TAURI_INTERNALS__?: { invoke?: Invoke };
  __TAURI__?: { core?: { invoke?: Invoke } };
};

/** Run on the page: generation workers cannot call Tauri's IPC bridge. */
export async function ensureDesktopNeuralServer(server: string, onProgress: (message: string) => void): Promise<string> {
  const desktop = typeof window === 'undefined' ? undefined : window as DesktopWindow;
  const invoke = desktop?.__TAURI__?.core?.invoke ?? desktop?.__TAURI_INTERNALS__?.invoke;
  if (!invoke) return server;
  server = loopbackServer(server);
  try {
    const response = await fetch(`${server}/status`, { signal: AbortSignal.timeout(2500), cache: 'no-store' });
    if (response.ok) {
      const status = await response.json();
      if (status.service === 'magna-urbis-neural' && status.profile === 'coarse4-nf4-b75-t2-decoder') return server;
    }
  } catch { /* The desktop owns the on-demand replacement when this endpoint is unreachable. */ }
  onProgress(translate('Starting the neural service…'));
  try {
    const timer = setInterval(() => { void invoke('desktop_neural_status').then(value => {
      const state = value as NeuralStatus; onProgress(describe(state));
    }).catch(() => {}); }, 500);
    let result: unknown;
    try { result = await invoke('ensure_neural'); } finally { clearInterval(timer); }
    if (typeof result !== 'string') throw new Error('Invalid neural service URL');
    const url = new URL(result);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/'
      || url.username || url.password || url.search || url.hash) throw new Error('Invalid neural service URL');
    return url.origin;
  } catch (error) {
    throw new Error(translate('Could not start the neural service: {error}').replace('{error}', String(error)));
  }
}

type NeuralStatus = { profile: string; directory: string; busy: boolean; models: { file: string; bytes: number; present: boolean }[];
  progress: { phase: string; file?: string; received?: number; total?: number; message?: string } };
registerMessages({
  'Native neural terrain': { en: 'Native neural terrain', fr: 'Terrain neuronal natif' },
  'Download terrain models': { en: 'Download terrain models', fr: 'Télécharger les modèles de terrain' },
  'The Rust inference engine is included. Download about 162 MB once; generation then works offline on a compatible GPU. No Python installation is needed.': {
    en: 'The Rust inference engine is included. Download about 162 MB once; generation then works offline on a compatible GPU. No Python installation is needed.',
    fr: 'Le moteur d’inférence Rust est inclus. Téléchargez environ 162 Mo une fois ; la génération fonctionne ensuite hors ligne avec un GPU compatible. Aucune installation Python n’est nécessaire.' },
  'Models downloaded': { en: 'Models downloaded', fr: 'Modèles téléchargés' },
  'Models not downloaded': { en: 'Models not downloaded', fr: 'Modèles non téléchargés' },
  'Downloading terrain models…': { en: 'Downloading terrain models…', fr: 'Téléchargement des modèles de terrain…' },
  'Verifying terrain models…': { en: 'Verifying terrain models…', fr: 'Vérification des modèles de terrain…' },
});
function describe(state: NeuralStatus): string {
  const p = state.progress;
  if (p.phase === 'error') return p.message ?? '';
  if (p.phase === 'download') return `${translate('Downloading terrain models…')} ${p.file} · ${((p.received ?? 0) / 1e6).toFixed(1)} / ${((p.total ?? 0) / 1e6).toFixed(1)} MB`;
  if (p.phase === 'verify') return translate('Verifying terrain models…');
  if (p.phase === 'starting') return translate('Starting the neural service…');
  return translate(state.models.every(m => m.present) ? 'Models downloaded' : 'Models not downloaded');
}
export function mountDesktopNeural(host: HTMLElement): boolean {
  const invoke = (window as DesktopWindow).__TAURI_INTERNALS__?.invoke;
  if (!invoke) return false;
  const panel = document.createElement('details'); panel.id = 'neural-model-manager'; panel.className = 'section desktop-neural'; panel.open = true;
  const summary = document.createElement('summary'); setText(summary, 'Native neural terrain'); panel.append(summary);
  const hint = document.createElement('p'); hint.className = 'hint'; setText(hint, 'The Rust inference engine is included. Download about 162 MB once; generation then works offline on a compatible GPU. No Python installation is needed.');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const bar = document.createElement('progress'); bar.max = 1; bar.hidden = true;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'small'; setText(button, 'Download terrain models');
  const directory = document.createElement('p'); directory.className = 'hint'; directory.style.overflowWrap = 'anywhere';
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false, pending = false;
  async function refresh(): Promise<void> {
    clearTimeout(timer);
    try {
      const state = await invoke!('desktop_neural_status') as NeuralStatus;
      status.textContent = `${state.profile} · ${describe(state)}`; directory.textContent = state.directory;
      // The size notice is for a first download only.
      hint.hidden = state.models.length > 0 && state.models.every(m => m.present);
      button.disabled = pending || state.busy;
      bar.hidden = state.progress.phase !== 'download';
      bar.value = (state.progress.received ?? 0) / (state.progress.total || 1);
      if (!disposed && (state.busy || pending)) timer = setTimeout(() => void refresh(), 500);
    } catch (error) { status.textContent = String(error); button.disabled = false; }
  }
  button.onclick = () => {
    pending = true; button.disabled = true;
    void invoke('desktop_neural_download').catch(error => { status.textContent = String(error); }).finally(() => { pending = false; void refresh(); });
    void refresh();
  };
  panel.append(hint, status, bar, button, directory); host.append(panel);
  panel.addEventListener('toggle', () => { if (panel.open) void refresh(); });
  window.addEventListener('beforeunload', () => { disposed = true; clearTimeout(timer); }, { once: true });
  void refresh();
  return true;
}
