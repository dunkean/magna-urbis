/**
 * The cartography of the map: the overlay renderer (render/canvas.ts: roads, land use, vegetation symbols, names,
 * legend and cartouche) with its canvas, the semantic land-use state it paints through a hook, and the whole-map
 * overlay rasters of an export with explicit layers.
 *
 * Holds the cartography, overlays and semantic passes of `set()`. A renderer whose configuration is unchanged is
 * updated in place (dirty regions); the renderers of other looks are kept dormant in a byte-bounded store, so that a
 * switch back to a look finds its tiles.
 */
import { rasterizeSvg as imageOf } from '../../render/svgRaster';
import { RetainedBudget } from '../../render/retainedBudget';
import { getLanguage } from '../i18n';
import { getDistanceUnit } from '../units';
import { cityOverlayLandKinds, cityOverlayLandKey, cityCountrysideCanvasOptions, cityOverlayPlanMarks } from '../../render/cityEnvironment';
import { displayQualityFor } from '../../render/displayQuality';
import type { World, LandKind } from '../../gen/types';
import type { City3dPhysicalGround as PhysicalGround } from '../../ui/city3d';
import { createCanvasRenderer, type CanvasRenderer } from '../../render/canvas';
import { roadGroundTones } from '../../render/roadStyle';
import { displayWorld } from '../../render/displayWorld';
import { buildingOccupationShapes } from '../../ui/forestOccupation';
import { nativeCitiesOf } from '../nativeProducts';
import { activityScene } from '../activitySites';
import { mapSeasonKey } from '../../render/seasonPalette';
import { biomePalette } from '../../render/biomes';
import { renderSvg } from '../../render/svg';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import { settlementRaster, type SettlementRaster } from '../../../../rust/bridge/settlements';
import { v1LandCanvas } from '../../render/v1Landscape';
import { punchWoods } from '../../render/treeSymbols';
import { riverSegments } from '../../ui/vectorWaterRender';
import { hydrologySegments, hydrologyWaterColour } from '../../../../rust/bridge/hydrologyRender';
import { passKeys } from '../passes/pass';
import { buildScene, type SceneMask, type Scene } from '../../render/scene';
import { drawRuralSemantic, ruralSemanticLegend, urbanSemanticLegend } from '../../render/semanticLayer';
import { contourDrawOf } from '../../render/composition';
import { hasRetainedInk } from '../../render/cartography/mapRecording';
import type { SemanticLegendEntry } from '../../render/legend';
import { sceneDirty, worldDirty, changedShapes, shapeKey, mergeRects } from '../../render/sceneDiff';
import type { Rect } from '../../render/tileindex';
import { seedSubset } from '../../../../rust/bridge/generationSeed';
import { cityRegionalNetwork } from '../../render/cityBridges';
import type { View } from '../../render/view';
import type { Cartography, DisplayParts, SemanticState, WorldBox } from './contract';
import type { MapState } from './mapState';
import { paintedBrushes } from './paintedBrushes';

/** Pixel width of the whole-map renderSvg overlay of exports. */
const EXPORT_OVERLAY_PX = 4096;
/** The overlay decorations (tree marks, brushes) follow the map, not a town's own variations: rerolling a town must not reshuffle every wood. */
const displaySeed = (seed: string): string => seedSubset(seed, key => !key.startsWith('city/'));
/** Building footprints and activity yards: the woods clear around them (the cartography buildingClearings hook). */
const clearingBuildings = (world: World) => [...nativeCitiesOf(world).flatMap(city => city.scene?.buildings ?? []), ...(activityScene(world)?.buildings ?? [])];
/** Reach of the overlay products derived from a changed shape (forest wash fringe 140 m, lone trees 120 m, clearings, sprites). */
const DERIVED_REACH = 220;
type CartographyProduct = { renderer: CanvasRenderer; overlay: HTMLCanvasElement; state: { config: string; scene: Scene; world: World }; physical?: PhysicalGround };

