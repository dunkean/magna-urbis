/**
 * The composed view: the 2D map on screen, moving and at rest, drawn by the live compositor
 * (render/live/compositor.ts) on one WebGL2 canvas from four live layers: the ground (baked tiles of the terrain
 * renderer), the overlay (the cartography's retained lists), the town (meshes) and the names (glyph atlas).
 *
 * This is the display path of the page; mapView.ts draws through it whenever `blocked()` answers undefined.
 *
 * A frame of a moving view is one compositor frame. When the view comes to rest, each of the overlay, the town and
 * the names is asked whether what its live layer draws is its picture at rest (LiveLayer.restExact):
 *  - yes: nothing else is painted for it, the compositor keeps drawing it, and a frame at rest costs what a moving
 *    frame costs;
 *  - no (a look its live layer does not cover, a layer that failed): the exact renderer of that layer paints it in
 *    its stepwise mode (non-blocking: it paints what it has and asks for the frame again as it progresses) into a 2D
 *    canvas stacked above the compositor's, shown once its paint is complete.
 * The exact canvases lie above the compositor's canvas, so a layer shown by one takes the layers above it with it:
 * the picture at rest is split at one level (`exactFrom`), the compositor below, exact canvases from there up.
 * A complete exact canvas also becomes the stand-in of its layer: the raster the compositor shows, moved with the
 * view, whenever the live layer is not ready.
 *
 * The furniture (frame, cartouche, legend, scale bar) is screen-space: the live overlay layer does not draw it, a
 * small 2D canvas on top does.
 *
 * The map has one camera (render/world/): a view with a pitch or a yaw is the same world seen tilted, and one
 * compositor frame (`drawTilted`): the terrain with the water, the overlay and the town plan draped on it, the names
 * standing on it. No picture at rest is made for it and no exact canvas is shown (they are pictures of the top view);
 * the furniture is hidden (a scale bar measures nothing in perspective). This view gives the compositor, the ground
 * layer and the names the relief of the map (`relief`), and places the names of a tilted view at rest. The town's
 * buildings and the modelled trees stand on the terrain as volumes (render/world/volumes.ts): two more layers, fed by
 * worldVolumes.ts, which draw nothing in the top view. A click on a tilted view picks with the camera's ray (`pick`:
 * the building volume in front of the ground, else the ground point), and its picture is the compositor's frame read
 * back (`capture`).
 */
import { createLiveCompositor, type LiveCompositor } from '../../render/live/compositor';
import { liveStats, noteLiveUnit } from '../../render/live/liveStats';
import { createLiveGroundLayer } from '../../render/live/groundLayer';
import { createLiveTextLayer } from '../../render/live/textLayer';
import type { LiveCityEnv } from '../../render/live/contract';
import type { CanvasRenderer } from '../../render/canvas';
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import type { View } from '../../render/view';
import { dualCameras } from '../../render/live/policy';
import { createCameraPose, groundHit, isTilted, pixelRay, poseCamera } from '../../render/world/camera';
import { createWorldBuildingsLayer, type WorldBuildingsLayer } from '../../render/world/buildingsLayer';
import type { Building3dVisual } from '../../render/urbanBuildingGeometry';
import { TerrainHeights } from '../../render/world/heights';
import { createWorldTreesLayer } from '../../render/world/treesLayer';
import { getDisplayQuality } from '../../render/displayQuality';
import { StepwisePaint } from '../../render/stepwisePaint';
import { isFantasyStyle } from '../../../../rust/bridge/fantasyTerrain';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import type { TerrainRenderer } from '../../ui/terrainRenderer';
import type { NativeCityMap } from '../nativeCityMap';
import { reportDrawnLabels } from '../drawnLabels';
import type { DisplayParts } from './contract';
import type { MapState } from './mapState';
import type { DisplayReadiness } from './readiness';
import { SETTLE_MS, type ViewMotion } from './viewMotion';
import { WorldVolumes } from './worldVolumes';

