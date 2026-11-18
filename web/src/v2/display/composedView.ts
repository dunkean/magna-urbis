/**
 * The composed view: the 2D map on screen, moving and at rest, drawn by the live compositor
 * (render/live/compositor.ts) on one WebGL2 canvas from four live layers: the ground (baked tiles of the terrain
 * renderer), the overlay (the cartography's retained lists), the town (meshes) and the names (glyph atlas).
 *
 * This is the display path of the page; mapView.ts draws through it whenever `blocked()` answers undefined, and
 * through fallbackView.ts otherwise.
 *
 * A frame of a moving view is one compositor frame. When the view comes to rest, each of the overlay, the town and
 * the names is asked whether what its live layer draws is its picture at rest (LiveLayer.restExact):
 *  - yes: nothing else is painted for it, the compositor keeps drawing it, and a frame at rest costs what a moving
 *    frame costs;
 *  - no (a look its live layer does not cover, a layer that failed): the exact renderer paints that layer, in steps,
 *    into a 2D canvas stacked above the compositor's, shown once its paint is complete.
 * The exact canvases lie above the compositor's canvas, so a layer shown by one takes the layers above it with it:
 * the picture at rest is split at one level (`exactFrom`), the compositor below, exact canvases from there up.
 * A complete exact canvas also becomes the stand-in of its layer: the raster the compositor shows, moved with the
 * view, whenever the live layer is not ready.
 *
 * The furniture (frame, cartouche, legend, scale bar) is screen-space: the live overlay layer does not draw it, a
 * small 2D canvas on top does.
 */
import { createLiveCompositor, liveStats, noteLiveUnit, type LiveCompositor } from '../../render/live/compositor';
import { createLiveGroundLayer } from '../../render/live/groundLayer';
import { createLiveTextLayer } from '../../render/live/textLayer';
import { fallbackForced } from '../../render/live/policy';
import type { LiveCityEnv } from '../../render/live/contract';
import type { CanvasRenderer } from '../../render/canvas';
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import type { View } from '../../render/view';
import { getDisplayQuality } from '../../render/displayQuality';
import { LiveTileFill } from '../../render/liveTileFill';
import { noteLivePart } from '../../render/vectorEngine';
import { isFantasyStyle } from '../../../../rust/bridge/fantasyTerrain';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import type { TerrainRenderer } from '../../ui/terrainRenderer';
import type { NativeCityMap } from '../nativeCityMap';
import { reportDrawnLabels } from '../drawnLabels';
import type { MapState } from './mapState';
import type { DisplayParts } from './parts';
import type { DisplayReadiness } from './readiness';
import type { ViewMotion } from './viewMotion';

/** Why the composed view waits (`blocked`): the ground layer has no tile yet. Its baking goes on under the fallback view. */
export const GROUND_WARMING = 'ground warming';
/** Exact layer canvases stacked above the compositor's: hidden until their exact paint is complete. */
const EXACT_LAYER_CSS = 'position:absolute;left:0;top:0;visibility:hidden';
/** The furniture canvas of a moving view (frame, cartouche, legend, scale bar) is redrawn at most this often. */
const FURNITURE_MS = 100;
/** Placeholder view of a stand-in that is being cleared. */
const WHOLE_VIEW: View = { cx: 0, cy: 0, scale: 1 };
/** The slice of glyph work the text layer gets in the frame that places the names of a view at rest. */
const NAMES_SLICE_MS = 2;

/** The layers an exact canvas can show, bottom to top. */
const EXACT_LAYERS = ['overlay', 'city', 'text'] as const;
type ExactLayer = (typeof EXACT_LAYERS)[number];
/** `layer` is `from` or lies above it. */
const atOrAbove = (layer: ExactLayer, from: ExactLayer | undefined): boolean => !!from && EXACT_LAYERS.indexOf(layer) >= EXACT_LAYERS.indexOf(from);

