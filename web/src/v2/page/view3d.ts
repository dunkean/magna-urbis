/** Preview closure and cancellable 3D opening/capture controls. main.ts calls the mounts at the original startup positions to preserve page side effects. */
import type { PageState } from './state';
import type { PageActions } from './actions';
import { insertHTML, setText, setDynamicText, applyAppearancePatch, type UrbanBuilding, townUrban } from './dependencies';
import { $ } from './dom';

/** Preview closure and cancellable 3D opening/capture controls. Called by main.ts in startup order. */
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

  /** Token of the 3D opening in flight (0 = none): the button stays enabled while the 3D view loads, and a click on "2D" abandons the opening. */
  state.open3dToken = 0;
  state.open3dSeq = 0;

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
