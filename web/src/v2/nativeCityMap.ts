/** Retained City Bench plans and native roofs on the V2 2D camera. No generation.
 * Same 2D engine as City Bench: WebGL2 cityGl (render/cityGlView.ts) draws the plans and city volumes
 * whenever the shared rule allows it (cityContract.cityGlBlockReason); Canvas 2D drawCity paints the
 * overlay (labels, glyphs, diagnostics, native house plans) and the whole frame otherwise. */
import type { World } from '../gen/types';
import type { View } from '../render/view';
import type { ExportLayers } from '../render/exportLayers';
import { viewRect } from '../render/view';
import { buildCityBuildings, buildCityScene, drawCity, selectCityLod, type Box, type CityBuildings, type CityFrameStats, type CityLayers, type CityLod, type CityScene } from '../render/cityCanvas';
import { DEFAULT_LAYERS } from '../render/cityGlStyle';
import { CityGlComposite, cityGlDrawOptions, mergeCityPlans } from '../render/cityGlView';
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
import { activityScene, activitySitesOf, drawInstallations } from './activitySites';

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
  materialFaces: number;
  frames: CityFrameStats[];
  houses: BuildingRenderMetrics[];
}
/** Painted by each city plan between its streets and its buildings; `mpp` is world units per screen pixel. */
export interface NativeCityHooks { beforeBuildings?(ctx: CanvasRenderingContext2D, scene: CityScene, frame: { viewport: Box; mpp: number }): void }
export interface NativeCityMap {
  draw(ctx: CanvasRenderingContext2D, view: View, w: number, h: number, dpr: number, appearance: ResolvedAppearance, visibility?: Partial<ExportLayers>, hooks?: NativeCityHooks): NativeCityMapStats;
  /** The city plans (activity sites included), for the semantic district layer. */
  scenes(): readonly CityScene[];
  /** Uploads the WebGL2 plan a frame with this appearance would use, if any (exports draw synchronously). */
  prepare(appearance: ResolvedAppearance, visibility?: Partial<ExportLayers>): Promise<void>;
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
}
interface MaterialFace { path: Path2D; layer: number; angle: number; z: number }
interface MaterialGeometry { faces: MaterialFace[]; outline: Path2D }
type LayerCanvas = HTMLCanvasElement | OffscreenCanvas;
const EMPTY_LAYERS = Object.fromEntries(Object.keys(DEFAULT_LAYERS).map(key => [key, false])) as unknown as CityLayers;
const finite = (value: number | undefined, fallback: number, min: number, max: number): number =>
  value !== undefined && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

function canvas(width: number, height: number): LayerCanvas | undefined {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width, height });
  return undefined;
}
function surfacePath(surface: Surface): Path2D {
  const path = new Path2D();
  for (const polygon of surface) for (const ring of [polygon.outer, ...polygon.holes]) {
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
      if (face.normal[2] <= .08 || face.vertices.length < 3) continue;
      const points = face.vertices.map(index => mesh!.vertices[index]);
      if (points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) continue;
      const layer = materialLayer(face.material || volume.materials?.cladding, materials);
      if (layer < 0) continue;
      faces.push({ path: surfacePath([{ outer: points, holes: [] }]), layer,
        angle: Math.atan2(face.normal[1], face.normal[0]) - Math.PI / 2,
        z: Math.max(...points.map(point => point.z)) });
    }
  }
  if (!faces.length) {
    const layer = materialLayer(building.volumes?.[0]?.materials.cladding, materials);
    if (layer >= 0) faces.push({ path: surfacePath(building.roof_footprint.length ? building.roof_footprint : building.footprint), layer,
      angle: (building.transform?.orientation_deg ?? 0) * Math.PI / 180, z: building.ground_z_m });
  }
  return faces.sort((a, b) => a.z - b.z);
}

