/** Foreground generation and idle small-place work. main.ts mounts gesture tracking and the queue after recipe/status setup so all world swaps use the same state. */
import type { PageState } from './state';
import type { PageActions } from './actions';
import {
  setText,
  settlementDisplayName,
  type UrbanBuilding,
  type Action,
  type V2TownStage,
  forcedUseRefusal,
  applyBuildingEdits,
  townUrban,
  buildingSignature,
  stagesForAction,
  effectiveRegion,
  cityStageValidityKeys,
  SmallPlaceQueue,
  boundedSmallPlaceRun,
  applyLabelEdits,
  migrateUrbanSeeds,
  scheduleAutosave,
} from './dependencies';
import { $ } from './dom';

export function createGenerationActions(state: PageState, actions: PageActions) {
  function smallPlaceRecipeKey(): string {
    return cityStageValidityKeys(state.settings, state.pristine, JSON.stringify(['all', []])).get('city-houses')!;
  }

  /** Test and shot scripts: terrain, placement, then the main town only (secondary places stay lazy for the background pass). */
  async function generateMainOnly(): Promise<void> {
    await actions.generate('terrain');
    if (!state.world) return;
    await actions.generate('region');
    if (!state.world?.settlements?.length) return;
    await actions.generate('town', state.world.settlements.find(place => place.main)?.key ?? 'main');
  }

  async function generate(action: Action, key?: string, townStage?: V2TownStage, terrainStage?: string, keys?: string[], cityOutput?: string): Promise<boolean> {
    if (state.busy) return false;
    state.cancelled = false;
    const previousSeed = state.settings.options.seed;
    migrateUrbanSeeds(state.settings);
    if (previousSeed !== state.settings.options.seed) {
      $<HTMLInputElement>('#seed').value = state.settings.options.seed;
      state.projectRevision++;
    }
    if (action !== 'terrain' && action !== 'all' && !state.world) {
      actions.toast('Create the territory first.');
      actions.selectTab('terrain');
      return false;
    }
    if (['all', 'region', 'settlements'].includes(action)) state.workbenchLayout?.prepareGeneration();
    actions.setBusy(true);
    // A user run takes the engine: the background place in flight (if any) completes and is dropped.
    await state.smallPlaces?.stop();
    if (state.cancelled) return false;
    const started = performance.now();
    const revision = state.projectRevision;
    let completed = false;
    if (['terrain', 'region', 'settlements', 'town'].includes(action)) state.chain.clearCityResults();
    state.chain.beginRun(action === 'town' ? [] : stagesForAction(action, townStage, terrainStage, state.settings.terrain?.procedural?.coastAfter));
    setText($('#progress-label'), 'Preparing computation…');
    setText($('#progress-time'), '0 s');
    state.elapsedTimer = setInterval(() => {
      setText($('#progress-time'), `${Math.round((performance.now() - started) / 1000)} s`);
    }, 500);
    actions.log(`Started: ${action} · seed ${state.settings.options.seed}`);
    try {
      const retainedSelection = state.selectedBuilding ? { ...state.selectedBuilding } : undefined,
        retainedSubdivision = state.selectedSubdivision;
      const result = await state.client.run(action, state.settings, state.previewBase?.pristine ?? state.previewBase?.world ?? state.pristine ?? state.world, key, townStage, terrainStage, keys, cityOutput);
      if (state.cancelled) return false;
      if (terrainStage && terrainStage !== 'cover-climate') {
        if (!state.world?.stats['v2.previewStage']) state.previewBase = { world: state.world, pristine: state.pristine };
      } else state.previewBase = undefined;
      state.labelBaseline = undefined;
      applyLabelEdits(result, state.settings.naming?.labels);
      state.pristine = result;
      const edited = applyBuildingEdits(result, state.mods);
      state.world = edited.world;
      if (edited.skipped) actions.log(`${edited.skipped} edit(s) no longer match their original building.`);
      setText($('#progress-label'), 'Drawing the map…');
      $<HTMLButtonElement>('#cancel-job').disabled = true;
      actions.log('Preparing the scene and drawing in the render worker…');
      const showStart = performance.now();
      await state.client.show(state.world, action === 'town' || action === 'towns');
      state.canvas.hidden = false;
      $('#empty-map').hidden = true;
      actions.updateWorld();
      void actions.refresh3dWorld();
      performance.measure('v2:show', { start: showStart });
      if (['region', 'settlements'].includes(action)) actions.selectTab('settlements');
      else if (['all', 'towns'].includes(action)) actions.selectTab('cities');
      setText($('#footer-status'), `Map ready · ${((performance.now() - started) / 1000).toFixed(1)} s`);
      const completion = `Finished in ${((performance.now() - started) / 1000).toFixed(2)} s · relief ${String(state.world.stats.backend ?? 'typescript-cpu')}`;
      const hasBuiltTowns = !!state.world.urban || state.world.settlements?.some(place => !!place.urban);
      actions.log(hasBuiltTowns ? `${completion} · cities ${String(state.world.stats['v2.urbanBackend'] ?? 'typescript-cpu')}` : completion);
      const refused = Object.entries(state.world.stats)
        .filter(([name]) => name.startsWith('v2.urbanRefusals:'))
        .reduce((count, [, value]) => count + Number(value || 0), 0);
      if (refused) {
        actions.log(`${refused} construction request(s) refused by the engine: see the settlement report.`);
        actions.toast(`${refused} construction(s) refused. Each settlement report explains the constraints.`, true);
      }
      if (state.world.stats['settlements.warning']) {
        actions.log(String(state.world.stats['settlements.warning']));
        if (!refused) actions.toast(String(state.world.stats['settlements.warning']));
      }
      if (key && retainedSelection?.settlement === key) {
        const buildings = townUrban(state.world, key)?.buildings ?? [],
          identity = retainedSelection.building as UrbanBuilding & { nativeRequestId?: string; nativeId?: string };
        const index = buildings.findIndex(b => (identity.nativeRequestId ? (b as typeof identity).nativeRequestId === identity.nativeRequestId : identity.nativeId ? (b as typeof identity).nativeId === identity.nativeId : buildingSignature(b) === buildingSignature(identity)));
        if (index >= 0) actions.showBuilding({ settlement: key, index, building: buildings[index] });
        else actions.showInspector(key);
      } else if (key && retainedSubdivision?.key === key) {
        if (!actions.inspectSubdivision(retainedSubdivision.kind, retainedSubdivision.point, key, retainedSubdivision.id)) actions.showInspector(key);
      } else if (key) actions.showInspector(key);
      state.smallPlaceRecipe = ['town', 'towns', 'all'].includes(action) && !cityOutput && !terrainStage ? actions.smallPlaceRecipeKey() : undefined;
      completed = true;
    } catch (e) {
      if (!state.cancelled) {
        const message = e instanceof Error ? e.message : String(e);
        actions.log(`Failed: ${message}`);
        if (message.startsWith('plan_refused:')) actions.toast('This model does not fit the parcel. The previous building is retained.', true);
        else if (message.includes('forced_use_refused:')) {
          const [, cause, role] = message.slice(message.indexOf('forced_use_refused:')).split(':');
          actions.toast(forcedUseRefusal(cause, role)!, true);
        } else void actions.reportGenerationFailure(message);
      }
    } finally {
      state.chain.endRun(completed);
      actions.setBusy(false);
      if (state.projectRevision !== revision) setText($('#footer-status'), 'New settings ready to generate');
      if (completed) state.smallPlaces?.start();
    }
    return completed;
  }
  return { smallPlaceRecipeKey, generateMainOnly, generate };
}

