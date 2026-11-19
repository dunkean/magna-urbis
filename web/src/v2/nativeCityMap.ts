/**
 * The exact town of the V2's 2D map: the towns of a world (plans, city volumes, native house plans, activity sites)
 * painted into a 2D context for one view. No generation.
 *
 * Who: the display (v2/display) for captures, exports, the fallback display and every frame at rest that the live
 * town layer does not cover; it also makes that live layer (`createLiveLayer`) from the same towns. The Canvas town
 * (render/city/canvas/town.ts) paints the frame; where the shared rule allows it (cityContract.cityGlBlockReason) the
 * GPU plan (render/cityGlView.ts) draws the plans and city volumes under a Canvas overlay (labels, glyphs,
 * diagnostics, native house plans). `draw` paints at once, or in its stepwise mode (render/city/canvas/stepwiseTown.ts).
 */
import { drawCityWaterways } from '../render/cityWaterways';
import { townWaterColour } from '../render/townWater';
import type { World } from '../gen/types';
import type { View } from '../render/view';
import type { ExportLayers } from '../render/exportLayers';
import { viewRect } from '../render/view';
import { buildCityBuildings, buildCityScene, cityGroundSubjects, drawCity, drawCitySteps, selectCityLod, type Box, type CityBuilding, type CityBuildings, type CityFrameStats, type CityLayers, type CityLod, type CityScene } from '../render/cityCanvas';
import { DEFAULT_LAYERS } from '../render/cityGlStyle';
import { CityGlComposite, cityGlDrawOptions, mergeCityBuildings, mergeCityBuildingsSteps, mergeCityPlans, mergeCityPlansSteps } from '../render/cityGlView';
import { cityCanopy } from '../render/cityGrove';
import type { CityGlFrame } from '../render/cityGl';
import { cityGlBlockReason, usesNativeHouseRenderer } from '../render/cityContract';
import { getRenderMode, onRenderMode, reportRenderStats } from '../render/renderMode';
import { UrbanBuildingLodRenderer, type BuildingRenderMetrics, type BuildingViewport } from '../render/urbanBuildingLod';
import { coverLayer, layerPattern, materialImagesNow, type MaterialImages } from '../render/buildingMaterials';
import type { UrbanBuildingAppearance } from '../render/urbanBuildingStyle';
import { cityBuildingAppearance, cityDrawOptions, finishCityFrame } from '../render/cityDrawOptions';
import type { HouseMaterial, Surface } from '../../../rust/bridge/housesContract';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import { nativeCitiesOf } from './nativeProducts';
import { cityGroundOf } from './rustUrban';
import { buildCityBuildingsParallel, clipCityGroundAhead, releaseCityBuildingWorkers } from '../render/cityBuildingsParallel';
import { cityGroundFor } from '../render/cityGround';
import { activityScene, activitySitesOf, drawInstallations } from './activitySites';
import type { LiveCityEnv, LiveLayer } from '../render/live/contract';
import { createLiveCityLayer } from '../render/live/cityLayer';
import { createStepwiseTown, type NativeCityStepwise } from '../render/city/canvas/stepwiseTown';
import { countWork } from '../render/workCount';

export interface NativeCityMapStats {
  native: boolean;
  cities: number;
  layouts: number;
  buildings: number;
  visibleBuildings: number;
  lod?: CityLod;
  renderer: 'canvas2d' | 'webgl2';
  /** Why Canvas 2D drew the plan (null: WebGL2 drew it). */
  reason?: string | null;
  drawCalls?: number;
  pending: boolean;
  ms: number;
  /** Stepwise mode: Canvas work of the last complete repaint of the town layer (0 before the first one). */
  paintMs?: number;
  materialFaces: number;
  frames: CityFrameStats[];
  houses: BuildingRenderMetrics[];
}
/** Painted by each city plan between its streets and its buildings; `mpp` is world units per screen pixel. */
export interface NativeCityHooks {
  beforeBuildings?(ctx: CanvasRenderingContext2D, scene: CityScene, frame: { viewport: Box; mpp: number }): void;
  /** The rivers the map draws under the towns (`riverSegments` layout): town ground and streets stay off them. */
  water?(): Float32Array | undefined;
  /** Canvas 2D town: puts the map's water back over the town ground and streets, before quays and bridges. */
  waterAbove?(ctx: CanvasRenderingContext2D, box: Box, over?: () => void): void;
}
export type { NativeCityStepwise } from '../render/city/canvas/stepwiseTown';
/** `content`: what the towns show changed (textures arrived, a mesh was uploaded); `progress`: the stepwise layer of the
 * current view is complete, the same frame can now be composed exactly. */