export function createNativeCityMap(world: World, onInvalidate: () => void): NativeCityMap {
  let disposed = false, queued = false, layer: LayerCanvas | undefined, context: CanvasRenderingContext2D | undefined;
  let lod: CityLod | undefined;
  const cities = nativeCitiesOf(world);
  // Keep snapshots separate: older archives may reuse a layout/parcel id in
  // another settlement. Their exact native identities must not be renamed.
  const raster = cities.length ? cityGroundOf(world) : undefined;
  const entries: Entry[] = cities.map(city => {
    const plan = buildCityScene(city.layouts, city.partitions ?? [], raster);
    return { plan, canopyBuildings: city.scene?.buildings, buildings: buildCityBuildings(city.scene, plan), houses: usesNativeHouseRenderer(city.scene) ? new UrbanBuildingLodRenderer(city.scene!) : undefined,
      materials: new Map((city.scene?.materials ?? []).map(material => [material.id, material])),
      refused: new Set(city.scene?.refusals.map(refusal => refusal.parcel_id)) };
  });
  // Activity sites (mills, quarries…) outside the towns: their buildings only, no plan.
  const activities = activityScene(world), sites = activitySitesOf(world);
  if (activities) {
    const plan = buildCityScene([], []);
    entries.push({ plan, canopyBuildings: activities.buildings, buildings: buildCityBuildings(activities, plan), houses: usesNativeHouseRenderer(activities) ? new UrbanBuildingLodRenderer(activities) : undefined,
      materials: new Map((activities.materials ?? []).map(material => [material.id, material])), refused: new Set() });
  }
  const textScenes = entries.map(entry => entry.plan);
  const layouts = entries.reduce((count, entry) => count + entry.plan.layouts.length, 0);
  const buildings = entries.reduce((count, entry) => count + entry.buildings.items.length, 0);
  // Bounded, display-only geometry. Retained native meshes and plan objects are
  // read, never copied into generated geometry or mutated.
  const textures = new Map<PlacedBuilding, MaterialGeometry>();
  const invalidate = (): void => {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!disposed) onInvalidate(); });
  };
  // WebGL2: every city in one GL scene (one context, one upload), built on the first GL frame.
  // Native house plans stay on Canvas 2D over it, as in City Bench.
  let gl: CityGlComposite | undefined, glScene: ReturnType<typeof mergeCityPlans> | undefined;
  const offRenderMode = onRenderMode(invalidate);
  /** Why this frame cannot use WebGL2 before any upload (null: it can). Partial exports (streets only,
   * no buildings...) keep Canvas 2D, which honours each layer switch. */
  const glBlockReason = (appearance: ResolvedAppearance, visibility: Partial<ExportLayers>): string | null =>
    visibility.city === false || visibility.roads === false || visibility.streets === false ? 'export-layers'
      : cityGlBlockReason({ mode: getRenderMode(), appearance, palette: appearance.city.palette, ready: true });
  /** Creates the GL layer and starts the merged upload; true once it can draw. */
  function prepareGl(): boolean {
    gl ??= new CityGlComposite(invalidate);
    glScene ??= mergeCityPlans(entries.map(entry => ({ plan: entry.plan, buildings: entry.houses ? undefined : entry.buildings })));
    return gl.prepare(glScene.plan, glScene.buildings);
  }
  function textureRoofs(ctx: CanvasRenderingContext2D, entry: Entry, viewport: BuildingViewport, mpp: number,
    appearance: UrbanBuildingAppearance, images: MaterialImages): number {
    if (typeof Path2D === 'undefined' || appearance.style === 'silhouette' || appearance.diagnostic !== 'none' || mpp > 2.2) return 0;
    let painted = 0, candidates = 0;
    ctx.save();
    try {
      ctx.beginPath(); ctx.rect(viewport.minX, viewport.minY, viewport.maxX - viewport.minX, viewport.maxY - viewport.minY); ctx.clip();
      // The shared 2D material atlas adds grain over the native facet lighting.
      // Normal-mapped wall lighting remains the perspective renderer's job.
      ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = .28;
      for (const visible of entry.houses?.query(viewport, mpp, appearance).visible ?? []) {
        if (visible.lod === 'silhouette' || candidates++ >= 128) continue;
        const building = visible.building;
        let geometry = textures.get(building);
        if (!geometry) {
          geometry = { faces: materialFaces(building, entry.materials),
            outline: surfacePath(building.roof_footprint.length ? building.roof_footprint : building.footprint) };
          textures.set(building, geometry);
          if (textures.size > 512) textures.delete(textures.keys().next().value!);
        }
        // Roof overhangs/courts retain the exact native footprint holes.
        ctx.save(); ctx.clip(geometry.outline, 'evenodd');
        for (const face of geometry.faces) {
          const pattern = layerPattern(ctx, images, face.layer, face.angle);
          if (pattern) { ctx.fillStyle = pattern; ctx.fill(face.path, 'evenodd'); painted++; }
        }
        ctx.restore();
      }
    } finally { ctx.restore(); }
    return painted;
  }
  return {
    scenes: () => textScenes,
    draw(target, view, w, h, dpr, appearance, visibility = {}, hooks) {
      const started = performance.now();
      const stats: NativeCityMapStats = { native: entries.length > 0, cities: entries.length, layouts, buildings,
        visibleBuildings: 0, renderer: 'canvas2d', pending: false, ms: 0, materialFaces: 0, frames: [], houses: [] };
      if (disposed || !entries.length || !(view.scale > 0) || !(w > 0) || !(h > 0) || !(dpr > 0)) return stats;
      const city = appearance.city, opacity = finite(city.opacity, .8, 0, 1);
      if (!opacity) return stats;
      const pixelsW = Math.max(1, Math.ceil(w * dpr)), pixelsH = Math.max(1, Math.ceil(h * dpr));
      if (opacity < 1) {
        layer ??= canvas(pixelsW, pixelsH);
        context ??= layer?.getContext('2d') as CanvasRenderingContext2D | undefined;
      }
      // Node/non-DOM hosts can still exercise the exact drawing API. Browsers
      // always use the isolated layer so nested painter alpha cannot defeat opacity.
      const isolated = opacity < 1 && !!layer && !!context, ctx = isolated ? context! : target;
      if (isolated) {
        if (layer!.width !== pixelsW) layer!.width = pixelsW;
        if (layer!.height !== pixelsH) layer!.height = pixelsH;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, pixelsW, pixelsH);
      }
      const viewport = viewRect(view, w, h), mpp = 1 / view.scale;
      lod = selectCityLod(mpp, lod); stats.lod = lod;
      const palette = city.palette, buildingAppearance: UrbanBuildingAppearance = cityBuildingAppearance(appearance);
      const requestedLayers = city.plan ? city.layers : EMPTY_LAYERS;
      const layers = { ...(visibility.city === false ? EMPTY_LAYERS : requestedLayers),
        streets: appearance.composition.networks.roads.visible && visibility.roads !== false && visibility.streets !== false && requestedLayers.streets, ...(appearance.composition.networks.water.visible ? {} : { waterways: false }) };
      const painted = city.painted, textured = city.textured;
      const images = textured && palette !== 'parchment' && palette !== 'ink' ? materialImagesNow(invalidate) : undefined;
      const buildingsVisible = visibility.city !== false && city.visible;
      let reason = glBlockReason(appearance, visibility);
      let glFrame: CityGlFrame | undefined;
      ctx.save();
      try {
        ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, (w / 2 - view.cx * view.scale) * dpr, (h / 2 - view.cy * view.scale) * dpr);
        // Activity / node installations: flat ground under every building.
        if (buildingsVisible) drawInstallations(ctx, sites, viewport, mpp);
        if (!reason) {
          if (!prepareGl()) reason = gl?.unavailable !== false ? 'gl-unavailable' : 'gl-not-ready';
          else {
            glFrame = gl!.draw(ctx, Math.round(w * dpr), Math.round(h * dpr), cityGlDrawOptions({ viewport, mpp, lod, view: city.view, palette, layers,
              buildingStyle: buildingAppearance.style, painted, buildingsVisible, diagnostic: buildingAppearance.diagnostic,
              refusedParcels: buildingAppearance.diagnostic === 'access' ? new Set(entries.flatMap(entry => [...entry.refused])) : undefined, textured, colors: appearance.palette.colors }));
            if (!glFrame) reason = 'gl-unavailable';
          }
        }
        stats.renderer = glFrame ? 'webgl2' : 'canvas2d'; stats.reason = reason; stats.drawCalls = glFrame?.drawCalls ?? 0;
        for (const entry of entries) {
          const frame = drawCity(ctx, entry.plan, cityDrawOptions({ appearance, city, frame: { viewport, mpp, dpr }, lod, layers, glFrame,
            labelsAllowed: visibility.labels !== false, buildingAppearance,
            page: { buildings: entry.buildings, buildingsVisible: buildingsVisible && (!glFrame || !!entry.houses), onTexturesReady: invalidate,
            refusedParcels: buildingAppearance.diagnostic === 'access' ? entry.refused : undefined,
            beforeBuildings: visibility.city !== false && hooks?.beforeBuildings ? (hookCtx => hooks.beforeBuildings!(hookCtx, entry.plan, { viewport, mpp })) : undefined,
            renderer: entry.houses && { draw(houseCtx, options) {
              const metrics = entry.houses!.draw(houseCtx, { ...options, painted });
              stats.houses.push(metrics); stats.visibleBuildings += metrics.visibleBuildings;
              if (images) stats.materialFaces += textureRoofs(houseCtx, entry, viewport, mpp, buildingAppearance, images);
              return metrics;
            } } } }));
          finishCityFrame(ctx, entry.plan, entry.canopyBuildings, { viewport, mpp, view: city.view, palette,
            visible: buildingsVisible, diagnostic: buildingAppearance.diagnostic, night: appearance.composition.ambience === 'night', streets: layers.streets });
          stats.frames.push(frame); stats.pending ||= frame.pending;
          if (!entry.houses || city.view !== 'buildings' || buildingAppearance.style === 'silhouette') stats.visibleBuildings += frame.buildings;
          // City volumes drawn by WebGL2: counted from the plan bins (drawCity painted none of them).
          if (glFrame && !entry.houses && buildingsVisible) stats.visibleBuildings += entry.buildings.bins.query(viewport).length;
        }
      } finally { ctx.restore(); }
      if (isolated) {
        target.save();
        try { target.setTransform(1, 0, 0, 1, 0, 0); target.globalAlpha *= opacity; target.drawImage(layer!, 0, 0); }
        finally { target.restore(); }
      }
      if (stats.pending) invalidate();
      stats.ms = performance.now() - started;
      reportRenderStats({ path: glFrame ? 'gpu' : 'cpu', ms: stats.ms, drawCalls: stats.drawCalls ?? 0, reason: glFrame ? undefined : reason ?? undefined });
      return stats;
    },
    async prepare(appearance, visibility = {}) {
      if (disposed || !entries.length || glBlockReason(appearance, visibility)) return;
      if (!prepareGl()) await gl?.ready();
    },
    dispose() {
      if (disposed) return;
      disposed = true; offRenderMode(); gl?.dispose(); gl = undefined; glScene = undefined;
      for (const entry of entries) entry.houses?.replaceScene({ buildings: [] });
      entries.length = 0; textures.clear();
      if (layer) layer.width = layer.height = 1;
      layer = undefined; context = undefined;
    },
  };
}
