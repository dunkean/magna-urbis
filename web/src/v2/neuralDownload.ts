import { loadNeuralManifest, obtainNeuralModel, listStoredNeuralModels, NEURAL_MODEL_NAMES, NeuralModelError } from '../../../rust/bridge/neuralModels';
import { obtainNeuralRuntime } from '../../../rust/bridge/neuralRuntime';
import { setText, getLanguage, numberLocale } from './i18n';
import { desktopReleasesUrl, getLatestDesktopRelease } from './desktopUpdates';
import type { V2Progress } from './contracts';
import type { ComputePreference } from './platform';
import { assertNeuralCompute } from './neuralExecution';
import { PATIENT_GPU_MS, requestWebGpuAdapter } from '../../../rust/bridge/webGpuAdapter';

export const NEURAL_NOTICE_KEY = 'magna-urbis-browser-neural-consent-v1';

/** Called only from a requested download/generation, including the settings download buttons. `stored`: every model is
 * already saved (checked after WebGPU, before any notice), so the first-download notice (size, desktop advice) is skipped. */
export async function confirmNeuralDownload(signal?: AbortSignal, stored?: () => Promise<boolean>): Promise<void> {
  signal?.throwIfAborted();
  let device: GPUDevice | undefined;
  try {
    const adapter = await requestWebGpuAdapter(PATIENT_GPU_MS);
    device = await adapter?.requestDevice();
    if (!device) throw new Error('No WebGPU device');
  } catch {
    throw new Error('WebGPU is unavailable. Use a browser with WebGPU and a compatible GPU, or the desktop app. No models were downloaded.');
  } finally {
    device?.destroy();
  }
  signal?.throwIfAborted();
  let accepted = false;
  try {
    accepted = localStorage.getItem(NEURAL_NOTICE_KEY) === 'accepted';
  } catch {
    /* Storage can be disabled. */
  }
  if (!accepted && stored) accepted = await stored().catch(() => false);
  if (!accepted) {
    const dialog = document.createElement('dialog');
    dialog.id = 'neural-download-warning';
    dialog.setAttribute('aria-labelledby', 'neural-download-title');
    const title = document.createElement('h2');
    title.id = 'neural-download-title';
    setText(title, 'Browser neural terrain');
    const explanation = document.createElement('p');
    setText(explanation, 'Neural generation works best in the desktop app. It requires a capable GPU with WebGPU and downloads about 163 MB once.');
    const link = document.createElement('a');
    link.href = desktopReleasesUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    setText(link, 'Desktop releases');
    void getLatestDesktopRelease().then(release => {
      if (release) link.href = release.url;
    });
    const actions = document.createElement('div');
    actions.className = 'row';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    setText(cancel, 'Cancel');
    const proceed = document.createElement('button');
    proceed.type = 'button';
    proceed.dataset.continue = '';
    setText(proceed, 'Continue');
    actions.append(cancel, proceed);
    dialog.append(title, explanation, link, actions);
    document.body.append(dialog);
    try {
      accepted = await new Promise<boolean>(resolve => {
        const abort = () => dialog.close('cancel');
        dialog.oncancel = event => {
          event.preventDefault();
          dialog.close('cancel');
        };
        dialog.onclose = () => {
          signal?.removeEventListener('abort', abort);
          resolve(dialog.returnValue === 'continue');
        };
        cancel.onclick = () => dialog.close('cancel');
        proceed.onclick = () => dialog.close('continue');
        signal?.addEventListener('abort', abort, { once: true });
        dialog.showModal();
        cancel.focus();
      });
    } finally {
      dialog.remove();
    }
    signal?.throwIfAborted();
    if (!accepted) throw new DOMException('Download cancelled. Completed models are retained; partial files are not saved.', 'AbortError');
    try {
      localStorage.setItem(NEURAL_NOTICE_KEY, 'accepted');
    } catch {
      /* Best effort. */
    }
  }
  // A refusal does not prevent normal Cache API use; retention is browser-controlled.
  await navigator.storage?.persist?.().catch(() => false);
  signal?.throwIfAborted();
}

export async function prepareBrowserNeuralDownload(assets: string, signal: AbortSignal, progress: (event: V2Progress) => void, compute: ComputePreference = 'auto'): Promise<void> {
  assertNeuralCompute(true, compute);
  // The notice only matters when something remains to download.
  let loaded: Awaited<ReturnType<typeof loadNeuralManifest>> | undefined;
  await confirmNeuralDownload(signal, async () => {
    loaded = await loadNeuralManifest(assets, signal);
    const saved = await listStoredNeuralModels(assets, loaded.manifest);
    return NEURAL_MODEL_NAMES.every(name => saved.some(r => r.current && r.name === name));
  });
  progress({ stage: 'neural-download', label: 'Verifying neural models…', completed: 0, total: 0 });
  try {
    const { manifest } = loaded ?? (await loadNeuralManifest(assets, signal));
    await obtainNeuralRuntime(assets, manifest, signal);
    const total = NEURAL_MODEL_NAMES.reduce((sum, name) => sum + manifest.models[name].bytes, 0);
    let completed = 0;
    for (const name of NEURAL_MODEL_NAMES) {
      signal.throwIfAborted();
      await obtainNeuralModel(assets, manifest, name, {
        signal,
        requireStorage: true,
        onProgress: event => {
          const done = completed + event.received,
            percent = Math.floor((100 * done) / total);
          const size = (value: number) => (value / 1e6).toLocaleString(numberLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          progress({ stage: 'neural-download', label: event.phase === 'download' ? 'Downloading neural models…' : 'Verifying neural models…', completed: done, total, detail: `${size(done)} / ${size(total)} ${getLanguage() === 'fr' ? 'Mo' : 'MB'} · ${percent}%` });
        },
      });
      completed += manifest.models[name].bytes;
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof NeuralModelError)
      throw new Error(
        error.code === 'integrity'
          ? 'The model is incomplete or failed its integrity check. It was not saved; try downloading again.'
          : error.code === 'storage'
            ? 'Unable to access or save browser files. Check available disk space and site storage permissions, then try again. This download has not been confirmed as saved.'
            : 'Download failed. Check your connection and model address, then retry. Completed downloads are retained.',
      );
    if (error instanceof Error && ['Neural runtime integrity check failed. Please retry.', 'Neural runtime unavailable. Check your connection and retry.'].includes(error.message)) throw error;
    throw new Error('Download failed. Check your connection and model address, then retry. Completed downloads are retained.');
  }
}
