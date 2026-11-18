/**
 * Public types of the V2 page modules (`v2/page/`): the shared page state and the operations the modules call on one
 * another. Types only; `state.ts` builds the state, `actions.ts` assembles the operations.
 */
import type { mountWorkbenchLayout } from '../workbenchLayout';
import type { mountSceneControls } from '../sceneControls';
import type { mountRoadDisplayControl } from '../roadDisplayControl';
import type { mountEditingTools } from '../editingTools';
import type { mountRenderControls } from '../renderControls';
import type { World, UrbanBuilding } from '../../gen/types';
import type { StudioClient, Action } from '../client';
import type { V2Settings, V2Progress, V2TownStage, UrbanSeedStage } from '../contracts';
import type { runtimeOptions } from '../platform';
import type { mountTerrainControls } from '../terrainControls';
import type { UrbanControls } from '../urbanControls';
import type { StageChain } from '../stageChain';
import type { StageDef, StageFamily } from '../stageRegistry';
import type { mountSettingsPanel } from '../settingsPanel';
import type { mountDesktopNeural } from '../desktopNeural';
import type { mountRegionControls } from '../regionControls';
import type { SmallPlaceQueue } from '../smallPlaces';
import type { mountMapControls } from '../mapControls';
import type { mountNameOriginControls } from '../nameOriginControls';
import type { mountMapLabelEditor } from '../mapLabelEditor';
import type { mountNetworkEditor } from '../networkEditor';
import type { mountTownMoveEditor } from '../townMoveEditor';
import type { createSelectionOverlay } from '../selectionOverlay';
import type { mountViewLoadingIndicator } from '../viewLoadingIndicator';
import type { V2Urban3d } from '../urban3d';
import type { mountCityCodeSharing } from '../cityCodeSharing';
import type { LocalFactsInput } from '../localFacts';
import type { Options } from '../../gen/options';
import type { cityReachedPopulation } from '../../render/cityPopulation';
import type { buildingAt } from '../edits';

/**
 * The project shown by the page and what the user selected in it. Every field holds its initial value from
 * `createPageState()` on. Writers:
 * - settings: model init; generation, the town/house/subdivision inspectors, projects (load, expert recipe), reset (preferences), the town mover, recipe listeners (toolbar), service addresses (runtime). Its contents are also written by every control form.
 * - world, pristine: generation (runs, background places, direct map edits), naming (mapEditing), the house inspector (edits), projects (load), the preview close button (view3d).
 * - previewBase: generation (stage previews), syncControls (settings), projects, the preview close button, direct map edits.
 * - mods: urban stage forms (stageChain), the town/house inspectors, recipe reset (settings, preferences), projects, the random seed (toolbar).
 * - labelBaseline: cleared by every world replacement (generation, naming, projects, reset).
 * - smallPlaceRecipe: generation (set after a town run), cleared by world replacements and recipe resets.
 * - projectRevision: incremented by every recipe or appearance change; generation compares it to say "new settings ready".
 * - busy: setBusy (status) only. cancelled: generation and the cancel button (toolbar).
 * - selectedTown, cityScope, selectedCities: places, the town inspector, the label editor (mapEditing), the chain's scope switch, reset.
 * - selectedBuilding, selectedSubdivision: the house/subdivision inspectors; cleared by places, settings and reset.
 * - currentTab: selectTab (settings). lastGesture: gesture listeners (generation).
 * - connectLocal: the service-address form (runtime). bootRuntime, localEdition: never rewritten.
 * - city3d: the 3D button (view3d) creates it on first opening; projects dispose it when a recipe without a map is loaded.
 */
export interface PageModel {
  settings: V2Settings;
  /** Displayed snapshot and the generated source before building edits. */
  world: World | undefined;
  pristine: World | undefined;
  /** Inspection can replace the display without discarding the completed project. */
  previewBase: { world?: World; pristine?: World } | undefined;
  mods: unknown[];
  /** Frozen generated names; cleared by every world replacement so edited labels recompose from the new map. */
  labelBaseline: World | undefined;
  /** City recipe key of the map produced by the last run that built towns; undefined = no background pass on this map. */
  smallPlaceRecipe: string | undefined;
  projectRevision: number;
  busy: boolean;
  cancelled: boolean;
  selectedTown: string;
  cityScope: 'all' | 'selection';
  selectedCities: Set<string>;
  selectedBuilding: { settlement: string; index: number; building: UrbanBuilding } | null;
  selectedSubdivision: { key: string; kind: 'quarter' | 'block' | 'parcel'; id: string; point: { x: number; y: number } } | undefined;
  currentTab: string;
  lastGesture: number;
  bootRuntime: ReturnType<typeof runtimeOptions>;
  localEdition: boolean;
  connectLocal: boolean;
  city3d: V2Urban3d | undefined;
}