export type NativeCityInvalidation = 'content' | 'progress';
export interface NativeCityMap {
  draw(ctx: CanvasRenderingContext2D, view: View, w: number, h: number, dpr: number, appearance: ResolvedAppearance, visibility?: Partial<ExportLayers>, hooks?: NativeCityHooks, stepwise?: NativeCityStepwise): NativeCityMapStats;
  /** Stops the stepwise repaint in progress, if any (the view moves again, or the renderer is busy elsewhere). */
  suspendStepwise(): void;
  /** The city plans (activity sites included), for the semantic district layer. */
  scenes(): readonly CityScene[];
  /** The town item of a building (by id) as this map draws it: the tilted view's volumes take its look from it. */
  building(id: string): CityBuilding | undefined;
  /** Uploads the WebGL2 plan a frame with this appearance would use, if any (exports draw synchronously). */
  prepare(appearance: ResolvedAppearance, visibility?: Partial<ExportLayers>): Promise<void>;
  /** The towns as a layer of the live compositor (render/live/cityLayer.ts), bound to its shared WebGL2 context: retained
   * meshes drawn while the view moves. Undefined without towns. Disposed with this map at the latest. */
  createLiveLayer(gl: WebGL2RenderingContext, env: LiveCityEnv): LiveLayer | undefined;
  dispose(): void;
}
interface Entry {
  plan: CityScene;
  buildings: CityBuildings;
  /** Native house plans (houses crate); city volumes have none and draw as plan silhouettes, like City Bench. */
  houses?: UrbanBuildingLodRenderer;
  materials: ReadonlyMap<string, HouseMaterial>;
  refused: ReadonlySet<string>;
  canopyBuildings?: readonly PlacedBuilding[];
  /** Very large towns: `buildings` is the view's tier, the items without roofs (`base`) or the cached detail of the visible tiles. */
  large?: { base: CityBuildings; detail: Map<string, CityBuildings> };
}
/** Building count above which a town is prepared in two tiers: its items without roof pans, snow and shadows for the views
 * where they cannot show, and the full detail of the visible tiles only, built on demand. Smaller towns keep one tier. */
const LARGE_TOWN_BUILDINGS = 60000;
/** Metres per pixel below which roof pans show (a 10 m roof face spans 2.5 px). */
const DETAIL_MPP = 4;
/** Side of the tiles the visible detail is snapped to, in metres. */
const DETAIL_TILE = 1024;
function largeTownBuildings(entry: Entry, viewport: Box, mpp: number): CityBuildings {
  const large = entry.large!;
  if (mpp > DETAIL_MPP) return large.base;
  const margin = Math.max(viewport.maxX - viewport.minX, viewport.maxY - viewport.minY) * 0.25,
    tile = (v: number, up: boolean) => (up ? Math.ceil : Math.floor)(v / DETAIL_TILE) * DETAIL_TILE;
  const region: Box = { minX: tile(viewport.minX - margin, false), minY: tile(viewport.minY - margin, false), maxX: tile(viewport.maxX + margin, true), maxY: tile(viewport.maxY + margin, true) };
  const key = [region.minX, region.minY, region.maxX, region.maxY].join(',');
  let detail = large.detail.get(key);
  if (!detail) {
    // In the town's own order, so overlapping buildings stack as in the one-tier drawing.
    detail = buildCityBuildings(
      {
        buildings: large.base.bins
          .query(region)
          .sort((a, b) => a - b)
          .map(i => large.base.items[i].building),
      },
      entry.plan,
    );
    // The snow line is the mean ground of the whole town, not of the visible subset.
    for (const item of detail.items) {
      const i = large.base.byId.get(item.id);
      if (i !== undefined) item.snowAltitude = large.base.items[i].snowAltitude;
    }
    // Only the current region is kept: at mid zoom a region of a 1M town holds tens of thousands of roofed buildings.
    large.detail.clear();
    large.detail.set(key, detail);
  }
  return detail;
}
interface MaterialFace {
  path: Path2D;
  layer: number;
  angle: number;
  z: number;
}
interface MaterialGeometry {
  faces: MaterialFace[];
  outline: Path2D;
}
type LayerCanvas = HTMLCanvasElement | OffscreenCanvas;
const EMPTY_LAYERS = Object.fromEntries(Object.keys(DEFAULT_LAYERS).map(key => [key, false])) as unknown as CityLayers;
const finite = (value: number | undefined, fallback: number, min: number, max: number): number => (value !== undefined && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback);

