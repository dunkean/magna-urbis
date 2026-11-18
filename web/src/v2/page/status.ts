/** Progress, busy state, logs and toasts. main.ts connects the client callbacks after runtime setup; handlers share the same page state and timing. */
import type { PageState } from './state';
import type { PageActions, ToastAction } from './actions';
import { setText, translate, numberLocale, type V2Progress, RUNTIME_FALLBACK, isNativeConnectionFailure } from './dependencies';
import { $ } from './dom';

export function createStatusActions(state: PageState, actions: PageActions) {
  function toast(message: string, error = false, action?: ToastAction): void {
    // Native connection problems never raise a notice: runs retry natively, then use the browser; the rest is a log line.
    // A failed action that produced nothing still says so, in plain words (never the raw error).
    if (isNativeConnectionFailure(message)) {
      actions.log(RUNTIME_FALLBACK.nativeQuiet);
      if (!error) return;
      message = RUNTIME_FALLBACK.nativeQuiet;
    }
    clearTimeout(state.toastTimer);
    const element = $('#toast'),
      text = document.createElement('span');
    setText(text, message);
    element.replaceChildren(text);
    if (action) {
      if (action.detail) {
        const detail = document.createElement('p');
        detail.className = 'toast-detail';
        setText(detail, action.detail);
        element.append(detail);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'small toast-action';
      setText(button, action.label);
      button.onclick = () => {
        element.hidden = true;
        action.run();
      };
      element.append(button);
    }
    element.dataset.error = String(error);
    element.hidden = false;
    state.toastTimer = setTimeout(
      () => {
        element.hidden = true;
      },
      action ? 20000 : error ? 12000 : 5000,
    );
  }

  function scrollLog(): void {
    if (state.logScroll) return;
    state.logScroll = requestAnimationFrame(() => {
      state.logScroll = 0;
      const el = $('#job-log');
      el.scrollTop = el.scrollHeight;
    });
  }

  function renderLog(): void {
    $('#job-log').textContent = state.logs.map(state.logLine).join('\n');
    actions.scrollLog();
  }

  /** Append-only: the whole log is re-rendered only when the oldest line drops or the language changes. */
  function log(message: string): void {
    const entry = { time: new Date(), message };
    state.logs.push(entry);
    if (state.logs.length > 150) {
      state.logs.shift();
      actions.renderLog();
      return;
    }
    const el = $('#job-log');
    el.append((state.logs.length > 1 ? '\n' : '') + state.logLine(entry));
    actions.scrollLog();
  }

  function dialog(id: string): void {
    if (id === '#export-dialog') actions.syncExportOptions();
    $<HTMLDialogElement>(id).showModal();
  }

  function updateProgress(p: V2Progress): void {
    setText($('#progress-label'), p.label);
    const meter = $<HTMLProgressElement>('#progress');
    if (p.total > 0) meter.value = Math.max(0, Math.min(100, (100 * p.completed) / p.total));
    else meter.removeAttribute('value');
    meter.setAttribute('aria-labelledby', 'progress-label');
    meter.setAttribute('aria-describedby', 'progress-detail');
    const cache = p.cache === 'memory' ? 'Memory cache reused' : p.cache === 'disk' ? 'Terrain restored from disk' : 'Computing in a worker';
    state.chain.progress(p);
    setText($('#progress-detail'), p.detail ?? cache);
    actions.log(p.label + (p.cache ? ` · ${p.cache}` : ''));
  }

  function setBusy(value: boolean): void {
    if (value) window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'busy' }));
    actions.labelEditorHostInert(value);
    state.busy = value;
    $('#progress-card').hidden = !value;
    $('#hardware-led').classList.toggle('busy-led', value);
    $('#app').setAttribute('aria-busy', String(value));
    for (const selector of ['#terrain-controls .chain-scroll', '#urban-settings-panel', '#inspector', '#editor-content']) {
      const panel = document.querySelector<HTMLElement>(selector);
      if (panel) panel.inert = value;
    }
    for (const id of [
      'generate-region',
      'run-chain',
      'relief-symbolic-open',
      'relief-modify-open',
      'terrain-only',
      'region-only',
      'towns-only',
      'cities-select-all',
      'cities-select-none',
      'random-seed',
      'expert-apply',
      'export-go',
      'save-map',
      'clear-heightmap',
      'preview-close',
    ]) {
      const button = document.getElementById(id) as HTMLButtonElement | null;
      if (button) button.disabled = value;
    } // Some buttons are mounted with their stage: a missing one must not abort a generation.
    document
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
        '[data-option],#culture-environment,#culture-random,#town-count,#project-file,#heightmap-file,#terrain-controls .chain-scroll input,#terrain-controls .chain-scroll select,#terrain-controls .chain-scroll button,#urban-settings-panel input,#urban-settings-panel select,#urban-settings-panel button',
      )
      .forEach(e => (e.disabled = value));
    document.querySelectorAll<HTMLButtonElement>('[data-relief],#inspector button').forEach(e => (e.disabled = value));
    if (!value && state.elapsedTimer) {
      clearInterval(state.elapsedTimer);
      state.elapsedTimer = undefined;
    }
    state.terrainControls.sync();
    state.regionControls.sync();
    state.urbanControls.sync();
    state.inspectorForms.forEach(form => form.sync());
    if (!value) actions.syncUrbanBackend();
    $<HTMLButtonElement>('#cancel-job').disabled = false;
    actions.syncCitySelection();
    state.mapControls.sync();
    actions.syncNameOrigins();
    state.riverEditor.sync();
    state.roadEditor.sync();
    state.townMover.sync();
    state.editingTools.sync();
    state.workbenchLayout?.sync();
  }

  function labelEditorHostInert(value: boolean): void {
    const panel = document.querySelector<HTMLElement>('.map-label-editor');
    if (panel) panel.inert = value;
  }
  return { toast, scrollLog, renderLog, log, dialog, updateProgress, setBusy, labelEditorHostInert };
}

/** Log formatting/scroll state and engine-reset callback. Called by main.ts in startup order. */
export function mountPageStatus(state: PageState, actions: PageActions): void {
  state.logLine = (entry: { time: Date; message: string }): string => `${entry.time.toLocaleTimeString(numberLocale())}  ${translate(entry.message)}`;

  state.logScroll = 0;

  state.client.onEngineReset = () => state.chain.clearResults();
}