export class CartographyProducts implements Cartography {
  renderer?: CanvasRenderer;
  /** The canvas the overlay renderer draws into; swapped when the renderer of another look comes back from the store. */
  overlay = document.createElement('canvas');
  private cartographyKey = '';
  private physical?: PhysicalGround;
  /** Dormant renderers of other looks. */
  private retained = new RetainedBudget();
  private landRaster?: { terrain: TerrainData; raster: SettlementRaster };
  /** For the renderer's semantic hook (render/cartography/contract.ts `arrivals`, `provisional`): the water rasters
   * (view, whole map) last seen and how many have arrived, the draws made without a product still being made. */
  private semanticWaterView?: object;
  private semanticWaterBase?: object;
  private semanticWaterViews = 0;
  private provisionalDraws = 0;

  constructor(
    private readonly map: MapState,
    private readonly parts: Pick<DisplayParts, 'ground' | 'water' | 'contours' | 'town'>,
  ) {}

  paintOverlay(view: View, pixelW: number, pixelH: number, stepwise: boolean): HTMLCanvasElement | undefined {
    if (!this.renderer) return undefined;
    if (this.overlay.width !== pixelW) this.overlay.width = pixelW;
    if (this.overlay.height !== pixelH) this.overlay.height = pixelH;
    this.renderer.draw(view, { stepwise });
    return this.overlay;
  }