function canvas(width: number, height: number): LayerCanvas | undefined {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width, height });
  return undefined;
}
function surfacePath(surface: Surface): Path2D {
  const path = new Path2D();
  for (const polygon of surface)
    for (const ring of [polygon.outer, ...polygon.holes]) {
      if (ring.length < 3) continue;
      path.moveTo(ring[0].x, ring[0].y);
      for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y);
      path.closePath();
    }
  return path;
}
/** Exact ids are preferred. Native catalogue patterns supply only known atlas
 * families; an unknown material keeps the existing native material colour. */
function materialLayer(id: string | undefined, materials: ReadonlyMap<string, HouseMaterial>): number {
  const key = id?.replace(/^city3d:cover:/, '');
  const exact = coverLayer(key);
  return exact >= 0 ? exact : coverLayer(id && materials.get(id)?.pattern);
}
function materialFaces(building: PlacedBuilding, materials: ReadonlyMap<string, HouseMaterial>): MaterialFace[] {
  const faces: MaterialFace[] = [];
  for (const volume of building.volumes ?? []) {
    const mesh = volume.roof_mesh;
    for (const face of mesh?.faces ?? []) {
      if (face.normal[2] <= 0.08 || face.vertices.length < 3) continue;
      const points = face.vertices.map(index => mesh!.vertices[index]);
      if (points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) continue;
      const layer = materialLayer(face.material || volume.materials?.cladding, materials);
      if (layer < 0) continue;
      faces.push({ path: surfacePath([{ outer: points, holes: [] }]), layer, angle: Math.atan2(face.normal[1], face.normal[0]) - Math.PI / 2, z: Math.max(...points.map(point => point.z)) });
    }
  }
  if (!faces.length) {
    const layer = materialLayer(building.volumes?.[0]?.materials.cladding, materials);
    if (layer >= 0) faces.push({ path: surfacePath(building.roof_footprint.length ? building.roof_footprint : building.footprint), layer, angle: ((building.transform?.orientation_deg ?? 0) * Math.PI) / 180, z: building.ground_z_m });
  }
  return faces.sort((a, b) => a.z - b.z);
}

/** Plans and city volumes of a world's native towns, built before the map (`createNativeCityMapAsync` spreads the
 * volumes over workers; `createNativeCityMap` builds whatever is missing on this thread). */
