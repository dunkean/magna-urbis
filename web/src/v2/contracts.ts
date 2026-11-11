import type { Options, World } from '../gen/types';
import type { LayoutConfig, ParcelConfig } from '../../../rust/bridge/urbanConfig';
import type { PlacementBatchSettings } from '../../../rust/bridge/urbanArchitecture';
import type { HouseConfig } from '../../../rust/bridge/housesContract';
import type { WasmThreadsInfo } from '../../../rust/bridge/wasmThreads';
import type { MapStyle } from '../render/styles';
import type { TerrainStyle } from '../render/terrainStyle';
import type { TerrainLayers } from '../render/terrainLighting';
import type { FantasyOptions } from '../../../rust/bridge/fantasyPainting';
import type { CityView, CityPalette, CityLayers } from '../render/cityCanvas';
import type { UrbanBuildingStyle, UrbanBuildingDiagnostic } from '../render/urbanBuildingStyle';
import type { DiagnosticId } from '../render/displayDiagnostics';
import type { V2TerrainSettings } from './terrainSettings';
import type { V2RegionSettings } from './regionSettings';
import type { RenderColors } from '../render/customColors';
import type { ForestSettings } from '../../../rust/bridge/terrainForest';
export type { V2TerrainSettings } from './terrainSettings';

export type V2TownStage = 'layout' | 'parcels' | 'programme' | 'buildings';
export type UrbanSeedStage = 'composition' | 'streets' | 'parcels' | 'programme' | 'buildings' | 'houses';
export interface V2UrbanControls {
  /** Legacy imports only. New variation choices are encoded in options.seed. */
  seed?: string;
  seeds?: Partial<Record<UrbanSeedStage, string>>;
  through?: V2TownStage;
  /** Building architecture (render/cityContract.ts); absent = city volumes, as in City Bench. */
  architecture?: import('../render/cityContract').CityArchitecture;
  layout?: Partial<LayoutConfig>;
  parcels?: Partial<ParcelConfig>;
  houses?: PlacementBatchSettings;
}
export interface V2UrbanSettings extends V2UrbanControls {
  /** Absent = follows the terrain engine (`runtime.backend`). */
  backend?: 'typescript' | 'rust' | 'native';
  local?: Record<string, V2UrbanControls>;
  /** `${settlementKey}/${nativeRequestId}` (shown by the inspector); bare request ids are a global fallback. */
  buildings?: Record<string, Partial<HouseConfig>>;
}

/** Rendering preferences never change the retained terrain or settlement generation recipe. */
export interface V2CityAppearance {
  view?: CityView;
  palette?: CityPalette;
  buildingStyle?: UrbanBuildingStyle;
  diagnostic?: UrbanBuildingDiagnostic;
  layers?: Partial<CityLayers>;
  groundBlend?: 'classic' | 'blended';
  painted?: boolean;
  opacity?: number;
  width?: number;
  ground?: import('../render/cityGroundModes').CityGround;
  plan?: boolean;
  colors?: 'materials' | 'uses';
  exaggeration?: number;
  refinement?: 'source' | 'noise';
}
export interface V2Appearance {
  /** Pass-by-pass recipe (render/composition.ts): the source of truth of every field it covers. */
  composition?: import('../render/composition').CompositionRecipe;
  colors?: RenderColors;
  roads?: boolean;
  buildings?: boolean;
  forest?: Partial<ForestSettings>;
  /** The original cartographic palette remains valid for all historical V2 projects. */
  style: MapStyle;
  terrainStyle?: TerrainStyle;
  renderer?: 'classic' | 'bench';
  contours?: boolean;
  landuse?: boolean;
  labels?: boolean;
  legend?: boolean;
  cartouche?: boolean;
  textured?: boolean;
  painted?: boolean;
  vegetation?: 'classic' | 'canopy';
  terrainLayers?: TerrainLayers;
  diagnostic?: DiagnosticId;
  /** Resource shown by the `res-potential` diagnostic (rust/bridge/resources.ts POTENTIAL_IDS). */
  resourcePotential?: string;
  lakes?: boolean;
  oxbows?: boolean;
  fantasy?: FantasyOptions;
  city?: V2CityAppearance;
  /** To test (31/10): one default table for 2D, 3D and the classic canvas (off = previous per-view defaults). */
  unifiedDefaults?: boolean;
}

/** V2 owns orchestration, while geometry is still produced by the existing engines. */
export interface V2Settings {
  options: Options;
  extent: 'auto' | number;
  /** Total requested places, including the main settlement; 0 lets the core decide. */
  settlementCount: number;
  /** A stable settlement key, not its display name or array position. */
  local: Record<string, Partial<Options>>;
  generation: 'procedural' | 'neural';
  /** Full bench terrain recipe; legacy Options remain the settlement/biome defaults. */
  terrain?: V2TerrainSettings;
  region?: V2RegionSettings;
  /** A saved decor opened as the whole world (relief, sea, lakes, rivers): `bytes` = the gzip file web/decors/<id>.decor. */
  decor?: { id: string; bytes: Uint8Array };
  urban?: V2UrbanSettings;
  appearance?: V2Appearance;
  /** Cartographic names can be edited without regenerating terrain or buildings. */
  naming?: { title?: string; places?: Record<string, string>; mode?: 'cultural' | 'localized'; /** Legacy import only; generic terms follow the UI language. */ displayLanguage?: import('./languages').Language;
    labels?: Record<string, import('./mapLabels').LabelEdit> };
  runtime?: {
    compute: 'auto' | 'cpu' | 'gpu';
    backend: 'typescript' | 'rust' | 'native';
    source: 'procedural' | 'procedural-phasor' | 'neural-wasm' | 'neural-python' | 'neural';
    localServer?: string; pythonServer?: string; neuralServer?: string; neuralAssets?: string;
    resolution?: number; erosion?: number;
  };
}

export interface V2Progress {
  stage: string;
  label: string;
  completed: number;
  total: number;
  /** Actual backend/work context. Omit totals for work that has no measurable completion fraction. */
  detail?:string;
  cache?: 'memory' | 'disk' | 'miss';
}
export type ProgressCallback = (progress: V2Progress) => void;
export type V2Action = 'terrain' | 'region' | 'roads' | 'towns' | 'town' | 'settlements' | 'all';
export interface V2WorkerRequest { id: number; action: V2Action; settings: V2Settings; world?: World; retainedWorldId?:number; key?: string; keys?: string[]; townStage?: V2TownStage; terrainStage?: string; cityOutput?: string; assetBase?: string }
/** Lazy fetch of the resource payload of a world's terrain; never a generation (id shares the client's counter). */
export interface V2ResourceRequest { type: 'resources'; id: number; settings: V2Settings; world?: World; retainedWorldId?: number }
export type V2WorkerResponse =
  | { id: number; type: 'progress'; progress: V2Progress }
  | { id: number; type: 'resources'; payload?: import('../../../rust/bridge/resources').ResourcePayload }
  | { id: number; type: 'result'; world: World; wasm?: WasmThreadsInfo }
  | { id: number; type: 'error'; error: string; wasm?: WasmThreadsInfo };

export interface V2Project {
  format: 'magna-urbis-v2';
  version: 1;
  engine: string;
  settings: V2Settings;
  world?: World;
  mods: unknown[];
}