/**
 * The picture of the view at rest:
 *   due            : not made for this view yet (the view moves, or has just arrived);
 *   live           : the compositor's layers are the picture; nothing else is painted;
 *   awaiting-names : as `live`, but the text layer is still preparing the names placed for this view;
 *   painting       : the exact renderers are painting the layers from `exactFrom` up, in steps;
 *   exact          : those exact canvases are complete and shown.
 */
type RestPicture = 'due' | 'live' | 'awaiting-names' | 'painting' | 'exact';

export class ComposedView {
  private live?: LiveCompositor;
  /** No WebGL2, a software renderer or a layer factory that threw: the fallback view for good. */
  private refused = false;
  /** The objects the live layers were made from: a new terrain renderer, cartography or city map gets new layers. */
  private owners: { gpu?: TerrainRenderer; cartography?: CanvasRenderer; city?: NativeCityMap; text?: boolean; /** The ground layer had a renderer to bake from. */ ground?: boolean } = {};
  /** The compositor's canvas and the exact canvases are in the page. */
  private onPage = false;
  /** The ground layer waits for its first tile under the fallback view: its baking goes on. */
  private warming = false;
  /** The overlay canvas in the page (the cartography pass may swap the cartography's). */
  private overlayOnPage?: HTMLCanvasElement;
  private readonly cityCanvas = document.createElement('canvas');
  private readonly textCanvas = document.createElement('canvas');
  private readonly furnitureCanvas = document.createElement('canvas');
  private furnitureDrawn = 0;
  private readonly furnitureAt: View = { cx: NaN, cy: NaN, scale: NaN };
  private cssW = 0;
  private cssH = 0;

  private rest: RestPicture = 'due';
  /** The lowest layer the picture at rest paints with its exact renderer (undefined: none). */
  private exactFrom?: ExactLayer;
  /** The lowest layer whose exact canvas is on screen; the canvases above it are too, and the compositor draws none of them. */
  private shownFrom?: ExactLayer;
  /** The exact town paint of the picture at rest is incomplete. */
  private townPending = false;
  /** `MapState.paintRevision` the picture at rest was made for. */
  private paintedRevision = -1;

  private readonly cityEnv: LiveCityEnv;

  constructor(
    private readonly map: MapState,
    private readonly parts: DisplayParts,
    private readonly element: HTMLElement,
    private readonly motion: ViewMotion,
    private readonly readiness: DisplayReadiness,
  ) {
    const { ground, water, contours, cartography, town } = parts;
    this.cityEnv = { appearance: () => map.resolved!, visibility: () => town.shownLayers(), water: () => water.cityWater, invalidate: map.compose };
    map.inCompositor = () => !!this.live?.busy();
    // The contours are inked through the overlay's semantic hook: its live lists are stale.
    contours.onReady = () => this.live?.invalidateLayer('overlay');
    // The whole-map capture may stand in for the live ground tiles (composeFrame): it showed the previous ground.
    ground.onBackgroundDropped = () => this.live?.setStandIn('ground', undefined, WHOLE_VIEW, 1, 1);
    // A town painted into its own exact canvas repeats its river cut on the exact overlay canvas under it.
    town.canvasUnder = canvas => (canvas === this.cityCanvas && this.exactFrom === 'overlay' ? cartography.overlay.getContext('2d') : null);
  }

