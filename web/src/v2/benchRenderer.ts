/**
 * The 2D map display of the V2: the object the page (v2/client.ts) talks to. It imports no generation entry point:
 * it shows retained products only.
 *
 * It builds the parts of the display and delegates to them (v2/display/, shared types in display/contract.ts):
 *
 *   mapState.ts            the map on display (world, settings, appearance) and the page's frame hook
 *   appearance.ts          set(): the appearance passes, which make the products below
 *   groundProducts.ts      terrain renderer or CPU raster, forest, programs, whole-map ground capture, 3D background
 *   waterProducts.ts       GPU water textures, vector water raster
 *   contours.ts            contour lines inked on the overlay and the 3D drape
 *   cartographyProducts.ts overlay renderer, semantic land use, export overlays
 *   townProducts.ts        native city map and the paint of the exact town renderer
 *   mapView.ts             the view on screen: motion, style-switch stand-in, capture frame
 *     composedView.ts        the live compositor, moving and at rest (the display path)
 *     fallback/              the view when the compositor cannot draw it
 *   exactFrame.ts          captures and exports
 *   miniature.ts           the miniature of the page
 *   readiness.ts           pending work and readiness marks
 */
import { RenderReadiness } from '../render/renderReadiness';
import { noteLiveUnit } from '../render/live/liveStats';
import type { MaterialRasterContext } from '../../../rust/bridge/terrainMaterialContext';
import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import type { City3dPhysicalGround as PhysicalGround } from '../ui/city3d';
import type { View } from '../render/view';
import type { Building3dVisual } from '../render/urbanBuildingGeometry';
import type { WorldRelief } from '../render/world/contract';
import type { Terrain3dCollisions } from '../render/world/terrain3dCollisions';
import type { ExportLayers } from '../render/exportLayers';
import { ResourceCache } from './passes/pass';
import type { ResourceSource } from './resourceLayer';
import { AppearancePasses } from './display/appearance';
import { CartographyProducts } from './display/cartographyProducts';
import { ContourInk } from './display/contours';
import type { SharedPassResources } from './display/contract';
import { ExactFrame } from './display/exactFrame';
import { GroundProducts } from './display/groundProducts';
import { MapState } from './display/mapState';
import { MapView } from './display/mapView';
import { Miniature } from './display/miniature';
import { DisplayReadiness } from './display/readiness';
import { TownProducts } from './display/townProducts';
import { WaterProducts } from './display/waterProducts';

export class BenchRenderer {
  private readonly map: MapState;
  /** The products of set(), each built here and handed to the others through its read-only contract. */
  private readonly products: { ground: GroundProducts; water: WaterProducts; contours: ContourInk; cartography: CartographyProducts; town: TownProducts };
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
    // The products tell the view what it retains of them (the events below); the view is built last, from the
    // complete set, so they reach it through `this`.
    const map = (this.map = new MapState(invalidate, shared ?? { cache: new ResourceCache() }, !shared, () => this.view.inCompositor()));
    const contours = new ContourInk(map, () => this.view.contoursChanged());
    const ground = new GroundProducts(map, () => this.view.groundCaptureDropped(), rasterOnly, materialContext);
    const water = new WaterProducts(map, { ground });
    // The town paints the urban semantics of the cartography, which draws the names of the towns: one of the two
    // reads the other lazily.
    const town: TownProducts = new TownProducts(map, { water }, () => cartography.semantic);
    const cartography = new CartographyProducts(map, { ground, water, contours, town });
    const parts = (this.products = { ground, water, contours, cartography, town });
    this.appearance = new AppearancePasses(map, { ground, water, cartography, town });
    this.readiness = new DisplayReadiness(map, parts, () => this.view);
    this.exact = new ExactFrame(map, parts);
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
    return this.products.ground.rasterContext();
  }
  /** Bytes held by the dormant cartography renderers of other looks. */
  /** The relief of the map on screen: the viewer zooms towards the terrain point under the cursor when tilted. */
  relief(): WorldRelief | undefined {
    return this.view.relief();
  }
  walkCollisions(): Terrain3dCollisions | undefined {
    return this.view.walkCollisions();
  }
  retainedBytes(): number {
    return this.products.cartography.retainedBytes();
  }

  // --- appearance ----------------------------------------------------------------------------------------------------
  set(world: World, settings: V2Settings, r: ResolvedAppearance, layers: Partial<ExportLayers> = {}, request = new RenderReadiness(r.target === 'export' ? 'capture' : '2d')): Promise<void> {
    return this.appearance.apply(world, settings, r, layers, request, this.view);
  }
  /** The physical land use of the overlay (composition mask, painted brushes, path caches) for the 3D ground tiles: no second scene. */
  physicalGround(): PhysicalGround | undefined {
    return this.products.cartography.physicalGround();
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
    return this.products.ground.exactReady();
  }

  // --- exact frames --------------------------------------------------------------------------------------------------
  /** Capture/export only: combines the layers into a single raster. */
  draw(view: View, w: number, h: number, dpr: number, canvas = this.surface): HTMLCanvasElement {
    return this.exact.paint(canvas, view, w, h, dpr, { stepwise: false, groundBeneath: false });
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
    if (this.products.ground.programError) throw this.products.ground.programError;
    const capture = new RenderReadiness('capture');
    capture.mark('programs-ready');
    this.view.prepareCapture();
    capture.mark('capture-complete');
  }
  /** The tilted view on screen as a picture (the PNG of the view); undefined in the top view. */
  captureView(): HTMLCanvasElement | undefined {
    return this.view.captureView();
  }
  /** The ground point under a CSS pixel of `view`, and in a tilted view the building volume in front of it. */
  pick(view: View, w: number, h: number, sx: number, sy: number, accept: (building: Building3dVisual) => boolean): { x: number; y: number; building?: Building3dVisual } | undefined {
    return this.view.pick(view, w, h, sx, sy, accept);
  }
  /** Terrain-pass bitmap for 3D; invalidated with the ground, shared without PNG encoding and image decoding. */
  groundBackground(): HTMLCanvasElement | undefined {
    return this.products.ground.groundBackground();
  }
  /** The ground of the 3D view as one whole-map image URL. */
  backgroundUrl(): string | undefined {
    return this.products.ground.backgroundUrl(this.products.water.vectors);
  }

  dispose(): void {
    const map = this.map,
      { ground, cartography, town, contours } = this.products;
    map.disposed = true;
    this.view.dispose();
    cartography.dispose();
    contours.dispose();
    town.dispose();
    ground.dispose();
    if (map.ownsShared) map.shared.cache.clear();
    map.world = undefined;
  }
}
