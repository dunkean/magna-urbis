/** Generation controls and stage orchestration. main.ts mounts the terrain, chain and urban forms around the intervening runtime/editor setup to preserve listener order. */
import type { PageState } from './state';
import type { PageActions } from './actions';
import {
  setText,
  translate,
  registerMessages,
  firstPendingGeneration,
  runRemainingGeneration,
  type Options,
  type V2TownStage,
  type BuildingEdit,
  mountTerrainControls,
  batchUrbanSync,
  mountUrbanControls,
  type UrbanControlParts,
  mountStageChain,
  type StageDef,
  type StageFamily,
  mountHeightmapSource,
  backendStatus,
  mountRegionControls,
  mountMapControls,
  migrateUrbanSeeds,
  rerollUrbanSeeds,
  type UrbanSeedStage,
  rerollSeed,
} from './dependencies';
import { $ } from './dom';

export function createStageChainActions(state: PageState, actions: PageActions) {
  function runCities(stage?: V2TownStage, output?: string): void {
    const keys = actions.cityTargets();
    if (keys && !keys.length) {
      actions.toast(translate('Select at least one city in the list on the right.'));
      return;
    }
    void actions.generate('towns', undefined, stage, undefined, keys, output);
  }

  function rerollCityStep(stage: UrbanSeedStage, keys: string[], output?: string): void {
    if (state.busy) return;
    if (!keys.length) return;
    rerollUrbanSeeds(state.settings, keys, stage);
    actions.touchRecipe();
    state.urbanControls.sync();
    state.inspectorForms.forEach(form => form.sync());
    $<HTMLInputElement>('#seed').value = state.settings.options.seed;
    const order: V2TownStage[] = ['layout', 'parcels', 'programme', 'buildings'];
    const minimum: V2TownStage = stage === 'composition' || stage === 'streets' ? 'layout' : stage === 'parcels' ? 'parcels' : stage === 'programme' ? 'programme' : 'buildings';
    const target = order[Math.max(order.indexOf(minimum), ...keys.map(key => order.indexOf((state.world?.stats[`v2.urbanStage:${key}`] ?? 'buildings') as V2TownStage)))];
    if (keys.length === 1) void actions.generate('town', keys[0], target, undefined, undefined, output);
    else void actions.generate('towns', undefined, target, undefined, keys, output);
  }

  /** `family`: run the whole family (cached upstream stages are kept) instead of previewing this stage. */
  function rerollStage(stage: StageDef, family = false): void {
    if (state.busy) return;
    const variation = typeof stage.variation === 'function' ? stage.variation(state.chain.context()) : stage.variation;
    if (!variation) return;
    if (stage.family === 'cities') {
      actions.rerollCityStep(variation as UrbanSeedStage, actions.cityTargets() ?? state.world?.settlements?.map(place => place.key) ?? [], stage.id);
      return;
    }
    migrateUrbanSeeds(state.settings);
    if (variation === 'settle-sites') actions.resetRegionEdits();
    state.settings.options.seed = rerollSeed(state.settings.options.seed, variation === 'settle-sites' ? [variation, 'city/*/default'] : [variation]);
    $<HTMLInputElement>('#seed').value = state.settings.options.seed;
    actions.touchRecipe();
    if (family) actions.runFamily(stage.family);
    else actions.runStage(stage);
  }

  function scheduleChainSync(): void {
    if (state.chainSyncFrame) return;
    state.chainSyncFrame = requestAnimationFrame(() => {
      state.chainSyncFrame = 0;
      state.chain.sync();
    });
  }

  function fullGenerationStatus(): string {
    const first = firstPendingGeneration(state.settings, state.previewBase?.pristine ?? state.previewBase?.world ?? state.pristine ?? state.world, actions.cityTargets());
    return first ? `Will run from ${first.family === 'region' ? 'Relief' : first.family === 'settlements' ? 'Settlements' : 'Cities'}` : 'Settings changed · ready to generate';
  }

  function syncFullGenerationButton(family: StageFamily): void {
    const button = $<HTMLButtonElement>('#run-chain'),
      label = translate(state.fullGenerationHelp[family].en);
    button.title = label;
    button.setAttribute('aria-label', label);
    button.hidden = false;
  }

  async function runFullGeneration(): Promise<void> {
    if (state.busy) return;
    await runRemainingGeneration(state.chain.family(), {
      settings: () => state.settings,
      world: () => state.previewBase?.pristine ?? state.previewBase?.world ?? state.pristine ?? state.world,
      generate: (action, keys, through) => actions.generate(action, undefined, through, undefined, keys),
      targets: actions.cityTargets,
      redraw: actions.refreshAppearance,
      progress: p => actions.log(p.label),
    });
  }

  function runFamily(family: StageFamily): void {
    state.familyActions[family][1]();
  }

  function runStage(stage: StageDef): void {
    if (stage.id === 'map-export') {
      actions.dialog('#export-dialog');
      return;
    }
    if (stage.id === 'map-naming') {
      void actions.redrawNames();
      return;
    }
    const run = stage.run;
    if (run.action === 'display') {
      void actions.refreshAppearance();
      return;
    }
    if (run.action === 'mask') {
      state.terrainControls.openEditor('symbolic');
      return;
    }
    if (run.action === 'town') {
      const backend = state.settings.urban?.backend ?? state.settings.runtime?.backend ?? 'typescript';
      actions.runCities(backend === 'typescript' ? undefined : run.townStage, stage.id);
      return;
    }
    void actions.generate(run.action, undefined, undefined, run.action === 'terrain' ? stage.id : undefined);
  }

  function cityControlDefaults(key: string): Partial<Options> | undefined {
    const source = state.world,
      place = source?.settlements?.find(place => place.key === key);
    return source && place ? { ...place.options, culture: String(source.stats[`v2.culture:${key}`] ?? place.culture), population: Number(source.stats[`v2.population:${key}`] ?? place.population) } : undefined;
  }
  return { runCities, rerollCityStep, rerollStage, scheduleChainSync, fullGenerationStatus, syncFullGenerationButton, runFullGeneration, runFamily, runStage, cityControlDefaults };
}

