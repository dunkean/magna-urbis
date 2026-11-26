/**
 * The water of the map as the 2D display draws it: the textures of the GPU ground's own water, and the vector water
 * (ink styles, CPU grounds, hydrology diagnostics, the map frame of a hidden relief) kept as one world-coordinate SVG
 * body and rasterized for the whole map, then per view at the density of the frame.
 *
 * Holds the water and frame passes of `set()`. The views and the exact frames ask `vectorRaster` for the raster of
 * their view; the cartography cuts its land use with it (`cutWater`); the town keeps its ground off `cityWater`.
 */
import { rasterizeSvg as imageOf } from '../../render/svgRaster';
import { cityWaterCutsLand } from '../../render/cityEnvironment';
import { retainedDecorOf } from '../decorTerrain';
import { decorWaterSvg } from '../../ui/decorWater';
import { type View, viewRect } from '../../render/view';
import { setWhiteWater, WHITE_WATER_ENABLED } from '../../render/whiteWater';
import { vectorWhiteWater } from '../../render/whiteWaterCourses';
import { terrainStyle } from '../../render/terrainStyle';
import { moonlightSvg } from '../../render/materialLook';
import { displayTerrainSettings } from '../displayBiome';
import { drawnWaterKey } from '../../render/waterRegime';
import { riverSegments, vectorWaterSvg, vectorOverlaySvg, vectorOverlayPixels, type WaterDisplay, type VectorOverlay } from '../../ui/vectorWaterRender';
import { renderHydrology, hydrologySegments, hydrologyWaterColour } from '../../../../rust/bridge/hydrologyRender';
import type { HydrologyOverlay } from '../../../../rust/bridge/hydrology';
import { isFantasyStyle } from '../../../../rust/bridge/fantasyTerrain';
import { viewRasterFits, viewRasterRegion, type ViewRasterRegion } from '../../render/viewRaster';
import { isResourceDiagnostic } from '../../render/displayDiagnostics';
import { resourceOverlayBody } from '../resourceLayer';
import type { DisplayParts, VectorRaster, Water, WorldBox } from './contract';
import type { MapState } from './mapState';
import { svgOf, svgPartsOf, wholeMap } from './mapSvg';

export class WaterProducts implements Water {
  /** Vector water, hydrology (waterSvg) and frame (frameSvg): world-coordinate SVG bodies, rasterized per view (render/viewRaster). */
  private waterSvg = '';
  private frameSvg = '';
  vectors = '';
  /** The bodies changed since `vectors` was made from them. */
  private vectorsDirty = false;
  vectorBase?: VectorRaster;
  vectorView?: VectorRaster;
  private vectorRequest?: Promise<void>;
  /** The region of that request. */
  vectorDue?: ViewRasterRegion;

  constructor(
    private readonly map: MapState,
    private readonly parts: Pick<DisplayParts, 'ground'>,
  ) {}

  get vectorPending(): boolean {
    return !!this.vectorRequest;
  }

