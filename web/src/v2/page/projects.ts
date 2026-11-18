/** Project/recipe imports, heightmaps and project workers. main.ts mounts the file/dialog listeners after map picking; boot recovery uses the same load callback. */
import type { PageState } from './state';
import type { PageActions } from './actions';
import {
  setHTML,
  setText,
  getLanguage,
  type World,
  readHeightmap,
  acceptHeightmap,
  imageHeightmap,
  validateSettings,
  type V2Settings,
  runtimeWorkerOptions,
  applyBuildingEdits,
  ProjectWorker,
  isBinaryProject,
  MAX_BINARY_PROJECT_BYTES,
  resultTransferBuffers,
  ComposeWorker,
  resolveAutoBackend,
  applyLabelEdits,
  renameMap,
  mountCityCodeSharing,
} from './dependencies';
import { $ } from './dom';

export function createProjectsActions(state: PageState, actions: PageActions) {
  async function loadProject(project: { settings: V2Settings; mods: unknown[]; world?: World }): Promise<void> {
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
    }
    // The disposed 3D view must also release the 2D viewer (paused) and the bench (suspended), or the next map stays blank.
    else {
      await state.client.clear();
      state.city3d?.dispose();
      state.city3d = undefined;
      state.open3dToken = 0;
      state.viewLoading.end('3d-open');
      state.client.set3dActive(false);
      setText($('#view3d'), '3D');
      $('#view3d').setAttribute('aria-pressed', 'false');
      $('#capture3d').hidden = true;
      state.canvas.hidden = true;
      $('#empty-map').hidden = false;
      setHTML($('#settlement-list'), '<p class="hint">Create the region to restore this recipe’s settlements.</p>');
      $('#inspector').hidden = true;
      actions.toast('Recipe loaded. Create the region to rebuild it.');
    }
  }

  function projectJob<T>(request: unknown, transfer: Transferable[] = []): Promise<T> {
    if ((request as { action?: string }).action === 'serialize-binary') {
      request = structuredClone(request);
      transfer = resultTransferBuffers(request);
    }
    const worker = new ProjectWorker(runtimeWorkerOptions());
    return new Promise<T>((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        worker.terminate();
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      worker.onerror = e => {
        worker.terminate();
        reject(new Error(e.message));
      };
      worker.postMessage(request, transfer);
    });
  }

  function composeJob(request: unknown, transfer: Transferable[] = []): Promise<{ settings: V2Settings; world?: World; mods: unknown[] }> {
    const worker = new ComposeWorker(runtimeWorkerOptions());
    return new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        worker.terminate();
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      worker.onerror = e => {
        worker.terminate();
        reject(new Error(e.message));
      };
      worker.postMessage(request, transfer);
    });
  }
  return { loadProject, projectJob, composeJob };
}

/** Dialogs, expert recipe, project/code import and heightmaps. Called by main.ts in startup order. */
export function mountProjectFiles(state: PageState, actions: PageActions): void {
  document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(
    b =>
      (b.onclick = () => {
        $<HTMLDialogElement>(`#${b.dataset.close}`).close();
      }),
  );

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
    getRecipe: () => ({ settings: state.settings, mods: state.mods }),
    busy: () => state.busy,
    load: async recipe => {
      if (state.busy) return;
      actions.setBusy(true);
      try {
        await actions.loadProject(recipe);
        actions.log('Import: generation code');
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
          ? await actions.projectJob<{ settings: V2Settings; world?: World; mods: unknown[] }>({ action: binary ? 'parse-binary' : 'parse', ...source }, transfer)
          : await actions.composeJob({ scope, ...source, current: state.settings, world: state.previewBase?.pristine ?? state.previewBase?.world ?? state.pristine ?? state.world, mods: state.mods }, transfer);
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
