/** Client initialization, test hook, links, autosave and hardware probe. main.ts calls the mounts at the original startup positions to preserve page side effects. */
import type { PageState } from './state';
import type { PageActions } from './actions';
import { setText, mountV2TestHook, armAutosave, takeAutosave, mountNewButton } from './dependencies';
import { $ } from './dom';

/** Client initialization, test hook, links, autosave and hardware probe. Called by main.ts in startup order. */
export async function mountPageBoot(state: PageState, actions: PageActions): Promise<void> {
  setText($('#build-info'), `${import.meta.env.VITE_BUILD_DATE ?? 'dev'} · ${import.meta.env.VITE_BUILD_COMMIT ?? 'local'}`);

  actions.syncControls();

  try {
    await state.client.init();
  } finally {
    document.getElementById('boot-splash')?.remove();
  }

  mountV2TestHook({
    getSettings: () => state.settings,
    getWorld: () => state.world ?? undefined,
    isBusy: () => state.busy,
    load: actions.loadProject,
    run: async places => {
      if (places === 'main') await actions.generateMainOnly();
      else await actions.generate('all');
    },
    smallPlacesSettled: () => state.smallPlaces?.settled() ?? Promise.resolve(),
    getViewer: () => state.client.viewer,
    get3d: () => state.city3d,
    prepareCapture: () => state.client.prepareViewportCapture(),
    rerollTown: key => actions.rerollCityStep('composition', [key]),
    displaySettled: () => state.client.displaySettled(),
  });

  await state.cityCodeSharing.restoreFromLocation();

  {
    // Reload recovery: an explicit #city= or ?test=1 wins; otherwise restore the autosaved recipe through the project import path.
    const explicit = new URLSearchParams(location.hash.slice(1)).has('city') || new URLSearchParams(location.search).get('test') === '1';
    const saved = explicit ? undefined : await takeAutosave(); // the entry is removed here and written back only after a successful restore
    if (saved) {
      actions.setBusy(true);
      try {
        await actions.loadProject({ settings: saved.settings, mods: saved.mods });
        actions.log('Restore: latest recipe');
      } catch (e) {
        console.info('Autosave restore failed, starting fresh:', e);
      }
      actions.setBusy(false);
      await actions.generate('all');
      try {
        if (saved.view) state.client.viewer.setView(saved.view as never);
      } catch {
        /* The viewport is optional. */
      }
      try {
        if (saved.ui?.tab) actions.selectTab(saved.ui.tab);
        if (saved.ui?.mode3d && state.world && !state.city3d?.active) {
          await ($('#view3d').onclick as unknown as () => Promise<void>)();
          if (saved.ui.camera) state.city3d?.setCamera(saved.ui.camera as never);
        }
      } catch {
        /* View state is optional. */
      }
    }
    armAutosave(() => ({ settings: state.settings, mods: state.mods, view: state.world ? state.client.viewer.getView() : undefined, ui: { tab: state.currentTab, mode3d: !!state.city3d?.active, camera: state.city3d?.active ? state.city3d.getCamera() : undefined } }));
    mountNewButton($('#import-open'));
    $('#export-open').before($('#city-code-open'));
  }

  const startupProbe = actions.inspectHardware();

  state.client.capabilitiesReady = () => startupProbe;
}