  /** Why this frame cannot be composed (undefined: it can). Creates the compositor and its layers on the way. */
  blocked(view: View, w: number, h: number, dpr: number): string | undefined {
    const map = this.map,
      { ground } = this.parts;
    if (fallbackForced()) return 'forced fallback';
    if (this.refused) return 'no hardware WebGL2';
    const r = map.resolved;
    if (!r || !map.world) return 'no map';
    if (r.target !== 'view2d') return 'not the 2D view';
    if (!ground.gpuActive || !ground.gpu) return 'CPU ground';
    if (ground.fantasy || isFantasyStyle(r.ground.style)) return 'illustrated ground';
    const live = (this.live ??= createLiveCompositor({ invalidate: map.compose, quality: getDisplayQuality }));
    if (!live) {
      this.refused = true;
      return 'no hardware WebGL2';
    }
    if (!live.active()) return 'context lost';
    try {
      this.syncLayers(live);
    } catch (error) {
      // A layer factory of another module threw: the map stays on the fallback view rather than failing every frame.
      console.warn('Live compositor: layer setup failed, fallback display.', error);
      this.refused = true;
      map.stats.liveError = String(error);
      return 'layer setup failed';
    }
    if (!live.hasLayer('ground')) return 'no ground layer';
    // No baked tile covers the view yet and nothing stands in for the ground: a composed frame would show bare paper.
    if (!live.layerReady('ground', view, w, h, Math.min(2, dpr)) && !ground.miniGround()) return GROUND_WARMING;
    return undefined;
  }

  private syncLayers(live: LiveCompositor): void {
    const gl = live.gl,
      owners = this.owners,
      map = this.map,
      { ground, cartography, town } = this.parts;
    if (owners.gpu !== ground.gpu) {
      owners.gpu = ground.gpu;
      owners.ground = false;
      live.setLayer('ground', ground.gpu ? createLiveGroundLayer(gl, { renderer: () => ground.groundTiles(), mapSize: () => map.world?.mapSize ?? 1, paper: () => map.groundPaper, invalidate: map.compose }) : undefined);
    }
    // The ground layer's work stops while it has no renderer to bake from: when one appears it is told, which also
    // restarts the compositor's work loop.
    const baking = !!ground.groundTiles();
    if (baking && !owners.ground) live.invalidateLayer('ground');
    owners.ground = baking;
    // One text layer for the page: it reads the placement of whichever cartography is current.
    if (!owners.text) {
      owners.text = true;
      live.setLayer('text', createLiveTextLayer(gl, { placement: () => cartography.renderer?.liveText(), invalidate: map.compose }));
    }
    if (owners.cartography !== cartography.renderer) {
      owners.cartography = cartography.renderer;
      live.setLayer('overlay', cartography.renderer?.createLiveLayer(gl));
      live.invalidateLayer('text');
    }
    if (owners.city !== town.city) {
      owners.city = town.city;
      live.setLayer('city', town.city?.createLiveLayer(gl, this.cityEnv));
    }
  }

  /** After the passes of set(): what the live layers cannot see by themselves. The ground layer follows the
   * renderer's contentRevision, the text layer the placement revision. */
  contentChanged(ran: readonly string[], before: { resolved?: ResolvedAppearance; native?: TerrainData }): void {
    const live = this.live,
      r = this.map.resolved!;
    if (!live) return;
    // Another ground style or terrain: the rasters of the previous map must not stand in for this one.
    if (before.resolved?.ground.style !== r.ground.style || before.native !== this.map.native) live.clearStandIns();
    // Another terrain: the baked tiles of the previous map must never show under this one (a stale tile is only a
    // fair stand-in for the same terrain in another look). The next frame makes a new ground layer.
    if (before.native !== this.map.native) this.owners.gpu = undefined;
    // The terrain pass takes the renderer away while it runs (gpuActive), and the ground layer's work stops without
    // one: its tiles are marked stale (they keep showing until re-baked) and the work loop starts again.
    if (ran.includes('terrainData')) live.invalidateLayer('ground');
    // The semantic hook of the overlay (contours, rural semantics, water cut) and the town hooks (urban semantics,
    // rivers) are the display's own state.
    if (ran.some(name => name === 'cartography' || name === 'overlays' || name === 'semantic' || name === 'water' || name === 'frame')) live.invalidateLayer('overlay');
    if (ran.some(name => name === 'city' || name === 'semantic' || name === 'water') || before.resolved?.keys.city !== r.keys.city) live.invalidateLayer('city');
  }
  /** The display quality or the vector engine changed: what the overlay, the town and the names retain is stale. */
  invalidateLayers(): void {
    for (const name of EXACT_LAYERS) this.live?.invalidateLayer(name);
    this.rest = 'due';
  }

