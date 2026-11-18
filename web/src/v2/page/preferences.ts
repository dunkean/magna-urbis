/** Language/units, layout, reset, name origins and road display. main.ts calls the mounts at the original startup positions to preserve page side effects. */
import type { PageState } from './state';
import type { PageActions } from './actions';
import {
  setText,
  translate,
  setLanguage,
  onLanguageChange,
  initializeLanguage,
  numberLocale,
  registerMessages,
  type Language,
  getDistanceUnit,
  onUnitsChange,
  unitFactor,
  type DistanceUnit,
  mountWorkbenchLayout,
  mountRoadDisplayControl,
  mountNameOriginControls,
  saveAutosaveNow,
  resetSettings,
  markAllStagesStale,
  RESET_LABEL,
  RESET_TITLE,
  RESET_CONFIRM,
  RESET_DONE,
} from './dependencies';
import { $ } from './dom';

/** Language/units, layout, reset, name origins and road display. Called by main.ts in startup order. */
export function mountPreferences(state: PageState, actions: PageActions): void {
  $<HTMLSelectElement>('#language-select').onchange = event => setLanguage((event.target as HTMLSelectElement).value as Language);

  state.preferenceDraw = Promise.resolve();
  state.preferenceRevision = 0;

  const refreshPresentation = () => {
    actions.syncLocalFacts();
    actions.updateExtent();
    setText($('#scale-label'), `≈ ${Math.round(80 / state.client.viewer.getView().scale).toLocaleString(numberLocale())} m`);
    const height = document.querySelector<HTMLInputElement>('#house-height');
    if (height) {
      const previous = (height.dataset.distanceUnit ?? 'm') as DistanceUnit;
      if (previous !== getDistanceUnit() && height.value !== '') height.value = String(Number(((Number(height.value) * unitFactor(previous)) / unitFactor(getDistanceUnit())).toFixed(6)));
      height.dataset.distanceUnit = getDistanceUnit();
      height.min = String(0.5 / unitFactor(getDistanceUnit()));
      height.max = String(1000 / unitFactor(getDistanceUnit()));
      const label = document.querySelector('[data-house-height-unit]');
      if (label) label.textContent = getDistanceUnit();
    }
    if (state.world && !state.busy) {
      const shown = state.world,
        revision = ++state.preferenceRevision;
      state.preferenceDraw = state.preferenceDraw
        .catch(() => {})
        .then(async () => {
          if (revision !== state.preferenceRevision || state.world !== shown || state.busy) return;
          await state.client.show(shown, true);
          if (revision === state.preferenceRevision && state.world === shown) state.city3d?.refresh();
        })
        .catch(actions.reportAppearanceError);
    }
  };

  onUnitsChange(refreshPresentation);

  onLanguageChange(() => {
    actions.syncFullGenerationButton(state.chain.family());
    actions.renderLog();
    document.querySelectorAll<HTMLOptGroupElement>('optgroup[data-render-label]').forEach(group => (group.label = translate(group.dataset.renderLabel!)));
    state.renderControls.sync();
    refreshPresentation();
    if (!state.busy) {
      if (state.selectedBuilding) actions.showBuilding(state.selectedBuilding);
      else if (state.selectedSubdivision) actions.inspectSubdivision(state.selectedSubdivision.kind, state.selectedSubdivision.point, state.selectedSubdivision.key, state.selectedSubdivision.id);
    }
  });

  registerMessages({ 'General seed': { en: 'General seed', fr: 'Graine générale' } });

  setText($('label[for="seed"]'), 'General seed');

  $<HTMLInputElement>('#seed').maxLength = 65536;

  initializeLanguage();

  state.workbenchLayout = mountWorkbenchLayout({
    getSettings: () => state.settings,
    getWorld: () => state.world,
    changed: actions.touchRecipe,
    appearance: () => {
      state.projectRevision++;
      void actions.refreshAppearance();
    },
    syncForms: () => {
      state.regionControls.sync();
      state.urbanControls.sync();
      state.inspectorForms.forEach(form => form.sync());
    },
  });

  {
    // Reset, next to Advanced in the top bar: a fresh page's recipe (runtime choice kept); the map stays until the next generation.
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.id = 'settings-reset';
    reset.className = 'advanced-open';
    setText(reset, RESET_LABEL);
    reset.setAttribute('data-i18n-title', RESET_TITLE);
    reset.title = translate(RESET_TITLE);
    $('#map-advanced-open').after(reset);
    reset.onclick = async () => {
      if (state.busy || !window.confirm(translate(RESET_CONFIRM))) return;
      state.labelBaseline = undefined;
      state.smallPlaceRecipe = undefined;
      await state.smallPlaces?.stop();
      state.settings = resetSettings(state.settings);
      state.mods = [];
      markAllStagesStale(state.world, state.pristine, state.previewBase?.world, state.previewBase?.pristine);
      state.chain.clearResults();
      state.selectedCities.clear();
      state.cityScope = 'all';
      state.selectedTown = 'main';
      actions.disposeInspectorForms();
      $('#inspector').hidden = true;
      state.selectedBuilding = null;
      state.selectedSubdivision = undefined;
      state.selectionOutline.set();
      setText($('#import-height-info'), 'No heightmap imported.');
      actions.touchRecipe();
      await actions.syncControls();
      actions.syncCitySelection();
      state.labelEditor.sync();
      state.projectRevision++;
      await actions.refreshAppearance();
      saveAutosaveNow();
      actions.log(RESET_DONE);
      actions.toast(RESET_DONE);
    };
  }

  {
    const host = document.createElement('section');
    host.id = 'settlements-name-origin';
    document.querySelector('#family-settlements .family-general')!.append(host);
    state.nameOrigins.push(
      mountNameOriginControls(host, 'settlements-name-origin', {
        getSettings: () => state.settings,
        busy: () => state.busy,
        changed: () => {
          actions.syncNameOrigins();
          void actions.redrawNames();
        },
      }),
    );
  }

  // Roads as plan, hidden or rendered: next to the urban plan field of the top bar.
  state.roadDisplay = mountRoadDisplayControl(document.querySelector('[data-setting-path="appearance.city.plan"]')?.closest('.parameter-field') ?? null, $('.view-strip'), {
    getSettings: () => state.settings,
    onChange: () => {
      state.projectRevision++;
      clearTimeout(state.renderTimer);
      state.renderTimer = setTimeout(() => void actions.refreshAppearance(), 120);
    },
  });
}
