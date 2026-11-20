/**
 * The map's appearance: the style selector, scene and render controls, and the refresh that applies them to the 2D map
 * and the open 3D view (a newer refresh supersedes one in flight). Also recovers from a lost map GPU context.
 * Mounted by main.ts after the map client; generation, naming and the inspectors call its refreshes.
 */
import type { PageActions, PageState } from './contract';
import { setHTML, insertHTML, setText } from '../i18n';
import { mountSceneControls } from '../sceneControls';
import { mountRenderControls, currentComposition, writeAppearanceControl, PRESET_OPTIONS } from '../renderControls';
import { MAP_GPU_FAILED_EVENT, MAP_GPU_LIGHTER_EVENT, MAP_GPU_LIGHTER_MESSAGE, isMapContextLost, type MapContextLostError } from '../../ui/glContextRecovery';
import { mountViewLoadingIndicator, watchDisplayPending } from '../viewLoadingIndicator';
import { $, esc } from './dom';

export function createAppearanceActions(state: PageState, actions: PageActions) {
  async function refreshAppearance(): Promise<void> {
    state.workbenchLayout?.sync();
    state.sceneControls.sync();
    state.city3d?.syncControls();
    const revision = ++state.renderRevision,
      appearanceStart = performance.now();
    // Keyed: a newer refresh supersedes this job; ended in `finally` whatever the revision, so it can never stay stuck.
    const viewJob = state.viewLoading.begin('appearance');
    state.renderControls.sync();
    const status = $('#render-status');
    delete status.dataset.error;
    status.hidden = false;
    setText(status, 'HD loading…');
    try {
      await state.client.setAppearance(state.settings);
      if (revision !== state.renderRevision) return;
      actions.syncDisplayWidgets();
      if (state.city3d?.active) {
        await state.client.prepare3dBackground();
        if (revision !== state.renderRevision || !state.city3d.active) return;
        state.city3d.refresh();
        await state.city3d.prepare();
        if (revision !== state.renderRevision) return;
        await state.client.waitFor3d(state.city3d);
      } else {
        await state.client.displaySettled();
      }
      if (revision === state.renderRevision) state.renderControls.sync();
    } catch (error) {
      if (revision === state.renderRevision) actions.reportAppearanceError(error);
    } finally {
      viewJob.end();
      if (revision === state.renderRevision) {
        if (status.dataset.error !== 'true') status.hidden = true;
        performance.measure('v2:appearance', { start: appearanceStart });
      }
    }
  }

  /** A new world (relief, settlements, edits) shown while the 3D view is open: the ground capture, the surface and the tiles must follow it (the 2D map redraws itself). */
  async function refresh3dWorld(): Promise<void> {
    if (!state.city3d?.active) return;
    const revision = ++state.renderRevision,
      status = $('#render-status');
    delete status.dataset.error;
    status.hidden = false;
    const viewJob = state.viewLoading.begin('appearance');
    setText(status, 'HD loading…');
    try {
      await state.client.prepare3dBackground(); // the bench ground of the new world is captured on demand, never while the 3D view is active
      if (!state.city3d?.active || revision !== state.renderRevision) return;
      state.city3d.refresh();
      await state.city3d.prepare();
      await state.client.waitFor3d(state.city3d);
    } catch (error) {
      if (revision === state.renderRevision) actions.reportAppearanceError(error);
    } finally {
      viewJob.end();
      if (revision === state.renderRevision && status.dataset.error !== 'true') status.hidden = true;
    }
  }

  function reportAppearanceError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    // The map's GPU context was lost for good: the renderer already dropped it. Never a dead map: re-render from a fresh
    // context in the light profile, or (second time) switch to the CPU-drawn parchment map.
    if (isMapContextLost(error)) {
      if ((error as MapContextLostError).final) {
        writeAppearanceControl(state.settings, 'appearance.composition.preset', 'parchment');
        state.projectRevision++;
        $<HTMLSelectElement>('#map-style').value = state.settings.appearance!.composition!.preset;
      }
      actions.toast(message, true);
      actions.scheduleAppearance();
      return;
    }
    if (error instanceof Error && error.name === 'MaterialRasterUnavailableError') {
      const status = $('#render-status');
      status.dataset.error = 'true';
      status.hidden = false;
      setText(status, 'Render unavailable: WebGL2 could not start. Choose a cartographic style.');
    }
    actions.toast(message, true);
  }

  /** The preset and export availability follow the current composition. */
  function syncDisplayWidgets(): void {
    state.sceneControls.sync();
    const recipe = currentComposition(state.settings, state.world ?? undefined);
    $<HTMLSelectElement>('#map-style').value = recipe.preset;
    actions.syncExportOptions();
  }

  /** A burst of control changes repaints once, 120 ms after the last one. */
  function scheduleAppearance(): void {
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(() => void actions.refreshAppearance(), 120);
  }

  function writeRecipe(path: string, value: unknown): void {
    writeAppearanceControl(state.settings, `appearance.composition.${path}`, value);
    state.projectRevision++;
    void actions.refreshAppearance();
  }
  return { refreshAppearance, scheduleAppearance, refresh3dWorld, reportAppearanceError, syncDisplayWidgets, writeRecipe };
}

export function mountAppearanceControls(state: PageState, actions: PageActions): void {
  /** Spinner left of the view selector: a counter of the view jobs (appearance, 3D opening, 2D tiles) still owed to the map. */
  state.viewLoading = mountViewLoadingIndicator($('#map-style'));

  watchDisplayPending(state.viewLoading, state.canvas, () => state.client.displayPending());

  state.sceneControls = mountSceneControls($('#scene-controls'), {
    getSettings: () => state.settings,
    onChange: () => {
      state.projectRevision++;
      actions.scheduleAppearance();
    },
  });

  insertHTML($('.style-control'), 'beforeend', '<span id="render-status" class="hint" role="status" aria-live="polite" hidden></span><div id="render-controls" hidden></div>');

  state.renderControls = mountRenderControls($('#render-controls'), {
    getSettings: () => state.settings,
    getWorld: () => state.world,
    getStyleSelectors: () => [$<HTMLSelectElement>('#map-style')],
    // The separate 3D view only (`?camera=dual`): the tilted map is the 2D view's own picture.
    getTarget: () => (state.city3d?.active ? 'view3d' : 'view2d'),
    onChange: () => {
      state.projectRevision++;
      actions.scheduleAppearance();
    },
  });

  // A map GPU loss recovered in place, in the light profile (glContextRecovery.ts): say so once.
  window.addEventListener(MAP_GPU_LIGHTER_EVENT, () => actions.toast(MAP_GPU_LIGHTER_MESSAGE, true));

  // A live map context lost for good: re-render, the renderer then reports MapContextLostError (reportAppearanceError).
  window.addEventListener(MAP_GPU_FAILED_EVENT, () => actions.scheduleAppearance());

  // The top-bar selector is the preset select of the render panel; 'custom' is shown but cannot be picked.
  setHTML($('#map-style'), PRESET_OPTIONS.map(o => `<option value="${o.value}"${o.value === 'custom' ? ' disabled' : ''}>${esc(o.label)}</option>`).join(''));
}
