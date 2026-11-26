/**
 * Contract of the 2D map display (v2/display/): the types its modules share.
 *
 * `set()` (appearance.ts) makes five families of products; each is one object that owns its state and is the only one
 * to write it. Every other module of the display receives them as `DisplayParts`, through the read-only interfaces
 * below: what it may read and call, nothing more.
 *
 *   ground      groundProducts.ts       written by the terrain data, look and forest passes
 *   water       waterProducts.ts        written by the water and frame passes, and by its own rasterizations
 *   contours    contours.ts             written by the worker results it waits for
 *   cartography cartographyProducts.ts  written by the cartography, overlays and semantic passes
 *   town        townProducts.ts         written by the city pass
 *
 * The terrain renderer (`Ground.gpu`) is one engine with several drivers: the ground passes give it the terrain, the
 * look and the forest; the water pass its water textures; the views redraw it; the exact frames capture it.
 * The map itself (world, settings, appearance) is `MapState` (mapState.ts), whose header lists its writers.
 */
import type { LandKind } from '../../gen/types';
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import type { CanvasRenderer } from '../../render/canvas';
import type { SemanticLook } from '../../render/composition';
import type { ExportLayers } from '../../render/exportLayers';
import type { GroundTileRenderer } from '../../render/live/contract';
import type { OverlayInk } from '../../render/live/contourInk';
import type { TreeSymbolLook } from '../../render/treeSymbols';
import type { Rect } from '../../render/tileindex';
import type { View } from '../../render/view';
import type { ViewRasterRegion } from '../../render/viewRaster';
import type { FantasyRaster } from '../../ui/fantasyRaster';
import type { TerrainRenderer } from '../../ui/terrainRenderer';
import type { WaterDisplay } from '../../ui/vectorWaterRender';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import type { NativeCityMap, NativeCityMapStats, NativeCityStepwise } from '../nativeCityMap';
import type { ResourceCache } from '../passes/pass';

/** Resources the page's renderer shares with its export renderers: derived products keyed by revisions, and the native city map. */
export interface SharedPassResources {
  cache: ResourceCache;
  city?: { key: string; map: NativeCityMap };
}

/** The view of a frame and the size it is drawn at. */
export interface ViewFrame {
  view: View;
  w: number;
  h: number;
  dpr: number;
}

/** A world rectangle in map metres. */
export type WorldBox = { minX: number; minY: number; maxX: number; maxY: number };

/** A raster of the vector water and the region of the map it covers. */
export interface VectorRaster {
  readonly image: HTMLCanvasElement;
  readonly region: ViewRasterRegion;
}

export interface Ground {
  /** The terrain renderer and its canvas, when the ground is drawn on the GPU. */
  readonly gpu?: TerrainRenderer;
  readonly gpuCanvas: HTMLCanvasElement;
  /** The terrain renderer holds the current terrain and can draw it. */
  readonly gpuActive: boolean;
  /** CPU ground: the terrain raster of the whole map. */
  readonly base?: HTMLCanvasElement;
  /** Illustrated ground: its washes and stamps. */
  readonly fantasy?: FantasyRaster;
  /** The compilation of the look's programs, its failure, and the forest update still running after set(). */
  readonly programWork?: Promise<void>;
  readonly programError?: unknown;
  readonly forestJob?: Promise<void>;
  /** Resolves when the ground can be drawn exactly (forest applied, programs compiled); rejects with the program error. */
  exactReady(): Promise<void>;
  /** The whole-map capture shows a ground that changed, optionally only in these world boxes. */
  dropBackground(regions?: readonly WorldBox[]): void;
  /** The 2D copy of the whole-map capture of the GPU ground (miniature, ground stand-in). */
  miniGround(): HTMLCanvasElement | undefined;
  /** The terrain renderer as the live ground layer bakes from it; undefined while it cannot draw the map. */
  groundTiles(): GroundTileRenderer | undefined;
  /** The paper map woods of the look (render/treeSymbols.ts): the GPU ground draws them when it is active. */
  treeSymbols(): TreeSymbolLook | undefined;
}

export interface Water {
  /** The vector water and frame of the whole map as one SVG body ('' when there is none). */
  readonly vectors: string;
  /** Its whole-map raster. */
  readonly vectorBase?: VectorRaster;
  /** Its raster for the last view that needed a finer one, and whether another is being made. */
  readonly vectorView?: VectorRaster;
  readonly vectorPending: boolean;
  /** The region of the raster being made. */
  readonly vectorDue?: ViewRasterRegion;
  /** The rivers of the GPU ground, which the town keeps its ground and streets off. */
  readonly cityWater?: Float32Array;
  /** The water pass produced water that no frame has drawn yet; `noteWaterShown` when one has. */
  readonly waterShownDue: boolean;
  noteWaterShown(): void;
  waterDisplay(): WaterDisplay;
  /** Drawn regime of the date the water was last drawn for (waterRegime.ts drawnWaterKey): the overlay's water cut follows it. */
  readonly regime: string;
  /** The ink water must read above the land-use tints. */
  waterAboveLand(): boolean;
  /** The map on screen is tilted (set by the composed view): the map drape lays the whole-map raster as water, and the
   * raster of the view on the tiles it covers. Only what `vectorDue` covers waits for another one. */
  tilted: boolean;
  /** Erases what `ctx` holds over the vector water. */
  cutWater(ctx: CanvasRenderingContext2D, rect: WorldBox): void;
  /** The raster for a frame; `refine` false keeps the one at hand instead of asking for a finer one. */
  vectorRaster(view: View, w: number, h: number, dpr: number, refine?: boolean): VectorRaster | undefined;
  /** Tilted: the raster of the view, over the whole-map one; the last one is kept while another is made, which is
   * asked for when neither is fine enough for this frame. */
  drapedDetail(view: View, w: number, h: number, dpr: number): VectorRaster | undefined;
  /** Resolves once `vectorRaster` can answer at the density of this frame. */
  vectorsReadyFor(view: View, w: number, h: number, dpr: number): Promise<void>;
}