/** Gesture tracking and the background small-place queue. Called by main.ts in startup order. */
export function mountBackgroundPlaces(state: PageState, actions: PageActions): void {
  // ── Small places built in the background (smallPlaces.ts) ───────────────────────────────
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const)
    window.addEventListener(
      type,
      event => {
        if (type !== 'pointermove' || (event as PointerEvent).buttons) state.lastGesture = performance.now();
      },
      { passive: true, capture: true },
    );

  const GESTURE_QUIET_MS = 400;

  state.smallPlaces = new SmallPlaceQueue({
    canonicalOrder: true,
    canBuild: (base, keys) => boundedSmallPlaceRun(base, state.settings, keys, effectiveRegion(state.settings).autoBuildPopulation),
    base: () => {
      if (state.busy || !state.pristine || !state.world || state.previewBase || !state.pristine.urban || state.pristine.stats['v2.cityOutput'] || state.smallPlaceRecipe === undefined || state.smallPlaceRecipe !== actions.smallPlaceRecipeKey()) return undefined;
      return { world: state.pristine, limit: effectiveRegion(state.settings).autoBuildPopulation, recipe: state.smallPlaceRecipe, backend: state.settings.urban?.backend ?? state.settings.runtime?.backend ?? 'typescript' };
    },
    focus: () => {
      const view = state.client.viewer.getView();
      return Number.isFinite(view.cx) && Number.isFinite(view.cy) ? { x: view.cx, y: view.cy } : undefined;
    },
    // One bounded batch uses the existing parallel targeted-city path; silent progress.
    build: (base, keys) => state.client.run('towns', state.settings, base, undefined, undefined, undefined, [...keys], undefined, () => undefined, true),
    release: () => state.client.releaseUrbanLanes(),
    apply: async (result, keys) => {
      state.labelBaseline = undefined;
      applyLabelEdits(result, state.settings.naming?.labels);
      state.pristine = result;
      state.world = applyBuildingEdits(result, state.mods).world;
      actions.log(`Built in the background: ${keys.map(key => settlementDisplayName(state.world!, key, state.settings) ?? key).join(', ')}`);
      // Same world swap as after a targeted build: the place now has its `urban` layer and detail 'eager'.
      for (const key of keys) window.dispatchEvent(new CustomEvent('v2-place-built', { detail: { key, world: state.world } }));
      await state.client.show(state.world, true);
      actions.updateWorld(true);
      scheduleAutosave();
    },
    idle: async () => {
      for (;;) {
        const quiet = performance.now() - state.lastGesture;
        if (state.busy || quiet < GESTURE_QUIET_MS) {
          await new Promise(resolve => setTimeout(resolve, state.busy ? 250 : GESTURE_QUIET_MS - quiet));
          continue;
        }
        await new Promise<void>(resolve => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => resolve(), { timeout: 1000 }) : setTimeout(resolve, 50)));
        if (!state.busy && performance.now() - state.lastGesture >= GESTURE_QUIET_MS) return;
      }
    },
    onError: (keys, error) => actions.log(`Background build of ${keys.join(', ')} failed: ${error instanceof Error ? error.message : String(error)}`),
  });
}
