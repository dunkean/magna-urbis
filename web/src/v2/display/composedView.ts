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
 *  - not yet, and its live layer has work left (a region of the overlay being recorded for this view, the town's
 *    meshes, the names placed for it): the layer gets a slice of work, the compositor keeps drawing what it has, and
 *    the question is asked again at the frame its work ends or shows something new;
 *  - no, and no work left (a look its live layer does not cover, a layer that failed, the processor drawing the
 *    map): the exact renderer of that layer paints it in
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
 * buildings and modelled trees stand on the terrain as volumes (render/world/volumes.ts), fed by worldVolumes.ts.
 * Volume-style houses also use that layer overhead; modelled trees belong to the tilted view. A click on a tilted view picks with the camera's ray (`pick`:
 * the building volume in front of the ground, else the ground point), and its picture is the compositor's frame read
 * back (`capture`).
 */
import { createLiveCompositor, type LiveCompositor } from '../../render/live/compositor';
import { liveStats, noteLiveUnit } from '../../render/live/liveStats';
import { createLiveGroundLayer } from '../../render/live/groundLayer';
import { createLiveTextLayer, tiltedNamesOpacity } from '../../render/live/textLayer';
import type { LiveCityEnv, LiveLayer } from '../../render/live/contract';
import type { CanvasRenderer } from '../../render/canvas';
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import type { View } from '../../render/view';
import { clampPitch, createCameraPose, groundHit, isFreeEye, isTilted, pixelRay, poseCamera, riseAt } from '../../render/world/camera';
import { createWorldBuildingsLayer, type WorldBuildingsLayer } from '../../render/world/buildingsLayer';
import type { Terrain3dCollisions } from '../../render/world/terrain3dCollisions';
import type { Building3dVisual } from '../../render/urbanBuildingGeometry';
import { TerrainHeights } from '../../render/world/heights';
import { cavernField, cavernSectionHeights, cavernTexelAt, underdarkCavernOf } from '../../render/underdarkCavern';
import { createWorldTreesLayer, type WorldTreesLayer } from '../../render/world/treesLayer';
import { createWorldBankPlantsLayer } from '../../render/world/bankPlantsLayer';
import { createWorldCaveLayer } from '../../render/world/caveLayer';
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
import { type CaveSection, WorldVolumes } from './worldVolumes';
import { machineDecision, reportMachineCompositor } from '../machineTier';
import { volumeTownBuildings } from '../../render/cityDrawOptions';

/** Why the composed view waits (`blocked`): the ground layer has no tile yet. Its baking goes on while it waits. */
export const GROUND_WARMING = 'ground warming';
/** What a CSS pixel of the map shows: the point (map metres), in a tilted view the building volume in front of the
 * ground, and the metres a CSS pixel spans at the depth of what it shows (1 / scale in the top view). */
export interface MapPick {
  x: number;
  y: number;
  building?: Building3dVisual;
  metresPerPixel: number;
}
/** Exact layer canvases stacked above the compositor's: hidden until their exact paint is complete. */
const EXACT_LAYER_CSS = 'position:absolute;left:0;top:0;visibility:hidden';
/** The furniture canvas of a moving view (frame, cartouche, legend, scale bar) is redrawn at most this often. */
const FURNITURE_MS = 100;
/** Placeholder view of a stand-in that is being cleared. */
const WHOLE_VIEW: View = { cx: 0, cy: 0, scale: 1 };
/** The slice of work a live layer that is not its picture at rest yet gets in a frame of the view at rest. */
const REST_SLICE_MS = 2;
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
 *   due      : not made for this view yet (the view moves, or has just arrived);
 *   live     : the compositor's layers are the picture; nothing else is painted;
 *   awaiting : as `live`, but a live layer (`awaited`) is still preparing its picture at rest for this view;
 *   painting : the exact renderers are painting the layers from `exactFrom` up, in steps;
 *   exact    : those exact canvases are complete and shown.
 */
type RestPicture = 'due' | 'live' | 'awaiting' | 'painting' | 'exact';

