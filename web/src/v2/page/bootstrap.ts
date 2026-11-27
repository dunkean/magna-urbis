/**
 * The end of start-up, run by main.ts after every mount: build stamp, recipe sync, client init (then the boot splash
 * goes), the test hook (`window.__v2Test`), a city code or link, the autosave restore, and the first engine probe.
 */
import type { PageActions, PageState } from './contract';
import { registerMessages, setText } from '../i18n';
import { mountV2TestHook } from '../testHook';
import { armAutosave, takeAutosave, mountNewButton, saveAutosaveNow } from '../autosave';
import { $ } from './dom';
import { inspectMachine, releaseMachineStyle } from '../machineTier';
import { mountMachineDefault, mountPerformancePolicy, persistedSettings, repairMachinePreset } from './machineDefault';
import { reloadPreviousMapAtStartup, startupPlan } from '../startup';
import { handheldDevice } from '../../../../rust/bridge/deviceClass';
import { note } from '../deviceJournal';
import { acceptResume, offerResume } from '../resumeOffer';
import { COMPACT_QUERY } from './phoneLayout';

const RESUME_OFFER = 'Your last map can be rebuilt.',
  RESUME = 'Resume';
registerMessages({ [RESUME_OFFER]: { en: RESUME_OFFER, fr: 'Votre dernière carte peut être reconstruite.' }, [RESUME]: { en: RESUME, fr: 'Reprendre' } });

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
    prepareCapture: () => state.client.prepareViewportCapture(),
    rerollTown: key => actions.rerollCityStep('composition', [key]),
    displaySettled: () => state.client.displaySettled(),
  });

  const query = new URLSearchParams(location.search),
    modelPreview = query.get('model-preview');
  if (modelPreview !== null) {
    // Finish evaluating the entry before the preview's lazy compositor imports it.
    void import('./modelPreview').then(({ showModelPreview }) => showModelPreview(modelPreview, query.get('model-lod') === 'overview', state, actions)).catch(error => actions.toast(String(error), true));
    return;
  }

  mountPerformancePolicy();
  const machineProbe = inspectMachine();

  await state.cityCodeSharing.restoreFromLocation();

  // Explicit links/tests win. Previous-map restoration is opt-in; ordinary openings propose a new landscape, except a
  // phone or tablet without a stored preference, which resumes a map left recently (see `startupPlan`).
  // Never awaited here: the entry module (main.ts awaits this function) must finish evaluating before the restored run
  // draws its map. In the build, the lazy renderer chunk imports the entry chunk, so `import('./benchRenderer')` waited
  // for the entry module, which waited for the run.
  void (async () => {
    const explicit = new URLSearchParams(location.hash.slice(1)).has('city') || new URLSearchParams(location.search).get('test') === '1';
    const previous = explicit ? undefined : await takeAutosave();
    const plan = startupPlan(state.settings, previous, { explicit, restore: reloadPreviousMapAtStartup(), handheld: handheldDevice(), now: Date.now() });
    const saved = plan.mode === 'restore' ? plan.saved : undefined;
    note('startup', `${plan.mode}${previous ? ` · autosave ${previous.savedAt ? Math.round((Date.now() - previous.savedAt) / 1000) + ' s old' : 'undated'}${previous.view ? ' with a map' : ''}` : ''}`);
    // Until the restored map is drawn, the autosave keeps its view: a tab discarded again meanwhile still resumes it.
    let restoringView = saved?.view;
    if (plan.mode === 'fresh') {
      repairMachinePreset(plan.settings);
      state.settings = plan.settings;
      state.mods = [];
      state.projectRevision++;
      actions.syncControls();
    }
    const startAutosave = () => armAutosave(() => ({ settings: persistedSettings(state.settings), mods: state.mods, view: state.world ? state.client.viewer.getView() : restoringView, ui: { tab: state.currentTab } }));
    const machine = await machineProbe;
    if (saved) {
      actions.setBusy(true);
      try {
        await actions.loadProject({ settings: saved.settings, mods: saved.mods });
        actions.log('Restore: latest recipe');
      } catch (e) {
        console.info('Autosave restore failed, starting fresh:', e);
      }
      // Loading a project protects its style; the restored autosave is this device's own recipe.
      releaseMachineStyle();
    }
    // Mounted once state.settings is the recipe of this start (fresh or restored): the preset swap applies to it only.
    if (!new URLSearchParams(location.hash.slice(1)).has('city')) mountMachineDefault(state, actions, machine);
    if (saved) {
      actions.setBusy(false);
      startAutosave(); // Save edits and pagehide even while the restored generation is still running.
      const rebuild = async (): Promise<void> => {
        note('resume', 'rebuild');
        await actions.generate('all');
        restoringView = undefined;
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
      };
      // The stored preference rebuilds at once. A handheld without it restored the recipe only: the generation waits
      // for the user's tap (resumeOffer.ts; the phone layout shows it on the empty map).
      if (reloadPreviousMapAtStartup() !== undefined) await rebuild();
      else {
        offerResume(() => void rebuild());
        if (!matchMedia(COMPACT_QUERY).matches) actions.toast(RESUME_OFFER, false, { label: RESUME, run: acceptResume });
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
