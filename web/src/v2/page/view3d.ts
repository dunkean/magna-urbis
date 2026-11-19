/**
 * The 3D and preview buttons of the workbench bar. Mounted by main.ts after the appearance controls, whose status
 * line it shares.
 *
 * The map has one camera: the "3D" button eases it to a tilt and back to the top view, and its label and pressed
 * state follow the camera however it was tilted (`mountTiltButton`); the padlock before it holds the map in the top
 * view (`mountLock2d`, a preference kept in this browser). While tilted, the separate 3D view's bar at the end
 * of the toolbar, with the navigation (worldNavigation.ts) and the modelled trees (worldTrees.ts), and the PNG of the view.
 *
 * With `?camera=dual` (render/live/policy.ts, temporary) the button opens the separate 3D view instead, as it did:
 * loaded on first use, cancellable by a click on "2D" while it loads, with its PNG capture. That part goes with the
 * 3D view.
 */
import type { PageActions, PageState } from './contract';
import { insertHTML, registerMessages, setText, setDynamicText, translate } from '../i18n';
import { applyAppearancePatch } from '../../render/appearanceRecipe';
import type { UrbanBuilding } from '../../gen/types';
import { townUrban } from '../edits';
import { dualCameras } from '../../render/live/policy';
import { isTilted } from '../../render/world/camera';
import { $ } from './dom';
import { mountWorldTreeControls } from './worldTrees';
import { mountWorldNavigation } from './worldNavigation';
import { mountWorldDepthControl } from './worldDepth';

/** Pitch the "3D" button eases the camera to: 57 degrees from the vertical. */
const BUTTON_PITCH = 1;
/** The 2D lock, a page preference (as the units and the display quality): kept in this browser. */
const LOCK_2D_STORAGE_KEY = 'magna-urbis-v2-lock-2d';

registerMessages({
  'Lock the map in 2D': { en: 'Lock the map in 2D', fr: 'Verrouiller la carte en 2D' },
  'Unlock the 3D view': { en: 'Unlock the 3D view', fr: 'Déverrouiller la vue 3D' },
  'The map is locked in 2D: unlock it with the padlock to tilt it.': { en: 'The map is locked in 2D: unlock it with the padlock to tilt it.', fr: 'La carte est verrouillée en 2D : déverrouillez-la avec le cadenas pour l’incliner.' },
});

const PADLOCK_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor"/><path data-shackle d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

/** The padlock beside the "3D" button: while pressed, the viewer keeps the map in the top view (Viewer.setTiltLocked)
 * and the "3D" button is disabled with the reason as its tooltip. */
function mountLock2d(state: PageState): void {
  insertHTML($('#view3d'), 'beforebegin', `<button id="view-lock2d" type="button" aria-pressed="false">${PADLOCK_ICON}</button>`);
  const lock = $<HTMLButtonElement>('#view-lock2d'),
    button = $<HTMLButtonElement>('#view3d'),
    shackle = lock.querySelector('[data-shackle]')!;
  const label = (element: Element, attribute: 'title' | 'aria-label', source: string | undefined): void => {
    if (source === undefined) {
      element.removeAttribute(`data-i18n-${attribute}`);
      element.removeAttribute(attribute);
      return;
    }
    element.setAttribute(`data-i18n-${attribute}`, source);
    element.setAttribute(attribute, translate(source));
  };
  const apply = (locked: boolean): void => {
    state.client.viewer.setTiltLocked(locked);
    lock.setAttribute('aria-pressed', String(locked));
    // Open shackle while unlocked: the right arm lifted off the body.
    shackle.setAttribute('d', locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 6 0v-1');
    const action = locked ? 'Unlock the 3D view' : 'Lock the map in 2D';
    label(lock, 'title', action);
    label(lock, 'aria-label', action);
    button.disabled = locked;
    label(button, 'title', locked ? 'The map is locked in 2D: unlock it with the padlock to tilt it.' : undefined);
  };
  let locked = false;
  try {
    locked = globalThis.localStorage?.getItem(LOCK_2D_STORAGE_KEY) === '1';
  } catch {
    /* Optional storage. */
  }
  apply(locked);
  lock.onclick = () => {
    locked = !locked;
    try {
      globalThis.localStorage?.setItem(LOCK_2D_STORAGE_KEY, locked ? '1' : '0');
    } catch {
      /* Optional storage. */
    }
    apply(locked);
  };
}

/** The "3D" button of the single camera: tilts the map in place, and comes back to the top view. */
function mountTiltButton(state: PageState, actions: PageActions): void {
  const button = $('#view3d'),
    viewer = state.client.viewer;
  mountLock2d(state);
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
    if (!state.world) {
      actions.toast('Create the terrain first.');
      return;
    }
    // The yaw is kept on the way up and reset on the way back: "2D" is the map, north up.
    if (tilted) viewer.tiltTo(0, 0);
    else viewer.tiltTo(BUTTON_PITCH);
  };
}

