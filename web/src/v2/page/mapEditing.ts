/**
 * Direct edits of the map: the names and labels editor (and the name redraw, serialized and superseded by revision),
 * the river and road editors, and the town mover. Each edit replaces the displayed world through `applyDirectMapEdit`.
 */
import type { PageActions, PageState } from './contract';
import { getLanguage, registerMessages } from '../i18n';
import { settlementDisplayName } from '../mapPresentation';
import type { World } from '../../gen/types';
import { applyBuildingEdits } from '../edits';
import { mountMapLabelEditor } from '../mapLabelEditor';
import { mountNetworkEditor } from '../networkEditor';
import { mountTownMoveEditor } from '../townMoveEditor';
import { translateLand } from '../../ui/urbanSnapshot';
import { renameMap } from '../mapNaming';
import { $ } from './dom';

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
          await actions.refresh3dWorld();
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
    void actions.refresh3dWorld();
  }
  return { syncNameOrigins, redrawNames, applyDirectMapEdit };
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

  const networkHost = { map: $('#map'), getWorld: () => (state.previewBase ? undefined : state.world), setWorld: actions.applyDirectMapEdit, getView: () => state.client.viewer.getView(), getSettings: () => state.settings, busy: () => state.busy, toast: actions.toast };

  state.riverEditor = mountNetworkEditor({ ...networkHost, panel: riverEditorHost, tools: ['rivers'] });

  state.roadEditor = mountNetworkEditor({ ...networkHost, panel: $('#edit-roads'), tools: ['roads', 'draw'], getSettings: () => state.settings });

  $('#network-tool-slot').append($('.v2-network-shortcuts'));

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
        }
        actions.touchRecipe();
        await actions.generate('region');
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
