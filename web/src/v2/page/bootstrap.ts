/**
 * The end of start-up, run by main.ts after every mount: build stamp, recipe sync, client init (then the boot splash
 * goes), the test hook (`window.__v2Test`), a city code or link, the autosave restore, and the first engine probe.
 */
import type { PageActions, PageState } from './contract';
import { setText } from '../i18n';
import { mountV2TestHook } from '../testHook';
import { armAutosave, takeAutosave, mountNewButton, saveAutosaveNow } from '../autosave';
import { $ } from './dom';
import { inspectMachine } from '../machineTier';
import { mountMachineDefault } from './machineDefault';
import { reloadPreviousMapAtStartup, startupPlan } from '../startup';

export async function mountPageBoot(state: PageState, actions: PageActions): Promise<void> {
  setText($('#build-info'), `${import.meta.env.VITE_BUILD_DATE ?? 'dev'} · ${import.meta.env.VITE_BUILD_COMMIT ?? 'local'}`);

  actions.syncControls();

  try {
    await state.client.init();
  } finally {
    document.getElementById('boot-splash')?.remove();
  }

  const machineProbe = inspectMachine();

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
    prepareCapture: () => state.client.prepareViewportCapture(),
    rerollTown: key => actions.rerollCityStep('composition', [key]),
    displaySettled: () => state.client.displaySettled(),
  });

  await state.cityCodeSharing.restoreFromLocation();

  // Explicit links/tests win. Previous-map restoration is opt-in; ordinary openings propose a new landscape.
  // Never awaited here: the entry module (main.ts awaits this function) must finish evaluating before the restored run
  // draws its map. In the build, the lazy renderer chunk imports the entry chunk, so `import('./benchRenderer')` waited
  // for the entry module, which waited for the run.
  void (async () => {
    const explicit = new URLSearchParams(location.hash.slice(1)).has('city') || new URLSearchParams(location.search).get('test') === '1';
    const previous = explicit ? undefined : await takeAutosave();
    const plan = startupPlan(state.settings, previous, { explicit, restore: reloadPreviousMapAtStartup() });
    const saved = plan.mode === 'restore' ? plan.saved : undefined;
    if (plan.mode === 'fresh') {
      state.settings = plan.settings;
      state.mods = [];
      state.projectRevision++;
      actions.syncControls();
    }
    const startAutosave = () =>
      armAutosave(() => ({ settings: state.settings, mods: state.mods, view: state.world ? state.client.viewer.getView() : undefined, ui: { tab: state.currentTab } }));
    const machine = await machineProbe;
    if (!previous && !new URLSearchParams(location.hash.slice(1)).has('city')) mountMachineDefault(state, actions, machine);
    if (saved) {
      actions.setBusy(true);
      try {
        await actions.loadProject({ settings: saved.settings, mods: saved.mods });
        actions.log('Restore: latest recipe');
      } catch (e) {
        console.info('Autosave restore failed, starting fresh:', e);
      }
      actions.setBusy(false);
      startAutosave(); // Save edits and pagehide even while the restored generation is still running.
      await actions.generate('all');
      try {
        if (saved.view) state.client.viewer.setView(saved.view as never);
      } catch {
        /* The viewport is optional. */
      }
      try {
        if (saved.ui?.tab) actions.selectTab(saved.ui.tab);
      } catch {
        /* View state is optional. */
      }
    }
    if (!saved) startAutosave();
    else saveAutosaveNow();
  })();
  mountNewButton($('#import-open'));
  $('#osm-open').before($('#city-code-open'));

  const startupProbe = actions.inspectHardware();

  state.client.capabilitiesReady = () => startupProbe;
}