export function mountView3d(state: PageState, actions: PageActions): void {
  insertHTML($('.style-control'), 'beforeend', '<button id="view3d" type="button" aria-pressed="false">3D</button><button id="capture3d" type="button" hidden>PNG 3D ↗</button>');

  insertHTML($('#header-menu'), 'beforeend', '<button id="preview-close" type="button" class="quiet small" hidden></button>');

  setDynamicText($('#preview-close'), () => 'Close preview');

  $('#preview-close').onclick = async () => {
    if (!state.previewBase?.world || state.busy) return;
    state.world = state.previewBase.world;
    state.pristine = state.previewBase.pristine;
    state.previewBase = undefined;
    await state.client.show(state.world, true);
    actions.updateWorld();
    void actions.refresh3dWorld();
  };

  if (!dualCameras()) {
    mountTiltButton(state, actions);
    // The navigation makes the bar the trees' controls join.
    mountWorldNavigation(state, actions);
    mountWorldTreeControls(state, actions);
    mountWorldDepthControl(state);
    return;
  }

  // state.open3dToken names the opening in flight (0 = none): the button stays enabled while the 3D view loads, and a
  // click on "2D" abandons the opening.
  $('#view3d').onclick = async () => {
    window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: '3d' }));
    if (!state.world) {
      actions.toast('Create the terrain first.');
      return;
    }
    if (state.open3dToken || state.city3d?.active) {
      const opening = state.open3dToken !== 0;
      state.open3dToken = 0; // a pending opening sees its token vanish and stops without showing the 3D view
      state.viewLoading.end('3d-open');
      const mapView = state.city3d?.active ? state.city3d.toMapView() : undefined;
      if (state.city3d?.active) state.city3d.hide();
      state.client.set3dActive(false);
      if (mapView) state.client.viewer.setView(mapView);
      setText($('#view3d'), '3D');
      $('#view3d').setAttribute('aria-pressed', 'false');
      $('#capture3d').hidden = true;
      state.editingTools.sync();
      if (opening) {
        if (!state.busy) $('#progress-card').hidden = true;
        $<HTMLButtonElement>('#cancel-job').hidden = false;
        if ($('#render-status').dataset.error !== 'true') $('#render-status').hidden = true;
      }
      return;
    }
    const myToken = (state.open3dToken = ++state.open3dSeq),
      stale3d = () => state.open3dToken !== myToken;
    const viewJob = state.viewLoading.begin('3d-open'); // ended in `finally`, superseded by a newer opening, ended by a click on "2D"
    setText($('#view3d'), '2D'); // back to 2D is possible at any time, also while the 3D view loads
    // The progress card stays until the 3D view has drawn a complete first frame (tiles ready, no pending job):
    // the view needs seconds after it is shown, and a vanished card looked like a freeze.
    const card3d = $('#progress-card'),
      cancel3d = $<HTMLButtonElement>('#cancel-job');
    const step3d = (detail: string) => {
      if (state.busy || stale3d()) return;
      card3d.hidden = false;
      cancel3d.hidden = true;
      setText($('#progress-label'), 'Opening the 3D view…');
      setText($('#progress-detail'), detail);
      setText($('#progress-time'), '');
      $<HTMLProgressElement>('#progress').removeAttribute('value');
    };
    const open3dStart = performance.now(),
      request3d = state.client.begin3dRequest();
    state.client.set3dActive(true);
    try {
      step3d('Map ground');
      await state.client.prepare3dBackground();
      if (stale3d()) return;
      step3d('3D engine and shaders');
      if (!state.city3d) {
        actions.toast('Loading the 3D view…');
        state.city3d = await (
          await import('../urban3d')
        ).mountV2Urban3d({
          host: $('.map-area'),
          toolbarHost: $('.toolbar-row'),
          advancedControls: $('#view3d-advanced-controls'),
          getWorld: () => state.world,
          getSettings: () => state.settings,
          getBackground: () => state.client.backgroundUrl(),
          getBackgroundImage: () => state.client.groundBackground(),
          getPhysicalGround: () => state.client.physicalGround(),
          onAppearancePatch: patch => {
            state.settings.appearance = applyAppearancePatch(state.settings.appearance, state.settings.options.style, patch);
            state.projectRevision++;
            void actions.refreshAppearance();
          },
          getTextured: () => state.settings.appearance?.textured ?? false,
          setTextured: value => {
            state.settings.appearance = { style: state.settings.options.style, ...state.settings.appearance, textured: value };
            state.projectRevision++;
            void actions.refreshAppearance();
          },
          getSelected: () => (state.selectedBuilding ? (state.selectedBuilding.building as UrbanBuilding & { nativeId?: string }).nativeId : undefined),
          onSelect: id => {
            for (const settlement of state.world?.settlements ?? []) {
              const urban = townUrban(state.world!, settlement.key),
                index = urban?.buildings.findIndex(b => (b as UrbanBuilding & { nativeId?: string }).nativeId === id) ?? -1;
              if (urban && index >= 0) {
                actions.showBuilding({ settlement: settlement.key, index, building: urban.buildings[index] });
                break;
              }
            }
          },
        });
      }
      if (stale3d()) return;
      await state.city3d.prepare();
      if (stale3d()) return; // back to 2D while loading: the 3D view is never shown
      state.city3d.show();
      state.city3d.fromMapView(state.client.viewer.getView());
      performance.measure('v2:3d:shown', { start: open3dStart });
      setText($('#view3d'), '2D');
      $('#view3d').setAttribute('aria-pressed', 'true');
      $('#capture3d').hidden = false;
      state.editingTools.sync();
      step3d('Terrain, buildings and trees');
      const view3d = state.city3d,
        status3d = $('#render-status');
      status3d.hidden = false;
      setText(status3d, 'HD loading…');
      const coverageTimer = setInterval(() => {
        if (request3d.has('first-covered-frame') && !state.busy) card3d.hidden = true;
      }, 40);
      try {
        await state.client.waitFor3d(view3d, request3d);
      } finally {
        clearInterval(coverageTimer);
        status3d.hidden = true;
      }
      performance.measure('v2:3d:tiles', { start: open3dStart });
    } catch (error) {
      if (stale3d()) return;
      if (!state.city3d?.active) {
        state.client.set3dActive(false);
        setText($('#view3d'), '3D');
      }
      actions.toast(String(error), true);
    } finally {
      viewJob.end();
      if (!stale3d()) {
        state.open3dToken = 0;
        if (!state.busy) card3d.hidden = true;
        cancel3d.hidden = false;
      }
    }
  };

  $('#capture3d').onclick = async () => {
    try {
      if (state.city3d?.active) actions.download(await state.city3d.capture(), `magna-urbis-${state.settings.options.seed}.3d.png`);
    } catch (error) {
      actions.toast(String(error), true);
    }
  };
}
