/** Recipe changes, form synchronization and service/import fields. main.ts mounts the interleaved DOM additions and parent tracking at their original positions. */
import type { PageState } from './state';
import type { PageActions } from './actions';
import { insertHTML, setText, setDynamicText, numberLocale, getDistanceUnit, formatDistance, adaptedExtent, type V2Settings, resetRegionalChildren, regionalParentKey, scheduleAutosave } from './dependencies';
import { $, esc } from './dom';

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

/** Service-address and import-scope DOM additions. Called by main.ts in startup order. */
export function mountSettingsDialogs(state: PageState, actions: PageActions): void {
  // Layer toggles live in the Display stages (widget:layer-*).
  insertHTML(
    $('#hardware-details'),
    'afterend',
    `<details class="section"><summary>Local service addresses</summary><p class="hint">The desktop edition starts Rust automatically. Python can use an existing local service. Addresses stay on your machine.</p><label class="label" for="rust-server">Native Rust</label><input id="rust-server" type="url" value="${esc(state.bootRuntime.localServer)}"><label class="label" for="python-server">Neural Python</label><input id="python-server" type="url" value="${esc(state.bootRuntime.pythonServer)}"><button id="services-apply" class="small" style="margin-top:12px">Save & verify</button><p class="hint">Python and model configuration: <a href="./scientific/index.html#runtime" target="_blank" rel="noopener">read the atlas ↗</a></p></details>`,
  );

  if (!state.localEdition) {
    $('#rust-server').hidden = true;
    $('label[for="rust-server"]').hidden = true;
    $('#rust-server').parentElement!.querySelector<HTMLElement>('p.hint')!.hidden = true;
  }

  insertHTML(
    $('#project-file'),
    'beforebegin',
    `<label class="label" for="import-scope">What should be imported from this file?</label><select id="import-scope"><option value="complete">Complete project · map + recipe + edits</option><option value="terrain">Territory · keep my settlement recipe</option><option value="urban">Settlement recipe · keep my territory</option></select><p class="hint" style="margin:8px 0 14px">Compositions retain the exact terrain and reset urban geometry: rebuild the settlements with the selected recipe.</p>`,
  );
}

/** Workbench handles and regional recipe parent tracking. Called by main.ts in startup order. */
export function mountRecipeTracking(state: PageState, actions: PageActions): void {
  state.workbenchLayout = undefined;
  state.roadDisplay = undefined;

  state.regionalParents = new WeakMap<V2Settings, string>([[state.settings, regionalParentKey(state.settings)]]);
}
