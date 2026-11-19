/**
 * Public types of the cartography renderer (render/canvas.ts `createCanvasRenderer`): its host dependencies, the
 * renderer interface the pages call, and the per-frame statistics. Re-exported by render/canvas.ts.
 */
import type { CityScene } from '../cityCanvas';
import type { TextSettings } from '../textLayer';
import type { VegetationStyle } from '../canopy';
import type { BrushImages } from '../brushes';
import type { World, Polygon, LandKind } from '../../gen/types';
import type { Palette, MapStyle } from '../styles';
import type { RenderColors } from '../customColors';
import type { RoadLook } from '../composition';
import type { RoadStyle } from '../roadStyle';
import type { Scene, SceneMask } from '../scene';
import type { View, Rect4 } from '../view';
import type { Label } from '../labels';
import type { PlacedMapLabel } from '../mapLabels';
import type { MapInformation, SemanticLegendEntry } from '../legend';
import type { ResolvedDisplayQuality } from '../displayQuality';
import type { LiveLayer, LiveTextPlacement } from '../live/contract';

export interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d', options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
}

export interface CanvasRendererDeps {
  /** Footprints of isolated houses and farms (native scenes): woods are cleared around them like around a farmstead. */
  buildingClearings?(): readonly Polygon[];
  /** Full-quality ownership when a light scene also retains flat polygons for the live shader. */
  fullLanduse?: (kind: LandKind) => boolean;
  separateText?: boolean;
  textSources?(): readonly CityScene[] | undefined;
  colors?: RenderColors;
  roadLook?: RoadLook;
  /** Look, emphasis and ambience of the roads, read per frame so a new emphasis repaints without a rebuild. */
  roadStyle?: () => RoadStyle;
  /** The Urban plan switch, read per frame (it joins the raster tile keys, no rebuild): false hides the abstract plan marks (the dashed site reserve outline). */
  urbanPlan?: () => boolean;
  /** Path2D constructor (default: RecPath2D, a native Path2D that both vector engines can draw). */
  Path2D?: new () => Path2D;
  /** Offscreen canvas factory (default: OffscreenCanvas / document canvas). Return null if unavailable. */
  createCanvas?: (w: number, h: number) => CanvasLike | null;
  /** Terrain bitmap provider (default: hillshade raster). Return null to skip terrain. */
  terrain?: (world: World, pal: Palette) => CanvasImageSource | null;
  /** Keep the map background transparent when composing a separate overlay. */
  transparentBackground?: boolean;
  /** The ground under the overlay draws the cave rock itself (Underdark on material grounds, terrainGl.ts): the overlay
   * keeps clipping to the cave floor but paints no rock walls. Read per frame. */
  groundCaverns?: () => boolean;
  dpr?: number;
  now?: () => number;
  tileSize?: number;
  /** Pre-built scene (avoids rebuilding when only the style changes). */
  scene?: Scene;
  /** Disable the raster tile path for diagnostics or constrained hosts. */
  raster?: boolean;
  rasterBytes?: number;
  /** Asks the host for a repaint after a step of a stepwise paint. Captures never schedule work. */
  invalidate?: () => void;
  /** Decoded display-only atlases; undefined draws the vector symbols. */
  brushes?: BrushImages;
  /** Irregular, shaded foliage in place of round forest/orchard symbols. */
  vegetation?: VegetationStyle;
  /** Decorative field scale, independent of the retained terrain extent. */
  furrowReferenceSize?: number;
  /** Natural layers owned by another pass (no fabricated world): they are neither built nor drawn. Absent = all. */
  mask?: SceneMask;
  /** Semantic land use of another pass, painted after the land-use layers and before water, roads and labels. `key` joins the raster tile keys, so a new look repaints the tiles; `draw` gets the world-coordinate context, the culling rect and the world units per screen pixel. */
  semantic?: {
    key(): string;
    /** `key` without the products made per view (contour paths from the worker, the water raster of the view): a rectangle drawn with all of them in hand stays valid while only those move. The live overlay keys its regions on it (cartography/liveHost.ts). */
    look(): string;
    /** Changes when a product made per view arrives. */
    arrivals(): number;
    /** Draws so far that lacked a product still being made (contour paths in the worker, a water mask coarser than the view's): what such a draw recorded is redone when `arrivals` changes. */
    provisional(): number;
    draw(ctx: CanvasRenderingContext2D, rect: Rect4, mpp: number, quality?: ResolvedDisplayQuality): void;
    legend?(): readonly SemanticLegendEntry[];
  };
}

