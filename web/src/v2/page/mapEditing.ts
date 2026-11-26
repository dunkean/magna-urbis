/**
 * Direct edits of the map: the names and labels editor (and the name redraw, serialized and superseded by revision),
 * the river and road editors, the outline editor of quarters, blocks and parcels, and the town mover. Each edit
 * replaces the displayed world through `applyDirectMapEdit`.
 */
import type { PageActions, PageState } from './contract';
import { getLanguage, numberLocale, registerMessages, translate } from '../i18n';
import { settlementDisplayName } from '../mapPresentation';
import type { World } from '../../gen/types';
import { applyBuildingEdits } from '../edits';
import { mountMapLabelEditor } from '../mapLabelEditor';
import { mountNetworkEditor } from '../networkEditor';
import { mountTownMoveEditor } from '../townMoveEditor';
import { roadAffectedTowns, roadTownNeedsChoice } from '../roadTownAccess';
import { withRoadEditChanges } from '../urbanRoadEditing';
import { mountContourEditor } from '../contourEditor';
import { editableContours, settingsForContourEdit, controlledContour, type ContourEdit, type ContourState } from '../contourEdits';
import { chooseAction } from '../actionDialog';
import { validateSettings } from '../project';
import type { RustTownSnapshot } from '../rustUrban';
import { atTopView } from './editingToolbar';
import { translateLand } from '../../ui/urbanSnapshot';
import { renameMap } from '../mapNaming';
import { $ } from './dom';
import { mountSettlementAdd } from './settlementAdd';
import { keepMovedSettlement } from '../settlementAdd';

export function createMapEditingActions(state: PageState, actions: PageActions) {
  function syncNameOrigins(): void {
    state.nameOrigins.forEach(form => form.sync());
  }

  function redrawNames(): Promise<void> {
    if (state.busy) return Promise.resolve();
    state.labelBaseline = undefined;
    const revision = ++state.namingRevision;
    state.projectRevision++;
    $('#map-names-apply').setAttribute('aria-busy', 'true');
    state.namingWork = state.namingWork
      .catch(() => {})
      .then(async () => {
        if (revision !== state.namingRevision || state.busy) return;
        if (!state.world) {
          state.mapControls.sync();
          actions.syncNameOrigins();
          return;
        }
        state.pristine = renameMap(state.pristine ?? state.world, state.settings, getLanguage());
        state.world = applyBuildingEdits(state.pristine, state.mods).world;
        await state.client.show(state.world, true);
        if (revision === state.namingRevision) {
          actions.updateWorld(true);
          actions.syncNameOrigins();
          state.inspectorForms.forEach(form => form.sync());
        }
      })
      .catch(actions.reportAppearanceError)
      .finally(() => {
        if (revision === state.namingRevision) $('#map-names-apply').setAttribute('aria-busy', 'false');
      });
    return state.namingWork;
  }

  /** Direct map edits replace the current snapshot; the full project saves that result. */
  async function applyDirectMapEdit(next: World): Promise<void> {
    if (state.busy) return;
    state.labelBaseline = undefined;
    state.previewBase = undefined;
    if (next.terrain !== state.world?.terrain) next.stats = { ...next.stats, 'v2.waterEditRevision': Math.max(Number(next.stats['v2.waterEditRevision'] ?? 0), Number(state.world?.stats['v2.waterEditRevision'] ?? 0) + 1) };
    state.pristine = next;
    state.mods = [];
    state.world = next;
    state.smallPlaceRecipe = undefined;
    state.client.invalidateRetained();
    actions.touchRecipe();
    await state.client.show(next, true);
    actions.updateWorld();
  }
  return { syncNameOrigins, redrawNames, applyDirectMapEdit };
}

/** Finish of a road session: the towns the edited roads reach are rebuilt (only their affected blocks) or keep their
 * buildings and only adapt their accesses, as the user chooses. Undefined: the user goes on editing. */