  // --- the page ------------------------------------------------------------------------------------------------------

  private enter(live: LiveCompositor, w: number, h: number): void {
    const overlay = this.parts.cartography.overlay;
    if (!this.onPage) {
      this.onPage = true;
      this.overlayOnPage = undefined;
      this.shownFrom = undefined;
      this.rest = 'due';
      this.cssW = this.cssH = 0;
      for (const canvas of [this.cityCanvas, this.textCanvas, this.furnitureCanvas]) canvas.style.cssText = EXACT_LAYER_CSS;
      live.canvas.style.visibility = 'visible';
      this.element.prepend(live.canvas);
      this.element.append(this.cityCanvas, this.textCanvas, this.furnitureCanvas);
      this.syncWork();
    }
    if (this.overlayOnPage !== overlay) {
      this.overlayOnPage?.remove();
      this.overlayOnPage = overlay;
      if (this.shownFrom === 'overlay') this.shownFrom = undefined;
      this.rest = 'due';
      overlay.style.cssText = EXACT_LAYER_CSS;
      overlay.style.width = w + 'px';
      overlay.style.height = h + 'px';
      live.canvas.after(overlay);
      this.applyVisibility();
    }
    if (w !== this.cssW || h !== this.cssH) {
      this.cssW = w;
      this.cssH = h;
      for (const canvas of [overlay, this.cityCanvas, this.textCanvas, this.furnitureCanvas]) {
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
      }
    }
  }
  /** The fallback view takes the page: the compositor's canvas and the exact canvases leave it. */
  leave(): void {
    if (!this.onPage) return;
    this.onPage = false;
    this.live?.canvas.remove();
    this.overlayOnPage?.remove();
    this.overlayOnPage = undefined;
    this.parts.cartography.overlay.style.cssText = '';
    for (const canvas of [this.cityCanvas, this.textCanvas, this.furnitureCanvas]) {
      canvas.remove();
      canvas.width = canvas.height = 0;
    }
    this.shownFrom = this.exactFrom = undefined;
    this.townPending = false;
    this.rest = 'due';
    this.cssW = this.cssH = 0;
  }
  /** While the fallback view is on screen: `warming`, the ground layer still bakes its first tile and its work goes
   * on; otherwise the compositor rests (its ground layer bakes in the terrain renderer's own canvas, which the
   * fallback view shows). */
  standBy(warming: boolean): void {
    this.warming = warming;
    this.syncWork();
  }
  /** The compositor's preparation runs while it is on screen (or warming) and the terrain renderer's state is still:
   * no tile is baked while the passes change it, nor behind another view. */
  syncWork(): void {
    this.live?.setPaused(this.map.suspended || this.map.preparing || !(this.onPage || this.warming));
  }
  private applyVisibility(): void {
    if (this.overlayOnPage) this.overlayOnPage.style.visibility = atOrAbove('overlay', this.shownFrom) ? 'visible' : 'hidden';
    this.cityCanvas.style.visibility = atOrAbove('city', this.shownFrom) ? 'visible' : 'hidden';
    this.textCanvas.style.visibility = atOrAbove('text', this.shownFrom) ? 'visible' : 'hidden';
  }
  private show(from: ExactLayer | undefined): void {
    if (this.shownFrom === from) return;
    this.shownFrom = from;
    this.applyVisibility();
  }

  // --- frames --------------------------------------------------------------------------------------------------------

