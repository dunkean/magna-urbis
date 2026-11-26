/**
 * Opening a project: the import dialog (project, recipe or composition, heightmap), the expert recipe dialog, city
 * codes and links, and `loadProject`, which replaces the page's project (also used by the autosave restore).
 */
import { protectMachineStyle } from '../machineTier';
import type { PageActions, PageState } from './contract';
import { setHTML, insertHTML, setText, getLanguage, registerMessages } from '../i18n';
import type { World } from '../../gen/types';
import { readHeightmap } from '../../ui/heightmap';
import { acceptHeightmap, imageHeightmap } from '../heightmapModel';
import { validateSettings } from '../project';
import type { V2Settings } from '../contracts';
import { applyBuildingEdits } from '../edits';
import { isBinaryProject, MAX_BINARY_PROJECT_BYTES } from '../projectBinary';
import { resolveAutoBackend } from '../runtimeChoices';
import { applyLabelEdits } from '../mapLabels';
import { renameMap } from '../mapNaming';
import { mountCityCodeSharing } from '../cityCodeSharing';
import { nativeCityRecords } from '../nativeProducts';
import { blockAddress } from '../../../../rust/bridge/urbanBlockEdits';
import { $ } from './dom';
import { composeJob, projectJob } from './projectWorkers';
import { mountOsmImport, osmCredits } from '../osm/osmDialog';

export function createProjectsActions(state: PageState, actions: PageActions) {
  async function loadProject(project: { settings: V2Settings; mods: unknown[]; world?: World }): Promise<void> {
    protectMachineStyle();
    state.labelBaseline = undefined;
    state.smallPlaceRecipe = undefined;
    await state.smallPlaces?.stop();
    const connections = { localServer: state.settings.runtime?.localServer ?? state.bootRuntime.localServer, pythonServer: state.settings.runtime?.pythonServer ?? state.bootRuntime.pythonServer };
    if (state.connectLocal && project.settings.runtime) project.settings.runtime = { ...project.settings.runtime, ...connections };
    state.client.invalidateRetained();
    state.chain.clearResults();
    state.previewBase = undefined;
    state.selectedCities.clear();
    state.settings = resolveAutoBackend(project.settings);
    state.mods = project.mods;
    state.pristine = project.world ? renameMap(project.world, state.settings, getLanguage()) : undefined;
    state.world = state.pristine ? applyBuildingEdits(state.pristine, state.mods).world : undefined;
    if (state.world) applyLabelEdits(state.world, state.settings.naming?.labels);
    actions.touchRecipe();
    await actions.syncControls();
    if (state.world) {
      await state.client.show(state.world);
      state.canvas.hidden = false;
      $('#empty-map').hidden = true;
      actions.updateWorld();
      const notice = state.world.stats['v2.compositionNotice'];
      if (notice) actions.toast(String(notice));
    } else {
      $('#map-attribution').hidden = true;
      await state.client.clear();
      state.canvas.hidden = true;
      $('#empty-map').hidden = false;
      setHTML($('#settlement-list'), '<p class="hint">Create the region to restore this recipe’s settlements.</p>');
      $('#inspector').hidden = true;
      actions.toast('Recipe loaded. Create the region to rebuild it.');
    }
  }

  return { loadProject };
}

registerMessages({
  'This code was shared from an imported or hand-drawn relief: load its heightmap or project to get the same land.': {
    en: 'This code was shared from an imported or hand-drawn relief: load its heightmap or project to get the same land.',
    fr: 'Ce code vient d’un relief importé ou dessiné : chargez sa heightmap ou son projet pour retrouver le même terrain.',
  },
});

/** A dialog's own close control: its `[data-close]` buttons or the × ending its head. */
const DIALOG_CLOSE = '[data-close], .dialog-head > button:last-child, :scope > header > button:last-child';
/**
 * Touch has no Escape key: a tap on the backdrop of a modal dialog clicks its close control, so the dialog's own close
 * logic runs. A dialog without one (a blocking choice) stays open. Touch events only: mouse and pen keep today's
 * behaviour. The touchend is cancelled so its compatibility click does not land on what lay under the dialog.
 */
function closeDialogsOnBackdropTap(): void {
  let pressed: HTMLDialogElement | undefined;
  const backdrop = (target: EventTarget | null, touch: Touch | undefined): HTMLDialogElement | undefined => {
    if (!touch || !(target instanceof HTMLDialogElement) || !target.open) return undefined;
    const box = target.getBoundingClientRect();
    return touch.clientX < box.left || touch.clientX > box.right || touch.clientY < box.top || touch.clientY > box.bottom ? target : undefined;
  };
  document.addEventListener('touchstart', event => (pressed = event.touches.length === 1 ? backdrop(event.target, event.changedTouches[0]) : undefined), { capture: true, passive: true });
  document.addEventListener(
    'touchend',
    event => {
      const dialog = backdrop(event.target, event.changedTouches[0]),
        close = dialog && dialog === pressed ? dialog.querySelector<HTMLElement>(DIALOG_CLOSE) : null;
      pressed = undefined;
      if (!close) return;
      event.preventDefault();
      close.click();
    },
    { capture: true, passive: false },
  );
}