  /** renderSvg overlay of an export (explicit layers), whole map at EXPORT_OVERLAY_PX: used only where it is not stretched. */
  exportOverlay?: HTMLCanvasElement;
  /** Physical land use of an export when a rural semantic look is on: drawn under the semantics, the rest of the overlay above. */
  exportGround?: HTMLCanvasElement;
  /** The parchment tints multiply over the lit ground: the overlay gets it as a backdrop, transparent on the water below. */
  private landBackdrop(): HTMLCanvasElement | null {
    const t = this.map.native,
      r = this.map.resolved!;
    if (!t || r.composition.variant !== 'parchment' || !r.ground.layers.relief) return null;
    if (this.landRaster?.terrain !== t) this.landRaster = { terrain: t, raster: settlementRaster(t) };
    // Every course cuts the backdrop, dry beds included: their symbols are drawn in the vector water below.
    const water = { ...this.parts.water.waterDisplay(), season: undefined },
      rivers = !r.composition.networks.water.visible ? undefined : t.water ? riverSegments(t.water, water) : t.hydrology ? hydrologySegments(t.hydrology, hydrologyWaterColour(r.ground.style, r.palette.colors)) : undefined;
    const land = (this.land = v1LandCanvas(this.landRaster.raster, 'parchment', this.map.world!.options.biome, rivers));
    // Woods painted by the ground (render/treeSymbols.ts): the ground draws this land under them, the overlay keeps it
    // only around them, so they show through (its tints are still masked by the whole land: `land`).
    const ground = this.parts.ground;
    if (!this.woodsOnGround) {
      ground.gpu?.setLandBackdrop(undefined);
      return land;
    }
    ground.gpu!.setLandBackdrop(land);
    return punchWoods(land, this.map.world!.landuse?.areas ?? [], this.map.world!.mapSize);
  }
  /** The GPU ground paints the woods of a parchment look (render/treeSymbols.ts): the overlay leaves them out. Set when
   * the overlay renderer is made, after the ground passes. */
  private woodsOnGround = false;
  /** The whole lit land of the last backdrop (the overlay's tint mask). */
  private land?: HTMLCanvasElement;
  private shownWorld(): World {
    const world = this.map.world!,
      layers = this.map.exportLayers,
      r = this.map.resolved!;
    // Native city plans and houses are drawn exactly once by CityBench. Natural vegetation, regional roads and names still use the original map renderer.
    const hideUrban = this.map.scene!.capabilities.nativeCities || layers.city === false;
    let shown = displayWorld(world, { roads: layers.roads, city: hideUrban ? false : undefined }, r.city.visible);
    const seed = displaySeed(world.seed);
    // Around native towns the regional roads and decks are owned as in 3D: the town draws its approaches and decks.
    const layouts = this.map.scene!.capabilities.nativeCities ? nativeCitiesOf(world).flatMap(city => city.layouts ?? []) : [];
    if (layouts.length) shown = { ...shown, ...cityRegionalNetwork(shown.roads, shown.bridges, layouts) };
    return shown.seed === seed ? shown : { ...shown, seed };
  }
  /** Land classes the vector overlay paints. A material ground draws the physical land use in its shader, so the overlay keeps only the vegetation symbols asked for. */
  private overlayLandKinds(): true | ((kind: LandKind) => boolean) {
    return cityOverlayLandKinds(this.map.resolved!);
  }
  /** Overlay renderer (names, roads, land use, painted/vegetation symbols); the natural layers it does not own are masked, not faked. */
  async cartographyPass(): Promise<void> {
    const world = this.map.world!,
      r = this.map.resolved!,
      layers = this.map.exportLayers,
      scene = this.map.scene!;
    const productKey = JSON.stringify([passKeys(this.map.input()).cartography, mapSeasonKey(), getLanguage(), getDistanceUnit(), scene.revisions.cities]);
    // Before the dispose: 3D tiles may paint through the current renderer during this wait.
    const brushes = r.cartography.painted ? ((await paintedBrushes()) ?? undefined) : undefined;
    const shown = this.shownWorld();
    const landuse = layers.landuse !== false && r.cartography.landuse;
    // The physical land use keeps its own vegetation drawing only where the composition asks for it on the vector overlay; the semantic layer is separate (hook below).
    const cartographic = r.composition.vegetation.cartographic;
    const mask: SceneMask = { water: false, contours: false, landuse: !landuse ? false : this.overlayLandKinds() };
    const v = scene.revisions,
      sceneKey = JSON.stringify(['scene', mapSeasonKey(), cityOverlayLandKey(r), v.roads, v.landuse, v.settlements, v.terrain, v.cities, layers.roads, layers.city, r.city.visible, landuse, cartographic, world.mapSize, shown.seed, world.options.biome]);
    const built = this.map.shared.cache.get(sceneKey, () => buildScene(shown, undefined, { mask }));
    // Same overlay configuration on the same map (a town build or edit): keep the renderer and its tiles, repaint only the changed areas.
    const config = JSON.stringify([
      r.keys.cartography,
      v.terrain,
      mapSeasonKey(),
      cityOverlayLandKey(r),
      landuse,
      cartographic,
      !!brushes,
      r.palette.colors,
      r.vegetation.symbols,
      r.composition.networks.roads.look,
      layers.decor,
      layers.roads,
      layers.city,
      layers.landuse,
      layers.labels,
      layers.streets,
      layers.background,
      layers.terrain,
      layers.water,
      r.city.visible,
      shown.seed,
      world.mapSize,
      world.options.biome,
    ]);
    if (this.cartographyKey !== productKey && this.cartographyState?.config !== config) {
      const hit = this.retained.take<CartographyProduct>('product:' + productKey);
      // Move the requested product out first: storing the outgoing style must not
      // evict the very entry this switch is about to use.
      this.storeCartography();
      this.cartographyKey = productKey;
      if (hit) {
        this.renderer = hit.renderer;
        this.overlay = hit.overlay;
        this.cartographyState = hit.state;
        this.physical = hit.physical;
        this.map.stats.cartographyUpdate = 'retained';
        this.map.passes.reset('overlays');
        return;
      }
      this.overlay = document.createElement('canvas');
    }
    this.cartographyKey = productKey;
    const previous = this.cartographyState;
    if (this.renderer && previous && previous.config === config && previous.scene !== built) {
      const started = performance.now();
      const dirty = sceneDirty(previous.scene, built);
      if (dirty) {
        const extra: Rect[] = worldDirty(previous.world, shown, 300);
        changedShapes(
          clearingBuildings(previous.world),
          clearingBuildings(shown),
          b => `${b.id}|${shapeKey(b.footprint[0]?.outer ?? [])}`,
          b => b.footprint[0]?.outer ?? [],
          extra,
        );
        const rects = mergeRects([...dirty, ...extra].map(d => ({ minX: d.minX - DERIVED_REACH, minY: d.minY - DERIVED_REACH, maxX: d.maxX + DERIVED_REACH, maxY: d.maxY + DERIVED_REACH })));
        const next: Scene = { ...built, dirty: rects };
        if (this.renderer.update(shown, next)) {
          this.cartographyState = { config, scene: built, world: shown };
          if (this.physical) this.physical.key = productKey;
          this.map.stats.cartographyUpdate = { dirty: rects.length, area: Math.round((rects.reduce((sum, d) => sum + (d.maxX - d.minX) * (d.maxY - d.minY), 0) / (world.mapSize * world.mapSize)) * 1000) / 10, ms: Math.round(performance.now() - started) };
          performance.measure('v2:cartography-dirty', { start: started });
          this.map.passes.reset('overlays');
          return;
        }
      }
    }
    this.renderer?.dispose();
    this.map.stats.cartographyUpdate = 'rebuilt';
    const map = this.map;
    const palette = { ...biomePalette(r.palette.mapStyle, world.options.biome), frameKind: 'none' as const, ...(layers.decor === false ? { grid: null } : {}) };
    const semanticLook = (): string =>
      `${this.semantic?.key ?? ''}|c${this.parts.contours.contourLook()?.landform ?? ''}:${JSON.stringify(contourDrawOf(this.map.resolved?.composition.recipe))}|w${this.parts.water.waterAboveLand() ? JSON.stringify([this.map.resolved!.keys.water, mapSeasonKey()]) : ''}|v${this.map.volumeBuildings ? 1 : 0}`;
    this.woodsOnGround = this.parts.ground.gpuActive && !!this.parts.ground.treeSymbols();
    this.renderer = createCanvasRenderer(this.overlay, shown, palette, {
      colors: r.palette.colors,
      separateText: true,
      textSources: () => this.parts.town.city?.scenes(),
      ...cityCountrysideCanvasOptions(r, world.mapSize),
      buildingClearings: () => buildingOccupationShapes({ buildings: clearingBuildings(this.map.world!) } as never)?.map(shape => shape.outer) ?? [],
      volumeBuildings: () => this.map.volumeBuildings,
      transparentBackground: true,
      groundCaverns: () => this.parts.ground.gpuActive && this.map.resolved?.ground.traits.family === 'material',
      terrain: () => this.landBackdrop(),
      scene: built,
      mask,
      urbanPlan: () => !!this.map.resolved && cityOverlayPlanMarks(this.map.resolved),
      roadLook: r.composition.networks.roads.look,
      roadStyle: () => {
        const c = this.map.resolved!.composition;
        return { look: c.networks.roads.look, emphasis: c.networks.roads.emphasis, night: c.ambience === 'night', colors: this.map.resolved!.palette.colors };
      },
      // Read per frame: a new look repaints the raster tiles through `key`, never the cartography pass.
      semantic: {
        createInk: gl => this.parts.contours.createLiveInk(gl),
        key: () => `${semanticLook()}|${this.parts.contours.revision}|${this.parts.water.waterAboveLand() ? JSON.stringify(this.parts.water.vectorView?.region) : ''}`,
        look: semanticLook,
        arrivals: () => {
          const water = this.parts.water;
          // Tilted, the cut is the whole-map raster's (WaterProducts.cutWater): a raster of a top view is no arrival.
          if (water.waterAboveLand() && ((!water.tilted && water.vectorView !== this.semanticWaterView) || water.vectorBase !== this.semanticWaterBase)) {
            if (!water.tilted) this.semanticWaterView = water.vectorView;
            this.semanticWaterBase = water.vectorBase;
            this.semanticWaterViews++;
          }
          return this.parts.contours.revision + this.semanticWaterViews;
        },
        provisional: () => this.provisionalDraws,
        draw: (ctx, rect, mpp, quality) => {
          this.paintRural(ctx, rect, mpp, quality === 'light');
          this.parts.water.cutWater(ctx, rect);
          // Contour paths still in the worker, or a finer water mask on its way (cutWater used the whole-map raster, or
          // nothing, while the raster of the view is made): this draw is redone when they arrive. A mask that is final
          // for the view (the view's raster, or the whole-map one with no request in flight) does not move.
          const water = this.parts.water,
            view = water.vectorView?.region,
            covered = !!view && view.x <= rect.minX && view.y <= rect.minY && view.x + view.width >= rect.maxX && view.y + view.height >= rect.maxY;
          const coarser = water.tilted ? !water.vectorBase : !covered && (!water.vectorBase || water.vectorPending);
          if ((!hasRetainedInk(ctx) && this.parts.contours.pendingAt(mpp)) || (water.waterAboveLand() && !!water.vectors && coarser)) this.provisionalDraws++;
        },
        legend: () => this.semanticLegend(),
      },
      invalidate: () => this.map.invalidate(),
      brushes,
      vegetation: r.vegetation.symbols,
      groundTrees: () => this.woodsOnGround,
      land: () => (this.woodsOnGround ? this.land : undefined),
      get dpr() {
        return map.dpr;
      },
    });
    const renderer = this.renderer;
    this.cartographyState = { config, scene: built, world: shown };
    // The 3D drape tiles take the physical land use without the semantic hook: their contours are inked here, at the tile's scale.
    this.physical = {
      key: productKey,
      ready: (box, pixels) => this.parts.contours.contoursAt(pixels / (box.maxX - box.minX), box),
      preview: (target, box) => renderer.drawCachedMap(target, box),
      paint: (target, box, options, defer) => {
        // The 3D drape calls its interactive paint `live`: for the exact renderer it is the stepwise one.
        const stepwise = !!options?.live,
          ground = renderer.drawGround(target, box, options && { stepwise });
        return this.parts.contours.drapeContours(target, box, displayQualityFor(stepwise) === 'light', defer) || ground;
      },
    };
    this.map.passes.reset('overlays');
  }
  /** Overlay renderer inputs: a matching configuration reuses the renderer through a dirty-region update. */
  private cartographyState?: { config: string; scene: Scene; world: World };
  private storeCartography(): void {
    if (this.renderer && this.cartographyState) {
      const product: CartographyProduct = { renderer: this.renderer, overlay: this.overlay, state: this.cartographyState, physical: this.physical };
      product.renderer.suspendStepwise();
      this.retained.put('product:' + this.cartographyKey, product, product.renderer.retainedBytes() + product.overlay.width * product.overlay.height * 4, () => {
        product.renderer.dispose();
        product.overlay.width = product.overlay.height = 0;
      });
    }
    this.renderer = undefined;
    this.cartographyState = undefined;
    this.physical = undefined;
  }
  /** The physical land use of the overlay above (composition mask, painted brushes, path caches) for the 3D ground tiles: no second scene. */
  physicalGround(): PhysicalGround | undefined {
    return this.physical;
  }
  /** Labels, legend and cartouche on the overlay renderer; the explicit-layers export raster. */
  async overlaysPass(): Promise<void> {
    const r = this.map.resolved!,
      layers = this.map.exportLayers;
    this.renderer!.setOverlays({ text: r.composition.text, labels: layers.labels !== false && r.cartography.labels, legend: layers.decor !== false && r.cartography.legend, cartouche: layers.decor !== false && r.cartography.cartouche });
    this.exportOverlay = undefined;
    this.exportGround = undefined;
    if (Object.keys(layers).length === 0) return;
    const sources = r.cartography.painted ? (await import('../../render/assets/brushAssets')).BRUSH_SOURCES : undefined;
    this.semanticPass(true); // the legend reads the semantic state, which may not be computed yet at this point
    const landuseOn = layers.landuse !== false && r.cartography.landuse;
    // Rural semantics sit above the physical land use but below roads and labels: with a semantic look on, the land use is its own raster (exportGround) under the semantics.
    const split = landuseOn && this.semantic!.rural !== 'off';
    const common = {
      width: EXPORT_OVERLAY_PX,
      style: r.palette.mapStyle,
      colors: r.palette.colors,
      buildings: r.city.visible,
      contours: false,
      landuseKinds: (kinds => (kinds === true ? undefined : kinds))(this.overlayLandKinds()),
      text: r.composition.text,
      labels: false,
      brushes: sources,
      vegetation: r.vegetation.symbols,
      roadGround: roadGroundTones(r.ground.traits.family === 'material', biomePalette(r.palette.mapStyle, this.map.world!.options.biome)),
      roadLook: r.composition.networks.roads.look,
      roadEmphasis: r.composition.networks.roads.emphasis,
      roadNight: r.composition.ambience === 'night',
    };
    const rasterOf = async (svg: string) => {
      const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
      document.querySelectorAll('.layer-decor').forEach(frame => frame.remove());
      return imageOf(new XMLSerializer().serializeToString(document.documentElement));
    };
    this.exportGround = undefined;
    if (split)
      this.exportGround = await rasterOf(
        renderSvg(this.shownWorld(), { ...common, layers: { background: false, terrain: false, water: false, landuse: true, city: false, streets: false, roads: false, labels: false, decor: false }, landuse: true, legend: false, cartouche: false }),
      );
    this.exportOverlay = await rasterOf(
      renderSvg(this.shownWorld(), {
        ...common,
        layers: { ...layers, background: false, terrain: false, water: false, ...(split ? { landuse: false } : {}) },
        landuse: landuseOn && !split,
        legend: r.cartography.legend,
        cartouche: r.cartography.cartouche,
        semanticLegend: this.semanticLegend(),
      }),
    );
  }
  /** Semantic land use state: looks, opacity and classes. Painted per frame from the canonical polygons (cartography hook, export branch of ExactFrame.paint, city hook), so nothing else re-runs. */
  semantic?: SemanticState;
  semanticPass(inline = false): void | Promise<void> {
    const c = this.map.resolved!.composition.landuse,
      layers = this.map.exportLayers,
      shown = layers.landuse !== false,
      before = this.semantic;
    const rural = shown ? c.rural : 'off',
      urban = shown ? c.urban : 'off';
    this.semantic = {
      rural,
      urban,
      opacity: c.opacity,
      classes: c.classes,
      key: JSON.stringify([
        rural,
        urban,
        c.opacity,
        Object.entries(c.classes)
          .filter(([, on]) => !on)
          .map(([kind]) => kind),
      ]),
    };
    // The overlays pass runs before this one and its key ignores the semantic state, yet the exported legend embeds it:
    // redo it now when the state moved (the inline call from the overlays pass is already up to date).
    if (!inline && before && before.key !== this.semantic.key && this.renderer) return this.overlaysPass();
  }
  paintRural(ctx: CanvasRenderingContext2D, viewport: WorldBox, mpp: number, light = false): void {
    if (!hasRetainedInk(ctx)) this.parts.contours.paintContours(ctx, viewport, mpp, 1, light);
    const s = this.semantic;
    const lineView = this.map.resolved?.composition.variant === 'topographic';
    if (s && s.rural !== 'off') drawRuralSemantic(ctx, this.map.world?.landuse, { look: s.rural, opacity: s.opacity, mpp, viewport, classes: s.classes, patterns: !light && !lineView, fieldStrips: lineView });
  }
  private semanticLegend(): SemanticLegendEntry[] {
    const s = this.semantic;
    return s ? [...ruralSemanticLegend(this.map.world?.landuse, s.classes, s.rural), ...urbanSemanticLegend(this.parts.town.city?.scenes() ?? [], s.urban)] : [];
  }
  retainedBytes(): number {
    return this.retained.bytes;
  }
  dispose(): void {
    this.retained.clear();
    this.renderer?.dispose();
  }
}