/** Terrain and region forms, including placement picking. Called by main.ts in startup order. */
export function mountGenerationControls(state: PageState, actions: PageActions): void {
  state.terrainControls = mountTerrainControls($('#terrain-controls'), {
    getSettings: () => state.settings,
    onChange: () => {
      actions.touchRecipe();
      state.regionControls?.sync();
      actions.syncUrbanBackend();
    },
    disabled: () => state.busy,
    context: { getWorld: () => state.world, onApply: () => void actions.generate('terrain') },
  });

  // City Bench forms are mounted per stage once the chain exists (below).
  state.urbanControls = { sync() {}, dispose() {} };

  state.pendingRegionPosition = undefined;

  state.regionControls = mountRegionControls($('#region-controls'), {
    getSettings: () => state.settings,
    onChange: actions.touchRecipe,
    getWorld: () => state.world,
    disabled: () => state.busy,
    onReroute: () => void actions.generate('roads'),
    onPickPosition: key => {
      window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'placement' }));
      state.pendingRegionPosition = key;
      actions.toast(translate('Choose a position on the map'));
    },
  });

  window.addEventListener('v2-edit-mode', event => {
    if ((event as CustomEvent<string>).detail !== 'placement') state.pendingRegionPosition = undefined;
  });

  state.inspectorForms = [];
}

