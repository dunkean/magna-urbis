/**
 * The 2D map display of the V2: the object the page (v2/client.ts) talks to. It imports no generation entry point:
 * it shows retained products only.
 *
 * It only assembles and delegates; the work is in v2/display/:
 *
 *   mapState.ts            the map on display (world, settings, appearance) and the page's frame hook
 *   appearance.ts          set(): the appearance passes, which make the products below
 *   groundProducts.ts      terrain renderer or CPU raster, forest, programs, whole-map ground capture
 *   waterProducts.ts       GPU water textures, vector water raster
 *   contours.ts            contour lines inked on the overlay and the 3D drape
 *   cartographyProducts.ts overlay renderer, semantic land use, export overlays
 *   townProducts.ts        native city map and the hooks of the exact town renderer
 *   mapView.ts             the view on screen: motion, style-switch stand-in, capture frame
 *     composedView.ts        the live compositor, moving and at rest (the display path)
 *     fallbackView.ts        the view when the compositor cannot draw it
 *   exactFrame.ts          captures, exports, the 3D background
 *   miniature.ts           the miniature of the page
 *   readiness.ts           pending work and readiness marks
 */
import { RenderReadiness } from '../render/renderReadiness';
import { noteLiveUnit } from '../render/live/compositor';
import type { MaterialRasterContext } from '../../../rust/bridge/terrainMaterialContext';
import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import type { City3dPhysicalGround as PhysicalGround } from '../ui/city3d';
import type { View } from '../render/view';
import type { ExportLayers } from '../render/exportLayers';
import { ResourceCache } from './passes/pass';
import type { ResourceSource } from './resourceLayer';
import { AppearancePasses } from './display/appearance';
import { CartographyProducts } from './display/cartographyProducts';
import { ContourInk } from './display/contours';
import { ExactFrame } from './display/exactFrame';
import { GroundProducts } from './display/groundProducts';
import { MapState, type SharedPassResources } from './display/mapState';
import { MapView } from './display/mapView';
import { Miniature } from './display/miniature';
import type { DisplayParts } from './display/parts';
import { DisplayReadiness } from './display/readiness';
import { TownProducts } from './display/townProducts';
import { WaterProducts } from './display/waterProducts';

export { paintedBrushes } from './display/cartographyProducts';

export class BenchRenderer {
  private readonly map: MapState;
  private readonly parts: DisplayParts;
  private readonly appearance: AppearancePasses;
  private readonly readiness: DisplayReadiness;
  private readonly exact: ExactFrame;
  private readonly view: MapView;
  private readonly miniature: Miniature;
  /** A capture or export only: one exact frame per `draw`. */
  private readonly surface = document.createElement('canvas');

  /** `invalidate`: asks the page for an animation frame. `rasterOnly`: never the GPU ground. `materialContext` and
   * `shared`: the page renderer's, for an export renderer that reuses its products. */
  constructor(invalidate: () => void, rasterOnly = false, materialContext?: MaterialRasterContext, shared?: SharedPassResources) {
    const map = (this.map = new MapState(invalidate, shared ?? { cache: new ResourceCache() }, !shared));
    const parts = {} as { -readonly [K in keyof DisplayParts]: DisplayParts[K] };
    parts.ground = new GroundProducts(map, parts, rasterOnly, materialContext);
    parts.water = new WaterProducts(map, parts);
    parts.contours = new ContourInk(map);
    parts.cartography = new CartographyProducts(map, parts);
    parts.town = new TownProducts(map, parts);
    this.parts = parts;
    this.appearance = new AppearancePasses(map, parts);
    this.readiness = new DisplayReadiness(map, parts, () => this.view);
    this.exact = new ExactFrame(map, parts, () => this.view.moving());
    this.view = new MapView(map, parts, this.exact, this.readiness);
    this.miniature = new Miniature(map, parts, this.view, () => this.readiness.pendingWork());
  }