  /** One frame of the view. `moved`: the view differs from the previous frame's. */
  draw(view: View, w: number, h: number, dpr: number, moved: boolean, now: number): void {
    const live = this.live!,
      map = this.map;
    this.enter(live, w, h);
    map.dpr = dpr;
    if (this.motion.phase(now) === 'moving') {
      // A frame of a gesture: the compositor alone. No exact renderer runs; their canvases are hidden.
      this.show(undefined);
      this.rest = 'due';
      this.composeFrame(live, view, w, h, dpr, true, now);
      this.motion.awaitRest(now, moved, this.viewRested);
      return;
    }
    // At rest: the picture at rest when it is due (the view came to rest, the content changed, a stepwise paint
    // progressed, the names were being prepared), else the compositor alone (a ground tile arrived, the page asked
    // for a frame of the same content).
    if (this.rest === 'due' || this.rest === 'awaiting-names' || this.paintedRevision !== map.paintRevision) this.restFrame(live, view, w, h, dpr, now);
    else this.composeFrame(live, view, w, h, dpr, false, now);
  }
  private viewRested = (): void => {
    if (!this.map.disposed && this.map.world) this.map.repaint();
  };

  /** One compositor frame: ground, water, and the live layers whose exact canvas is not shown. */
  private composeFrame(live: LiveCompositor, view: View, w: number, h: number, dpr: number, moving: boolean, now: number, repaintFurniture = false): void {
    const t = performance.now(),
      ratio = Math.min(2, dpr),
      map = this.map,
      { ground, water } = this.parts;
    // The water raster of this frame; a moving view keeps the one it has (a finer one is rasterized at rest).
    const vectors = water.vectorRaster(view, w, h, dpr, !moving);
    live.setWater(vectors?.image, vectors?.region);
    live.setPaper(map.groundPaper);
    live.setLayerShown('overlay', !atOrAbove('overlay', this.shownFrom));
    live.setLayerShown('text', !atOrAbove('text', this.shownFrom));
    live.setLayerShown('city', !atOrAbove('city', this.shownFrom) && (map.exportLayers.city !== false || map.exportLayers.streets !== false));
    live.draw(view, w, h, ratio, moving);
    // Ground tiles not baked yet (the first frames of a map or of a look) and nothing to stand in for them: the
    // whole-map capture of the miniature does, uploaded once, and the frame is composed again in this task.
    const baked = liveStats().layers.ground;
    if (baked && !baked.ready && !baked.standIn) {
      const coarse = ground.miniGround(),
        size = map.world!.mapSize;
      if (coarse) {
        live.setStandIn('ground', coarse, { cx: size / 2, cy: size / 2, scale: 1 }, size, size);
        live.draw(view, w, h, ratio, moving);
      }
    }
    // The rivers are in this frame: the vector water raster, or the GPU ground's own once the tiles of the view are baked
    // (a coarse tier, a stand-in or a tile of the previous map may not show them).
    if (water.waterShownDue) {
      const stats = liveStats(),
        tiles = stats.layers.ground;
      if (vectors || (tiles?.ready && !tiles.standIn && !stats.pending.ground)) water.noteWaterShown();
    }
    if (moving) noteLivePart('frame', t);
    this.paintFurniture(view, w, h, dpr, now, moving, repaintFurniture);
  }

