/** Retained City Bench plans and native roofs on the V2 2D camera. No generation. */
import type { World } from '../gen/types';
import type { View } from '../render/view';
import type { ExportLayers } from '../render/exportLayers';
import { viewRect } from '../render/view';
import { buildCityBuildings, buildCityScene, drawCity, selectCityLod, type CityBuildings, type CityFrameStats, type CityLayers, type CityLod, type CityScene } from '../render/cityCanvas';
import { DEFAULT_LAYERS } from '../render/cityGlStyle';
import { UrbanBuildingLodRenderer, type BuildingRenderMetrics, type BuildingViewport } from '../render/urbanBuildingLod';
import { coverLayer, layerPattern, materialImagesNow, type MaterialImages } from '../render/buildingMaterials';
import type { UrbanBuildingAppearance } from '../render/urbanBuildingStyle';
import type { HouseMaterial, Surface } from '../../../rust/bridge/housesContract';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { V2Appearance } from './contracts';
import type { RustTownSnapshot } from './rustUrban';
import { rustSettlementRaster } from './rustUrban';

export interface NativeCityMapStats {
  native: boolean;
  cities: number;
  layouts: number;
  buildings: number;
  visibleBuildings: number;
  lod?: CityLod;
  renderer: 'canvas2d';
  pending: boolean;
  ms: number;
  materialFaces: number;
  frames: CityFrameStats[];
  houses: BuildingRenderMetrics[];
}
export interface NativeCityMap {
  draw(ctx: CanvasRenderingContext2D, view: View, w: number, h: number, dpr: number, appearance: V2Appearance, visibility?: Partial<ExportLayers>): NativeCityMapStats;
  dispose(): void;
}
interface Entry {
  plan: CityScene;
  buildings: CityBuildings;
  houses: UrbanBuildingLodRenderer;
  materials: ReadonlyMap<string, HouseMaterial>;
  refused: ReadonlySet<string>;
}
interface MaterialFace { path: Path2D; layer: number; angle: number; z: number }
interface MaterialGeometry { faces: MaterialFace[]; outline: Path2D }
type LayerCanvas = HTMLCanvasElement | OffscreenCanvas;
const EMPTY_LAYERS = Object.fromEntries(Object.keys(DEFAULT_LAYERS).map(key => [key, false])) as unknown as CityLayers;
const finite = (value: number | undefined, fallback: number, min: number, max: number): number =>
  value !== undefined && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const paintedByDefault = (appearance: V2Appearance): boolean =>
  (appearance.terrainStyle ?? appearance.style).startsWith('render') || (appearance.city?.ground ?? '').startsWith('render');

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
  const cities = Object.values(world.debug?.v2RustCities as Record<string, RustTownSnapshot> ?? {}).filter(city => city.layouts?.length);
  // Keep snapshots separate: older archives may reuse a layout/parcel id in
  // another settlement. Their exact native identities must not be renamed.
  const raster = cities.length ? rustSettlementRaster(world) : undefined;
  const entries: Entry[] = cities.map(city => {
    const plan = buildCityScene(city.layouts, city.partitions ?? [], raster);
    return { plan, buildings: buildCityBuildings(city.scene, plan), houses: new UrbanBuildingLodRenderer(city.scene ?? { buildings: [] }),
      materials: new Map((city.scene?.materials ?? []).map(material => [material.id, material])),
      refused: new Set(city.scene?.refusals.map(refusal => refusal.parcel_id)) };
  });
  const labels = world.options.labels ?? true;
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
      for (const visible of entry.houses.query(viewport, mpp, appearance).visible) {
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
    draw(target, view, w, h, dpr, appearance, visibility = {}) {
      const started = performance.now();
      const stats: NativeCityMapStats = { native: entries.length > 0, cities: entries.length, layouts, buildings,
        visibleBuildings: 0, renderer: 'canvas2d', pending: false, ms: 0, materialFaces: 0, frames: [], houses: [] };
      if (disposed || !entries.length || !(view.scale > 0) || !(w > 0) || !(h > 0) || !(dpr > 0)) return stats;
      const city = appearance.city ?? {}, opacity = finite(city.opacity, .8, 0, 1);
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
      const palette = city.palette ?? 'parchment', buildingAppearance: UrbanBuildingAppearance = {
        colors: appearance.colors, style: city.buildingStyle ?? 'cartographic', diagnostic: city.diagnostic ?? 'none' };
      const requestedLayers = { ...(city.plan === false ? EMPTY_LAYERS : DEFAULT_LAYERS), ...(city.plan === false ? {} : city.layers) };
      const layers = { ...(visibility.city === false ? EMPTY_LAYERS : requestedLayers),
        streets: visibility.streets !== false && requestedLayers.streets };
      const painted = city.painted ?? paintedByDefault(appearance), textured = appearance.textured ?? false;
      const images = textured && palette !== 'parchment' && palette !== 'ink' ? materialImagesNow(invalidate) : undefined;
      ctx.save();
      try {
        ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, (w / 2 - view.cx * view.scale) * dpr, (h / 2 - view.cy * view.scale) * dpr);
        for (const entry of entries) {
          const frame = drawCity(ctx, entry.plan, { colors: appearance.colors, viewport, mpp, dpr, lod, view: city.view ?? 'buildings', palette, layers,
            width: finite(city.width, .6, 0, 5), labels: visibility.labels !== false && (appearance.labels ?? labels),
            buildings: entry.buildings, buildingsVisible: visibility.city !== false && appearance.buildings !== false,
            appearance: buildingAppearance, textured, onTexturesReady: invalidate, groundBlend: city.groundBlend === 'blended',
            refusedParcels: buildingAppearance.diagnostic === 'access' ? entry.refused : undefined,
            renderer: { draw(houseCtx, options) {
              const metrics = entry.houses.draw(houseCtx, { ...options, painted });
              stats.houses.push(metrics); stats.visibleBuildings += metrics.visibleBuildings;
              if (images) stats.materialFaces += textureRoofs(houseCtx, entry, viewport, mpp, buildingAppearance, images);
              return metrics;
            } } });
          stats.frames.push(frame); stats.pending ||= frame.pending;
          if ((city.view ?? 'buildings') !== 'buildings') stats.visibleBuildings += frame.buildings;
        }
      } finally { ctx.restore(); }
      if (isolated) {
        target.save();
        try { target.setTransform(1, 0, 0, 1, 0, 0); target.globalAlpha *= opacity; target.drawImage(layer!, 0, 0); }
        finally { target.restore(); }
      }
      if (stats.pending) invalidate();
      stats.ms = performance.now() - started;
      return stats;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of entries) entry.houses.replaceScene({ buildings: [] });
      entries.length = 0; cities.length = 0; textures.clear();
      if (layer) layer.width = layer.height = 1;
      layer = undefined; context = undefined;
    },
  };
}