interface PreparedCities {
  plans: CityScene[];
  buildings: (CityBuildings | undefined)[];
}
const largeTown = (city: ReturnType<typeof nativeCitiesOf>[number]): boolean => !usesNativeHouseRenderer(city.scene) && (city.scene?.buildings.length ?? 0) > LARGE_TOWN_BUILDINGS;
function cityPlans(world: World): CityScene[] {
  const cities = nativeCitiesOf(world);
  // Keep snapshots separate: older archives may reuse a layout/parcel id in
  // another settlement. Their exact native identities must not be renamed.
  const raster = cities.length ? cityGroundOf(world) : undefined;
  return cities.map(city => buildCityScene(city.layouts, city.partitions ?? [], raster));
}
/** `createNativeCityMap` with the city volumes of the unedited native towns built over workers (same result). */
export async function createNativeCityMapAsync(world: World, onInvalidate: (kind: NativeCityInvalidation) => void): Promise<NativeCityMap> {
  const cities = nativeCitiesOf(world);
  // The water clip of every town's lots and blocks runs on the warm build workers first; the plans then read it.
  if (cities.length)
    await clipCityGroundAhead(
      cityGroundFor(cityGroundOf(world)),
      cities.flatMap(city => cityGroundSubjects(city.layouts, city.partitions ?? [])),
    );
  const plans = cityPlans(world);
  // Several small towns can together take seconds. Reuse the warm pool in order so
  // the first town does not leave every later town building on the page.
  const batchBuildings = cities.reduce((sum, city) => sum + (usesNativeHouseRenderer(city.scene) ? 0 : (city.scene?.buildings.length ?? 0)), 0);
  const buildings: (CityBuildings | undefined)[] = [];
  try {
    for (const [i, city] of cities.entries()) buildings.push(usesNativeHouseRenderer(city.scene) ? undefined : await buildCityBuildingsParallel(city.scene, plans[i], city.sites, { roofs: !largeTown(city), batchBuildings }));
  } finally {
    releaseCityBuildingWorkers();
  }
  return createNativeCityMap(world, onInvalidate, { plans, buildings });
}
const objectIds = new WeakMap<object, number>();
let objectSeq = 0;
const idOf = (value: object | undefined): number => {
  if (!value) return 0;
  let id = objectIds.get(value);
  if (!id) objectIds.set(value, (id = ++objectSeq));
  return id;
};
export function createNativeCityMap(world: World, onInvalidate: (kind: NativeCityInvalidation) => void, prepared?: PreparedCities): NativeCityMap {
  countWork('town.map');
  let disposed = false,
    queued = false,
    layer: LayerCanvas | undefined,
    context: CanvasRenderingContext2D | undefined;
  let lod: CityLod | undefined;
  const cities = nativeCitiesOf(world),
    plans = prepared?.plans ?? cityPlans(world);
  const entries: Entry[] = cities.map((city, i) => {
    const plan = plans[i],
      ready = prepared?.buildings[i];
    const large = largeTown(city) ? { base: ready ?? buildCityBuildings(city.scene, plan, { roofs: false }), detail: new Map<string, CityBuildings>() } : undefined;
    return {
      plan,
      canopyBuildings: city.scene?.buildings,
      buildings: large?.base ?? ready ?? buildCityBuildings(city.scene, plan),
      ...(large ? { large } : {}),
      houses: usesNativeHouseRenderer(city.scene) ? new UrbanBuildingLodRenderer(city.scene!) : undefined,
      materials: new Map((city.scene?.materials ?? []).map(material => [material.id, material])),
      refused: new Set(city.scene?.refusals.map(refusal => refusal.parcel_id)),
    };
  });
  // Activity sites (mills, quarries…) outside the towns: their buildings only, no plan.
  const activities = activityScene(world),
    sites = activitySitesOf(world);
  if (activities) {
    const plan = buildCityScene([], []);
    entries.push({
      plan,
      canopyBuildings: activities.buildings,
      buildings: buildCityBuildings(activities, plan),
      houses: usesNativeHouseRenderer(activities) ? new UrbanBuildingLodRenderer(activities) : undefined,
      materials: new Map((activities.materials ?? []).map(material => [material.id, material])),
      refused: new Set(),
    });
  }
  const textScenes = entries.map(entry => entry.plan);
  const layouts = entries.reduce((count, entry) => count + entry.plan.layouts.length, 0);
  const buildings = entries.reduce((count, entry) => count + entry.buildings.items.length, 0);
  // Bounded, display-only geometry. Retained native meshes and plan objects are
  // read, never copied into generated geometry or mutated.
  const textures = new Map<PlacedBuilding, MaterialGeometry>();
  /** Bumped whenever the towns may paint differently for the same frame: a kept stepwise layer is then stale. */
  let contentRevision = 0;
  const invalidate = (): void => {
    contentRevision++;
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) onInvalidate('content');
    });
  };
  // WebGL2: every city in one GL scene (one context, one upload), built on the first GL frame.
  // Native house plans stay on Canvas 2D over it, as in City Bench.
  let gl: CityGlComposite | undefined, glScene: ReturnType<typeof mergeCityPlans> | undefined;
  const offRenderMode = onRenderMode(invalidate);
  /** Why this frame cannot use WebGL2 before any upload (null: it can). Partial exports (streets only,
   * no buildings...) keep Canvas 2D, which honours each layer switch. */
  const glBlockReason = (appearance: ResolvedAppearance, visibility: Partial<ExportLayers>): string | null =>
    visibility.city === false || visibility.roads === false || visibility.streets === false ? 'export-layers' : cityGlBlockReason({ mode: getRenderMode(), appearance, palette: appearance.city.palette, ready: true });
  /** Creates the GL layer and starts the merged upload; true once it can draw. */
  function prepareGl(): boolean {
    gl ??= new CityGlComposite(invalidate);
    if (!glScene) countWork('town.canvasPlanMerge');
    glScene ??= mergeCityPlans(entries.map(entry => ({ plan: entry.plan, buildings: entry.houses ? undefined : entry.buildings })));
    return gl.prepare(glScene.plan, glScene.buildings);
  }
  function textureRoofs(ctx: CanvasRenderingContext2D, entry: Entry, viewport: BuildingViewport, mpp: number, appearance: UrbanBuildingAppearance, images: MaterialImages): number {
    if (typeof Path2D === 'undefined' || appearance.style === 'silhouette' || appearance.diagnostic !== 'none' || mpp > 2.2) return 0;
    let painted = 0,
      candidates = 0;
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(viewport.minX, viewport.minY, viewport.maxX - viewport.minX, viewport.maxY - viewport.minY);
      ctx.clip();
      // The shared 2D material atlas adds grain over the native facet lighting.
      // Normal-mapped wall lighting remains the perspective renderer's job.
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = 0.28;
      for (const visible of entry.houses?.query(viewport, mpp, appearance).visible ?? []) {
        if (visible.lod === 'silhouette' || candidates++ >= 128) continue;
        const building = visible.building;
        let geometry = textures.get(building);
        if (!geometry) {
          geometry = { faces: materialFaces(building, entry.materials), outline: surfacePath(building.roof_footprint.length ? building.roof_footprint : building.footprint) };
          textures.set(building, geometry);
          if (textures.size > 512) textures.delete(textures.keys().next().value!);
        }
        // Roof overhangs/courts retain the exact native footprint holes.
        ctx.save();
        ctx.clip(geometry.outline, 'evenodd');
        for (const face of geometry.faces) {
          const pattern = layerPattern(ctx, images, face.layer, face.angle);
          if (pattern) {
            ctx.fillStyle = pattern;
            ctx.fill(face.path, 'evenodd');
            painted++;
          }
        }
        ctx.restore();
      }
    } finally {
      ctx.restore();
    }
    return painted;
  }
  type TownFrame = { view: View; w: number; h: number; dpr: number; appearance: ResolvedAppearance; visibility: Partial<ExportLayers>; hooks?: NativeCityHooks; lod: CityLod };
  const townLayers = (appearance: ResolvedAppearance, visibility: Partial<ExportLayers>): CityLayers => {
    // Urban plan off is already folded into city.layers (withoutUrbanPlan): streets, walls and lamps stay.
    const requestedLayers = appearance.city.layers;
    return { ...(visibility.city === false ? EMPTY_LAYERS : requestedLayers), streets: appearance.composition.networks.roads.visible && visibility.streets !== false && requestedLayers.streets, ...(appearance.composition.networks.water.visible ? {} : { waterways: false }) };
  };
  const newStats = (): NativeCityMapStats => ({ native: entries.length > 0, cities: entries.length, layouts, buildings, visibleBuildings: 0, renderer: 'canvas2d', pending: false, ms: 0, materialFaces: 0, frames: [], houses: [] });
  /** Paints every town of a frame into `ctx` (the frame's device pixels), in resumable steps: the same Canvas calls in
   * the same order whether they run at once (captures, exports, opaque towns: `drawCity`) or, `resumable`, over
   * several tasks (the stepwise mode: `drawCitySteps`, the same function with pauses). */
  function* paintSteps(ctx: CanvasRenderingContext2D, f: TownFrame, stats: NativeCityMapStats, resumable = false): Generator<void, void> {
    const { view, w, h, dpr, appearance, visibility, hooks, lod } = f,
      city = appearance.city;
    const viewport = viewRect(view, w, h),
      mpp = 1 / view.scale;
    const palette = city.palette,
      buildingAppearance: UrbanBuildingAppearance = cityBuildingAppearance(appearance);
    const layers = townLayers(appearance, visibility);
    const painted = city.painted,
      textured = city.textured;
    const images = textured && palette !== 'parchment' && palette !== 'ink' ? materialImagesNow(invalidate) : undefined;
    const buildingsVisible = visibility.city !== false && city.visible;
    let reason = glBlockReason(appearance, visibility);
    let glFrame: CityGlFrame | undefined;
    ctx.save();
    try {
      ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, (w / 2 - view.cx * view.scale) * dpr, (h / 2 - view.cy * view.scale) * dpr);
      // Activity / node installations: flat ground under every building.
      if (buildingsVisible) drawInstallations(ctx, sites, viewport, mpp, palette !== 'parchment' && palette !== 'ink');
      if (!reason) {
        if (!prepareGl()) reason = gl?.unavailable !== false ? 'gl-unavailable' : 'gl-not-ready';
        else {
          glFrame = gl!.draw(
            ctx,
            Math.round(w * dpr),
            Math.round(h * dpr),
            cityGlDrawOptions({
              viewport,
              mpp,
              lod,
              view: city.view,
              palette,
              layers,
              buildingStyle: buildingAppearance.style,
              painted,
              buildingsVisible,
              diagnostic: buildingAppearance.diagnostic,
              refusedParcels: buildingAppearance.diagnostic === 'access' ? new Set(entries.flatMap(entry => [...entry.refused])) : undefined,
              textured,
              colors: appearance.palette.colors,
              water: hooks?.water?.(),
            }),
          );
          if (!glFrame) reason = 'gl-unavailable';
        }
      }
      stats.renderer = glFrame ? 'webgl2' : 'canvas2d';
      stats.reason = reason;
      stats.drawCalls = glFrame?.drawCalls ?? 0;
      for (const entry of entries) {
        const options = cityDrawOptions({
          appearance,
          city,
          frame: { viewport, mpp, dpr },
          lod,
          layers,
          glFrame,
          labelsAllowed: visibility.labels !== false,
          buildingAppearance,
          page: {
            buildings: entry.buildings,
            farBuildings: entry.large?.base,
            buildingsVisible: buildingsVisible && (!glFrame || !!entry.houses),
            onTexturesReady: invalidate,
            refusedParcels: buildingAppearance.diagnostic === 'access' ? entry.refused : undefined,
            beforeBuildings: visibility.city !== false && hooks?.beforeBuildings ? hookCtx => hooks.beforeBuildings!(hookCtx, entry.plan, { viewport, mpp }) : undefined,
            waterAbove: hooks?.waterAbove ? (hookCtx, box, over) => hooks.waterAbove!(hookCtx, box, over) : undefined,
            renderer: entry.houses && {
              draw(houseCtx, options) {
                const metrics = entry.houses!.draw(houseCtx, { ...options, painted });
                stats.houses.push(metrics);
                stats.visibleBuildings += metrics.visibleBuildings;
                if (images) stats.materialFaces += textureRoofs(houseCtx, entry, viewport, mpp, buildingAppearance, images);
                return metrics;
              },
            },
          },
        });
        const frame = resumable ? yield* drawCitySteps(ctx, entry.plan, options) : drawCity(ctx, entry.plan, options);
        finishCityFrame(ctx, entry.plan, entry.canopyBuildings, { viewport, mpp, view: city.view, palette, visible: buildingsVisible, diagnostic: buildingAppearance.diagnostic, night: !!buildingAppearance.lightsOn, streets: layers.streets });
        stats.frames.push(frame);
        stats.pending ||= frame.pending;
        if (!entry.houses || city.view !== 'buildings' || buildingAppearance.style === 'silhouette') stats.visibleBuildings += frame.buildings;
        // City volumes drawn by WebGL2: counted from the plan bins (drawCity painted none of them).
        if (glFrame && !entry.houses && buildingsVisible) stats.visibleBuildings += entry.buildings.bins.query(viewport).length;
        yield;
      }
    } finally {
      ctx.restore();
    }
  }

  // The stepwise mode of the exact town (render/city/canvas/stepwiseTown.ts): its kept layers and its scheduler.
  let tierRevision = 0;
  const stepwiseTown = createStepwiseTown<TownFrame, NativeCityMapStats>({
    paint: (ctx, frame, stats) => paintSteps(ctx, frame, stats, true),
    newStats,
    canvas,
    revision: () => `${contentRevision}|${tierRevision}`,
    lookKey: f => `${idOf(f.appearance)}|${idOf(f.hooks?.water?.())}|${JSON.stringify(f.visibility)}|${getRenderMode()}`,
    contentPending: invalidate,
    progressed: () => {
      if (!disposed) onInvalidate('progress');
    },
  });
  // Live compositor layers (render/city/live/townLayer.ts). They share the merged plan of the GL path and keep their own
  // tier of the very large towns: the merged buildings of the tiers last handed out, reused while no tier changes.
  const liveLayers = new Set<LiveLayer>();
  let liveTier: { parts: (CityBuildings | undefined)[]; merged: CityBuildings } | undefined, liveRefused: ReadonlySet<string> | undefined;
  // The live scene also holds the towns and activity sites drawn by the native house renderer (entry.houses), as their
  // city volumes (entry.buildings: massing silhouettes with roof pans and cast shadows, built with the entry): the
  // plan path leaves them to the house renderer, which only Canvas 2D runs.
  const liveParts = (parts: readonly (CityBuildings | undefined)[]) => entries.map((entry, i) => ({ plan: entry.plan, buildings: parts[i] }));
  const sameParts = (parts: readonly (CityBuildings | undefined)[]): boolean => !!liveTier && liveTier.parts.length === parts.length && liveTier.parts.every((part, i) => part === parts[i]);
  function liveMerged(parts: (CityBuildings | undefined)[]): CityBuildings {
    if (!sameParts(parts)) liveTier = { parts, merged: mergeCityBuildings(liveParts(parts)) };
    return liveTier!.merged;
  }
  /** The live scene in resumable steps (a few milliseconds each): the GL path's merged plan when it has none yet, then
   * every entry's buildings. The exact draw may build its plan meanwhile; the first one made is kept. */
  function* liveSceneSteps(): Generator<void, { plan: CityScene; buildings: CityBuildings }> {
    if (!glScene) {
      const merged = yield* mergeCityPlansSteps(entries.map(entry => ({ plan: entry.plan, buildings: entry.houses ? undefined : entry.buildings })));
      glScene ??= merged;
    }
    const plan = glScene.plan,
      parts = entries.map(entry => entry.buildings);
    if (!sameParts(parts)) {
      const merged = yield* mergeCityBuildingsSteps(liveParts(parts));
      liveTier = { parts, merged };
    }
    return { plan, buildings: liveTier!.merged };
  }
  /** Towns with a far raster on satellite grounds (drawCitySteps `farTown`: not the house-renderer ones), with the whole
   * town's buildings as the exact draw hands them to drawFarTown. */
  let liveFarTowns: { plan: CityScene; buildings: CityBuildings }[] | undefined;
  const farTowns = () => (liveFarTowns ??= entries.filter(entry => !entry.houses).map(entry => ({ plan: entry.plan, buildings: entry.large?.base ?? entry.buildings })));
  /** The buildings of a resting view for the live layer: each large town's tier for that view (largeTownBuildings), the
   * others as they are. Builds a detail tier on this thread when the view needs one, as the exact draw does. */
  function liveBuildings(viewport: Box, mpp: number): CityBuildings | undefined {
    if (disposed) return undefined;
    return liveMerged(entries.map(entry => (entry.large ? largeTownBuildings(entry, viewport, mpp) : entry.buildings)));
  }
  return {
    scenes: () => textScenes,
    building(id) {
      for (const entry of entries) {
        const buildings = entry.large?.base ?? entry.buildings,
          index = buildings.byId.get(id);
        if (index !== undefined) return buildings.items[index];
      }
      return undefined;
    },
    suspendStepwise: () => stepwiseTown.stop(),
    draw(target, view, w, h, dpr, appearance, visibility = {}, hooks, stepwise) {
      const started = performance.now();
      const stats = newStats();
      if (disposed || !entries.length || !(view.scale > 0) || !(w > 0) || !(h > 0) || !(dpr > 0)) return stats;
      const city = appearance.city,
        opacity = finite(city.opacity, 0.8, 0, 1);
      if (!opacity) return stats;
      const pixelsW = Math.max(1, Math.ceil(w * dpr)),
        pixelsH = Math.max(1, Math.ceil(h * dpr));
      const viewport = viewRect(view, w, h),
        mpp = 1 / view.scale;
      lod = selectCityLod(mpp, lod);
      stats.lod = lod;
      // Very large towns: the buildings of this view (base or visible detail); the GL scene follows once uploaded.
      let swapped = false;
      for (const entry of entries)
        if (entry.large) {
          const shown = largeTownBuildings(entry, viewport, mpp);
          if (shown !== entry.buildings) {
            entry.buildings = shown;
            swapped = true;
          }
        }
      if (swapped) tierRevision++;
      if (swapped && glScene) gl?.setBuildings(mergeCityBuildings(entries.map(entry => ({ plan: entry.plan, buildings: entry.houses ? undefined : entry.buildings }))));
      const frame: TownFrame = { view, w, h, dpr, appearance, visibility, hooks, lod };
      // Stepwise mode with a translucent town: the kept layer (stepwiseTown.layerFor).
      const kept = opacity < 1 && stepwise ? stepwiseTown.layerFor(frame, stepwise, pixelsW, pixelsH) : undefined;
      let isolated = !!kept;
      if (kept) {
        const held = kept.layer;
        if (held) {
          const from = held.stats;
          Object.assign(stats, { visibleBuildings: from.visibleBuildings, renderer: from.renderer, reason: from.reason, drawCalls: from.drawCalls, materialFaces: from.materialFaces, frames: from.frames, houses: from.houses });
          target.save();
          try {
            target.setTransform(1, 0, 0, 1, 0, 0);
            target.globalAlpha *= opacity;
            if (kept.exact) target.drawImage(held.canvas, 0, 0);
            else {
              // The layer of another view, placed where its ground now is.
              const k = (view.scale * dpr) / (held.view.scale * held.dpr),
                wide = held.canvas.width * k,
                high = held.canvas.height * k;
              target.drawImage(held.canvas, pixelsW / 2 + (held.view.cx - view.cx) * view.scale * dpr - wide / 2, pixelsH / 2 + (held.view.cy - view.cy) * view.scale * dpr - high / 2, wide, high);
            }
          } finally {
            target.restore();
          }
        }
        stats.pending = !kept.exact || !!held?.stats.pending;
      } else {
        if (opacity < 1) {
          layer ??= canvas(pixelsW, pixelsH);
          context ??= layer?.getContext('2d') as CanvasRenderingContext2D | undefined;
        }
        // Node/non-DOM hosts can still exercise the exact drawing API. Browsers
        // always use the isolated layer so nested painter alpha cannot defeat opacity.
        isolated = opacity < 1 && !!layer && !!context;
        const ctx = isolated ? context! : target;
        if (isolated) {
          if (layer!.width !== pixelsW) layer!.width = pixelsW;
          if (layer!.height !== pixelsH) layer!.height = pixelsH;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, pixelsW, pixelsH);
        }
        const steps = paintSteps(ctx, frame, stats);
        while (!steps.next().done);
        if (isolated) {
          target.save();
          try {
            target.setTransform(1, 0, 0, 1, 0, 0);
            target.globalAlpha *= opacity;
            target.drawImage(layer!, 0, 0);
          } finally {
            target.restore();
          }
        }
      }
      if (isolated) {
        // Canal water is water, not plan ink: at full strength, as the rivers under the plan (townWater.ts).
        const layers = townLayers(appearance, visibility);
        if (layers.waterways !== false && (layers.streets || layers.waterways)) {
          target.save();
          try {
            target.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, (w / 2 - view.cx * view.scale) * dpr, (h / 2 - view.cy * view.scale) * dpr);
            for (const entry of entries) drawCityWaterways(target, entry.plan.layouts, mpp, townWaterColour(appearance));
          } finally {
            target.restore();
          }
        }
      }
      // A kept layer reports its own pending content when its repaint ends (stepwiseTown).
      if (!kept && stats.pending) invalidate();
      stats.ms = performance.now() - started;
      stats.paintMs = stepwiseTown.paintMs;
      reportRenderStats({ path: stats.renderer === 'webgl2' ? 'gpu' : 'cpu', ms: stats.ms, drawCalls: stats.drawCalls ?? 0, reason: stats.renderer === 'webgl2' ? undefined : (stats.reason ?? undefined) });
      return stats;
    },
    async prepare(appearance, visibility = {}) {
      if (disposed || !entries.length || glBlockReason(appearance, visibility)) return;
      if (!prepareGl()) await gl?.ready();
    },
    createLiveLayer(context, env) {
      if (disposed || !entries.length) return undefined;
      const made = createLiveCityLayer(context, env, {
        sceneSteps: liveSceneSteps,
        enclosures: () => entries.map(entry => entry.plan.lotEnclosures),
        canopies: () => entries.map(entry => cityCanopy(entry.plan.layouts, entry.canopyBuildings)),
        buildingsFor: entries.some(entry => entry.large) ? liveBuildings : undefined,
        layers: townLayers,
        farTowns,
        refused: () => (liveRefused ??= new Set(entries.flatMap(entry => [...entry.refused]))),
        sites: () => sites.length > 0,
        housePlans: () => entries.some(entry => !!entry.houses),
      });
      const dispose = made.dispose.bind(made);
      const owned: LiveLayer = Object.assign(made, {
        dispose: () => {
          liveLayers.delete(owned);
          dispose();
        },
      });
      liveLayers.add(owned);
      return owned;
    },
    dispose() {
      if (disposed) return;
      for (const live of [...liveLayers]) live.dispose();
      liveTier = undefined;
      liveRefused = undefined;
      liveFarTowns = undefined;
      disposed = true;
      offRenderMode();
      gl?.dispose();
      gl = undefined;
      glScene = undefined;
      stepwiseTown.release();
      for (const entry of entries) entry.houses?.replaceScene({ buildings: [] });
      entries.length = 0;
      textures.clear();
      if (layer) layer.width = layer.height = 1;
      layer = undefined;
      context = undefined;
    },
  };
}
