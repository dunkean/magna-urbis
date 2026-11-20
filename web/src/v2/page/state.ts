/**
 * Builds the V2 page's shared state (types and writers in `contract.ts`). main.ts creates it once, first.
 * The project and work fields start with their initial values. The parts (controls, client) are filled by their
 * mounts; reading one before its mount throws, so a start-up order mistake fails loudly instead of reading undefined.
 */
import type { PageModel, PageParts, PageState, PageWork } from './contract';
import type { V2Settings } from '../contracts';
import { defaultSettings } from '../settings';
import { applySceneClock, DEFAULT_SCENE } from '../sceneClock';
import { runtimeOptions } from '../platform';
import { resolveAutoBackend } from '../runtimeChoices';

const PARTS: readonly (keyof PageParts)[] = [
  'canvas',
  'client',
  'selectionOutline',
  'viewLoading',
  'sceneControls',
  'renderControls',
  'terrainControls',
  'regionControls',
  'backendBindings',
  'settingsPanel',
  'chain',
  'mapControls',
  'labelEditor',
  'riverEditor',
  'roadEditor',
  'contourEditor',
  'townMover',
  'nativeNeuralManager',
  'neuralModelManager',
  'editingTools',
  'cityCodeSharing',
];

function initialModel(): PageModel {
  const settings = defaultSettings();
  applySceneClock(settings, DEFAULT_SCENE);
  const bootRuntime = runtimeOptions(),
    localEdition = bootRuntime.profile === 'local';
  // The installed launcher already owns a ready native service; avoid loading WASM for the same CPU work.
  if (localEdition) {
    settings.generation = 'procedural';
    settings.runtime = { ...settings.runtime!, backend: 'native', source: 'procedural', localServer: bootRuntime.localServer, pythonServer: bootRuntime.pythonServer };
    delete settings.runtime.autoBackend;
  } else resolveAutoBackend(settings);
  return {
    settings,
    world: undefined,
    pristine: undefined,
    previewBase: undefined,
    mods: [],
    labelBaseline: undefined,
    smallPlaceRecipe: undefined,
    projectRevision: 0,
    busy: false,
    cancelled: false,
    selectedTown: 'main',
    cityScope: 'all',
    selectedCities: new Set<string>(),
    selectedBuilding: null,
    selectedSubdivision: undefined,
    currentTab: 'terrain',
    lastGesture: 0,
    bootRuntime,
    localEdition,
    connectLocal: localEdition,
    city3d: undefined,
  };
}

function initialWork(): PageWork {
  return {
    toastTimer: undefined,
    elapsedTimer: undefined,
    logs: [],
    logScroll: 0,
    renderTimer: undefined,
    renderRevision: 0,
    open3dToken: 0,
    open3dSeq: 0,
    chainSyncFrame: 0,
    pendingRegionPosition: undefined,
    inspectorForms: [],
    // An inert stand-in until the urban stage forms mount into the chain.
    urbanControls: { sync() {}, dispose() {} },
    nameOrigins: [],
    namingRevision: 0,
    namingWork: Promise.resolve(),
    neuralSelectionRevision: 0,
    parcelMerge: undefined,
    workbenchLayout: undefined,
    smallPlaces: undefined,
    // Seeded by mountRecipeTracking (settings.ts) once the forms have mounted; touchRecipe never runs before.
    regionalParents: new WeakMap<V2Settings, string>(),
  };
}

export function createPageState(): PageState {
  const state = { ...initialModel(), ...initialWork() };
  for (const name of PARTS) {
    let value: unknown,
      mounted = false;
    Object.defineProperty(state, name, {
      enumerable: true,
      get() {
        if (!mounted) throw new Error(`V2 page: '${name}' is read before its mount`);
        return value;
      },
      set(next) {
        value = next;
        mounted = true;
      },
    });
  }
  // The parts were just defined on the object above: it now has every field of PageState.
  return state as PageState;
}
