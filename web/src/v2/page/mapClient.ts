/**
 * The map: the StudioClient on #map-canvas (2D view, minimap, runs), its scale label, the measure tool and the selection
 * outline. Mounted by main.ts right after the shell; every later module reaches the map through `state.client`.
 */
import type { PageActions, PageState } from './contract';
import { setText, numberLocale } from '../i18n';
import { StudioClient } from '../client';
import { createSelectionOverlay } from '../selectionOverlay';
import { mountMeasureTool } from '../measureTool';
import { $ } from './dom';

export function mountMapClient(state: PageState, actions: PageActions): void {
  state.canvas = $<HTMLCanvasElement>('#map-canvas');

  // The scale label follows the view at most every SCALE_LABEL_MS, and only when its text changes: written in every
  // frame of a gesture, its attribute and text mutations made the page recompute styles and lay the label out per frame.
  const SCALE_LABEL_MS = 120;

  let scaleLabelText = '',
    scaleLabelAt = 0,
    scaleLabelTimer: ReturnType<typeof setTimeout> | undefined;

  const writeScaleLabel = (): void => {
    scaleLabelTimer = undefined;
    scaleLabelAt = performance.now();
    const text = `≈ ${Math.round(80 / state.client.viewer.getView().scale).toLocaleString(numberLocale())} m`;
    if (text !== scaleLabelText) {
      scaleLabelText = text;
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
      if (scaleLabelTimer !== undefined) return;
      const wait = SCALE_LABEL_MS - (performance.now() - scaleLabelAt);
      if (wait <= 0) writeScaleLabel();
      else scaleLabelTimer = setTimeout(writeScaleLabel, wait);
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
