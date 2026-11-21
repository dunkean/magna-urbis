/**
 * The Places panel: the list of settlements and isolated buildings, the city selection that targets runs, population
 * and warning texts, local facts cards, and `updateWorld`, which resyncs every control after the displayed world changes.
 */
import type { PageActions, PageState } from './contract';
import { setHTML, insertHTML, setText, setDynamicText, translate, numberLocale, nameHTML, numberHTML } from '../i18n';
import { settlementDisplayName } from '../mapPresentation';
import { localFactsHtml, type LocalFactsInput } from '../localFacts';
import { activitySitesOf } from '../activitySites';
import { isolatedPlacesOf } from '../isolatedPlaces';
import { demographicClass } from '../../../../rust/bridge/settlementDemography';
import { nativeCityRecords } from '../nativeProducts';
import { cityReachedPopulation, populationText, populationShortfallText } from '../../render/cityPopulation';
import { emptyTownWarningKeys, isNeighbourWarning, nameNeighbourWarning } from '../townNeighbours';
import { townUrban } from '../edits';
import { TownFirstDisplay } from '../townFirstDisplay';
import { stageById, type StageFamily } from '../stageRegistry';
import { $, esc } from './dom';

/** Number formatting of the population texts, in the current language. */
export const populationFormat = () => ({ t: translate, locale: numberLocale() });

