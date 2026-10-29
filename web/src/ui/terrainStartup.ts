import { executionProfiles, executionRuntime } from './executionProfile';
import { initialTerrainSource, neuralModelLabel, terrainStartupText, type NeuralServiceState } from './terrainStartupState';
import { LOCALE_KEY, savedLocale } from './shellLocale';

export type TerrainLoadingPhase = 'interface' | 'generation' | 'rendering' | 'ready' | 'error';
export interface TerrainLoading { phase: TerrainLoadingPhase; message?: string }

export function terrainLoading(phase: TerrainLoadingPhase, message?: string): void {
  window.dispatchEvent(new CustomEvent<TerrainLoading>('terrain:loading', { detail: { phase, message } }));
}

// This module deliberately has no renderer, brush, WASM or model dependencies.
const source = document.querySelector<HTMLSelectElement>('#terrainSource');
const overlay = document.getElementById('terrainLoading');
if (source && overlay) {
  const params = new URLSearchParams(location.search);
  const initial = initialTerrainSource(params, executionProfiles[executionRuntime.profile].neural);
  source.value = initial; source.dataset.sourceInitialized = 'true';
  const title = document.getElementById('terrainLoadingTitle')!;
  const message = document.getElementById('terrainLoadingMessage')!;
  const elapsed = document.getElementById('terrainLoadingElapsed')!;
  const model = document.getElementById('terrainModelStatus')!;
  let phase: TerrainLoadingPhase = 'interface', started = performance.now(), initialized = false;
  let lastProgress = started, polling = false, modelsLoaded = false, stopped = false;
  const t = (key: Parameters<typeof terrainStartupText>[0]): string => terrainStartupText(key, savedLocale());
  function update(next: TerrainLoading): void {
    if (next.phase !== phase) started = performance.now();
    phase = next.phase; lastProgress = performance.now();
    if (phase !== 'interface' && !initialized) {
      initialized = true; document.body.dataset.terrainStartup = 'ready';
      document.querySelector('.terrain-workspace')?.removeAttribute('inert');
    }
    overlay!.dataset.phase = phase;
    title.textContent = t(phase);
    message.textContent = next.message ?? (phase === 'interface' ? t('interfaceHint') : '');
    overlay!.hidden = phase === 'ready';
    document.getElementById('viewport')?.setAttribute('aria-busy', String(phase !== 'ready' && phase !== 'error'));
    if (phase === 'error') model.dataset.state = 'error';
    if (next.message?.includes('calcul coarse')) { modelsLoaded = true; showModels(); }
  }
  function showModels(): void {
    const neural = !['procedural', 'procedural-phasor'].includes(source!.value); model.hidden = !neural;
    if (source!.value === 'neural-wasm') {
      model.textContent = t(modelsLoaded ? 'browserReady' : 'browserWaiting');
      model.dataset.state = modelsLoaded ? 'ready' : 'waiting';
    }
  }
  async function poll(): Promise<void> {
    showModels();
    const selected = source!.value;
    if (polling || !['neural', 'neural-python'].includes(selected)) return;
    polling = true;
    try {
      const server = (selected === initial ? params.get('neural') : null) ?? `http://127.0.0.1:${selected === 'neural-python' ? 8793 : 8792}`;
      const response = await fetch(`${server}/status`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Service neuronal indisponible');
      const status = await response.json() as NeuralServiceState;
      if (source!.value !== selected || stopped) return;
      model.textContent = neuralModelLabel(status, savedLocale()); model.dataset.state = status.state;
      if (phase === 'generation' && ['loading', 'generating'].includes(status.state)) {
        message.textContent = status.message; lastProgress = performance.now();
      }
    } catch {
      if (source!.value === selected && !stopped) { model.textContent = t('checkCuda'); model.dataset.state = 'error'; }
    } finally { polling = false; }
  }
  window.addEventListener('terrain:loading', event => update((event as CustomEvent<TerrainLoading>).detail));
  window.addEventListener('bench-source-change', () => { void poll(); });
  source.addEventListener('change', () => { modelsLoaded = false; void poll(); });
  window.addEventListener('error', event => { if (!initialized) update({ phase: 'error', message: event.message || t('loadFailed') }); });
  const refreshLocale = (): void => { title.textContent = t(phase); if (phase === 'interface') message.textContent = t('interfaceHint'); void poll(); };
  window.addEventListener('magna-locale-change', refreshLocale);
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) refreshLocale(); });
  const timer = setInterval(() => {
    if (!overlay!.hidden) {
      const seconds = Math.floor((performance.now() - started) / 1000);
      elapsed.textContent = `${seconds} ${t('elapsed')}${performance.now() - lastProgress > 8000 ? ` · ${t('noProgress')}` : ''}`;
    }
    void poll();
  }, 1000);
  window.addEventListener('pagehide', () => { stopped = true; clearInterval(timer); }, { once: true });
  update({ phase: 'interface' }); void poll();
}