export interface Contours {
  createLiveInk(gl: WebGL2RenderingContext): OverlayInk | undefined;
  dispose(): void;
  /** Changes with every new set of paths. */
  readonly revision: number;
  /** Paths still being computed. */
  pending(): number;
  /** The set `paintContours` draws at `mpp` is still in the worker (it draws the last set, or none, meanwhile). */
  pendingAt(mpp: number): boolean;
  /** The landform the contours are drawn for; undefined when the look has none. */
  contourLook(): { landform: string } | undefined;
  /** Resolves once the paths of this scale and box are computed. */
  contoursAt(scale: number, box: Rect): Promise<void>;
  paintContours(ctx: CanvasRenderingContext2D, viewport: WorldBox, mpp: number, light?: boolean): boolean;
}

/** Semantic land-use state: looks, opacity and classes. */
export interface SemanticState {
  readonly rural: SemanticLook;
  readonly urban: SemanticLook;
  readonly opacity: number;
  readonly classes: Readonly<Record<LandKind, boolean>>;
  readonly key: string;
}

export interface Cartography {
  /** The overlay renderer, and the canvas it draws into (the composed view places that canvas in the page). */
  readonly renderer?: CanvasRenderer;
  readonly overlay: HTMLCanvasElement;
  /** Whole-map overlay rasters of an export with explicit layers. */
  readonly exportOverlay?: HTMLCanvasElement;
  readonly exportGround?: HTMLCanvasElement;
  readonly semantic?: SemanticState;
  /** Paints the overlay of `view` at this pixel size into `overlay` and returns it; undefined without a renderer. */
  paintOverlay(view: View, pixelW: number, pixelH: number, stepwise: boolean): HTMLCanvasElement | undefined;
  /** Contours and rural semantics, as the overlay paints them through its hook. */
  paintRural(ctx: CanvasRenderingContext2D, viewport: WorldBox, mpp: number, light?: boolean): void;
  retainedBytes(): number;
}

/** How one paint of the town is made (Town.draw). */
export interface TownPaint {
  /** The world building meshes draw all houses above this ground and street pass. */
  planOnly?: boolean;
  /** The exact town renderer keeps a town layer and repaints it in steps; absent: one complete paint. */
  stepwise?: NativeCityStepwise;
  /** The ground was laid in this same canvas (captures, exports): the rivers are put back over the town by drawing it
   * again inside them. Absent: the ground lies in a canvas below, and the town clears its own pixels over the rivers. */
  groundRedraw?: (ctx: CanvasRenderingContext2D) => void;
  /** The exact overlay canvas below a town painted into a canvas of its own: the same cut is made there. */
  overlayBelow?: CanvasRenderingContext2D | null;
}

export interface Town {
  readonly city?: NativeCityMap;
  /** The layers the town is drawn with: one object per set of export layers (the live town layer compares it). */
  shownLayers(): Partial<ExportLayers>;
  /** Paints the towns of `view` with the current appearance; undefined without a city map. */
  draw(ctx: CanvasRenderingContext2D, view: View, w: number, h: number, dpr: number, paint: TownPaint): NativeCityMapStats | undefined;
  /** Resolves once a complete paint can be made synchronously. */
  prepare(): Promise<void>;
}

export interface DisplayParts {
  readonly ground: Ground;
  readonly water: Water;
  readonly contours: Contours;
  readonly cartography: Cartography;
  readonly town: Town;
}

/** What `set()` tells the view on screen (mapView.ts). */
export interface AppearanceListener {
  /** The passes are about to change the products: the picture on screen is kept as it is until they end. */
  beginAppearanceChange(): void;
  endAppearanceChange(): void;
  /** The passes that ran, and the appearance and terrain they replaced. */
  contentChanged(ran: readonly string[], before: { resolved?: ResolvedAppearance; native?: TerrainData }): void;
}

/** What the readiness and the miniature ask the view on screen. */
export interface ViewStatus {
  /** The view moves, or its picture at rest is still owed. */
  busy(): boolean;
  /** Pending work that only concerns the view on screen (the picture at rest, the town paint, names being prepared). */
  pendingViewOnly(): number;
  /** Overlay rasters the last exact paint of the cartography still waits for. */
  pendingOverlay(): number;
}

/** How an exact frame is painted (ExactFrame.paint). */
export interface ExactPaint {
  /** The exact renderers paint in steps, at the display quality, and ask for the frame again as they progress.
   * False: one complete synchronous paint at full quality (captures, exports). */
  readonly stepwise: boolean;
  /** A GPU ground lies in a canvas of its own beneath the frame, which stays transparent over it. False: the ground is
   * captured from the terrain renderer into the frame. A CPU ground is always painted into the frame. */
  readonly groundBeneath: boolean;
}
