/** The client, throttled scale label, measure tool and selection overlay. main.ts calls the mounts at the original startup positions to preserve page side effects. */
import type { PageState } from './state';
import type { PageActions } from './actions';
import { setText, numberLocale, StudioClient, createSelectionOverlay, mountMeasureTool } from './dependencies';
import { $ } from './dom';

/** The client, throttled scale label, measure tool and selection overlay. Called by main.ts in startup order. */
export function mountMapClient(state: PageState, actions: PageActions): void {
  state.canvas = $<HTMLCanvasElement>('#map-canvas');

  // The scale label follows the view at most every SCALE_LABEL_MS, and only when its text changes: written in every
  // frame of a gesture, its attribute and text mutations made the page recompute styles and lay the label out per frame.
  const SCALE_LABEL_MS = 120;

  state.scaleLabelText = '';
  state.scaleLabelAt = 0;
  state.scaleLabelTimer = undefined;

  const writeScaleLabel = (): void => {
    state.scaleLabelTimer = undefined;
    state.scaleLabelAt = performance.now();
    const text = `≈ ${Math.round(80 / state.client.viewer.getView().scale).toLocaleString(numberLocale())} m`;
    if (text !== state.scaleLabelText) {
      state.scaleLabelText = text;
      setText($('#scale-label'), text);
    }
  };

  state.client = new StudioClient(
    state.canvas,
    $('#map'),
    $<HTMLCanvasElement>('#minimap'),
    actions.updateProgress,
    e => void actions.reportGenerationFailure(e.message),
    () => {
      if (state.scaleLabelTimer !== undefined) return;
      const wait = SCALE_LABEL_MS - (performance.now() - state.scaleLabelAt);
      if (wait <= 0) writeScaleLabel();
      else state.scaleLabelTimer = setTimeout(writeScaleLabel, wait);
    },
  );

  mountMeasureTool({ map: $('#map'), canvas: state.canvas, slot: $('.view-strip'), readout: $('#cursor-readout'), getView: () => state.client.viewer.getView(), getHeight: () => state.world?.terrain.height, getMapSize: () => state.world?.mapSize });

  state.selectionOutline = createSelectionOverlay($('#map'), () => state.client.viewer.getView());

  window.addEventListener('v2-edit-mode', event => {
    const token = (event as CustomEvent<string>).detail;
    // A sticky map selection keeps its outline through tab changes (see editingTools).
    if (['navigate', '3d'].includes(token) || (token === 'family' && !$<HTMLInputElement>('#inspect-mode').checked)) state.selectionOutline.set();
  });
}