/**
 * Timers, revisions and tool states several page modules share. Initial values from `createPageState()` on. Writers:
 * - toastTimer: toast (status). elapsedTimer: generate (generation), setBusy (status).
 * - logs: log (status). logScroll: scrollLog (status).
 * - renderTimer: the scheduled appearance refresh (appearance, stageChain, preferences), cleared on unload.
 * - renderRevision: refreshAppearance / refresh3dWorld (appearance): a newer refresh supersedes work in flight.
 * - open3dToken, open3dSeq: the 3D button (view3d); projects clear the token. Zero = no opening in flight.
 * - chainSyncFrame: scheduleChainSync (stageChain).
 * - pendingRegionPosition: the region form's position picker (stageChain), the map click (toolbar).
 * - inspectorForms: the inspectors push their forms; disposeInspectorForms (places) empties the list.
 * - urbanControls: an inert stand-in until the urban stage forms mount (stageChain).
 * - nameOrigins: the settlements' name-origin form (preferences).
 * - namingRevision, namingWork: redrawNames (mapEditing), serialized and superseded by revision.
 * - neuralSelectionRevision: inspectNeuralSelection (runtime).
 * - parcelMerge: the parcel merge tool (subdivisionInspector); the map click (toolbar) feeds it.
 * - workbenchLayout, roadDisplay: mounted last (preferences); readers before that see undefined.
 * - smallPlaces: the background queue (generation), mounted after the recipe forms.
 */
export interface PageWork {
  toastTimer: ReturnType<typeof setTimeout> | undefined;
  elapsedTimer: ReturnType<typeof setInterval> | undefined;
  logs: { time: Date; message: string }[];
  logScroll: number;
  renderTimer: ReturnType<typeof setTimeout> | undefined;
  renderRevision: number;
  open3dToken: number;
  open3dSeq: number;
  chainSyncFrame: number;
  pendingRegionPosition: string | undefined;
  inspectorForms: UrbanControls[];
  urbanControls: UrbanControls;
  nameOrigins: ReturnType<typeof mountNameOriginControls>[];
  namingRevision: number;
  namingWork: Promise<void>;
  neuralSelectionRevision: number;
  parcelMerge: { key: string; id: string; add(p: { x: number; y: number }): void } | undefined;
  workbenchLayout: ReturnType<typeof mountWorkbenchLayout> | undefined;
  roadDisplay: ReturnType<typeof mountRoadDisplayControl> | undefined;
  smallPlaces: SmallPlaceQueue | undefined;
  regionalParents: WeakMap<V2Settings, string>;
}

/**
 * Controls and services created by one mount each, in start-up order. Each one exists from its mount on; reading it
 * earlier throws (`state.ts`), it never yields undefined. Written once, by:
 * mapClient (canvas, client, selectionOutline), appearance (viewLoading, sceneControls, renderControls),
 * stageChain (terrainControls, regionControls; then chain, mapControls), runtime (backendBindings, settingsPanel;
 * then nativeNeuralManager, neuralModelManager), mapEditing (labelEditor, riverEditor, roadEditor, townMover),
 * toolbar (editingTools), projects (cityCodeSharing).
 */
