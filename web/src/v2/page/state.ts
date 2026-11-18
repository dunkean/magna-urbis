/** The page's shared state, including stable client/control handles. main.ts creates one object; ordered mounts assign the original initial values and handlers mutate these same fields. */
import type {
  translate,
  mountWorkbenchLayout,
  mountSceneControls,
  mountRoadDisplayControl,
  mountEditingTools,
  mountRenderControls,
  World,
  UrbanBuilding,
  StudioClient,
  V2Settings,
  runtimeOptions,
  mountTerrainControls,
  UrbanControls,
  StageChain,
  StageFamily,
  mountSettingsPanel,
  mountDesktopNeural,
  mountRegionControls,
  SmallPlaceQueue,
  mountMapControls,
  mountNameOriginControls,
  mountMapLabelEditor,
  mountNetworkEditor,
  mountTownMoveEditor,
  createSelectionOverlay,
  mountViewLoadingIndicator,
  V2Urban3d,
  mountCityCodeSharing,
} from './dependencies';

export interface PageState {
  settings: V2Settings;
  /** Displayed snapshot and the generated source before building edits. */
  world: World | undefined;
  pristine: World | undefined;
  /** Inspection can replace the display without discarding the completed project. */
  previewBase: { world?: World; pristine?: World } | undefined;
  mods: unknown[];
  smallPlaces: SmallPlaceQueue | undefined;
  /** Recipe of the last town-building run; undefined prevents a background pass. */
  smallPlaceRecipe: string | undefined;
  lastGesture: number;
  selectedTown: string;
  cityScope: 'all' | 'selection';
  selectedCities: Set<string>;
  placeName: (key: string) => string;
  popFormat: () => { t: typeof translate; locale: string };
  selectedBuilding: { settlement: string; index: number; building: UrbanBuilding } | null;
  selectedSubdivision: { key: string; kind: 'quarter' | 'block' | 'parcel'; id: string; point: { x: number; y: number } } | undefined;
  busy: boolean;
  cancelled: boolean;
  currentTab: string;
  toastTimer: ReturnType<typeof setTimeout> | undefined;
  elapsedTimer: ReturnType<typeof setInterval> | undefined;
  logs: { time: Date; message: string }[];
  projectRevision: number;
  bootRuntime: ReturnType<typeof runtimeOptions>;
  localEdition: boolean;
  connectLocal: boolean;
  canvas: HTMLCanvasElement;
  scaleLabelText: string;
  scaleLabelAt: number;
  scaleLabelTimer: ReturnType<typeof setTimeout> | undefined;
  client: StudioClient;
  selectionOutline: ReturnType<typeof createSelectionOverlay>;
  city3d: V2Urban3d | undefined;
  renderTimer: ReturnType<typeof setTimeout> | undefined;
  /** Newer appearance/world refreshes supersede work already in flight. */
  renderRevision: number;
  viewLoading: ReturnType<typeof mountViewLoadingIndicator>;
  sceneControls: ReturnType<typeof mountSceneControls>;
  renderControls: ReturnType<typeof mountRenderControls>;
  /** Zero means no pending opening; returning to 2D clears the token. */
  open3dToken: number;
  open3dSeq: number;
  terrainControls: ReturnType<typeof mountTerrainControls>;
  urbanControls: UrbanControls;
  pendingRegionPosition: string | undefined;
  regionControls: ReturnType<typeof mountRegionControls>;
  inspectorForms: UrbanControls[];
  backendBindings: Parameters<typeof mountSettingsPanel>[1];
  settingsPanel: ReturnType<typeof mountSettingsPanel>;
  chainSyncFrame: number;
  fullGenerationHelp: Record<StageFamily, { en: string; fr: string }>;
  familyActions: Record<StageFamily, [string, () => void]>;
  chain: StageChain;
  mapControls: ReturnType<typeof mountMapControls>;
  nameOrigins: ReturnType<typeof mountNameOriginControls>[];
  labelBaseline: World | undefined;
  labelEditor: ReturnType<typeof mountMapLabelEditor>;
  riverEditor: ReturnType<typeof mountNetworkEditor>;
  roadEditor: ReturnType<typeof mountNetworkEditor>;
  townMover: ReturnType<typeof mountTownMoveEditor>;
  namingRevision: number;
  /** Serializes name redraws without changing their revision checks. */
  namingWork: Promise<void>;
  nativeNeuralManager: ReturnType<typeof mountDesktopNeural>;
  neuralModelManager: { dispose(): void };
  neuralSelectionRevision: number;
  editingTools: ReturnType<typeof mountEditingTools>;
  runtimeCapabilities: NonNullable<StudioClient['runtimeCapabilities']>;
  logLine: (entry: { time: Date; message: string }) => string;
  logScroll: number;
  workbenchLayout: ReturnType<typeof mountWorkbenchLayout> | undefined;
  roadDisplay: ReturnType<typeof mountRoadDisplayControl> | undefined;
  regionalParents: WeakMap<V2Settings, string>;
  parcelMerge: { key: string; id: string; add(p: { x: number; y: number }): void } | undefined;
  pointerStart: { x: number; y: number };
  cityCodeSharing: ReturnType<typeof mountCityCodeSharing>;
  /** Language/unit redraws retain their own serialized queue and revision. */
  preferenceDraw: Promise<void>;
  preferenceRevision: number;
}

/** Only allocate here. Mounts initialize every field at the original declaration point, preserving recipe creation, DOM queries and timers; callback wiring must not read state before those phases run. */
export function createPageState(): PageState {
  return {} as PageState;
}