  /** The page element of the 2D view. */
  get element(): HTMLDivElement {
    return this.view.element;
  }
  get stats(): Record<string, unknown> {
    return this.map.stats;
  }
  /** True while `invalidate` only asks for a new frame of the same content (the miniature of the page stays valid). */
  get redrawOnly(): boolean {
    return this.map.redrawOnly;
  }
  get requestId(): number | undefined {
    return this.map.request?.id;
  }
  /** Resource payload provider (StudioClient): fetched lazily, only when a resource diagnostic is shown. */
  set resourceSource(source: ResourceSource | undefined) {
    this.map.resourceSource = source;
  }
  /** Resources an export renderer may reuse (read-only for it). */
  sharedResources(): SharedPassResources {
    return this.map.shared;
  }
  rasterContext(): MaterialRasterContext | undefined {
    return this.parts.ground.rasterContext();
  }
  /** Bytes held by the dormant cartography renderers of other looks. */
  retainedBytes(): number {
    return this.parts.cartography.retainedBytes();
  }

  // --- appearance ----------------------------------------------------------------------------------------------------
  set(world: World, settings: V2Settings, r: ResolvedAppearance, layers: Partial<ExportLayers> = {}, request = new RenderReadiness(r.target === 'export' ? 'capture' : '2d')): Promise<void> {
    return this.appearance.apply(world, settings, r, layers, request, this.view);
  }
  /** The physical land use of the overlay (composition mask, painted brushes, path caches) for the 3D ground tiles: no second scene. */
  physicalGround(): PhysicalGround | undefined {
    return this.parts.cartography.physicalGround();
  }

  // --- the view on screen --------------------------------------------------------------------------------------------
  drawLive(view: View, w: number, h: number, dpr: number): void {
    this.view.draw(view, w, h, dpr);
  }
  /** The whole task of a frame of the page, for the journal of slow units (LiveStats.slow). */
  noteFrame(since: number): void {
    noteLiveUnit('frame', since);
  }
  setSuspended(value: boolean): void {
    this.view.setSuspended(value);
  }
  /** True when the last miniature had its map content and no work was pending: otherwise it must be drawn again. */
  get miniComplete(): boolean {
    return this.miniature.complete;
  }
  drawMini(size: number): HTMLCanvasElement {
    return this.miniature.draw(size);
  }

  // --- readiness -----------------------------------------------------------------------------------------------------
  /** Display work still owed to the map on screen; 0 once it is complete. */
  pendingWork(): number {
    return this.readiness.pendingWork();
  }
  derivedPending(): number {
    return this.readiness.derivedPending();
  }
  /** Resolves once the progressive updates (woods after a town build) are on screen. */
  settled(): Promise<void> {
    return this.readiness.settled();
  }
  exactReady(): Promise<void> {
    return this.parts.ground.exactReady();
  }

  // --- exact frames --------------------------------------------------------------------------------------------------
  /** Capture/export only: combines the layers into a single raster. */
  draw(view: View, w: number, h: number, dpr: number, canvas = this.surface): HTMLCanvasElement {
    return this.exact.paint(canvas, view, w, h, dpr, false);
  }
  /** The whole map at `size` pixels, with other export layers when given. */
  async capture(size: number, layers?: Partial<ExportLayers>): Promise<HTMLCanvasElement> {
    const capture = new RenderReadiness('capture');
    if (layers) await this.set(this.map.world!, this.map.settings!, this.map.resolved!, layers);
    return this.exact.capture(size, this.surface, capture);
  }
  /** An exact frame of the view on screen, laid over it for a screenshot. */
  prepareCapture(): void {
    if (this.readiness.pendingWork()) throw new Error('HD loading… Wait for the renderer before capturing.');
    if (this.parts.ground.programError) throw this.parts.ground.programError;
    const capture = new RenderReadiness('capture');
    capture.mark('programs-ready');
    this.view.prepareCapture();
    capture.mark('capture-complete');
  }
  /** Terrain-pass bitmap for 3D; invalidated with the ground, shared without PNG encoding and image decoding. */
  groundBackground(): HTMLCanvasElement | undefined {
    return this.parts.ground.groundBackground();
  }
  backgroundUrl(): string | undefined {
    return this.exact.backgroundUrl();
  }

  dispose(): void {
    const map = this.map;
    map.disposed = true;
    this.view.dispose();
    this.parts.cartography.dispose();
    this.parts.town.dispose();
    this.parts.ground.dispose();
    if (map.ownsShared) map.shared.cache.clear();
    map.world = undefined;
  }
}