export function mountProjectFiles(state: PageState, actions: PageActions): void {
  insertHTML($('#import-dialog'), 'afterend', '<dialog id="osm-dialog" aria-labelledby="osm-title"></dialog>');
  insertHTML($('.map-bottom'), 'beforeend', `<div id="map-attribution" hidden>${osmCredits}</div>`);
  mountOsmImport(state, actions);
  insertHTML(
    $('#project-file'),
    'beforebegin',
    `<label class="label" for="import-scope">What should be imported from this file?</label><select id="import-scope"><option value="complete">Complete project · map + recipe + edits</option><option value="terrain">Territory · keep my settlement recipe</option><option value="urban">Settlement recipe · keep my territory</option></select><p class="hint" style="margin:8px 0 14px">Compositions retain the exact terrain and reset urban geometry: rebuild the settlements with the selected recipe.</p>`,
  );

  document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(
    b =>
      (b.onclick = () => {
        $<HTMLDialogElement>(`#${b.dataset.close}`).close();
      }),
  );
  closeDialogsOnBackdropTap();

  $('#import-open').onclick = () => actions.dialog('#import-dialog');

  $('#heightmap-import-quick').onclick = () => actions.dialog('#import-dialog');

  $('#export-open').onclick = () => {
    actions.dialog('#export-dialog');
  };

  $('#expert-open').onclick = () => {
    const clone = structuredClone(state.settings);
    delete clone.options.importedHeight;
    $<HTMLTextAreaElement>('#expert-json').value = JSON.stringify(clone, null, 2);
    setText($('#expert-error'), '');
    actions.dialog('#expert-dialog');
  };

  $('#expert-apply').onclick = () => {
    try {
      const next = JSON.parse($<HTMLTextAreaElement>('#expert-json').value);
      if (state.settings.options.importedHeight) next.options.importedHeight = state.settings.options.importedHeight;
      validateSettings(next);
      state.settings = next;
      actions.touchRecipe();
      actions.syncControls();
      $<HTMLDialogElement>('#expert-dialog').close();
      actions.toast('Recipe applied. Run the generation you need.');
    } catch (e) {
      setText($('#expert-error'), String(e));
    }
  };

  state.cityCodeSharing = mountCityCodeSharing({
    getSettings: () => state.settings,
    blockAddress: (key, saved) => {
      const layout = nativeCityRecords(state.world)?.[key]?.layouts[0];
      return layout && blockAddress(layout, saved);
    },
    busy: () => state.busy,
    toast: message => actions.toast(message),
    load: async (recipe, source) => {
      if (state.busy) return;
      actions.setBusy(true);
      try {
        await actions.loadProject(recipe);
        actions.log(source ? 'Import: Azgaar FMG' : 'Import: generation code');
        if (recipe.reliefMissing) actions.toast('This code was shared from an imported or hand-drawn relief: load its heightmap or project to get the same land.');
      } finally {
        actions.setBusy(false);
      }
      // An opened code or link shows its city: run the whole chain without waiting for a click
      // (not awaited, so the import dialog closes while it runs).
      void actions.runFullGeneration();
    },
  });

  $<HTMLInputElement>('#project-file').onchange = async e => {
    const input = e.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file || state.busy) return;
    actions.setBusy(true);
    $<HTMLButtonElement>('#cancel-job').disabled = true;
    setText($('#progress-label'), 'Reading & preparing the project…');
    setText($('#progress-time'), '');
    try {
      if (file.size > MAX_BINARY_PROJECT_BYTES) throw new Error('Binary project is too large (2 GiB compressed maximum).');
      const binary = isBinaryProject(new Uint8Array(await file.slice(0, 8).arrayBuffer()));
      if (!binary && file.size > 256 * 1024 * 1024) throw new Error('JSON project is too large (256 MiB maximum). Use a .muproj file for large maps.');
      const source = binary ? { buffer: await file.arrayBuffer() } : { text: await file.text() },
        transfer = 'buffer' in source ? [source.buffer!] : [],
        scope = $<HTMLSelectElement>('#import-scope').value;
      const project =
        scope === 'complete'
          ? await projectJob<{ settings: V2Settings; world?: World; mods: unknown[] }>({ action: binary ? 'parse-binary' : 'parse', ...source }, transfer)
          : await composeJob({ scope, ...source, current: state.settings, world: state.previewBase?.pristine ?? state.previewBase?.world ?? state.pristine ?? state.world, mods: state.mods }, transfer);
      await actions.loadProject(project);
      $<HTMLDialogElement>('#import-dialog').close();
      actions.log(`Import ${scope} : ${file.name}`);
    } catch (e) {
      actions.reportAppearanceError(e);
    } finally {
      input.value = '';
      actions.setBusy(false);
    }
  };

  $<HTMLInputElement>('#heightmap-file').onchange = async e => {
    const input = e.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    try {
      const image = await readHeightmap(file);
      acceptHeightmap(state.settings, imageHeightmap(image), file.name);
      state.terrainControls.sketchHost.dispatchEvent(new CustomEvent('relief-source-changed', { bubbles: true, detail: 'import' }));
      setText($('#import-height-info'), `${file.name} · ${image.w} × ${image.h} px`);
      actions.touchRecipe();
      actions.syncControls();
      actions.toast('Heightmap ready. Set the elevations, then create the topography.');
    } catch (e) {
      actions.toast(String(e), true);
    } finally {
      input.value = '';
    }
  };

  $('#clear-heightmap').onclick = () => {
    delete state.settings.options.importedHeight;
    if (state.settings.terrain) {
      delete state.settings.terrain.sketch;
      delete state.settings.terrain.zones;
      delete state.settings.terrain.modification;
    }
    state.terrainControls.sync();
    setText($('#import-height-info'), 'No heightmap imported.');
    actions.touchRecipe();
  };
}
