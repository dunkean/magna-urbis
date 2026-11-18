/**
 * Releases what the page holds (GPU contexts, workers, timers) when it unloads. Mounted by main.ts after the controls
 * it disposes.
 */
import type { PageActions, PageState } from './contract';

export function mountPageDisposal(state: PageState, actions: PageActions): void {
  window.addEventListener('beforeunload', () => {
    clearTimeout(state.renderTimer);
    state.renderControls.dispose();
    state.city3d?.dispose();
    state.terrainControls.dispose();
    state.urbanControls.dispose();
    state.regionControls.dispose();
    state.neuralModelManager.dispose();
    actions.disposeInspectorForms();
    state.client.destroy();
  });
}