async function prepareRoadEdit(state: PageState, actions: PageActions, before: World, next: World): Promise<World | undefined> {
  const keys = roadAffectedTowns(before, next);
  if (!keys.length) return { ...next, stats: { ...next.stats, 'v2.roadEditReport': translate('Road edits applied. No settlement needs rebuilding.') } };
  const towns = keys.filter(key => roadTownNeedsChoice(next, key));
  let choice: 'access' | 'rebuild' | 'edit' = 'access';
  if (towns.length) {
    const answer = await chooseAction({
      id: 'road-towns-dialog',
      title: 'Update affected settlements',
      message: 'Keep the edited roads and rebuild only the affected blocks, or adapt the accesses while keeping the buildings.',
      details: towns.map(key => settlementDisplayName(next, key, state.settings) ?? key),
      cancelValue: 'edit',
      choices: [
        { value: 'edit', label: 'Continue road editing' },
        { value: 'rebuild', label: 'Rebuild affected blocks' },
        { value: 'access', label: 'Update accesses only', primary: true },
      ],
    });
    choice = answer.value ?? 'edit';
    if (choice === 'edit') return undefined;
  }
  const rebuild = keys.filter(key => !roadTownNeedsChoice(next, key) || choice === 'rebuild'),
    access = choice === 'rebuild' ? [] : towns;
  await state.smallPlaces?.stop();
  actions.setBusy(true, true);
  try {
    let updated = withRoadEditChanges(before, { ...next, stats: { ...next.stats, 'v2.roadRebuiltBlocks': 0, 'v2.roadAccessUnreachable': '' } }, keys);
    if (rebuild.length) updated = await state.client.run('towns', state.settings, updated, undefined, undefined, undefined, rebuild, undefined, actions.updateProgress, false, 'rebuild');
    if (access.length) updated = await state.client.run('towns', state.settings, updated, undefined, undefined, undefined, access, undefined, actions.updateProgress, false, 'access');
    if (updated.stats['v2.roadAccessUnreachable']) actions.toast('Some town accesses could not be routed. Try another waypoint or rebuild the affected town.', true);
    const blocks = Number(updated.stats['v2.roadRebuiltBlocks'] ?? 0);
    const report = translate('Road edits applied: {blocks} blocks rebuilt, {places} settlements checked.').replace('{blocks}', blocks.toLocaleString(numberLocale())).replace('{places}', keys.length.toLocaleString(numberLocale()));
    return { ...updated, terrain: next.terrain, stats: { ...updated.stats, 'v2.roadEditReport': report } };
  } finally {
    actions.setBusy(false);
  }
}

const OUTLINE_KEPT = 'Outline kept — site constraints';

/** One outline edit: the chosen town alone is rebuilt through its current stage with the edited recipe. Returns the
 * engine's warning when it refused or changed the outline. */
async function applyContourEdit(state: PageState, actions: PageActions, edit: ContourEdit): Promise<string | undefined> {
  if (!state.world) throw new Error('Create the terrain first.');
  const before = state.world,
    next = settingsForContourEdit(state.settings, edit);
  validateSettings(next);
  // An outline the control leaves unchanged only updates the recipe: nothing to rebuild.
  if (edit.shape && controlledContour(edit.target.shape, edit.shape) === edit.shape) {
    state.settings = next;
    await actions.applyDirectMapEdit({ ...before });
    return;
  }
  await state.smallPlaces?.stop();
  actions.setBusy(true, true);
  let updated: World;
  try {
    updated = await state.client.run('town', next, before, edit.target.town, undefined, undefined, undefined, undefined, actions.updateProgress, false, undefined, true);
  } finally {
    actions.setBusy(false);
  }
  state.settings = next;
  await actions.applyDirectMapEdit(updated);
  const warningsOf = (world: World) => (world.debug?.v2RustCities as Record<string, RustTownSnapshot> | undefined)?.[edit.target.town]?.warnings ?? [];
  const warnings = warningsOf(updated),
    previous = warningsOf(before);
  const pattern = /retouche|outline|contour|split|block edit|lot edit|parcel edit|quarter edit/i;
  const targets = editableContours(updated, edit.target.kind),
    actual = targets.find(t => t.town === edit.target.town && t.id === edit.target.id);
  const unchanged = edit.parts ? targets.length <= editableContours(before, edit.target.kind).length : edit.shape ? actual && controlledContour(edit.target.shape, actual.shape) === actual.shape : !!actual;
  return warnings.find(w => !previous.includes(w) && pattern.test(w)) ?? (unchanged ? (warnings.find(w => pattern.test(w)) ?? translate(OUTLINE_KEPT)) : undefined);
}