/** Generation families, stage chain and map controls. Called by main.ts in startup order. */
export function mountStageControls(state: PageState, actions: PageActions): void {
  state.chainSyncFrame = 0;

  state.fullGenerationHelp = {
    region: { en: 'Run every unfinished or stale stage, from relief through cities', fr: 'Exécuter toutes les étapes manquantes ou périmées, du relief aux villes' },
    settlements: { en: 'Run every unfinished or stale stage, including relief if needed, through cities', fr: 'Exécuter toutes les étapes manquantes ou périmées, y compris le relief si nécessaire, jusqu’aux villes' },
    cities: { en: 'Run every unfinished or stale stage through the targeted cities, including earlier stages if needed', fr: 'Exécuter toutes les étapes manquantes ou périmées jusqu’aux villes ciblées, y compris les étapes précédentes si nécessaire' },
    map: { en: 'Run every unfinished or stale stage, from relief through cities, then redraw the map', fr: 'Exécuter toutes les étapes manquantes ou périmées, du relief aux villes, puis redessiner la carte' },
  };

  for (const copy of Object.values(state.fullGenerationHelp)) registerMessages({ [copy.en]: copy });

  registerMessages({
    'Will run from Relief': { en: 'Will run from Relief', fr: 'La génération commencera au relief' },
    'Will run from Settlements': { en: 'Will run from Settlements', fr: 'La génération commencera aux peuplements' },
    'Will run from Cities': { en: 'Will run from Cities', fr: 'La génération commencera aux villes' },
  });

  state.familyActions = {
    region: ['Create the relief', () => void actions.generate('terrain')],
    settlements: ['Place & connect', () => void actions.generate('region')],
    cities: ['Build targeted cities', () => actions.runCities()],
    map: ['Redraw the map', () => void actions.refreshAppearance()],
  };

  state.chain = mountStageChain({
    root: $('#terrain-controls'),
    staging: $('#stage-staging'),
    terrain: state.terrainControls,
    regionRoot: $('#region-controls'),
    renderRoot: $('#render-controls'),
    getSettings: () => state.settings,
    getWorld: () => state.world,
    getPlace: () => {
      const place = state.world?.settlements?.find(s => s.key === state.selectedTown);
      return place ? { key: place.key, name: place.name ?? (place.main ? translate('Main settlement') : place.key) } : undefined;
    },
    busy: () => state.busy,
    cityScope: () => {
      const keys = (state.world?.settlements ?? [])
        .filter(place => state.cityScope === 'all' || state.selectedCities.has(place.key))
        .map(place => place.key)
        .sort();
      return { mode: state.cityScope, count: keys.length, total: state.world?.settlements?.length ?? 0, key: JSON.stringify([state.cityScope, keys]) };
    },
    onCityScope: mode => {
      state.cityScope = mode;
      actions.syncCitySelection();
    },
    onChange: () => {
      actions.touchRecipe();
      state.regionControls.sync();
      actions.syncUrbanBackend();
    },
    onRegionChange: () => {
      actions.touchRecipe();
      state.regionControls.sync();
    },
    onAppearance: () => {
      state.projectRevision++;
      clearTimeout(state.renderTimer);
      state.renderTimer = setTimeout(() => void actions.refreshAppearance(), 120);
    },
    run: actions.runStage,
    reroll: actions.rerollStage,
    runFamily: actions.runFamily,
    openPlace: () => {
      if (state.world && state.selectedTown) {
        $('#places-panel').hidden = false;
        actions.showInspector(state.selectedTown);
      }
    },
    openExecution: actions.openExecutionSettings,
    onNeuralSelected: () => void actions.inspectNeuralSelection(),
    availability: () => {
      const s = backendStatus();
      return { checked: s.checked, webgpu: s.webgpu, native: s.native.available, python: s.python.available };
    },
    heightmap: {
      source: host =>
        mountHeightmapSource(host, {
          getSettings: () => state.settings,
          onLoaded: () => {
            actions.touchRecipe();
            state.terrainControls.sync();
            state.chain.sync();
            actions.toast('Heightmap loaded. Create the relief to use it.');
          },
          importFile: () => $<HTMLButtonElement>('#terrain-import-heightmap').click(),
          importImage: () => $<HTMLInputElement>('#heightmap-file').click(),
          onError: error => actions.toast(String(error), true),
        }),
    },
    onFamily: family => {
      actions.syncFullGenerationButton(family);
      window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: family === 'map' && state.world && !state.busy ? 'labels' : 'family' }));
      setText($('#generate-label'), state.familyActions[family][0]);
      actions.syncPlacesPanel(family);
    },
  });

  state.mapControls = mountMapControls(state.chain.body('map-naming'), state.chain.body('map-export'), {
    getSettings: () => state.settings,
    getWorld: () => state.world,
    busy: () => state.busy,
    onNames: () => {
      void actions.redrawNames();
    },
    onExport: () => actions.dialog('#export-dialog'),
  });
}

/** Urban forms mounted into the existing chain stages. Called by main.ts in startup order. */
export function mountUrbanStageForms(state: PageState, actions: PageActions): void {
  const urbanParts: [string, UrbanControlParts][] = [
    ['city-composition', { sections: ['layout', 'footprint', 'growth', 'fortifications', 'ports'], extras: ['header', 'phases', 'archetypes'] }],
    ['city-roads', { sections: ['streets'], extras: [] }],
    ['city-parcels', { sections: ['parcels'], extras: [] }],
    ['city-programme', { sections: ['programme'], extras: [] }],
    ['city-buildings', { sections: ['placement'], extras: [] }],
    ['city-houses', { sections: ['house', 'workshop'], extras: ['mixtures', 'catalogue'] }],
  ];

  {
    const forms = urbanParts.map(([stage, parts]) => {
      const host = document.createElement('div');
      state.chain.body(stage).append(host);
      return mountUrbanControls(
        host,
        () => state.settings,
        () => {
          state.mods = state.mods.filter(m => !(m && typeof m === 'object' && (m as BuildingEdit).type === 'building' && (state.cityScope === 'all' || state.selectedCities.has((m as BuildingEdit).settlement))));
          actions.touchRecipe();
          actions.syncUrbanBackend();
          state.urbanControls.sync();
        },
        { kind: 'global' },
        {
          ...parts,
          targets: () => (state.world?.settlements ?? []).filter(place => state.cityScope === 'all' || state.selectedCities.has(place.key)).map(place => place.key),
          placeDefaults: actions.cityControlDefaults,
          disabled: () => state.busy || (!!state.world?.settlements?.length && state.cityScope === 'selection' && !state.selectedCities.size),
        },
      );
    });
    state.urbanControls = { sync: () => batchUrbanSync(() => forms.forEach(form => form.sync())), dispose: () => forms.forEach(form => form.dispose()) };
  }
}
