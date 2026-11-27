/**
 * The 3D and preview buttons of the workbench bar. Mounted by main.ts after the appearance controls, whose status
 * line it shares.
 *
 * The map has one camera: the "3D" button eases it to a tilt and back to the top view, and its label and pressed
 * state follow the camera however it was tilted (`mountTiltButton`); the padlock before it holds the map in the top
 * view (`mountViewLock`, a browser preference, also enforced when 3D is unavailable). While tilted, a bar at the end
 * of the toolbar holds the navigation (worldNavigation.ts), the modelled trees (worldTrees.ts) and the PNG of the view.
 */
import type { PageActions, PageState } from './contract';
import { insertHTML, registerMessages, setText, setDynamicText, translate } from '../i18n';
import { liveStats } from '../../render/live/liveStats';
import { isTilted } from '../../render/world/camera';
import { $ } from './dom';
import { mountWorldTreeControls } from './worldTrees';
import { mountWorldNavigation } from './worldNavigation';
import { mountWorldDepthControl } from './worldDepth';
import { mountWorldReliefControl } from './worldRelief';
import { FIREFOX_3D_UNAVAILABLE, mountViewLock } from './viewLock';
import { isFirefox } from '../../ui/firefox';

/** Only the composed view tilts; its fallback draws the top view alone (after a lost graphics context, for example). */
const NOT_COMPOSED = '3D is unavailable for now: the map is drawn without the graphics compositor ({reason}).';
registerMessages({ [NOT_COMPOSED]: { en: NOT_COMPOSED, fr: 'La 3D est indisponible pour l’instant : la carte est dessinée sans le compositeur graphique ({reason}).' } });

/** Pitch the "3D" button eases the camera to: 57 degrees from the vertical. */
const BUTTON_PITCH = 1;

/** The "3D" button: tilts the map in place, and comes back to the top view. */
function mountTiltButton(state: PageState, actions: PageActions): void {
  const button = $<HTMLButtonElement>('#view3d'),
    viewer = state.client.viewer;
  let tilted = false;
  // Pressed for any view that is not the plain map, a turned top view included: "2D" then brings the map back.
  viewer.onCamera(view => {
    if (tilted === isTilted(view)) return;
    tilted = !tilted;
    setText(button, tilted ? '2D' : '3D');
    button.setAttribute('aria-pressed', String(tilted));
    // The editors work on the top view: they end when the camera tilts and are offered again when it is back. "Select
    // on map" stays on (it picks in a tilted view too).
    if (tilted) window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: $<HTMLInputElement>('#inspect-mode').checked ? 'buildings' : '3d' }));
    state.editingTools.sync();
    state.contourEditor.sync();
  });
  button.onclick = () => {
    if (button.disabled) return;
    if (!state.world) {
      actions.toast('Create the terrain first.');
      return;
    }
    // A press that cannot tilt says why: the viewer tilts only the frame source marked so (mapView.ts, canTilt).
    if (!tilted && !document.querySelector('[data-camera="tilt"]')) {
      actions.toast(isFirefox() ? FIREFOX_3D_UNAVAILABLE : translate(NOT_COMPOSED).replace('{reason}', liveStats().reason ?? ''), true);
      return;
    }
    // The yaw is kept on the way up and reset on the way back: "2D" is the map, north up.
    if (tilted) viewer.tiltTo(0, 0);
    else viewer.tiltTo(BUTTON_PITCH);
  };
}

export function mountView3d(state: PageState, actions: PageActions): void {
  insertHTML($('.style-control'), 'beforeend', '<button id="view3d" type="button" aria-pressed="false">3D</button><button id="capture3d" type="button" hidden>PNG</button>');

  insertHTML($('#header-menu'), 'beforeend', '<button id="preview-close" type="button" class="quiet small" hidden></button>');

  setDynamicText($('#preview-close'), () => 'Close preview');
  mountViewLock(state.client.viewer);

  $('#preview-close').onclick = async () => {
    if (!state.previewBase?.world || state.busy) return;
    state.world = state.previewBase.world;
    state.pristine = state.previewBase.pristine;
    state.previewBase = undefined;
    await state.client.show(state.world, true);
    actions.updateWorld();
  };

  mountTiltButton(state, actions);
  // The navigation makes the bar the trees' controls join.
  mountWorldNavigation(state, actions);
  mountWorldReliefControl(state, actions);
  mountWorldTreeControls(state, actions);
  mountWorldDepthControl(state);
}