export interface PageParts {
  canvas: HTMLCanvasElement;
  client: StudioClient;
  selectionOutline: ReturnType<typeof createSelectionOverlay>;
  viewLoading: ReturnType<typeof mountViewLoadingIndicator>;
  sceneControls: ReturnType<typeof mountSceneControls>;
  renderControls: ReturnType<typeof mountRenderControls>;
  terrainControls: ReturnType<typeof mountTerrainControls>;
  regionControls: ReturnType<typeof mountRegionControls>;
  backendBindings: Parameters<typeof mountSettingsPanel>[1];
  settingsPanel: ReturnType<typeof mountSettingsPanel>;
  chain: StageChain;
  mapControls: ReturnType<typeof mountMapControls>;
  labelEditor: ReturnType<typeof mountMapLabelEditor>;
  riverEditor: ReturnType<typeof mountNetworkEditor>;
  roadEditor: ReturnType<typeof mountNetworkEditor>;
  townMover: ReturnType<typeof mountTownMoveEditor>;
  nativeNeuralManager: ReturnType<typeof mountDesktopNeural>;
  neuralModelManager: { dispose(): void };
  editingTools: ReturnType<typeof mountEditingTools>;
  cityCodeSharing: ReturnType<typeof mountCityCodeSharing>;
}

export type PageState = PageModel & PageWork & PageParts;

export interface ToastAction {
  detail?: string;
  label: string;
  run(): void;
}

/** The page operations, one owner module each (named in the comment of each group). */
export interface PageActions {
  // places
  cityTargets(): string[] | undefined;
  syncCitySelection(): void;
  reachedPopulation(key: string, target: number): ReturnType<typeof cityReachedPopulation>;
  neighbourWarnings(key: string): string[];
  absorbedBy(key: string): string | undefined;
  placeWarningText(key: string, target: number): string;
  populationMarkup(key: string, target: number): string;
  cityStageLabel(key: string): string;
  syncPlacesPanel(family?: StageFamily): void;
  disposeInspectorForms(): void;
  updateWorld(keepInspector?: boolean): void;
  syncLocalFacts(): void;
  appendLocalFacts(host: HTMLElement, key: string, selection?: LocalFactsInput['selection']): void;
  // stageChain
  runCities(stage?: V2TownStage, output?: string): void;
  rerollCityStep(stage: UrbanSeedStage, keys: string[], output?: string): void;
  rerollStage(stage: StageDef, family?: boolean): void;
  scheduleChainSync(): void;
  fullGenerationStatus(): string;
  syncFullGenerationButton(family: StageFamily): void;
  runFullGeneration(): Promise<void>;
  runFamily(family: StageFamily): void;
  runStage(stage: StageDef): void;
  cityControlDefaults(key: string): Partial<Options> | undefined;
  updateProgress(p: V2Progress): void;
  // appearance
  refreshAppearance(): Promise<void>;
  scheduleAppearance(): void;
  refresh3dWorld(): Promise<void>;
  reportAppearanceError(error: unknown): void;
  syncDisplayWidgets(): void;
  writeRecipe(path: string, value: unknown): void;
  // runtime
  openExecutionSettings(): void;
  openNeuralModelsSettings(): void;
  inspectNeuralSelection(): Promise<void>;
  reportGenerationFailure(message: string): Promise<void>;
  inspectHardware(): Promise<void>;
  // mapEditing
  syncNameOrigins(): void;
  redrawNames(): Promise<void>;
  applyDirectMapEdit(next: World): Promise<void>;
  // settings
  syncUrbanBackend(): void;
  resetRegionEdits(previousParent?: string): void;
  touchRecipe(): void;
  updateExtent(): void;
  syncControls(): Promise<void>;
  selectTab(tab: string): void;
  // status
  toast(message: string, error?: boolean, action?: ToastAction): void;
  renderLog(): void;
  log(message: string): void;
  dialog(id: string): void;
  setBusy(value: boolean): void;
  // generation
  generateMainOnly(): Promise<void>;
  generate(action: Action, key?: string, townStage?: V2TownStage, terrainStage?: string, keys?: string[], cityOutput?: string): Promise<boolean>;
  smallPlaceRecipeKey(): string;
  // inspectors
  showInspector(key: string, focus?: boolean): void;
  showBuilding(hit: NonNullable<ReturnType<typeof buildingAt>>): void;
  inspectSubdivision(kind: 'quarter' | 'block' | 'parcel', p: { x: number; y: number }, settlementKey?: string, selectedId?: string): boolean;
  // projects
  loadProject(project: { settings: V2Settings; mods: unknown[]; world?: World }): Promise<void>;
  // exports
  download(blob: Blob, name: string): void;
  syncExportOptions(): void;
}