export function mountMapEditing(state: PageState, actions: PageActions): void {
  state.labelEditor = mountMapLabelEditor($('#edit-labels'), {
    getWorld: () => (state.previewBase ? undefined : state.world),
    getSettings: () => state.settings,
    // Recompose from the frozen generated names before applying the current edits: clearing a moved label or a
    // free-text replacement therefore restores its original name and placement.
    onChange: () => void actions.redrawNames(),
    onNames: () => {
      void actions.redrawNames();
    },
    onPlace: key => {
      state.selectedTown = key;
      state.selectedCities.clear();
      state.selectedCities.add(key);
      state.cityScope = 'selection';
      actions.syncCitySelection();
      document.querySelectorAll<HTMLButtonElement>('[data-town]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.town === key)));
    },
    map: $('#map'),
    getView: () => state.client.viewer.getView(),
    focus: point => {
      const view = state.client.viewer.getView();
      state.client.viewer.setView({ ...view, cx: point.x, cy: point.y });
    },
  });

  state.labelEditor.sync();

  registerMessages({ 'Names & labels': { en: 'Names & labels', fr: 'Noms et étiquettes' }, 'Edit name and visibility': { en: 'Edit name and visibility', fr: 'Modifier le nom et sa visibilité' } });

  const riverEditorHost = document.createElement('div');

  riverEditorHost.id = 'river-editor';

  $('#edit-rivers').append(riverEditorHost);

  const networkHost = {
    map: $('#map'),
    getWorld: () => (state.previewBase ? undefined : state.world),
    setWorld: actions.applyDirectMapEdit,
    getView: () => state.client.viewer.getView(),
    topView: () => atTopView(state),
    getSettings: () => state.settings,
    busy: () => state.busy,
    toast: actions.toast,
  };

  state.riverEditor = mountNetworkEditor({ ...networkHost, panel: riverEditorHost, tools: ['rivers'] });

  state.roadEditor = mountNetworkEditor({ ...networkHost, panel: $('#edit-roads'), tools: ['roads', 'draw'], prepareRoadEdit: (before, next) => prepareRoadEdit(state, actions, before, next) });

  $('#network-tool-slot').append($('.v2-network-shortcuts'));

  const contourTools = document.createElement('div');
  contourTools.id = 'contour-tool-slot';
  $('#network-tool-slot').append(contourTools);
  state.contourEditor = mountContourEditor({
    map: $('#map'),
    toolbar: contourTools,
    getView: networkHost.getView,
    topView: networkHost.topView,
    busy: () => state.busy,
    toast: actions.toast,
    capture: () => (state.world && !state.previewBase ? { world: state.world, settings: state.settings } : undefined),
    restore: async (snapshot: ContourState) => {
      state.settings = structuredClone(snapshot.settings);
      await actions.applyDirectMapEdit(snapshot.world);
    },
    apply: edit => applyContourEdit(state, actions, edit),
  });

  mountSettlementAdd(state, actions, $('.v2-network-shortcuts'));

  state.townMover = mountTownMoveEditor({
    map: $('#map'),
    toolbar: $('.v2-network-shortcuts'),
    getWorld: networkHost.getWorld,
    getView: networkHost.getView,
    busy: () => state.busy,
    error: actions.reportAppearanceError,
    places: $('#places-panel'),
    setView: view => state.client.viewer.setView(view),
    getSettings: networkHost.getSettings,
    getName: key => (state.world ? settlementDisplayName(state.world, key, state.settings) : undefined),
    deferred: {
      commit: async positions => {
        if (!state.world) return;
        state.settings.region ??= {};
        state.settings.region.placement = {
          ...state.settings.region.placement,
          mode: 'list',
          list: (state.world.settlements ?? []).map(place => ({
            key: place.key,
            name: place.name ?? '',
            population: place.population,
            culture: place.culture,
            siteType: place.archetype,
            sitePrefs: { ...place.options?.sitePrefs },
            position: positions.get(place.key) ?? { ...place.center },
          })),
        };
        for (const [key, center] of positions) {
          const previous = state.world.settlements?.find(place => place.key === key)?.center;
          const scope = state.settings.urban?.local?.[key];
          if (previous) for (const edits of [scope?.layout?.overrides?.quarters, scope?.parcels?.overrides?.parcels]) for (const edit of Object.values(edits ?? {})) if (edit.shape) edit.shape = translateLand(edit.shape, center.x - previous.x, center.y - previous.y);
          state.settings.local[key] = { ...state.settings.local[key], center: { ...center } };
          // A moved place stays where the user put it through later placements (count, population or density edits).
          const town = state.world.settlements?.find(place => place.key === key);
          if (town) keepMovedSettlement(state.settings, town, center);
        }
        actions.touchRecipe();
        await actions.generate('region', undefined, undefined, undefined, undefined, undefined, true);
      },
    },
    commit: async (next, key, dx, dy) => {
      const scope = state.settings.urban?.local?.[key];
      for (const edits of [scope?.layout?.overrides?.quarters, scope?.parcels?.overrides?.parcels]) for (const edit of Object.values(edits ?? {})) if (edit.shape) edit.shape = translateLand(edit.shape, dx, dy);
      const oldNames = new Map(state.world?.names?.entries.map(e => [e.id, e.anchor]) ?? []);
      for (const e of next.names?.entries ?? []) {
        const p = oldNames.get(e.id),
          edit = state.settings.naming?.labels?.[e.id];
        if (edit && p && (p.x !== e.anchor.x || p.y !== e.anchor.y)) edit.anchor = { ...e.anchor };
      }
      await actions.applyDirectMapEdit(next);
    },
  });
}
