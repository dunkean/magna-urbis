/**
 * The recipe: what follows a change (autosave, chain sync, extent, background places), the reset of regional edits when
 * the regional parent changes, the sync of every form from the recipe, and the family tab. Mounted by main.ts once
 * the forms exist, to seed the regional parent of the recipe they normalized.
 */
import type { PageActions, PageState } from './contract';
import { setText, setDynamicText, numberLocale } from '../i18n';
import { getDistanceUnit, formatDistance } from '../units';
import { adaptedExtent } from '../settings';
import { resetRegionalChildren, regionalParentKey } from '../generationEdits';
import { scheduleAutosave } from '../autosave';
import { $ } from './dom';

export function createSettingsActions(state: PageState, actions: PageActions) {
  function syncUrbanBackend(): void {
    const backend = state.settings.urban?.backend ?? state.settings.runtime?.backend ?? 'typescript';
    $('#urban-controls').hidden = backend === 'typescript';
  }

  function resetRegionEdits(previousParent?: string): void {
    state.mods = resetRegionalChildren(state.settings, state.mods, previousParent);
    state.selectedCities.clear();
    state.cityScope = 'all';
    state.smallPlaceRecipe = undefined;
    for (const source of new Set([state.world, state.pristine]))
      if (source) {
        source.options = { ...source.options, culture: state.settings.options.culture };
        for (const place of source.settlements ?? []) {
          place.culture = state.settings.options.culture;
          source.stats['v2.culture:' + place.key] = state.settings.options.culture;
        }
      }
    state.chain.clearCityResults();
    actions.disposeInspectorForms();
    $('#inspector').hidden = true;
    state.selectedBuilding = null;
    state.selectedSubdivision = undefined;
    state.selectionOutline.set();
    $<HTMLInputElement>('#seed').value = state.settings.options.seed;
    state.urbanControls.sync();
    state.regionControls.sync();
    actions.syncNameOrigins();
  }

  function touchRecipe(): void {
    state.workbenchLayout?.sync();
    const parent = regionalParentKey(state.settings),
      previous = state.regionalParents.get(state.settings);
    if (previous !== undefined && previous !== parent) actions.resetRegionEdits(previous);
    state.regionalParents.set(state.settings, regionalParentKey(state.settings));
    state.projectRevision++;
    scheduleAutosave();
    // A recipe change drops the place in flight; the pass resumes only while the city recipe still matches the displayed map.
    state.smallPlaces?.cancel();
    state.smallPlaces?.start();
    actions.updateExtent();
    actions.scheduleChainSync();
    setText($('#footer-status'), state.world ? actions.fullGenerationStatus() : 'Terrain and water, in one click');
  }

  function updateExtent(): void {
    setDynamicText($('#extent-hint'), () => formatDistance(adaptedExtent(state.settings), getDistanceUnit(), numberLocale(), true));
  }

  function syncControls(): Promise<void> {
    if (!state.world?.stats['v2.previewStage']) state.previewBase = undefined;
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-option]').forEach(input => {
      const key = input.dataset.option!;
      const value = key.startsWith('center.') ? state.settings.options.center?.[key.endsWith('x') ? 'x' : 'y'] : (state.settings.options as unknown as Record<string, unknown>)[key];
      input.value = String(value ?? (key === 'sprawl' ? 1 : input.tagName === 'SELECT' ? 'auto' : ''));
    });
    const legacyCount = document.querySelector<HTMLInputElement>('#town-count');
    if (legacyCount) legacyCount.value = String(state.settings.settlementCount);
    $<HTMLInputElement>('#rust-server').value = state.settings.runtime?.localServer ?? state.bootRuntime.localServer ?? '';
    $<HTMLInputElement>('#python-server').value = state.settings.runtime?.pythonServer ?? state.bootRuntime.pythonServer ?? '';
    state.terrainControls.sync();
    state.regionControls.sync();
    state.urbanControls.sync();
    actions.syncUrbanBackend();
    actions.updateExtent();
    actions.syncDisplayWidgets();
    state.renderControls.sync();
    state.mapControls.sync();
    actions.syncNameOrigins();
    return state.client.setAppearance(state.settings).catch(actions.reportAppearanceError);
  }

  function selectTab(tab: string): void {
    state.currentTab = tab;
    state.chain.selectFamily(tab === 'terrain' ? 'region' : tab === 'map' ? 'map' : tab === 'cities' ? 'cities' : 'settlements');
  }
  return { syncUrbanBackend, resetRegionEdits, touchRecipe, updateExtent, syncControls, selectTab };
}

export function mountRecipeTracking(state: PageState): void {
  state.regionalParents.set(state.settings, regionalParentKey(state.settings));
}