export class ComposedView {
  private live?: LiveCompositor;
  /** No WebGL2, a software renderer or a layer factory that threw: `blocked` for good. */
  private refused = false;
  /** The objects the live layers were made from: a new terrain renderer, cartography or city map gets new layers. */
  private owners: { gpu?: TerrainRenderer; terrain?: TerrainData; cartography?: CanvasRenderer; city?: NativeCityMap; text?: boolean; volumes?: boolean; /** The ground layer had a renderer to bake from. */ ground?: boolean } = {};
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
  /** The lowest layer below `exactFrom` whose live layer is still preparing its picture at rest (undefined: none). */
  private awaited?: ExactLayer;
  /** The lowest layer whose exact canvas is on screen; the canvases above it are too, and the compositor draws none of them. */
  private shownFrom?: ExactLayer;
  /** The exact town paint of the picture at rest is incomplete. */
  private townPending = false;
  /** `MapState.paintRevision` the picture at rest was made for. */
  private paintedRevision = -1;

  /** The relief of the terrain on display, for the camera and the draped ground; made again for another terrain or
   * vertical exaggeration. */
  private heights?: { terrain: TerrainData; roof: number | undefined; data: Float32Array; section?: CaveSection; relief: TerrainHeights };
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
  /** The town layer last handed to the compositor, which the next town map may adopt. */
  private liveCity?: LiveLayer;
  /** The town in volume and the trees of the tilted map, for the two volume layers. */
  private readonly volumes: WorldVolumes;
  /** The buildings layer on the compositor, for picking and the selection tint. */
  private buildings?: WorldBuildingsLayer;
  /** The volume id of the selected building (highlightBuilding), kept for a layer made later. */
  private highlighted?: string;
  private trees?: WorldTreesLayer;
  private volumeBuildings = false;
  private exactPlan = false;