  /** Frame, cartouche, legend and scale bar over the live overlay layer, which does not draw them: at most every
   * FURNITURE_MS while the view moves, once per view at rest, and again when the content may have changed (`repaint`). */
  private paintFurniture(view: View, w: number, h: number, dpr: number, now: number, moving: boolean, repaint: boolean): void {
    const canvas = this.furnitureCanvas,
      renderer = this.parts.cartography.renderer,
      hidden = canvas.style.visibility === 'hidden';
    // The exact overlay canvas holds the furniture, and so does its raster when it stands in for the live layer.
    if (!renderer || this.shownFrom === 'overlay' || liveStats().layers.overlay?.standIn) {
      if (!hidden) canvas.style.visibility = 'hidden';
      return;
    }
    const pixelW = Math.round(w * dpr),
      pixelH = Math.round(h * dpr),
      at = this.furnitureAt;
    const same = at.cx === view.cx && at.cy === view.cy && at.scale === view.scale && canvas.width === pixelW && canvas.height === pixelH;
    if (hidden) canvas.style.visibility = 'visible';
    else if (!repaint && (same || (moving && now - this.furnitureDrawn < FURNITURE_MS))) return;
    this.furnitureDrawn = now;
    at.cx = view.cx;
    at.cy = view.cy;
    at.scale = view.scale;
    if (canvas.width !== pixelW) canvas.width = pixelW;
    if (canvas.height !== pixelH) canvas.height = pixelH;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelW, pixelH);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderer.drawFurniture(ctx, view, w, h);
  }

  // --- the picture at rest -------------------------------------------------------------------------------------------

  /** Makes, or carries on making, the picture of the view at rest. */
  private restFrame(live: LiveCompositor, view: View, w: number, h: number, dpr: number, now: number): void {
    const started = performance.now(),
      map = this.map,
      { cartography, town } = this.parts,
      renderer = cartography.renderer,
      ratio = Math.min(2, dpr);
    this.motion.restDone();
    // Taken before the paints: an invalidation they raise makes the picture due again.
    this.paintedRevision = map.paintRevision;
    const cityOn = map.exportLayers.city !== false || map.exportLayers.streets !== false;
    // The names of this view, placed without a Canvas text paint: the text layer draws them from its atlas.
    if (renderer) {
      renderer.placeText(view, w, h);
      reportDrawnLabels(renderer.lastPlaced().map(p => p.label.id));
    }
    const from = this.lowestExact(live, view, w, h, ratio, cityOn),
      namesAwaited = from === 'awaited';
    const exactFrom = (this.exactFrom = from === 'awaited' ? undefined : from);
    let overlayPending = false;
    this.townPending = false;
    if (exactFrom) {
      const pixelW = Math.round(w * dpr),
        pixelH = Math.round(h * dpr);
      const cleared = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
        if (canvas.width !== pixelW) canvas.width = pixelW;
        if (canvas.height !== pixelH) canvas.height = pixelH;
        const ctx = canvas.getContext('2d')!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, pixelW, pixelH);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return ctx;
      };
      // The ground is the compositor's canvas below: the town clears its own pixels over the rivers (waterAbove).
      town.groundRedraw = undefined;
      LiveTileFill.track(map, () => {
        let t = performance.now();
        if (exactFrom === 'overlay') {
          const overlay = cartography.overlay;
          if (overlay.width !== pixelW) overlay.width = pixelW;
          if (overlay.height !== pixelH) overlay.height = pixelH;
          renderer!.draw(view, { live: true });
          noteLiveUnit('exact:overlay', t);
          t = noteLivePart('cartography', t);
        }
        if (exactFrom !== 'text') {
          const ctx = cleared(this.cityCanvas);
          if (cityOn) map.stats.city = town.city?.draw(ctx, view, w, h, dpr, map.resolved!, town.shownLayers(), town.hooks, { key: map.townContent, moving: false });
          noteLiveUnit('exact:city', t);
          t = noteLivePart('city', t);
        }
        const names = cleared(this.textCanvas);
        renderer?.drawText(names, view, w, h, false);
        noteLiveUnit('exact:text', t);
        noteLivePart('text', t);
      });
      this.townPending = exactFrom !== 'text' && cityOn && !!(map.stats.city as { pending?: boolean } | undefined)?.pending;
      overlayPending = exactFrom === 'overlay' && (LiveTileFill.pending(map) > 0 || (renderer?.lastStats().rasterPending ?? 0) > 0);
    }
    const complete = !!exactFrom && !this.townPending && !overlayPending;
    this.show(this.nextShown(exactFrom, complete, !!exactFrom && (live.layerReady(exactFrom, view, w, h, ratio) || live.hasStandIn(exactFrom))));
    this.composeFrame(live, view, w, h, dpr, false, now, true);
    // The complete exact rasters stand in for their layers at the next gesture.
    if (exactFrom) {
      if (exactFrom === 'overlay' && !overlayPending) live.setStandIn('overlay', cartography.overlay, view, w, h);
      if (exactFrom !== 'text' && !this.townPending) live.setStandIn('city', cityOn && town.city ? this.cityCanvas : undefined, view, w, h);
      live.setStandIn('text', renderer ? this.textCanvas : undefined, view, w, h);
    }
    this.rest = exactFrom ? (complete ? 'exact' : 'painting') : namesAwaited ? 'awaiting-names' : 'live';
    noteLivePart('frame', started);
    this.readiness.notePresented();
  }
  /** The lowest of the overlay, the town and the names whose live layer is not its picture at rest for this view;
   * undefined when all three are; `awaited` when only the names are missing and the text layer is preparing them. */
  private lowestExact(live: LiveCompositor, view: View, w: number, h: number, ratio: number, cityOn: boolean): ExactLayer | 'awaited' | undefined {
    const { cartography, town } = this.parts;
    // Without a cartography there is no overlay and no name to paint; a hidden town has nothing to paint either.
    if (cartography.renderer && !live.restExact('overlay', view, w, h, ratio)) return 'overlay';
    if (cityOn && town.city && !live.restExact('city', view, w, h, ratio)) return 'city';
    if (!cartography.renderer || live.restExact('text', view, w, h, ratio)) return undefined;
    // The text layer holds the names of another placement (they keep following the map meanwhile): it gets a slice
    // of work now, and the names are painted exact only if it has nothing left to do and still cannot show them.
    if (live.advanceLayer('text', NAMES_SLICE_MS)) return 'awaited';
    return live.restExact('text', view, w, h, ratio) ? undefined : 'text';
  }
  /** The exact canvases to have on screen. Those from `from` up change hands together: when their paints are complete,
   * or as they fill when the compositor has nothing to show for the lowest of them (`covered` false: no live layer
   * ready, no stand-in). Canvases already on screen stay, repainted in place; those below `from` go back to the
   * compositor. */
  private nextShown(from: ExactLayer | undefined, complete: boolean, covered: boolean): ExactLayer | undefined {
    if (!from) return undefined;
    if (complete || !covered) return from;
    const shown = this.shownFrom;
    return shown && !atOrAbove(from, shown) ? shown : shown ? from : undefined;
  }

  // --- pending work, style switch, disposal --------------------------------------------------------------------------

  /** Pending work that only concerns the view on screen: the picture at rest, the names being prepared, the town paint. */
  pendingViewOnly(): number {
    return Number(this.motion.restOwed) + Number(this.rest === 'awaiting-names') + Number(this.townPending);
  }
  /** Overlay rasters the exact overlay paint still waits for (none when the overlay at rest is the live layer). */
  pendingOverlay(): number {
    return this.exactFrom === 'overlay' ? (this.parts.cartography.renderer?.lastStats().rasterPending ?? 0) : 0;
  }
  /** The canvases that hold the picture on screen, for the frozen stand-in of a style switch. The compositor's buffer
   * is not preserved: it can only be copied in the task that drew it, so the frame is drawn again here. */
  frozenSources(): HTMLCanvasElement[] | undefined {
    const shown = this.motion.frame,
      live = this.live;
    if (!this.onPage || !shown || !live?.active()) return undefined;
    if (!live.draw(shown.view, shown.w, shown.h, Math.min(2, shown.dpr), false)) return undefined;
    const sources = [live.canvas];
    if (atOrAbove('overlay', this.shownFrom) && this.overlayOnPage) sources.push(this.overlayOnPage);
    if (atOrAbove('city', this.shownFrom)) sources.push(this.cityCanvas);
    if (atOrAbove('text', this.shownFrom)) sources.push(this.textCanvas);
    if (this.furnitureCanvas.style.visibility !== 'hidden') sources.push(this.furnitureCanvas);
    return sources;
  }
  /** After a style switch: the canvases the frozen stand-in hid come back as they were (the previous map) until the
   * next frame makes the picture at rest again. */
  thaw(): void {
    if (this.onPage && this.live) {
      this.live.canvas.style.visibility = 'visible';
      this.applyVisibility();
    }
    this.rest = 'due';
    this.syncWork();
  }
  dispose(): void {
    this.live?.dispose();
    this.live = undefined;
  }
}
