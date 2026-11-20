/**
 * Public City 3D contracts shared by mount owners and city view modules.
 * Reads/writes: Types only; no runtime state.
 */
import { type CityGround as CityGroundMode } from '../../render/cityGroundModes';
import type { RoadInk } from '../../render/roadStyle';
import { type MapLabelWorld } from '../../render/mapLabels';
import { type TextSettings } from '../../render/textLayer';
import { type Palette } from '../../render/styles';
import { type Terrain3d, type Terrain3dCamera, type Terrain3dGroundSettings, type Terrain3dLookSettings, type Terrain3dOptions } from '../terrain3d';
import { type Terrain3dIllustration } from '../terrain3dTexture';
import type { HeightLayer } from '../terrain/contract';
import type { ForestField, ForestOccupation } from '../../../../rust/bridge/terrainForest';
import { type UrbanBuildingAppearance } from '../../render/urbanBuildingStyle';
import type { NativeBuildingProjectionScene } from '../urbanBuildingProjection';
import type { Parent3dScene } from '../urbanParent3d';
import { type CityDrawOptions } from '../../render/cityCanvas';
import { type LandCultures } from '../landDetail';
import { type SemanticDepth, type SemanticLook } from '../../render/composition';
import type { LandKind, LandUseLayer } from '../../gen/types';
import type { PlacementBatch, PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import type { Layout, Partition, Street } from '../../../../rust/bridge/urban';
import type { Point } from '../../../../rust/bridge/housesContract';
import type { Decor } from '../decor';
import { type RetainedRegime } from '../retainedWaterRegime';
import type { TerrainStyle } from '../../render/terrainStyle';

export interface City3dOptions {
  /** Off-thread forest/building occupation merge for the 3D ground (Terrain3dOptions.mergeOccupation). */
  mergeOccupation?: Terrain3dOptions['mergeOccupation'];
  /** Walking plus altitude-sensitive zoom, pan and orbit controls. */
  navigation?: boolean;
  /** Positioned container (the bench viewport); the 3D view covers it when shown. */
  host: HTMLElement;
  /** V2 opens the draped map immediately; expensive procedural material shader
   * compilation is deferred until that ground mode is selected. */
  fastTerrain?: boolean;
  /** Optional workshop controls. Omitted keeps City Bench's original two ground modes. */
  materialGrounds?: boolean;
  /** Hide legacy independent ground choices when the host owns the map style. */
  groundControl?: boolean;
  toolbarHost?: HTMLElement;
  advancedControls?: HTMLElement;
  sharedVisibilityControls?: boolean;
  /** Drape the exact raster material over real geometry on software WebGL. */
  softwareMaterialFallback?: boolean;
  getGroundSettings?(ground: City3dGround): Terrain3dGroundSettings | undefined;
  getLook?(): Terrain3dLookSettings;
  getForest?(): { field?: ForestField; occupation?: ForestOccupation } | undefined;
  getSurface?(): City3dSurface | undefined;
  getWaterDisplay?(): City3dWaterDisplay | undefined;
  /** The 2D map's exact water banks (retained rivers and lakes, map metres) and its flat water colour. Every 3D ground
   * then takes its rivers from them, crisp at tile resolution, instead of the decor's 30 m water raster. */
  getRetainedWater?(): City3dRetainedWater | undefined;
  getHeightSampler?(): ((x: number, y: number, metresPerPixel: number) => number) | undefined;
  getViewSettings?(): Partial<City3dViewSettings>;
  onViewSettingsChange?(settings: Omit<City3dViewSettings, 'plan'>): void;
  getPlanOptions?(): Partial<Pick<CityDrawOptions, 'colors' | 'view' | 'palette' | 'width' | 'layers' | 'groundBlend' | 'roadLook' | 'roadEmphasis' | 'waterColor' | 'streetPalette' | 'night' | 'labels' | 'buildingsVisible' | 'appearance'>> & {
    opacity?: number;
    roadInk?: RoadInk;
  };
  getBuildingAppearance?(): Partial<UrbanBuildingAppearance>;
  getBuildingsVisible?(): boolean;
  /** Semantic land use on the ground: independent of the plan overlay and of the ground look. */
  getSemantic?(): City3dSemantic | undefined;
  /** Physical land use and vector vegetation on the ground, by the 2D painters. `material`: the tile is a material ground. */
  getPhysicalGround?(material: boolean): City3dPhysicalGround | undefined;
  /** Map names, glyphs and pins (default: shown). */
  labels?: boolean;
  getText?(): { world?: MapLabelWorld; text: Readonly<TextSettings>; palette: Palette };
  getDecor(): Decor | undefined;
  getScene(): PlacementBatch | undefined;
  /** Exact accepted-plan cartography with native records retained cold. Takes
   * precedence over the legacy scene, including an explicitly empty index. */
  getProjection?(): NativeBuildingProjectionScene | Parent3dScene | undefined;
  getLayouts?(): readonly Layout[] | undefined;
  /** Regional roads crossing the map: their bridges are drawn too. */
  getRegionalStreets?(): readonly Street[] | undefined;
  /** Ground-tile painter of the activity-site installations meeting `box`, or undefined when there are none; `natural` = satellite look. */
  getSiteGround?(box: { minX: number; minY: number; maxX: number; maxY: number }, mpp: number): ((ctx: CanvasRenderingContext2D, natural: boolean) => void) | undefined;
  /** Stand-in houses of the places whose plan is not generated yet (farmRoofs.ts placeholderPlacedBuildings): raised
   * like the town silhouettes, so such a place does not vanish in 3D. The same list object while nothing changes. */
  getPlaceholderBuildings?(): readonly PlacedBuilding[] | undefined;
  getPartitions?(): readonly Partition[] | undefined;
  getLotEnclosures?(): readonly import('../../../../rust/bridge/urban').LotEnclosure[] | undefined;
  getSelected?(): string | undefined;
  /** Textured materials (PBR roofs, walls, streets, plazas): the 2D map's « Matières texturées » switch. */
  getTextured?(): boolean;
  /** The 3D bar's « Textures » box sets the same switch. */
  setTextured?(on: boolean): void;
  /** URL of the 2D map image; default `decors/<id>.png` (or the parent decor's). */
  getBackground?(): string | undefined;
  /** Ready map bitmap; hosts with a rendered canvas avoid a PNG/decode round trip. */
  getBackgroundImage?(): HTMLCanvasElement | undefined;
  /** Revision of a mutable background canvas, independent of its object identity. */
  getBackgroundKey?(): string;
  /** Retained Illustrated background with the raised relief removed from its oblique material. */
  getIllustrated?(): { key: string; load(): Promise<Terrain3dIllustration> } | undefined;
  onSelect?(id: string): void;
  onCamera?(camera: Terrain3dCamera): void;
  /** Shared native detail controller (Codex `urban.buildingDetails`): one queue and
   * bounded cache for 2D and 3D. When given, the 3D view never realizes on its own. */
  details?: City3dDetailService;
}

export type City3dGround = CityGroundMode;

export interface City3dViewSettings {
  ground: City3dGround;
  plan: boolean;
  colors: 'materials' | 'uses';
  exaggeration: number;
  refinement: 'source' | 'noise';
  trees3d: boolean;
  /** Render distance of the modelled trees (m). */ treeDistance: number;
}

export interface City3dSurface {
  height: HeightLayer;
  water?: { n: number; levels: Float32Array; mask: Float32Array; field?: import('../lakeGeometry').LakeField; width?: number };
  waterVisible?: boolean;
}

export interface City3dWaterDisplay {
  texture: HTMLCanvasElement;
  paths?: Path2D;
  ink?: { fill: string; stroke: string };
  /** River ribbons use nonzero fill: evenodd would punch holes where caps and confluences overlap. */
  riverPaths?: Path2D;
  /** Seasonal water regime (waterRegime.ts), on a context transformed to map metres: `erase` dry and frozen water from a
   * water cover drawn from the raster, `ground` paints dry beds and ice as ground albedo, `ink` as map symbols.
   * The texture and paths above already leave the dry and frozen water out. */
  regime?(ctx: CanvasRenderingContext2D, mode: 'erase' | 'ground' | 'ice' | 'ink', mpp: number): boolean;
  /** The regime holds ice (an `ice` decal pass is needed on material grounds). */
  frozen?: boolean;
}

export interface City3dRetainedWater {
  paths: readonly { path: Path2D; rule: CanvasFillRule }[];
  color: string;
  /** Seasonal regime of these banks (retainedWaterRegime.ts) and the style of its ink symbols. */
  regime?: RetainedRegime;
  style?: TerrainStyle;
}

export interface City3dSemantic {
  landuse: LandUseLayer | undefined;
  /** Cultures that choose the crops of the holdings (landDetail). */ cultures?: LandCultures;
  rural: SemanticLook;
  urban: SemanticLook;
  opacity: number;
  classes: Readonly<Record<LandKind, boolean>>;
  depth: SemanticDepth;
}

/** `key` moves when the painting changes. `paint` fills the transparent `target`, which covers `box`; false when the tile holds nothing. */
export interface City3dPhysicalGround {
  key: string;
  /** Exact tiles await the same contour products as 2D before painting. */
  ready?(box: { minX: number; minY: number; maxX: number; maxY: number }, pixels: number): Promise<void>;
  /** The painter already leaves water out of its land use. */
  keepsWater?: boolean;
  /** Read-only reuse of the live 2D pyramid while the camera moves. */
  preview?(target: HTMLCanvasElement, box: { minX: number; minY: number; maxX: number; maxY: number }): boolean;
  /** `defer`, when given: the painter calls it when it draws provisional content (async work still running) and calls the
   * returned function once that work lands, so only the tiles that drew it repaint. */
  paint(target: HTMLCanvasElement, box: { minX: number; minY: number; maxX: number; maxY: number }, options?: { live: boolean }, defer?: () => () => void): boolean;
}

export interface City3dDetailService {
  setActiveView(view: '2d' | '3d'): void;
  update(view: { viewport: { minX: number; minY: number; maxX: number; maxY: number }; metresPerPixel: number; selectedId?: string; enabled?: boolean }): unknown;
  cached(): readonly PlacedBuilding[];
  subscribe(listener: () => void): () => void;
}

export interface City3d {
  readonly active: boolean;
  /** Load retained inputs and asynchronous backend pipelines before showing the view. */
  prepare(): Promise<void>;
  show(): void;
  hide(): void;
  /** Cheap: re-reads the getters and updates only what changed. */
  refresh(): void;
  /** Reflect a new recipe immediately, without waiting for map textures or shader preparation. */
  syncControls(): void;
  focus(point: Point, radius?: number): void;
  getCamera(): Terrain3dCamera | undefined;
  setCamera(camera: Terrain3dCamera): void;
  /** The 2D map view (centre in metres, CSS pixels per metre) equivalent to the current orbit camera: its target and distance. */
  toMapView(): { cx: number; cy: number; scale: number } | undefined;
  /** Points the orbit camera at a 2D map view's centre, at the distance that shows the same ground width. Needs a shown view. */
  fromMapView(view: { cx: number; cy: number; scale: number }): void;
  capture(): Promise<Blob>;
  captureIllustration(): Promise<{ image: Blob; depth: Blob; camera: Terrain3dCamera }>;
  stats(): City3dStats;
  dispose(): void;
}

export interface City3dStats {
  programsReady?: boolean;
  buildings: number;
  silhouette: number;
  compact: number;
  detailed: number;
  displayMs: number;
  timings: { engine?: number; surface?: number; plan?: number; buildings?: number };
  realizing: number;
  realizeError?: string;
  bridges?: { count: number; first?: Point };
  walls?: City3dWallStats;
  lod?: ReturnType<Terrain3d['getLodInfo']>;
  parentWindow?: { complete: boolean; reason: string; parents: number; members: number };
}

/** Fortification display volumes: enclosures drawn, pieces (curtain chunks, towers, gates, works), triangles. */
export interface City3dWallStats {
  count: number;
  pieces: number;
  triangles: number;
  ms: number;
  first?: Point;
  gate?: Point;
}

export type Ground = City3dGround;

export type Colors = 'materials' | 'uses';