  constructor(
    private readonly map: MapState,
    private readonly parts: DisplayParts,
    private readonly element: HTMLElement,
    private readonly motion: ViewMotion,
    private readonly readiness: DisplayReadiness,
  ) {
    const { water, town } = parts;
    this.cityEnv = { appearance: () => map.resolved!, visibility: () => town.shownLayers(), water: () => water.cityWater, volumeBuildings: () => this.volumeBuildings, volumeYards: () => this.volumes.yardsShown(), invalidate: map.compose };
    this.volumes = new WorldVolumes(
      map,
      parts,
      () => this.relief(),
      () => this.volumeBuildings,
      () => this.caveSection(),
    );
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

  /** The relief the camera stands on and the ground is draped over; undefined without a terrain. */
  relief(): TerrainHeights | undefined {
    const terrain = this.map.native;
    if (!terrain) return undefined;
    const exaggeration = this.map.resolved?.city.exaggeration ?? 1;
    const underdark = this.map.world?.options.biome === 'underdark',
      grid = terrain.field ?? { n: terrain.resolution, data: terrain.height, cave: terrain.caveMask };
    // Underdark: the relief is the cave's section model, rock cut at the roof of its chamber (the appearance's roof).
    const roof = underdark && grid.cave ? underdarkCavernOf(this.map.resolved?.composition.recipe).roof : undefined;
    if (this.heights?.terrain !== terrain || this.heights.roof !== roof || this.heights.relief.exaggeration !== exaggeration) {
      // Another exaggeration keeps the section: only the roof clearance or the terrain cuts it again.
      const kept = this.heights?.terrain === terrain && this.heights.roof === roof ? this.heights : undefined,
        field = kept || roof === undefined ? undefined : cavernField({ x: 0, y: 0, width: terrain.width, n: grid.n, data: grid.data, cave: grid.cave }, roof),
        section = kept ? kept.section : field && { field, raw: new TerrainHeights(grid.data, grid.n, terrain.width, -Infinity, 1) },
        data = kept?.data ?? (field ? cavernSectionHeights(grid.data, field) : grid.data);
      // The sea covers what lies below its level; the Underdark is drawn down to its floors.
      // A coast traced from the field (v2/terrainProjection.ts) carries its shore detail in the mesh too.
      const shore = !underdark && !!terrain.field && !terrain.caveMask.length && !(terrain.field.floor > 0) && (this.map.world?.terrain.seaFraction ?? 0) > 0;
      const relief = new TerrainHeights(data, grid.n, terrain.width, underdark ? -Infinity : 0, exaggeration, shore);
      // The cave's rock is solid for a flyer: only it stops him (render/world/navigation.ts).
      if (section) relief.solidAt = (x, y) => cavernTexelAt(section.field, x, y, 0) > 0.5;
      this.heights = { terrain, roof, data, section, relief };
    }
    return this.heights.relief;
  }
  /** The section cut the relief of an Underdark map was made from, and its heights before the cut. */
  private caveSection(): CaveSection | undefined {
    return this.relief() ? this.heights?.section : undefined;
  }
  /** Collision geometry is published with the town scene, independently of visible mesh LOD. */
  walkCollisions(): Terrain3dCollisions | undefined {
    return this.map.exportLayers.city !== false ? this.volumes.walkCollisions : undefined;
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
    if (ground.fantasy || isFantasyStyle(r.ground.style)) return 'illustrated ground';
    // The GPU terrain renderer, or the CPU raster of a look without relief (GroundProducts.groundTiles).
    if (!ground.groundTiles()) return 'CPU ground';
    const live = (this.live ??= createLiveCompositor({
      invalidate: map.compose,
      quality: getDisplayQuality,
      relief: () => this.relief(),
      mapSize: () => map.world?.mapSize ?? 0,
      restPending: () => this.motion.restOwed || this.rest === 'due' || this.rest === 'painting' || !!this.awaited,
    }));
    if (!live) {
      this.refused = true;
      reportMachineCompositor(false);
      return 'no hardware WebGL2';
    }
    if (!live.active()) {
      return 'context lost';
    }
    try {
      this.syncLayers(live);
    } catch (error) {
      // A layer factory of another module threw: the map is not composed, rather than failing every frame.
      console.warn('Live compositor: layer setup failed, the map is not composed.', error);
      this.refused = true;
      reportMachineCompositor(false);
      map.stats.liveError = String(error);
      return 'layer setup failed';
    }
    reportMachineCompositor(true);
    if (this.volumeBuildings && !live.hasLayer('buildings')) return 'building meshes unavailable';
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
    // One ground layer per terrain and renderer: the baked tiles of another terrain must never show under this one (a
    // stale tile is only a fair stand-in for the same terrain in another look).
    if (owners.gpu !== ground.gpu || owners.terrain !== map.native) {
      owners.gpu = ground.gpu;
      owners.terrain = map.native;
      owners.ground = false;
      live.setLayer(
        'ground',
        createLiveGroundLayer(gl, {
          renderer: () => ground.groundTiles(),
          treeMaterials: () => !!this.volumes.trees.inputs(),
          treeSelection: frame => this.trees?.selection(frame),
          mapSize: () => map.world?.mapSize ?? 1,
          paper: () => map.groundPaper,
          terrain: () => this.relief(),
          cave: this.volumes.cave,
          night: this.volumes.trees.night,
          invalidate: map.compose,
        }),
      );
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
      this.buildings.highlight(this.highlighted);
      live.setLayer('trees', (this.trees = createWorldTreesLayer(gl, this.volumes.trees)));
      live.setLayer('banks', createWorldBankPlantsLayer(gl, this.volumes.trees));
      live.setLayer('cave', createWorldCaveLayer(gl, { cave: this.volumes.cave, terrain: () => this.relief(), invalidate: map.compose }));
    }
    if (owners.cartography !== cartography.renderer) {
      owners.cartography = cartography.renderer;
      live.setLayer('overlay', cartography.renderer?.createLiveLayer(gl));
      live.invalidateLayer('text');
    }
    const volumeBuildings = !!map.native && machineDecision().tier === 'capable' && volumeTownBuildings(map.resolved);
    map.volumeBuildings = volumeBuildings;
    // Another building tier (city volumes or flat buildings) is a look of the same town: the town layer keeps its meshes
    // and draws the other tier (townLayer.ts planOnly); only other towns make a new layer.
    const newTown = owners.city !== town.city;
    if (newTown || this.volumeBuildings !== volumeBuildings) {
      this.volumeBuildings = volumeBuildings;
      live.setStandIn('city', undefined, WHOLE_VIEW, 1, 1);
      this.shownFrom = undefined;
      this.rest = 'due';
      this.applyVisibility();
      owners.city = town.city;
      if (newTown) {
        // A local edit: the new map adopts the layer of the previous one (the same object), which keeps its GPU data
        // and draws the previous towns until the edited scene is uploaded.
        const layer = town.city?.createLiveLayer(gl, this.cityEnv, this.liveCity);
        if (layer && layer === this.liveCity) live.invalidateLayer('city');
        else live.setLayer('city', layer);
        this.liveCity = layer;
      }
      else live.invalidateLayer('city');
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
    // Another map style: the old look leaves the screen as soon as the coarsest tiles of the new one are baked (the
    // first thing baked), and nothing of it is ever drawn with the new one.
    if (before.resolved && before.resolved.styleId !== r.styleId) live.lookChanged();
    // The terrain pass takes the renderer away while it runs (gpuActive), and the ground layer's work stops without
    // one: its tiles are marked stale (they keep showing until re-baked) and the work loop starts again.
    if (ran.includes('terrainData')) live.invalidateLayer('ground');
    // The semantic hook of the overlay (contours, rural semantics, water cut) and the town hooks (urban semantics,
    // rivers) are the display's own state. The town layer follows its look itself (townLayer.ts lookNow).
    if (ran.some(name => name === 'cartography' || name === 'overlays' || name === 'semantic' || name === 'water' || name === 'frame')) live.invalidateLayer('overlay');
    if (ran.some(name => name === 'city' || name === 'semantic' || name === 'water')) live.invalidateLayer('city');
  }
  /** The display quality or the vector engine changed: what the overlay and the names retain is stale. The live town
   * reads neither, and keeps its tables (its look follows the appearance, townLayer.ts lookNow). */
  invalidateLayers(): void {
    for (const name of ['overlay', 'text'] as const) this.live?.invalidateLayer(name);
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
    this.map.volumeBuildings = false;
    if (!this.onPage) return;
    this.onPage = false;
    this.parts.water.tilted = false;
    this.live?.canvas.remove();
    this.overlayOnPage?.remove();
    this.overlayOnPage = undefined;
    this.parts.cartography.overlay.style.cssText = '';
    for (const canvas of [this.cityCanvas, this.textCanvas, this.furnitureCanvas]) {
      canvas.remove();
      canvas.width = canvas.height = 0;
    }
    this.shownFrom = this.exactFrom = this.awaited = undefined;
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
    this.live?.setPaused(this.map.preparing || !(this.onPage || this.warming));
  }
  private applyVisibility(): void {
    if (this.overlayOnPage) this.overlayOnPage.style.visibility = !this.volumeBuildings && atOrAbove('overlay', this.shownFrom) ? 'visible' : 'hidden';
    this.cityCanvas.style.visibility = !this.volumeBuildings && atOrAbove('city', this.shownFrom) ? 'visible' : 'hidden';
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
    this.parts.water.tilted = isTilted(view);
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
    if (this.rest === 'due' || this.rest === 'painting' || this.awaited || this.paintedRevision !== map.paintRevision) this.restFrame(live, view, w, h, dpr, now);
    else this.composeFrame(live, view, w, h, dpr, false, now);
  }
  private viewRested = (): void => {
    if (!this.map.disposed && this.map.world) this.map.repaint();
  };
  /** One frame of a tilted camera: the compositor alone, whose terrain shows the water, the overlay and the town
   * plan draped on the relief, with the names standing on it while it rises. The exact canvases are pictures of the top view: none
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
    // The picture at rest of the top view is not owed here: a layer awaited for it, or an exact paint under way, would
    // keep the page's pending work above 0 for as long as the view stays tilted, and the readiness loop (settled)
    // would ask for a frame at every animation frame.
    this.exactFrom = this.awaited = undefined;
    this.townPending = false;
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
    // A tilted view at rest is presented by this frame: the readiness marks of the request (visible-complete ends the
    // page's wait for the display) are given here as the top view's picture at rest gives them.
    if (!moving) this.readiness.notePresented();
  }
  /** The names of a tilted view at rest: the placement of the top view of its centre and scale (the names then keep
   * the sizes and the spacing of the map the camera tilts from), over a wider square. Placing for the perspective
   * itself would need the collisions of the projected names; the text layer fades the far ones instead. Placed once
   * per view and content; while the view moves, the names of the last placement follow the terrain. */
  private placeTiltedNames(view: View, w: number, h: number): void {
    // Names the text layer does not show are not placed.
    if (tiltedNamesOpacity(isFreeEye(view) ? 1 : riseAt(clampPitch(view.pitch))) <= 0) {
      this.tiltedNames.revision = -1;
      reportDrawnLabels([]);
      return;
    }
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
    // while it is tilted (another raster would bake every tile of the map drape again). That raster has metres per pixel:
    // at rest the raster of the view, the one of the top view it tilts from, goes over it on the tiles it covers.
    const size = map.world!.mapSize,
      vectors = tilted ? water.vectorRaster({ cx: size / 2, cy: size / 2, scale: DRAPED_WATER_PIXELS / size }, DRAPED_WATER_PIXELS, DRAPED_WATER_PIXELS, 1, false) : water.vectorRaster(view, w, h, dpr, !moving);
    live.setWater(vectors?.image, vectors?.region);
    if (!tilted) live.setWaterDetail(undefined);
    else if (!moving) {
      const detail = water.drapedDetail(view, w, h, dpr);
      live.setWaterDetail(detail?.image, detail?.region, water.vectorDue);
    }
    live.setPaper(map.groundPaper);
    const exactOverlay = atOrAbove('overlay', this.shownFrom),
      exactCity = atOrAbove('city', this.shownFrom) && (!this.volumeBuildings || this.exactPlan);
    live.setLayerShown('overlay', this.volumeBuildings || !exactOverlay, this.volumeBuildings && exactOverlay);
    live.setLayerShown('text', !atOrAbove('text', this.shownFrom));
    live.setLayerShown('city', (this.volumeBuildings || !exactCity) && (map.exportLayers.city !== false || map.exportLayers.streets !== false), this.volumeBuildings && exactCity);
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
    const { exact: exactFrom, awaited } = this.restPlan(live, view, w, h, ratio, cityOn);
    this.exactFrom = exactFrom;
    this.awaited = awaited;
    this.exactPlan = exactFrom === 'city' || exactFrom === 'overlay';
    if (this.volumeBuildings && exactFrom === 'overlay' && cityOn && live.hasLayer('city')) {
      const ready = live.layerReady('city', view, w, h, ratio);
      // Its plan stands for the exact one, but for the quarter outlines that only the Canvas town draws.
      if ((ready && !this.map.resolved?.city.layers.quarters) || live.layerPending('city')) {
        this.exactPlan = false;
        if (!ready) this.awaited ??= 'city';
      }
    }
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
        if (this.exactPlan) {
          const ctx = cleared(this.cityCanvas);
          // The ground is the compositor's canvas below: the town clears its own pixels over the rivers, and those
          // of the exact overlay canvas under it.
          if (cityOn) map.stats.city = town.draw(ctx, view, w, h, dpr, { planOnly: this.volumeBuildings, stepwise: { key: map.townContent, moving: false }, overlayBelow: exactFrom === 'overlay' ? cartography.overlay.getContext('2d') : null });
          t = noteExact('exact:city', t);
        }
        const names = cleared(this.textCanvas);
        renderer?.drawText(names, view, w, h);
        noteExact('exact:text', t);
      });
      this.townPending = this.exactPlan && cityOn && !!(map.stats.city as { pending?: boolean } | undefined)?.pending;
      overlayPending = exactFrom === 'overlay' && (StepwisePaint.pending(map) > 0 || (renderer?.lastStats().rasterPending ?? 0) > 0);
    }
    const complete = !!exactFrom && !this.townPending && !overlayPending;
    this.show(this.nextShown(exactFrom, complete, !!exactFrom && (live.layerReady(exactFrom, view, w, h, ratio) || live.hasStandIn(exactFrom))));
    // The complete exact rasters stand in for their layers at the next gesture.
    if (exactFrom) {
      if (exactFrom === 'overlay' && !overlayPending) live.setStandIn('overlay', cartography.overlay, view, w, h);
      if (this.exactPlan && !this.townPending) live.setStandIn('city', cityOn && town.city ? this.cityCanvas : undefined, view, w, h);
      live.setStandIn('text', renderer ? this.textCanvas : undefined, view, w, h);
    }
    this.composeFrame(live, view, w, h, dpr, false, now, true);
    this.rest = exactFrom ? (complete ? 'exact' : 'painting') : awaited ? 'awaiting' : 'live';
    liveStats().rest = { picture: this.rest, exactFrom, awaited };
    noteLiveUnit('rest', started);
    this.readiness.notePresented();
  }
  /** Of the overlay, the town and the names: the lowest whose live layer is not its picture at rest for this view and
   * cannot become it (`exact`), and below it the lowest whose live layer is still preparing it (`awaited`). */
  private restPlan(live: LiveCompositor, view: View, w: number, h: number, ratio: number, cityOn: boolean): { exact?: ExactLayer; awaited?: ExactLayer } {
    const { cartography, town } = this.parts;
    let awaited: ExactLayer | undefined;
    for (const layer of EXACT_LAYERS) {
      // Without a cartography there is no overlay and no name to paint; a hidden town has nothing to paint either.
      if (layer === 'city' ? !cityOn || !town.city : !cartography.renderer) continue;
      if (live.restExact(layer, view, w, h, ratio)) continue;
      // The live layer holds another region, mesh tier or placement (it keeps following the map meanwhile): it gets
      // a slice of work now, and the layer is painted exact only once it has nothing left to do and still cannot
      // show its picture at rest.
      if (live.advanceLayer(layer, REST_SLICE_MS)) awaited ??= layer;
      else if (!live.restExact(layer, view, w, h, ratio)) return { exact: layer, awaited };
    }
    return { awaited };
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

  /** What lies under the CSS pixel (sx, sy) of a tilted view: the building volume in front of the ground there (with
   * the point where the ray meets its box), else the ground point. Every volume stops the ray, a town building or not:
   * a click on a farm roof never selects the ground behind it. Undefined when the pixel shows neither (the sky). CPU
   * only, for a click. */
  pick(view: View, w: number, h: number, sx: number, sy: number): MapPick | undefined {
    const relief = this.relief(),
      pose = poseCamera(createCameraPose(), view, h, relief),
      point: [number, number] = [0, 0],
      ground = groundHit(pose, sx, sy, w, h, relief, point);
    const ray = new Float64Array(3);
    pixelRay(pose, sx, sy, w, h, ray);
    const hit = this.map.exportLayers.city !== false ? this.buildings?.pick(pose.eye, ray, pose.rise, ground, () => true) : undefined;
    // `t` is the depth along the view axis (pixelRay): a CSS pixel there spans t / focal metres across the view.
    if (hit) return { x: pose.eye[0] + ray[0] * hit.t, y: pose.eye[1] + ray[1] * hit.t, building: hit.building, metresPerPixel: hit.t / pose.focal };
    return ground < Infinity ? { x: point[0], y: point[1], metresPerPixel: ground / pose.focal } : undefined;
  }
  /** Tints the volume of the selected building (its volume id; undefined: none). */
  highlightBuilding(id: string | undefined): void {
    this.highlighted = id;
    this.buildings?.highlight(id);
  }
  /** The tilted view as a picture, the compositor's frame at `dpr` (LiveCompositor.capture). */
  capture(view: View, w: number, h: number, dpr: number, out: HTMLCanvasElement): boolean {
    return !!this.live?.active() && this.live.capture(view, w, h, Math.min(2, dpr), out);
  }

  // --- pending work, style switch, disposal --------------------------------------------------------------------------

  /** Pending work that only concerns the view on screen: the picture at rest, a live layer preparing it, the town paint. */
  pendingViewOnly(): number {
    const visibleVolumes = !!this.volumeBuildings && this.map.exportLayers.city !== false;
    const volumes = this.tilted || visibleVolumes ? Number(this.volumes.pending()) + Number(!!this.live?.layerPending('buildings')) + Number(visibleVolumes && !this.buildings?.presented()) : 0;
    const forest = !!(this.tilted && this.live?.active() && this.trees?.pendingPresentation());
    // A completed paint job still owes its final presentation frame. Tilted and fallback frames do not use `rest`.
    const picture = !this.tilted && this.live?.active() && (this.rest === 'due' || this.rest === 'painting');
    return Number(this.motion.restOwed) + Number(!!this.awaited) + Number(this.townPending) + Number(!!picture) + volumes + Number(forest);
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
    if (!this.volumeBuildings && atOrAbove('overlay', this.shownFrom) && this.overlayOnPage) sources.push(this.overlayOnPage);
    if (!this.volumeBuildings && atOrAbove('city', this.shownFrom)) sources.push(this.cityCanvas);
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
    this.trees = undefined;
  }
}