export function createPlacesActions(state: PageState, actions: PageActions) {
  const placeName = (key: string): string => (state.world && settlementDisplayName(state.world, key, state.settings)) || key;
  const firstDisplay = new TownFirstDisplay();
  let waitingForDisplay = false;
  const syncFirstDisplay = (): void => {
    document.querySelectorAll<HTMLElement>('[data-town-render-loading]').forEach(spinner => {
      const pending = firstDisplay.pending(state.world, spinner.dataset.townRenderLoading!);
      spinner.hidden = !pending;
      spinner.setAttribute('aria-busy', String(pending));
    });
  };
  /** Generation can finish before the first exact town paint. Await the displayed request, including its Canvas,
   * while keeping the rest of the app usable. A newer world replaces the wait without clearing its own spinner. */
  const waitForFirstDisplay = async (): Promise<void> => {
    if (waitingForDisplay) return;
    waitingForDisplay = true;
    try {
      while (state.world && state.world.settlements?.some(town => firstDisplay.pending(state.world, town.key))) {
        const world = state.world;
        await state.client.displaySettled();
        if (world !== state.world) continue;
        firstDisplay.notePresented(world);
        syncFirstDisplay();
      }
    } catch (error) {
      actions.reportAppearanceError(error);
    } finally {
      waitingForDisplay = false;
    }
  };

  function cityTargets(): string[] | undefined {
    return state.cityScope === 'all' ? undefined : [...state.selectedCities];
  }

  function syncCitySelection(): void {
    const valid = new Set(state.world?.settlements?.map(place => place.key) ?? []);
    for (const key of state.selectedCities) if (!valid.has(key)) state.selectedCities.delete(key);
    if (state.cityScope === 'selection' && !state.selectedCities.size) state.cityScope = 'all';
    document.querySelectorAll<HTMLInputElement>('[data-city-select]').forEach(input => {
      input.checked = state.cityScope === 'selection' && state.selectedCities.has(input.dataset.citySelect!);
      input.disabled = state.busy;
    });
    $<HTMLButtonElement>('#towns-only').disabled = state.busy || !valid.size || (state.cityScope === 'selection' && !state.selectedCities.size);
    $('#cities-select-all').setAttribute('aria-pressed', String(state.cityScope === 'all'));
    setDynamicText($('#cities-selected-count'), () => translate('{count} selected').replace('{count}', String(state.cityScope === 'all' ? valid.size : state.selectedCities.size)));
    state.urbanControls.sync();
    state.chain.sync();
  }

  /** Population reached by a built town (undefined before its houses exist: the target stays displayed). */
  function reachedPopulation(key: string, target: number) {
    const native = nativeCityRecords(state.world ?? undefined)?.[key];
    return native?.stage === 'buildings'
      ? cityReachedPopulation(
          target,
          (native.programmePartitions ?? []).map(p => p.programme),
          native.scene,
        )
      : undefined;
  }

  /** The engine's warnings about neighbouring towns, with site keys. */
  function neighbourWarnings(key: string): string[] {
    const native = nativeCityRecords(state.world ?? undefined)?.[key];
    // The layout keeps the engine's text (site keys); the snapshot's copy may already carry other names.
    const raw = (native?.layouts ?? []).flatMap(layout => layout.warnings ?? []);
    return [...new Set(raw.length ? raw : (native?.warnings ?? []))].filter(isNeighbourWarning);
  }

  /** A place with no room is listed as absorbed by the neighbours that claim the land. */
  function absorbedBy(key: string): string | undefined {
    const empty = actions.neighbourWarnings(key).map(emptyTownWarningKeys).find(Boolean);
    return empty?.map(placeName).join(', ');
  }

  /** The Places list ⚠: the capacity shortfall, else the neighbours' warnings (a place they leave short or empty). */
  function placeWarningText(key: string, target: number): string {
    const reached = actions.reachedPopulation(key, target);
    if (reached?.shortfallHouseholds) return populationShortfallText(reached, populationFormat());
    return actions
      .neighbourWarnings(key)
      .map(w => translate(nameNeighbourWarning(w, placeName)))
      .join('\n');
  }

  function populationMarkup(key: string, target: number): string {
    const absorbed = actions.absorbedBy(key);
    if (absorbed) return esc(translate('Absorbed by {name}').replace('{name}', absorbed));
    const reached = actions.reachedPopulation(key, target);
    return reached ? esc(populationText(target, reached, populationFormat())) : `${numberHTML(target)} hab.`;
  }

  function cityStageLabel(key: string): string {
    if (!state.world || !townUrban(state.world, key)) return 'Placed · no urban plan';
    const stage = state.world.stats[`v2.urbanStage:${key}`];
    return stage === 'layout' ? 'Stage: roads & quarters' : stage === 'parcels' ? 'Stage: parcels' : stage === 'programme' ? 'Stage: programme' : 'Stage: houses';
  }

  function syncPlacesPanel(family: StageFamily = state.chain.family()): void {
    document.body.dataset.workbenchFamily = family;
    $('#places-panel').hidden = !['settlements', 'cities'].includes(family);
  }

  function disposeInspectorForms(): void {
    state.inspectorForms.forEach(form => form.dispose());
    state.inspectorForms = [];
  }

  /** `keepInspector`: a background place arrived; the user's open inspector stays as it is. */
  function updateWorld(keepInspector = false): void {
    if (!state.world) return;
    state.labelEditor.sync();
    state.riverEditor.sync();
    state.roadEditor.sync();
    state.contourEditor.sync();
    state.townMover.sync();
    state.editingTools.sync();
    state.mapControls.sync();
    if (!keepInspector) actions.disposeInspectorForms();
    state.regionControls.sync();
    state.terrainControls.sync();
    state.city3d?.refresh();
    const towns = (state.world.settlements ?? []).map(place => ({ ...place, name: settlementDisplayName(state.world!, place.key, state.settings) }));
    setText($('#map-metrics'), `${state.world.terrain.rivers.length} watercourses\n${towns.length} settlements`);
    const preview = stageById.get(String(state.world.stats['v2.previewStage'] ?? ''));
    $('#preview-close').hidden = !preview || !state.previewBase?.world;
    setText($('#towns-count'), String(towns.length));
    setHTML(
      $('#settlement-list'),
      towns.length
        ? [...towns]
            .sort((a, b) => b.population - a.population)
            .map(
              (s, index, list) =>
                `${index === 0 || demographicClass(list[index - 1].population) !== demographicClass(s.population) ? `<h3 class="settlement-group">${esc(translate(demographicClass(s.population)))}</h3>` : ''}<div class="settlement-choice"><input type="radio" name="city-target" data-city-select="${esc(s.key)}" aria-label="${esc(translate('Select {name} for generation').replace('{name}', s.name ?? s.key))}" ${state.selectedCities.has(s.key) ? 'checked' : ''}><button class="settlement-item" data-town="${esc(s.key)}" aria-pressed="${state.selectedTown === s.key}"><span class="settlement-dot ${(s.main ? state.world?.urban : s.urban) ? 'ready' : ''}"></span><span class="grow"><span class="settlement-name"><strong>${nameHTML(s.name, s.main ? 'Main settlement' : s.key)}</strong><span class="view-loading town-render-loading" data-town-render-loading="${esc(s.key)}" role="status" aria-busy="${firstDisplay.pending(state.world, s.key)}" aria-label="Loading textures and view…" title="Loading textures and view…"${firstDisplay.pending(state.world, s.key) ? '' : ' hidden'}></span>${((warning: string) => (warning ? `<span class="settlement-warning" role="img" title="${esc(warning)}" aria-label="${esc(warning)}">⚠</span>` : ''))(actions.placeWarningText(s.key, s.population))}</span><small>${actions.populationMarkup(s.key, s.population)} · <span>${esc(s.archetype)}</span></small><small class="settlement-stage">${actions.cityStageLabel(s.key)}</small></span><span class="count-badge">${(s.main ? state.world?.urban : s.urban) ? '↗' : '＋'}</span></button></div>`,
            )
            .join('')
        : '<p class="hint">Create settlement sites to select a place.</p>',
    );
    const activities = activitySitesOf(state.world);
    if (activities.length)
      insertHTML(
        $('#settlement-list'),
        'beforeend',
        `<h3 class="settlement-group">Isolated buildings · ${activities.length}</h3>${[...activities]
          .sort((a, b) => b.buildings.length - a.buildings.length)
          .map(site => `<button class="activity-place" data-activity="${esc(site.id)}"><strong>${esc(site.template)}</strong><small>${esc(site.kind)} · ${site.buildings.length}</small></button>`)
          .join('')}`,
      );
    // Inhabited farms outside every listed place (land use): listed as farmsteads and hamlets of their nearest place.
    const isolated = isolatedPlacesOf(state.world);
    if (isolated.length)
      insertHTML(
        $('#settlement-list'),
        'beforeend',
        `<h3 class="settlement-group">${esc(translate('Isolated farmsteads'))} · ${isolated.length}</h3>${isolated
          .map(
            place =>
              `<button class="activity-place" data-isolated="${esc(place.key)}"><strong>${esc(translate(place.category === 'hamlet' ? 'Farm hamlet' : 'Isolated farmstead'))}</strong><small>${esc(translate('{farms} households').replace('{farms}', String(place.farms)))}${place.near ? ` · ${esc(translate('near {place}').replace('{place}', settlementDisplayName(state.world!, place.near, state.settings) ?? place.near))}` : ''}${place.connected ? '' : ` · ${esc(translate('no track'))}`}</small></button>`,
          )
          .join('')}`,
      );
    document.querySelectorAll<HTMLButtonElement>('[data-isolated]').forEach(
      button =>
        (button.onclick = () => {
          const place = isolated.find(place => place.key === button.dataset.isolated);
          if (!place) return;
          state.client.viewer.setView({ cx: place.center.x, cy: place.center.y, scale: 2 });
          if (place.near) actions.showInspector(place.near);
        }),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-activity]').forEach(
      button =>
        (button.onclick = () => {
          const site = activities.find(site => site.id === button.dataset.activity);
          if (!site) return;
          state.client.viewer.setView({ cx: site.x, cy: site.y, scale: 2 });
          actions.showInspector(site.parent);
          setHTML($('#building-inspector'), `<div class="edit-building"><h3>${esc(site.template)}</h3><p>${esc(site.kind)} · ${site.buildings.length} buildings · ${site.residents} inhabitants</p><p class="hint">${esc(site.resource)} · ${esc(site.culture)}</p></div>`);
        }),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-town]').forEach(
      b =>
        (b.onclick = () => {
          state.selectedCities.clear();
          state.selectedCities.add(b.dataset.town!);
          state.cityScope = 'selection';
          actions.syncCitySelection();
          actions.showInspector(b.dataset.town!, true);
        }),
    );
    document.querySelectorAll<HTMLInputElement>('[data-city-select]').forEach(
      input =>
        (input.onchange = () => {
          const key = input.dataset.citySelect!;
          if (!input.checked) return;
          state.selectedCities.clear();
          state.selectedCities.add(key);
          state.cityScope = 'selection';
          state.smallPlaces?.prioritize(key);
          actions.syncCitySelection();
          actions.showInspector(key);
        }),
    );
    actions.syncCitySelection();
    if (!keepInspector) {
      $('#inspector').hidden = true;
      state.selectedBuilding = null;
      state.selectedSubdivision = undefined;
      state.selectionOutline.set();
    }
    actions.syncPlacesPanel();
    state.chain.sync();
    actions.syncLocalFacts();
    syncFirstDisplay();
    void waitForFirstDisplay();
  }

  function syncLocalFacts(): void {
    if (!state.world) return;
    document.querySelectorAll<HTMLElement>('[data-local-facts]').forEach(card => {
      const key = card.dataset.localFacts!,
        settlement = state.world!.settlements?.find(place => place.key === key);
      if (!settlement) return;
      const kind = card.dataset.factsKind as NonNullable<LocalFactsInput['selection']>['kind'] | undefined;
      setHTML(card, localFactsHtml({ settlement, urban: townUrban(state.world!, key), native: nativeCityRecords(state.world!)?.[key], selection: kind ? { kind, index: Number(card.dataset.factsIndex) } : undefined }));
    });
  }

  function appendLocalFacts(host: HTMLElement, key: string, selection?: LocalFactsInput['selection']): void {
    const card = document.createElement('section');
    card.className = 'local-facts';
    card.dataset.localFacts = key;
    if (selection) {
      card.dataset.factsKind = selection.kind;
      card.dataset.factsIndex = String(selection.index);
    }
    host.append(card);
    actions.syncLocalFacts();
  }
  return { cityTargets, syncCitySelection, reachedPopulation, neighbourWarnings, absorbedBy, placeWarningText, populationMarkup, cityStageLabel, syncPlacesPanel, disposeInspectorForms, updateWorld, syncLocalFacts, appendLocalFacts };
}

/** The selection buttons and the collapse toggle of the Places panel. */
export function mountPlaces(state: PageState, actions: PageActions): void {
  $('#cities-select-all').onclick = () => {
    state.selectedCities.clear();
    state.cityScope = 'all';
    state.selectedTown = '';
    state.selectedBuilding = null;
    state.selectedSubdivision = undefined;
    state.selectionOutline.set();
    $('#inspector').hidden = true;
    document.querySelectorAll('[data-town]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    actions.syncCitySelection();
  };

  $('#cities-select-none').onclick = () => {
    state.selectedCities.clear();
    state.cityScope = 'selection';
    actions.syncCitySelection();
  };

  $('#places-collapse').onclick = () => {
    const panel = $('#places-panel'),
      collapsed = panel.dataset.collapsed !== 'true';
    panel.dataset.collapsed = String(collapsed);
    $('#places-collapse').setAttribute('aria-expanded', String(!collapsed));
    setText($('#places-collapse'), collapsed ? '+' : '–');
  };
}
