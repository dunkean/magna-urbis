import type { Options, World } from '../gen/types';
import type { LayoutConfig, ParcelConfig } from '../../../rust/bridge/urbanConfig';
import type { PlacementBatchSettings } from '../../../rust/bridge/urbanArchitecture';
import type { HouseConfig } from '../../../rust/bridge/housesContract';
import type { WasmThreadsInfo } from '../../../rust/bridge/wasmThreads';
import type { MapStyle } from '../render/styles';
import type { TerrainStyle } from '../render/terrainStyle';
import type { TerrainLighting, TerrainLayers } from '../render/terrainLighting';
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
export interface V2UrbanControls {
  through?: V2TownStage;
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
  ground?: 'map' | 'render' | 'render3d' | 'render3d-brush' | 'render-v2' | 'render-v2-substrate' | 'render-v2-moisture' | 'render-v2-vegetation' | 'render-v2-snow';
  plan?: boolean;
  colors?: 'materials' | 'uses';
  exaggeration?: number;
  refinement?: 'source' | 'noise';
}
export interface V2Appearance {
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
  lighting?: TerrainLighting;
  terrainLayers?: TerrainLayers;
  diagnostic?: DiagnosticId;
  lakes?: boolean;
  oxbows?: boolean;
  season?: number;
  fantasy?: FantasyOptions;
  city?: V2CityAppearance;
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
  urban?: V2UrbanSettings;
  appearance?: V2Appearance;
  /** Cartographic names can be edited without regenerating terrain or buildings. */
  naming?: { title?: string; places?: Record<string, string> };
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
export interface V2WorkerRequest { id: number; action: V2Action; settings: V2Settings; world?: World; retainedWorldId?:number; key?: string; keys?: string[]; townStage?: V2TownStage; terrainStage?: string; assetBase?: string }
export type V2WorkerResponse =
  | { id: number; type: 'progress'; progress: V2Progress }
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
