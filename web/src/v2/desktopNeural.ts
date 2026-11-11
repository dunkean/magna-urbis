import { registerMessages, translate } from './i18n';
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
    if (response.ok) return server;
  } catch { /* The desktop owns the on-demand replacement when this endpoint is unreachable. */ }
  onProgress(translate('Starting the neural service…'));
  try {
    const result = await invoke('ensure_neural');
    if (typeof result !== 'string') throw new Error('Invalid neural service URL');
    const url = new URL(result);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/'
      || url.username || url.password || url.search || url.hash) throw new Error('Invalid neural service URL');
    return url.origin;
  } catch (error) {
    throw new Error(translate('Could not start the neural service: {error}').replace('{error}', String(error)));
  }
}