export interface FrameStats {
  band: number;
  scale: number;
  ms: number;
  tilesDrawn: number;
  bigDrawn: number;
  pathsBuilt: number;
  pathCache: number;
  buildingsCandidate: number;
  buildingsDrawn: boolean;
  textureTiles: number;
  /** Dedicated furrow records (three paths each); separate from the shared tile path cache. */
  furrowCache?: number;
  furrowsDrawn?: number;
  brushBytes?: number;
  rasterHits?: number;
  rasterBuilt?: number;
  rasterBytes?: number;
  rasterPending?: number;
}

export interface Overlays {
  text?: Readonly<TextSettings>;
  labels: boolean;
  legend: boolean;
  cartouche: boolean;
}

export interface CanvasRenderer {
  scene: Scene;
  palette: Palette;
  /** The view on the renderer's canvas. Without options (captures, exports, sheets) every tile is built before the call
   * returns. `stepwise`: missing tiles are built in short steps over the next frames (each asks for a repaint) and the
   * browser quality policy applies: the composed view's exact overlay at rest and the fallback display. */
  draw(view: View, options?: { stepwise: boolean }): FrameStats;
  /** Stops the stepwise paint under way (its missing tiles are built at the next stepwise draw). */
  suspendStepwise(): void;
  /** `moving`: a frame of a pan or zoom gesture; the labels of the last placement follow the map instead of being placed again. */
  drawText(target: CanvasRenderingContext2D, view: View, width: number, height: number, moving?: boolean): void;
  /** Places the names for `view` exactly as `drawText` does at rest, without drawing: `liveText()` then returns that placement. */
  placeText(view: View, cssW: number, cssH: number): void;
  /** Physical land use alone (no grid, semantics, water or roads) on the transparent `target`, which covers the world square `box`. False: nothing there. */
  drawGround(target: CanvasLike, box: Rect4, options?: { stepwise: boolean }): boolean;
  /** The stepwise tiles cached for `box` (the stand-in of the 3D drape and the miniature). Never rasterises a missing tile or includes labels. */
  drawCachedMap(target: CanvasLike, box: Rect4): boolean;
  /** Reuse immutable scene tiles and resources after detail arrival. False requires a new renderer. */
  update(world: World, scene: Scene, style?: MapStyle | Palette): boolean;
  setLabels(labels: Label[]): void;
  /** Toggle names and site pins, the legend and the cartouche (defaults: labels per world.options.labels, legend per world.options.legend, cartouche on). */
  setOverlays(o: Partial<Overlays>): void;
  /** Labels placed in the last frame (debug / tests). */
  lastPlaced(): PlacedMapLabel[];
  /** The last exact placement of the names (a rest frame), for the live text layer; undefined when names are off. */
  liveText(): LiveTextPlacement | undefined;
  /** `withRect = false` draws the static base only (the page overlays the view rectangle itself). */
  drawMinimap(target: CanvasLike, view: View, viewW: number, viewH: number, withRect?: boolean): void;
  lastStats(): FrameStats;
  /** The cartography overlay as a layer of the live compositor (render/live/contract.ts): the retained lists are
   * replayed in `gl`, the compositor's context, with their area prefix baked once per region. Undefined when this
   * renderer cannot record (no raster path, no invalidation hook, no WebGL2 state). The caller disposes the layer. */
  createLiveLayer(gl: WebGL2RenderingContext): LiveLayer | undefined;
  /** Frame, cartouche, legend and scale bar alone (screen space) on `target`, cleared first: a canvas of `cssW` x
   * `cssH` CSS pixels at any pixel ratio. What a live frame draws over the overlay layer. */
  drawFurniture(target: CanvasRenderingContext2D, view: View, cssW: number, cssH: number): void;
  /** Conservative owned storage for retaining an inactive style (native Path2D memory is estimated). */
  retainedBytes(): number;
  /** Title and legend of the actual renderer, without a view-specific scale in the external drawer. */
  getMapInfo(): MapInformation;
  dispose(): void;
}