  waterDisplay(): WaterDisplay {
    const r = this.map.resolved!,
      t = this.map.native!,
      effective = displayTerrainSettings(this.map.settings!, this.map.world!.mapSize);
    return {
      style: r.ground.traits.fantasy && r.composition.networks.water.look === 'natural' ? 'render3d' : r.ground.style,
      colors: r.palette.colors,
      showLakes: r.ground.lakes,
      showOxbows: r.ground.oxbows,
      riverArea: t.water?.riverArea ?? 0.02,
      riverMode: effective.hydrology?.riverMode ?? 'vector',
      overlay: r.diagnostic.startsWith('v-') ? (r.diagnostic as VectorOverlay) : 'none',
      season: { zone: effective.climateZone, season: r.ground.season, calendar: r.ground.calendar },
    };
  }
  /** Drawn regime of the date the water was last drawn for (waterRegime.ts drawnWaterKey). */
  regime = '';
  /** GPU water/overlay textures, plus the vector water and hydrology diagnostics (rasterized per view). */
  async waterPass(): Promise<void> {
    performance.mark('mu:water-2d-requested');
    this.parts.ground.dropBackground();
    this.cityWater = undefined;
    const t = this.map.native!,
      r = this.map.resolved!,
      style = r.ground.style,
      colors = r.palette.colors,
      layers = this.map.layers(),
      water = this.waterDisplay();
    this.regime = water.season ? drawnWaterKey(water.season) : '';
    const ink = r.composition.networks.water.look === 'ink',
      visible = layers.water && r.composition.networks.water.visible;
    // The next frame that draws this water marks `mu:water-2d-shown` (ExactFrame.paint, ComposedView.composeFrame).
    this.waterShownDue = visible && !!(t.water || t.hydrology || retainedDecorOf(this.map.world!.terrain));
    const vectorDisplay = { ...water, style: ink ? r.palette.mapStyle : ('render3d' as const) };
    if (this.parts.ground.gpuActive) {
      if (t.water) {
        // The painted compositor (natural water) reads the seasonal regime from the segment colour.
        const material = !ink && water.overlay === 'none',
          mouthMix: number[] | undefined = material && r.ground.traits.satelliteVariant === 1 && !r.ground.traits.paperMap ? [] : undefined,
          rivers = visible ? riverSegments(t.water, { ...water, material, thread: true }, mouthMix) : undefined;
        // Only the colour pass sees dissolved sediment. Towns keep the physical banks.
        let painted = rivers;
        if (rivers && mouthMix?.length) {
          painted = new Float32Array(rivers.length + mouthMix.length);
          painted.set(rivers);
          painted.set(mouthMix, rivers.length);
        }
        this.parts.ground.gpu!.setWater(painted ? { lake: water.showLakes ? t.water.lakeField.values : undefined, n: t.water.hydro.n, rivers: painted, regime: material, estuaries: !!mouthMix?.length } : undefined);
        // Natural water only: ink styles draw their water as vectors in the overlay, which the town keeps.
        this.cityWater = rivers && !ink && !isFantasyStyle(style) ? rivers : undefined;
        this.parts.ground.gpu!.setOverlay(vectorOverlayPixels(t.water, water.overlay, t.conditioning?.delta ? { values: t.conditioning.delta, n: t.conditioning.n } : undefined));
      } else if (t.hydrology) {
        const rivers = visible ? hydrologySegments(t.hydrology, hydrologyWaterColour(style, colors)) : undefined;
        this.parts.ground.gpu!.setWater(rivers ? { lake: water.showLakes ? t.hydrology.waterField : undefined, shore: 'exact', n: t.hydrology.resolution, rivers } : undefined);
        this.cityWater = !ink && !isFantasyStyle(style) ? rivers : undefined;
        this.parts.ground.gpu!.setOverlay(undefined);
      } else this.parts.ground.gpu!.setWater(undefined);
    }
    // Rapids and falls of the satellite ground: vector foam marks over the GL rivers, built once per network (whiteWater.ts).
    const satellite = r.ground.traits.satelliteVariant === 1 && !r.ground.traits.paperMap && this.map.world!.options.biome !== 'underdark';
    setWhiteWater(WHITE_WATER_ENABLED && this.parts.ground.gpuActive && visible && !ink && satellite && water.overlay === 'none' && t.water ? vectorWhiteWater(t.water, water.riverArea, water.season) : undefined);
    const decor = retainedDecorOf(this.map.world!.terrain);
    let svg = decor && visible ? decorWaterSvg(decor, ink ? r.palette.mapStyle : 'render3d', water.showLakes, colors) : '';
    if (t.water && visible) {
      if (ink || !this.parts.ground.gpuActive || isFantasyStyle(style)) svg += vectorWaterSvg(t.water, vectorDisplay, !ink);
      if (!this.parts.ground.gpuActive && water.overlay !== 'none') svg += vectorOverlaySvg(t.water, water.overlay, t.conditioning?.delta ? { values: t.conditioning.delta, n: t.conditioning.n } : undefined);
    }
    if (t.hydrology) {
      const diagnostic = r.diagnostic !== 'none' && !r.diagnostic.startsWith('v-') && r.diagnostic !== 'elevation' && !isResourceDiagnostic(r.diagnostic) ? (r.diagnostic as HydrologyOverlay) : 'none';
      const hydrology = water.showLakes ? t.hydrology : { ...t.hydrology, lakeOffsets: t.hydrology.lakeOffsets.slice(0, 1), lakePoints: t.hydrology.lakePoints.slice(0, 0) };
      svg += renderHydrology(hydrology, diagnostic, (ink || !this.parts.ground.gpuActive) && visible, ink ? r.palette.mapStyle : 'render3d', true, colors);
    }
    if (isResourceDiagnostic(r.diagnostic)) {
      const resources = await resourceOverlayBody(this.map.world!, r, this.map.resourceSource);
      svg += resources.svg;
      if (resources.error) this.map.stats.resourcesError = resources.error;
      else delete this.map.stats.resourcesError;
    }
    this.waterSvg = svg;
    this.vectorsDirty = true;
  }
  /** The water pass of the current map produced water that no frame has drawn yet. */
  waterShownDue = false;
  noteWaterShown(): void {
    this.waterShownDue = false;
    performance.mark('mu:water-2d-shown');
  }
  /** The map frame when the relief (which draws its own) is hidden. */
  framePass(): void {
    const r = this.map.resolved!,
      t = this.map.native!,
      layers = this.map.layers();
    this.frameSvg = !layers.relief && layers.frame ? `<rect width="${t.width}" height="${t.width}" fill="none" stroke="${terrainStyle(r.ground.style, r.palette.colors).palette.frame}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>` : '';
    this.vectorsDirty = true;
    this.parts.ground.dropBackground();
  }
  /** The look of the ground changed: the night grading of the vector water follows it. */
  invalidateVectors(): void {
    this.vectorsDirty = true;
  }
  /** Starts the whole-map raster of the bodies when they changed; undefined when it is current. */
  refreshStaleVectors(): Promise<void> | undefined {
    return this.vectorsDirty ? this.refreshVectors() : undefined;
  }
  /** set() failed: the bodies of the failed passes are not rasterized. */
  rollback(): void {
    this.vectorsDirty = false;
  }
  private async refreshVectors(): Promise<void> {
    this.vectorsDirty = false;
    const r = this.map.resolved!,
      water = r.composition.ambience === 'night' && r.composition.networks.water.look === 'natural' ? moonlightSvg(this.waterSvg, 'v2-water-night') : this.waterSvg;
    const svg = water + this.frameSvg;
    if (svg === this.vectors) return;
    const whole = wholeMap(this.map.native!.width);
    this.vectors = svg;
    this.vectorView = undefined;
    this.vectorRequest = this.vectorDue = undefined;
    const image = svg ? await imageOf(svgOf(svg, whole)) : undefined;
    // A newer body was set while this one decoded (set() may start the raster before its last passes).
    if (this.vectors !== svg) return;
    this.vectorBase = image && { image, region: whole };
    if (image) performance.mark('mu:water-2d-raster');
  }
  /** Palettes whose ink water must read above the land-use tints (atlas, topographic). */
  waterAboveLand(): boolean {
    const r = this.map.resolved;
    return !!r && cityWaterCutsLand(r);
  }
  /**
   * The vector water raster lies under the overlay: erase the land use, contours and semantics above it (the parchment
   * backdrop does the same with `destination-in`), so rivers and lakes stay crisp in their palette blue. Roads and bridges come later.
   */
  tilted = false;
  cutWater(ctx: CanvasRenderingContext2D, rect: WorldBox): void {
    if (!this.waterAboveLand()) return;
    const covers = (v?: { region: ViewRasterRegion }): boolean => !!v && v.region.x <= rect.minX && v.region.y <= rect.minY && v.region.x + v.region.width >= rect.maxX && v.region.y + v.region.height >= rect.maxY;
    const mask = covers(this.vectorView) ? this.vectorView : this.vectorBase;
    if (!mask) return;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.drawImage(mask.image, mask.region.x, mask.region.y, mask.region.width, mask.region.height);
    ctx.restore();
  }
  /** The rivers of the GPU ground (the segments given to its water layer): the town plan keeps its ground and streets off them. */
  cityWater?: Float32Array;
  /** The vector raster for this frame: the view raster when it fits, else the whole-map one while a
   * view raster at the frame's density is prepared (the frame is redrawn when it is ready). `refine` false (a frame of
   * a moving view): the coarser raster is kept, the SVG rasterisation of a new region waits for the view at rest. */
  vectorRaster(view: View, w: number, h: number, dpr: number, refine = true): VectorRaster | undefined {
    if (!this.vectors) return undefined;
    const size = this.map.world!.mapSize,
      rect = viewRect(view, w, h),
      density = view.scale * dpr;
    if (viewRasterFits(this.vectorView?.region, rect, density, size)) return this.vectorView;
    if (viewRasterFits(this.vectorBase?.region, rect, density, size, Infinity)) return this.vectorBase;
    if (refine) void this.requestVectors(viewRasterRegion(rect, density, size));
    return this.vectorView && viewRasterFits({ ...this.vectorView.region, density }, rect, density, size) ? this.vectorView : this.vectorBase;
  }
  drapedDetail(view: View, w: number, h: number, dpr: number): VectorRaster | undefined {
    if (!this.vectors) return undefined;
    const size = this.map.world!.mapSize,
      rect = viewRect(view, w, h),
      density = view.scale * dpr;
    if (!viewRasterFits(this.vectorView?.region, rect, density, size) && !viewRasterFits(this.vectorBase?.region, rect, density, size, Infinity)) void this.requestVectors(viewRasterRegion(rect, density, size));
    return this.vectorView;
  }
  async vectorsReadyFor(view: View, w: number, h: number, dpr: number): Promise<void> {
    const size = this.map.world!.mapSize,
      rect = viewRect(view, w, h),
      density = view.scale * dpr;
    if (!this.vectors || viewRasterFits(this.vectorView?.region, rect, density, size) || viewRasterFits(this.vectorBase?.region, rect, density, size, Infinity)) return;
    await this.vectorRequest;
    await this.requestVectors(viewRasterRegion(rect, density, size));
  }
  /** UTF-8 of the vector SVG body, encoded once per body. */
  private vectorBytes?: { text: string; bytes: Uint8Array };
  private requestVectors(region: ViewRasterRegion): Promise<void> {
    if (this.vectorRequest) return this.vectorRequest;
    this.vectorDue = region;
    const vectors = this.vectors;
    if (this.vectorBytes?.text !== vectors) this.vectorBytes = { text: vectors, bytes: new TextEncoder().encode(vectors) };
    const request: Promise<void> = imageOf(svgPartsOf(this.vectorBytes.bytes, region))
      .then(
        image => {
          if (this.map.disposed || this.vectors !== vectors) return;
          this.vectorView = { image, region };
          performance.mark('mu:water-2d-view-raster');
          this.map.invalidate();
        },
        () => undefined,
      )
      .finally(() => {
        if (this.vectorRequest === request) this.vectorRequest = this.vectorDue = undefined;
      });
    return (this.vectorRequest = request);
  }
}
