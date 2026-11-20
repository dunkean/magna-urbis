/**
 * What the page tells the user: toasts, the generation log, dialogs, and the busy state that locks the controls during
 * a run. Called by every module; owns no mount.
 */
import type { PageActions, ToastAction, PageState } from './contract';
import type { V2Progress } from '../contracts';
import { setText, translate, numberLocale } from '../i18n';
import { F as RUNTIME_FALLBACK } from '../runtimeChoices';
import { isNativeConnectionFailure } from '../../../../rust/bridge/nativeAvailability';
import { $ } from './dom';

const logLine = (entry: { time: Date; message: string }): string => `${entry.time.toLocaleTimeString(numberLocale())}  ${translate(entry.message)}`;

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
    $('#job-log').textContent = state.logs.map(logLine).join('\n');
    scrollLog();
  }

  /** Append-only: the whole log is re-rendered only when the oldest line drops or the language changes. */
  function log(message: string): void {
    const entry = { time: new Date(), message };
    state.logs.push(entry);
    if (state.logs.length > 150) {
      state.logs.shift();
      renderLog();
      return;
    }
    const el = $('#job-log');
    el.append((state.logs.length > 1 ? '\n' : '') + logLine(entry));
    scrollLog();
  }

  function dialog(id: string): void {
    if (id === '#export-dialog') {
      // "Save map" has its own button and leaves the format on the project file; the dialog is for map exports, whose
      // options (layers, size, area) only show for PNG and SVG.
      const format = $<HTMLSelectElement>('#export-format');
      if (format.value === 'binary') format.value = 'png';
      actions.syncExportOptions();
    }
    $<HTMLDialogElement>(id).showModal();
  }

  /** `keepEditor`: the work belongs to the open road or outline editor (its Finish, an outline edit), which stays on. */
  function setBusy(value: boolean, keepEditor = false): void {
    if (value && !keepEditor) window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'busy' }));
    labelEditorHostInert(value);
    state.busy = value;
    $('#progress-card').hidden = !value;
    showProgressSettlement();
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
    state.contourEditor.sync();
    state.townMover.sync();
    state.editingTools.sync();
    state.workbenchLayout?.sync();
  }

  /** Second line of the progress card: which settlement of a town run is being built (its counters restart with each one). */
  function showProgressSettlement(settlement?: V2Progress['settlement']): void {
    const context = $('#progress-context');
    context.hidden = !settlement;
    if (settlement) setText(context, `Settlement ${settlement.index}/${settlement.total} (${settlement.name})`);
  }

  function labelEditorHostInert(value: boolean): void {
    const panel = document.querySelector<HTMLElement>('.map-label-editor');
    if (panel) panel.inert = value;
  }
  return { toast, renderLog, log, dialog, setBusy, showProgressSettlement };
}