/** Why the composed view waits (`blocked`): the ground layer has no tile yet. Its baking goes on while it waits. */
export const GROUND_WARMING = 'ground warming';
/** Exact layer canvases stacked above the compositor's: hidden until their exact paint is complete. */
const EXACT_LAYER_CSS = 'position:absolute;left:0;top:0;visibility:hidden';
/** The furniture canvas of a moving view (frame, cartouche, legend, scale bar) is redrawn at most this often. */
const FURNITURE_MS = 100;
/** Placeholder view of a stand-in that is being cleared. */
const WHOLE_VIEW: View = { cx: 0, cy: 0, scale: 1 };
/** The slice of glyph work the text layer gets in the frame that places the names of a view at rest. */
const NAMES_SLICE_MS = 2;
/** The names of a tilted view are those of the top view of its centre and scale, placed over a square this many
 * times the larger side of the viewport: a tilted camera sees further than the top view's rectangle, towards the
 * horizon and on both sides of it. Beyond, the names would fade anyway (render/live/textLayer.ts). */
const TILTED_NAMES_REACH = 1.6;
/** The whole map in this many pixels: the view the water raster of a tilted frame is asked for. */
const DRAPED_WATER_PIXELS = 1024;

/** The layers an exact canvas can show, bottom to top. */
const EXACT_LAYERS = ['overlay', 'city', 'text'] as const;
type ExactLayer = (typeof EXACT_LAYERS)[number];
/** Notes one exact paint in the journal of slow units and starts the clock of the next. */
const noteExact = (what: string, since: number): number => {
  noteLiveUnit(what, since);
  return performance.now();
};
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
  /** No WebGL2, a software renderer or a layer factory that threw: `blocked` for good. */
  private refused = false;
  /** The objects the live layers were made from: a new terrain renderer, cartography or city map gets new layers. */
  private owners: { gpu?: TerrainRenderer; cartography?: CanvasRenderer; city?: NativeCityMap; text?: boolean; volumes?: boolean; /** The ground layer had a renderer to bake from. */ ground?: boolean } = {};
  /** The compositor's canvas and the exact canvases are in the page. */
  private onPage = false;
  /** Off the page, waiting for the first tile of the ground layer: its baking goes on. */
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

  /** The relief of the terrain on display, for the camera and the draped ground; made again for another terrain or
   * vertical exaggeration. */
  private heights?: { terrain: TerrainData; relief: TerrainHeights };
  /** Pitch and yaw of the last frame (0, 0: the top view). */
  private pitch = 0;
  private yaw = 0;
  /** A tilted view counts as moving until then, and the timer asks for the frame that says it rests: the motion of
   * the view (viewMotion.ts) follows the centre and the scale only. */
  private tiltMovingUntil = 0;
  private tiltTimer?: ReturnType<typeof setTimeout>;
  /** What the names of the tilted view were last placed for (`revision`: MapState.paintRevision; -1: not placed). */
  private readonly tiltedNames = { cx: 0, cy: 0, scale: 0, side: 0, revision: -1 };

  private readonly cityEnv: LiveCityEnv;
  /** The town in volume and the trees of the tilted map, for the two volume layers. */
  private readonly volumes: WorldVolumes;
  /** The buildings layer on the compositor, for picking. */
  private buildings?: WorldBuildingsLayer;

  constructor(
    private readonly map: MapState,
    private readonly parts: DisplayParts,
    private readonly element: HTMLElement,
    private readonly motion: ViewMotion,
    private readonly readiness: DisplayReadiness,
  ) {
    const { water, town } = parts;
    this.cityEnv = { appearance: () => map.resolved!, visibility: () => town.shownLayers(), water: () => water.cityWater, invalidate: map.compose };
    this.volumes = new WorldVolumes(map, parts, () => this.relief());
  }

  /** Inside a compositor frame or work slice: a frame request raised now comes from a live layer. */
  inCompositor(): boolean {
    return !!this.live?.busy();
  }
  /** New contour paths: they are inked through the overlay's semantic hook, so its live lists are stale. */
  contoursChanged(): void {
    this.live?.invalidateLayer('overlay');
  }
  /** The whole-map capture of the ground may stand in for the live ground tiles (composeFrame): it showed the previous ground. */
  groundCaptureDropped(): void {
    this.live?.setStandIn('ground', undefined, WHOLE_VIEW, 1, 1);
  }

  /** The relief the camera stands on and the ground is draped over. Undefined without a terrain, and with
   * `?camera=dual`, where the map does not tilt. */
  relief(): TerrainHeights | undefined {
    const terrain = this.map.native;
    if (!terrain || dualCameras()) return undefined;
    const exaggeration = this.map.resolved?.city.exaggeration ?? 1;
    if (this.heights?.terrain !== terrain || this.heights.relief.exaggeration !== exaggeration) {
      const grid = terrain.field ?? { n: terrain.resolution, data: terrain.height };
      // The sea covers what lies below its level; the Underdark is drawn down to its floors.
      const floor = this.map.world?.options.biome === 'underdark' ? -Infinity : 0;
      this.heights = { terrain, relief: new TerrainHeights(grid.data, grid.n, terrain.width, floor, exaggeration) };
    }
    return this.heights.relief;
  }
  /** The last frame was drawn with a tilted camera. */
  get tilted(): boolean {
    return this.pitch !== 0 || this.yaw !== 0;
  }

  /** Why this frame cannot be composed (undefined: it can). Creates the compositor and its layers on the way. */
  blocked(view: View, w: number, h: number, dpr: number): string | undefined {
    const map = this.map,
      { ground } = this.parts;
    if (this.refused) return 'no hardware WebGL2';
    const r = map.resolved;
    if (!r || !map.world) return 'no map';
    if (r.target !== 'view2d') return 'not the 2D view';
    if (!ground.gpuActive || !ground.gpu) return 'CPU ground';
    if (ground.fantasy || isFantasyStyle(r.ground.style)) return 'illustrated ground';
    const live = (this.live ??= createLiveCompositor({ invalidate: map.compose, quality: getDisplayQuality, relief: () => this.relief(), mapSize: () => map.world?.mapSize ?? 0 }));
    if (!live) {
      this.refused = true;
      return 'no hardware WebGL2';
    }
    if (!live.active()) return 'context lost';
    try {
      this.syncLayers(live);
    } catch (error) {
      // A layer factory of another module threw: the map is not composed, rather than failing every frame.
      console.warn('Live compositor: layer setup failed, the map is not composed.', error);
      this.refused = true;
      map.stats.liveError = String(error);
      return 'layer setup failed';
    }
    if (!live.hasLayer('ground')) return 'no ground layer';
    // No baked tile covers the view yet and nothing stands in for the ground: a composed frame would show bare paper.
    // The miniature's capture stands in for the top view only; a tilted frame draws no stand-in.
    if (!live.layerReady('ground', view, w, h, Math.min(2, dpr)) && (isTilted(view) || !ground.miniGround())) return GROUND_WARMING;
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
      live.setLayer('ground', ground.gpu ? createLiveGroundLayer(gl, { renderer: () => ground.groundTiles(), mapSize: () => map.world?.mapSize ?? 1, paper: () => map.groundPaper, terrain: () => this.relief(), invalidate: map.compose }) : undefined);
    }
    // The ground layer's work stops while it has no renderer to bake from: when one appears it is told, which also
    // restarts the compositor's work loop.
    const baking = !!ground.groundTiles();
    if (baking && !owners.ground) live.invalidateLayer('ground');
    owners.ground = baking;
    // One text layer for the page: it reads the placement of whichever cartography is current.
    if (!owners.text) {
      owners.text = true;
      live.setLayer('text', createLiveTextLayer(gl, { placement: () => cartography.renderer?.liveText(), terrain: () => this.relief(), invalidate: map.compose }));
    }
    // One pair of volume layers for the page: they read the town and the trees of whichever map is on display.
    if (!owners.volumes) {
      owners.volumes = true;
      live.setLayer('buildings', (this.buildings = createWorldBuildingsLayer(gl, this.volumes.buildings)));
      live.setLayer('trees', createWorldTreesLayer(gl, this.volumes.trees));
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
  /** Another view takes the page: the compositor's canvas and the exact canvases leave it. */
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
    this.pitch = this.yaw = 0;
    clearTimeout(this.tiltTimer);
  }
  /** While the composed view is off the page: `warming`, the ground layer still bakes its first tile and its work
   * goes on; otherwise the compositor rests (its ground layer bakes in the terrain renderer's own canvas, which
   * another view may be showing). */
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
    if (isTilted(view)) {
      this.drawTilted(live, view, w, h, dpr, moved, now);
      return;
    }
    this.pitch = this.yaw = 0;
    this.tiltedNames.revision = -1;
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
  /** One frame of a tilted camera: the compositor alone, whose terrain shows the water, the overlay and the town
   * plan draped on the relief, with the names standing on it. The exact canvases are pictures of the top view: none
   * is shown and no picture at rest is made; the next frame of the top view makes its own anew. When the tilted view
   * comes to rest its names are placed. */
  private drawTilted(live: LiveCompositor, view: View, w: number, h: number, dpr: number, moved: boolean, now: number): void {
    const pitch = view.pitch ?? 0,
      yaw = view.yaw ?? 0,
      changed = moved || pitch !== this.pitch || yaw !== this.yaw;
    this.pitch = pitch;
    this.yaw = yaw;
    this.show(undefined);
    this.rest = 'due';
    this.motion.restDone();
    if (changed) {
      this.tiltMovingUntil = now + SETTLE_MS;
      clearTimeout(this.tiltTimer);
      this.tiltTimer = setTimeout(this.viewRested, SETTLE_MS + 1);
    }
    const moving = now < this.tiltMovingUntil;
    if (!moving) {
      this.placeTiltedNames(view, w, h);
      this.volumes.refresh();
    }
    this.composeFrame(live, view, w, h, dpr, moving, now);
  }
  /** The names of a tilted view at rest: the placement of the top view of its centre and scale (the names then keep
   * the sizes and the spacing of the map the camera tilts from), over a wider square. Placing for the perspective
   * itself would need the collisions of the projected names; the text layer fades the far ones instead. Placed once
   * per view and content; while the view moves, the names of the last placement follow the terrain. */
  private placeTiltedNames(view: View, w: number, h: number): void {
    const renderer = this.parts.cartography.renderer,
      placed = this.tiltedNames,
      side = TILTED_NAMES_REACH * Math.max(w, h),
      revision = this.map.paintRevision;
    if (!renderer || (placed.cx === view.cx && placed.cy === view.cy && placed.scale === view.scale && placed.side === side && placed.revision === revision)) return;
    placed.cx = view.cx;
    placed.cy = view.cy;
    placed.scale = view.scale;
    placed.side = side;
    placed.revision = revision;
    renderer.placeText({ cx: view.cx, cy: view.cy, scale: view.scale }, side, side);
    reportDrawnLabels(renderer.lastPlaced().map(p => p.label.id));
  }

  /** One compositor frame: ground, water, and the live layers whose exact canvas is not shown. */
  private composeFrame(live: LiveCompositor, view: View, w: number, h: number, dpr: number, moving: boolean, now: number, repaintFurniture = false): void {
    const ratio = Math.min(2, dpr),
      map = this.map,
      { ground, water } = this.parts,
      tilted = isTilted(view);
    // The water raster of this frame; a moving view keeps the one it has (a finer one is rasterized at rest). A
    // tilted frame drapes it on the terrain as far as the horizon: it takes the raster of the whole map, and keeps it
    // while it is tilted (another raster would bake every tile of the map drape again).
    const size = map.world!.mapSize,
      vectors = tilted ? water.vectorRaster({ cx: size / 2, cy: size / 2, scale: DRAPED_WATER_PIXELS / size }, DRAPED_WATER_PIXELS, DRAPED_WATER_PIXELS, 1, false) : water.vectorRaster(view, w, h, dpr, !moving);
    live.setWater(vectors?.image, vectors?.region);
    live.setPaper(map.groundPaper);
    live.setLayerShown('overlay', !atOrAbove('overlay', this.shownFrom));
    live.setLayerShown('text', !atOrAbove('text', this.shownFrom));
    live.setLayerShown('city', !atOrAbove('city', this.shownFrom) && (map.exportLayers.city !== false || map.exportLayers.streets !== false));
    live.setLayerShown('buildings', map.exportLayers.city !== false);
    live.draw(view, w, h, ratio, moving);
    // Ground tiles not baked yet (the first frames of a map or of a look) and nothing to stand in for them: the
    // whole-map capture of the miniature does, uploaded once, and the frame is composed again in this task.
    const baked = liveStats().layers.ground;
    if (baked && !baked.ready && !baked.standIn) {
      const coarse = ground.miniGround();
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
    this.paintFurniture(view, w, h, dpr, now, moving, repaintFurniture);
  }

  /** Frame, cartouche, legend and scale bar over the live overlay layer, which does not draw them: at most every
   * FURNITURE_MS while the view moves, once per view at rest, and again when the content may have changed (`repaint`). */
  private paintFurniture(view: View, w: number, h: number, dpr: number, now: number, moving: boolean, repaint: boolean): void {
    const canvas = this.furnitureCanvas,
      renderer = this.parts.cartography.renderer,
      hidden = canvas.style.visibility === 'hidden';
    // The exact overlay canvas holds the furniture, and so does its raster when it stands in for the live layer.
    // The furniture belongs to the top view (its scale bar measures nothing in perspective).
    if (!renderer || isTilted(view) || this.shownFrom === 'overlay' || liveStats().layers.overlay?.standIn) {
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
      // The exact renderers in their stepwise mode: each paints what it has now and asks for the frame again.
      StepwisePaint.track(map, () => {
        let t = performance.now();
        if (exactFrom === 'overlay') {
          cartography.paintOverlay(view, pixelW, pixelH, true);
          t = noteExact('exact:overlay', t);
        }
        if (exactFrom !== 'text') {
          const ctx = cleared(this.cityCanvas);
          // The ground is the compositor's canvas below: the town clears its own pixels over the rivers, and those
          // of the exact overlay canvas under it.
          if (cityOn) map.stats.city = town.draw(ctx, view, w, h, dpr, { stepwise: { key: map.townContent, moving: false }, overlayBelow: exactFrom === 'overlay' ? cartography.overlay.getContext('2d') : null });
          t = noteExact('exact:city', t);
        }
        const names = cleared(this.textCanvas);
        renderer?.drawText(names, view, w, h);
        noteExact('exact:text', t);
      });
      this.townPending = exactFrom !== 'text' && cityOn && !!(map.stats.city as { pending?: boolean } | undefined)?.pending;
      overlayPending = exactFrom === 'overlay' && (StepwisePaint.pending(map) > 0 || (renderer?.lastStats().rasterPending ?? 0) > 0);
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
    noteLiveUnit('rest', started);
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

  // --- picking and captures of a tilted view --------------------------------------------------------------------------

  /** What lies under the CSS pixel (sx, sy) of a tilted view: the ground point, and the building volume in front of the
   * ground there among those `accept` takes (with the point where the ray meets its box). Undefined when the pixel
   * shows neither (the sky). CPU only, for a click. */
  pick(view: View, w: number, h: number, sx: number, sy: number, accept: (building: Building3dVisual) => boolean): { x: number; y: number; building?: Building3dVisual } | undefined {
    const relief = this.relief(),
      pose = poseCamera(createCameraPose(), view, h, relief),
      point: [number, number] = [0, 0],
      ground = groundHit(pose, sx, sy, w, h, relief, point);
    const ray = new Float64Array(3);
    pixelRay(pose, sx, sy, w, h, ray);
    const hit = this.map.exportLayers.city !== false ? this.buildings?.pick(pose.eye, ray, pose.rise, ground, accept) : undefined;
    if (hit) return { x: pose.eye[0] + ray[0] * hit.t, y: pose.eye[1] + ray[1] * hit.t, building: hit.building };
    return ground < Infinity ? { x: point[0], y: point[1] } : undefined;
  }
  /** The tilted view as a picture, the compositor's frame at `dpr` (LiveCompositor.capture). */
  capture(view: View, w: number, h: number, dpr: number, out: HTMLCanvasElement): boolean {
    return !!this.live?.active() && this.live.capture(view, w, h, Math.min(2, dpr), out);
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
    // The ground of a new terrain has no tile yet (the view holds its last picture, mapView.ts): a frame drawn now
    // would be bare paper. Nothing is frozen: the canvases stay as they are through the passes.
    if (!live.layerReady('ground', shown.view, shown.w, shown.h, Math.min(2, shown.dpr))) return undefined;
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
    clearTimeout(this.tiltTimer);
    this.live?.dispose();
    this.live = undefined;
    this.buildings = undefined;
  }
}
