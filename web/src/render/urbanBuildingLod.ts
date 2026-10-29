/** Camera-dependent views of immutable native architecture. No procedural
 * architectural decisions, roof fitting or SVG/DOM construction occur here. */
import type { HouseMaterial, MaterialSlots, Point, RoofEdgeKind, Surface } from '../../../rust/bridge/housesContract';
import type { ArchitectureFunction, ArchitectureVolume, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { houseMaterialColor } from '../../../rust/bridge/houseRender';
import { buildingPaint, type UrbanBuildingAppearance } from './urbanBuildingStyle';

export interface BuildingViewport { minX: number; minY: number; maxX: number; maxY: number }
export type BuildingLod = 'silhouette' | 'ridges' | 'facets';
export interface CompactBuildingCartography {
  height_m?: number;
  /** Already resolved world-space roof lines; absent/empty never invents a gable. */
  ridges: readonly (readonly [Point, Point])[];
  roof_system?: string;
}
type VisualVolume = Pick<ArchitectureVolume, 'z_m' | 'wall_height_m' | 'roof_height_m' | 'materials'> & Partial<Pick<ArchitectureVolume, 'roof_mesh' | 'roof_system'>>;
/** Both PlacedBuilding and a mesh-free resolved plan can satisfy this contract.
 * All coordinates are world metres, including roof mesh vertices and ridges. */
export interface CompactBuildingVisual {
  id: string;
  footprint: Surface;
  roof_footprint: Surface;
  function: ArchitectureFunction;
  entrance?: Point;
  ground_z_m?: number;
  height_m?: number;
  materials?: MaterialSlots;
  volumes?: readonly VisualVolume[];
  cartographic?: CompactBuildingCartography;
}
export interface BuildingLodScene<B extends CompactBuildingVisual = PlacedBuilding> {
  buildings: readonly B[];
  materials?: HouseMaterial[];
}
export interface BuildingLodOptions {
  sectorSizeM?: number;
  /** A huge monument is kept in an overflow list, not thousands of grid cells. */
  maxSectorsPerBuilding?: number;
  maxCachedBuildings?: number;
  maxCachedVertices?: number;
  maxLodHistory?: number;
  ridgeThresholdPx?: number;
  facetThresholdPx?: number;
  hysteresis?: number;
  /** Bounds expensive mesh preparation even for unusually large viewports. */
  maxFacetBuildings?: number;
  raster?: boolean;
  rasterThresholdMpp?: number;
  rasterTilePixels?: number;
  maxRasterBytes?: number;
  maxRasterBuildsPerFrame?: number;
  maxRasterBuildMs?: number;
  /** Optional test/host factory. Default uses OffscreenCanvas, then HTML Canvas. */
  rasterCanvasFactory?: (pixels: number) => OffscreenCanvas | HTMLCanvasElement | undefined;
}
export interface BuildingQueryMetrics {
  totalBuildings: number;
  visitedSectors: number;
  testedBuildings: number;
  visibleBuildings: number;
  queryMs: number;
}
export interface BuildingRenderMetrics extends BuildingQueryMetrics {
  indexBuildMs: number;
  drawMs: number;
  drawCalls: number;
  submittedVertices: number;
  /** Points processed to prepare paths this frame; cached Path2D replay is free here. */
  preparedVertices: number;
  roofMeshesRead: number;
  ridgeSegments: number;
  cacheHits: number;
  cacheMisses: number;
  cachedBuildings: number;
  cachedVertices: number;
  lod: Record<BuildingLod, number>;
  renderMode: 'vector' | 'raster';
  /** Raster counts sum cached tile intersections and may count edge straddlers twice. */
  visibleBuildingsExact: boolean;
  rasterTiles: number;
  rasterTilesBuilt: number;
  /** The host should request another animation frame while this is nonzero. */
  rasterTilesPending: number;
  rasterCacheBytes: number;
  rasterDrawCalls: number;
}
export interface VisibleLodBuilding<B extends CompactBuildingVisual = PlacedBuilding> {
  building: B;
  bounds: BuildingViewport;
  lod: BuildingLod;
  projectedSizePx: number;
}
export interface BuildingLodFrame<B extends CompactBuildingVisual = PlacedBuilding> {
  visible: VisibleLodBuilding<B>[];
  metrics: BuildingQueryMetrics;
}
export interface BuildingDrawOptions {
  viewport: BuildingViewport;
  /** World metres per CSS pixel. The caller owns the Canvas transform and DPR. */
  metresPerPixel: number;
  appearance: UrbanBuildingAppearance;
  selectedId?: string;
  /** False draws retained plans even when native exterior overlays are cached.
   * Does not alter the cache or control native detail demand. Default true. */
  useDetails?: boolean;
  /** Painted plans for the Render background (paintedBuildings): function/landmark tints for
   * silhouettes, height-graded ground shadows, LOD-weighted dark edges. Default: City Bench
   * « Rendu » background (`<html data-city-background="render">`). */
  painted?: boolean;
}

interface IndexedBuilding<B> { building: B; bounds: BuildingViewport; order: number }
interface RingPath { points: readonly Point[]; reverse: boolean }
interface GeometryPath { rings: RingPath[]; vertices: number; path?: Path2D }
export interface BuildingRoofLine { a: Point; b: Point; kind: RoofEdgeKind }
type Line = BuildingRoofLine;
interface FacetLayer { groups: { color: string; darkness: number; geometry: GeometryPath }[]; z: number }
interface CachedGeometry {
  outline: GeometryPath;
  ridges?: Line[];
  facets?: FacetLayer[];
  vertices: number;
}
interface RasterTile {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  bytes: number;
  buildings: number;
  lod: Record<BuildingLod, number>;
  bounds: BuildingViewport;
}
type PathSink = Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo' | 'closePath'>;
const DEFAULTS: Required<BuildingLodOptions> = {
  sectorSizeM: 128, maxSectorsPerBuilding: 64,
  maxCachedBuildings: 2048, maxCachedVertices: 200_000, maxLodHistory: 8192,
  ridgeThresholdPx: 18, facetThresholdPx: 72, hysteresis: .15, maxFacetBuildings: 256,
  raster: true, rasterThresholdMpp: 2, rasterTilePixels: 256, maxRasterBytes: 32 * 1024 * 1024,
  maxRasterBuildsPerFrame: 4, maxRasterBuildMs: 8,
  rasterCanvasFactory: pixels => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(pixels, pixels);
    if (typeof document === 'undefined') return undefined;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = pixels; return canvas;
  },
};
const CURVED_ROOFS = new Set(['RF-CONE', 'RF-DOME', 'RF-DOME-CONE', 'RF-CURVED', 'RF-SADDLE', 'RF-VAULT', 'RF-THATCH-VAULT', 'RF-SHELL', 'RF-SNOW']);

function overlaps(a: BuildingViewport, b: BuildingViewport): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
function validViewport(box: BuildingViewport): boolean {
  return [box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite) && box.minX <= box.maxX && box.minY <= box.maxY;
}
function validPoint(point: Point): boolean { return Number.isFinite(point.x) && Number.isFinite(point.y); }
function surfaceBounds(surface: Surface): BuildingViewport | undefined {
  const bounds = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
  for (const polygon of surface) for (const p of polygon.outer) {
    if (!validPoint(p)) return undefined;
    bounds.minX = Math.min(bounds.minX, p.x); bounds.minY = Math.min(bounds.minY, p.y);
    bounds.maxX = Math.max(bounds.maxX, p.x); bounds.maxY = Math.max(bounds.maxY, p.y);
  }
  return validViewport(bounds) ? bounds : undefined;
}
function roofSurface(building: CompactBuildingVisual): Surface {
  return building.roof_footprint.length ? building.roof_footprint : building.footprint;
}
function clippedLine(line: Line, surface: Surface): Line[] {
  const dx = line.b.x - line.a.x, dy = line.b.y - line.a.y;
  if (Math.hypot(dx, dy) < 1e-9) return [];
  const cuts = [0, 1];
  for (const polygon of surface) for (const ring of [polygon.outer, ...polygon.holes]) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b.x - a.x, ey = b.y - a.y;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-12) continue;
    const ax = a.x - line.a.x, ay = a.y - line.a.y;
    const t = (ax * ey - ay * ex) / denominator, u = (ax * dy - ay * dx) / denominator;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  const at = (t: number): Point => ({x: line.a.x + t * dx, y: line.a.y + t * dy});
  const output: Line[] = [];
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] > 1e-9 && buildingSurfaceContains(surface, at((cuts[i] + cuts[i - 1]) / 2))) {
      output.push({a: at(cuts[i - 1]), b: at(cuts[i]), kind: line.kind});
    }
  }
  return output;
}
function signedArea(ring: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]; area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}
function appendRings(sink: PathSink, rings: readonly RingPath[]): void {
  for (const {points, reverse} of rings) {
    if (points.length < 3) continue;
    for (let i = 0; i < points.length; i++) {
      const p = points[reverse ? points.length - 1 - i : i];
      if (i === 0) sink.moveTo(p.x, p.y); else sink.lineTo(p.x, p.y);
    }
    sink.closePath();
  }
}
function geometryPath(surface: Surface, metrics: Pick<BuildingRenderMetrics, 'preparedVertices'>): GeometryPath {
  const rings: RingPath[] = [];
  let vertices = 0;
  for (const polygon of surface) {
    for (const [hole, points] of [polygon.outer, ...polygon.holes].entries()) {
      if (points.length < 3 || !points.every(validPoint)) continue;
      // Nonzero winding unions overlapping roofs, unlike a single evenodd batch.
      rings.push({points, reverse: (signedArea(points) < 0) !== (hole > 0)});
      vertices += points.length;
    }
  }
  const path = typeof Path2D === 'undefined' ? undefined : new Path2D();
  if (path) appendRings(path, rings);
  metrics.preparedVertices += vertices;
  return {rings, vertices, path};
}
function appendGeometry(sink: CanvasRenderingContext2D, path: GeometryPath): void { appendRings(sink, path.rings); }
function paintGeometry(ctx: CanvasRenderingContext2D, geometry: GeometryPath, metrics: BuildingRenderMetrics, stroke = false): void {
  if (geometry.path) {
    if (stroke) ctx.stroke(geometry.path); else ctx.fill(geometry.path, 'nonzero');
  } else {
    ctx.beginPath(); appendGeometry(ctx, geometry);
    if (stroke) ctx.stroke(); else ctx.fill('nonzero');
  }
  metrics.drawCalls++; metrics.submittedVertices += geometry.vertices;
}
function clipGeometry(ctx: CanvasRenderingContext2D, geometry: GeometryPath): void {
  if (geometry.path) ctx.clip(geometry.path, 'nonzero');
  else { ctx.beginPath(); appendGeometry(ctx, geometry); ctx.clip('nonzero'); }
}

/** Containment uses polygon union and explicit holes, regardless of winding. */
export function buildingSurfaceContains(surface: Surface, point: Point): boolean {
  const inRing = (ring: readonly Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i], dx = b.x - a.x, dy = b.y - a.y;
      const cross = (point.x - a.x) * dy - (point.y - a.y) * dx;
      if (Math.abs(cross) <= 1e-8 * Math.max(1, Math.hypot(dx, dy)) &&
          point.x >= Math.min(a.x, b.x) - 1e-8 && point.x <= Math.max(a.x, b.x) + 1e-8 &&
          point.y >= Math.min(a.y, b.y) - 1e-8 && point.y <= Math.max(a.y, b.y) + 1e-8) return true;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  return surface.some(polygon => inRing(polygon.outer) && !polygon.holes.some(inRing));
}

/** Pure screen-size policy. Hysteresis changes only the representation, never
 * building geometry/identity. The two thresholds are measured in CSS pixels. */
export function selectBuildingLod(projectedSizePx: number, previous?: BuildingLod, options: BuildingLodOptions = {}): BuildingLod {
  const {ridgeThresholdPx: ridge, facetThresholdPx: facet, hysteresis: h} = {...DEFAULTS, ...options};
  if (!Number.isFinite(projectedSizePx) || projectedSizePx < 0) return 'silhouette';
  const ridgeLimit = ridge * (previous === 'ridges' || previous === 'facets' ? 1 - h : previous ? 1 + h : 1);
  const facetLimit = facet * (previous === 'facets' ? 1 - h : previous ? 1 + h : 1);
  if (projectedSizePx >= facetLimit) return 'facets';
  return projectedSizePx >= ridgeLimit ? 'ridges' : 'silhouette';
}

/** Native/compact resolved roof lines shared by interactive Canvas and exports.
 * No ridge is synthesized from a bounding rectangle or an unknown roof style. */
export function buildingRoofRidges(building: CompactBuildingVisual, onMeshRead?: () => void): BuildingRoofLine[] {
  const lines: Line[] = [];
  if (building.cartographic) {
    for (const [a, b] of building.cartographic.ridges) if (validPoint(a) && validPoint(b)) lines.push({a, b, kind: 'ridge'});
  } else for (const volume of building.volumes ?? []) {
    const mesh = volume.roof_mesh; onMeshRead?.();
    if (!mesh) continue;
    for (const edge of mesh.edges ?? []) {
      if (!['ridge', 'hip', 'valley', 'oculus'].includes(edge.kind)) continue;
      if (edge.kind === 'hip') {
        const a = edge.faces[0] === null ? undefined : mesh.faces[edge.faces[0]], b = edge.faces[1] === null ? undefined : mesh.faces[edge.faces[1]];
        const roof = mesh.groups?.find(group => group.id === a?.roof_group)?.rf ?? volume.roof_system ?? '';
        if (a && b && CURVED_ROOFS.has(roof) && a.roof_group === b.roof_group && a.material === b.material && a.kind === b.kind &&
            a.normal.reduce((sum, normal, index) => sum + normal * b.normal[index], 0) > .94) continue;
      }
      const a = mesh.vertices[edge.vertices[0]], b = mesh.vertices[edge.vertices[1]];
      if (a && b && validPoint(a) && validPoint(b)) lines.push({a, b, kind: edge.kind});
    }
  }
  return lines.flatMap(line => clippedLine(line, roofSurface(building)));
}

/** Build once for an immutable scene. Camera changes call draw()/query(), not
 * replaceScene(). Replacement (even with the same IDs) invalidates every cache. */
export class UrbanBuildingLodRenderer<B extends CompactBuildingVisual = PlacedBuilding> {
  private readonly options: Required<BuildingLodOptions>;
  private scene!: { buildings: B[]; materials: HouseMaterial[] };
  private identities = new Set<string>();
  private materialIndex = new Map<string, HouseMaterial>();
  private records: IndexedBuilding<B>[] = [];
  private sectors = new Map<string, number[]>();
  private overflow: number[] = [];
  private seen = new Uint32Array(0);
  private stamp = 0;
  private geometryCache = new Map<CompactBuildingVisual, CachedGeometry>();
  private history = new Map<CompactBuildingVisual, BuildingLod>();
  private cacheVertices = 0;
  private indexBuildMs = 0;
  private byId = new Map<string, IndexedBuilding<B>>();
  /** Close-up exterior overlays; the retained plan owns indexing and picking. */
  private details = new Map<string, CompactBuildingVisual>();
  private rasterCache = new Map<string, RasterTile>();
  private rasterBytes = 0;
  private rasterUnavailable = false;

  constructor(scene: BuildingLodScene<B>, options: BuildingLodOptions = {}) {
    this.options = {...DEFAULTS, ...options};
    for (const key of ['sectorSizeM', 'maxSectorsPerBuilding', 'ridgeThresholdPx', 'facetThresholdPx', 'rasterThresholdMpp', 'rasterTilePixels', 'maxRasterBuildsPerFrame', 'maxRasterBuildMs'] as const) {
      if (!(this.options[key] > 0) || !Number.isFinite(this.options[key])) throw new Error(`Invalid building renderer option: ${key}`);
    }
    for (const key of ['maxCachedBuildings', 'maxCachedVertices', 'maxLodHistory', 'maxFacetBuildings', 'maxRasterBytes'] as const) {
      if (!(this.options[key] >= 0) || !Number.isFinite(this.options[key])) throw new Error(`Invalid building renderer option: ${key}`);
    }
    if (this.options.facetThresholdPx <= this.options.ridgeThresholdPx || this.options.hysteresis < 0 || this.options.hysteresis >= .5) throw new Error('Invalid building LOD thresholds.');
    this.replaceScene(scene);
  }

  replaceScene(scene: BuildingLodScene<B>): void {
    const start = performance.now();
    this.scene = { buildings: [], materials: [] }; this.records = []; this.sectors.clear(); this.byId.clear(); this.details.clear(); this.overflow = []; this.clearCaches();
    this.identities.clear(); this.materialIndex.clear(); this.seen = new Uint32Array(0); this.stamp = 0; this.indexBuildMs = 0;
    this.appendScene(scene);
    this.indexBuildMs = performance.now() - start;
  }

  /** Add one successful progressive chunk. Existing records, close-up detail and
   * vector caches keep their identity; only touched overview tiles are rebuilt.
   * Input arrays remain caller-owned and are never mutated or retained as the
   * growable accumulator. Duplicate IDs/material changes reject before append. */
  appendScene(delta: BuildingLodScene<B>): void {
    const start = performance.now(), ids = new Set<string>();
    for (const building of delta.buildings) {
      if (this.identities.has(building.id) || ids.has(building.id)) throw new Error(`Duplicate building identity: ${building.id}`);
      ids.add(building.id);
    }
    const addedMaterials = new Map<string, HouseMaterial>();
    for (const material of delta.materials ?? []) {
      const previous = addedMaterials.get(material.id) ?? this.materialIndex.get(material.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(material)) throw new Error(`Conflicting building material: ${material.id}`);
      if (!previous) addedMaterials.set(material.id, material);
    }
    for (const [id, material] of addedMaterials) { this.materialIndex.set(id, material); this.scene.materials.push(material); }
    const addedBounds: BuildingViewport[] = [], size = this.options.sectorSizeM;
    for (const building of delta.buildings) {
      this.identities.add(building.id); this.scene.buildings.push(building);
      const bounds = surfaceBounds(roofSurface(building)); if (!bounds) continue;
      addedBounds.push(bounds);
      const index = this.records.length;
      const record = {building, bounds, order: index};
      this.records.push(record); this.byId.set(building.id, record);
      const x0 = Math.floor(bounds.minX / size), x1 = Math.floor(bounds.maxX / size), y0 = Math.floor(bounds.minY / size), y1 = Math.floor(bounds.maxY / size);
      if (![x0, x1, y0, y1].every(Number.isSafeInteger) || (x1 - x0 + 1) * (y1 - y0 + 1) > this.options.maxSectorsPerBuilding) { this.overflow.push(index); continue; }
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const key = `${x},${y}`;
        const sector = this.sectors.get(key);
        if (sector) sector.push(index); else this.sectors.set(key, [index]);
      }
    }
    if (this.records.length > this.seen.length) {
      const seen = new Uint32Array(Math.max(this.records.length, this.seen.length * 2, 64)); seen.set(this.seen); this.seen = seen;
    }
    for (const [key, tile] of this.rasterCache) if (addedBounds.some(bounds => overlaps(bounds, tile.bounds))) {
      this.rasterCache.delete(key); this.rasterBytes -= tile.bytes; tile.canvas.width = tile.canvas.height = 1;
    }
    this.indexBuildMs += performance.now() - start;
  }

  clearCaches(): void {
    this.geometryCache.clear(); this.history.clear(); this.cacheVertices = 0;
    for (const tile of this.rasterCache.values()) tile.canvas.width = tile.canvas.height = 1;
    this.rasterCache.clear(); this.rasterBytes = 0;
  }
  get cacheStats(): {buildings: number; vertices: number; lodHistory: number} {
    return {buildings: this.geometryCache.size, vertices: this.cacheVertices, lodHistory: this.history.size};
  }

  getBuilding(id: string): B | undefined { return this.byId.get(id)?.building; }

  /** Install/remove one immutable exterior without rebuilding the city index or
   * invalidating overview tiles. The footprint references must remain the exact
   * retained plan. Only vector facet LOD uses this overlay. */
  setDetail(id: string, detail?: CompactBuildingVisual): void {
    const base = this.byId.get(id)?.building;
    if (detail && (!base || detail.id !== id || detail.footprint !== base.footprint || detail.roof_footprint !== base.roof_footprint)) {
      throw new Error('A building detail must preserve the indexed plan and identity.');
    }
    const previous = this.details.get(id);
    if (previous === detail) return;
    if (previous) {
      const geometry = this.geometryCache.get(previous);
      if (geometry) { this.cacheVertices -= geometry.vertices; this.geometryCache.delete(previous); }
      this.history.delete(previous);
    }
    if (detail) this.details.set(id, detail); else this.details.delete(id);
  }

  private candidates(viewport: BuildingViewport): {records: IndexedBuilding<B>[]; metrics: BuildingQueryMetrics} {
    if (!validViewport(viewport)) throw new Error('Building viewport must contain finite, ordered bounds.');
    const start = performance.now(), hits: number[] = [];
    const metrics: BuildingQueryMetrics = {totalBuildings: this.scene.buildings.length, visitedSectors: 0, testedBuildings: 0, visibleBuildings: 0, queryMs: 0};
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) { this.seen.fill(0); this.stamp = 1; }
    const add = (indices: readonly number[]): void => {
      for (const index of indices) {
        if (this.seen[index] === this.stamp) continue;
        this.seen[index] = this.stamp; metrics.testedBuildings++;
        const record = this.records[index]; if (overlaps(record.bounds, viewport)) hits.push(index);
      }
    };
    const size = this.options.sectorSizeM;
    const x0 = Math.floor(viewport.minX / size), x1 = Math.floor(viewport.maxX / size), y0 = Math.floor(viewport.minY / size), y1 = Math.floor(viewport.maxY / size);
    if ([x0, x1, y0, y1].every(Number.isSafeInteger) && (x1 - x0 + 1) * (y1 - y0 + 1) <= this.sectors.size) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        metrics.visitedSectors++; const sector = this.sectors.get(`${x},${y}`); if (sector) add(sector);
      }
    } else {
      // A continental viewport must not iterate billions of empty grid cells.
      for (const [key, sector] of this.sectors) {
        metrics.visitedSectors++;
        const comma = key.indexOf(','), x = Number(key.slice(0, comma)), y = Number(key.slice(comma + 1));
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) add(sector);
      }
    }
    add(this.overflow);
    // Stable painter/picking order independent of the order sectors were visited.
    // `order` is the record index and every list is ascending, so a numeric
    // typed-array sort (no comparator) gives the identical order.
    const sorted = Uint32Array.from(hits).sort();
    const records: IndexedBuilding<B>[] = new Array(sorted.length);
    for (let i = 0; i < sorted.length; i++) records[i] = this.records[sorted[i]];
    metrics.visibleBuildings = records.length; metrics.queryMs = performance.now() - start;
    return {records, metrics};
  }

  query(viewport: BuildingViewport, metresPerPixel: number, appearance?: UrbanBuildingAppearance): BuildingLodFrame<B> {
    if (!(metresPerPixel > 0) || !Number.isFinite(metresPerPixel)) throw new Error('metresPerPixel must be finite and positive.');
    const {records, metrics} = this.candidates(viewport);
    const visible = records.map(({building, bounds}): VisibleLodBuilding<B> => {
      const projectedSizePx = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / metresPerPixel;
      const lod = appearance?.style === 'silhouette' ? 'silhouette' : selectBuildingLod(projectedSizePx, this.history.get(building), this.options);
      this.history.delete(building); this.history.set(building, lod);
      if (this.history.size > this.options.maxLodHistory) this.history.delete(this.history.keys().next().value!);
      return {building, bounds, lod, projectedSizePx};
    });
    return {visible, metrics};
  }

  /** Pick the same roof projection that is drawn; courtyard interiors pass through. */
  pick(point: Point): B | undefined {
    if (!validPoint(point)) return undefined;
    const {records} = this.candidates({minX: point.x, minY: point.y, maxX: point.x, maxY: point.y});
    for (let i = records.length - 1; i >= 0; i--) if (buildingSurfaceContains(roofSurface(records[i].building), point)) return records[i].building;
    return undefined;
  }

  /** Same real roof/hole outline as vector/raster selection, without repainting
   * a partial prefix over the complete overview (which would reorder roofs). */
  drawSelection(ctx: CanvasRenderingContext2D, id: string, metresPerPixel: number): boolean {
    const record = this.byId.get(id); if (!record) return false;
    if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) throw new Error('Invalid selection scale.');
    const outline = geometryPath(roofSurface(record.building), { preparedVertices: 0 });
    ctx.save(); try {
      ctx.strokeStyle = '#197ea4'; ctx.lineWidth = 2 * metresPerPixel; ctx.lineJoin = 'round';
      if (outline.path) ctx.stroke(outline.path); else { ctx.beginPath(); appendGeometry(ctx, outline); ctx.stroke(); }
    } finally { ctx.restore(); }
    return true;
  }

  private lastColors: object | undefined; private lastColorKey = '{}';
  /** Colour cache key, recomputed only when the colours object changes. */
  private colorKeyOf(colors: object | undefined): string {
    if (colors !== this.lastColors || colors === undefined) { this.lastColors = colors; this.lastColorKey = JSON.stringify(colors ?? {}); }
    return this.lastColorKey;
  }

  private geometry(building: CompactBuildingVisual, metrics: BuildingRenderMetrics): CachedGeometry {
    const cached = this.geometryCache.get(building);
    if (cached) { this.geometryCache.delete(building); this.geometryCache.set(building, cached); metrics.cacheHits++; return cached; }
    metrics.cacheMisses++;
    const outline = geometryPath(roofSurface(building), metrics);
    const geometry: CachedGeometry = {outline, vertices: outline.vertices};
    this.geometryCache.set(building, geometry); this.cacheVertices += geometry.vertices;
    this.trimCache(); return geometry;
  }
  private growGeometry(building: CompactBuildingVisual, geometry: CachedGeometry, vertices: number): void {
    geometry.vertices += vertices;
    if (this.geometryCache.get(building) === geometry) this.cacheVertices += vertices;
    this.trimCache();
  }
  private trimCache(): void {
    while (this.geometryCache.size > this.options.maxCachedBuildings || this.cacheVertices > this.options.maxCachedVertices) {
      const oldest = this.geometryCache.keys().next().value;
      if (oldest === undefined) break;
      this.cacheVertices -= this.geometryCache.get(oldest)!.vertices; this.geometryCache.delete(oldest);
    }
  }
  private ridges(building: CompactBuildingVisual, geometry: CachedGeometry, metrics: BuildingRenderMetrics): Line[] {
    if (geometry.ridges) return geometry.ridges;
    const clipped = buildingRoofRidges(building, () => metrics.roofMeshesRead++);
    geometry.ridges = clipped; metrics.preparedVertices += clipped.length * 2;
    this.growGeometry(building, geometry, clipped.length * 2); return clipped;
  }
  private facets(building: CompactBuildingVisual, geometry: CachedGeometry, metrics: BuildingRenderMetrics): FacetLayer[] {
    if (geometry.facets) return geometry.facets;
    const layers: FacetLayer[] = [], catalogue = {materials: this.scene.materials ?? []};
    let vertices = 0;
    for (const volume of building.volumes ?? []) {
      const mesh = volume.roof_mesh; metrics.roofMeshesRead++;
      if (!mesh) continue;
      const grouped = new Map<string, {surfaces: Map<string, Surface>; darkness: Map<string, number>; z: number}>();
      for (const face of mesh.faces) {
        if (face.normal[2] < 0 || face.vertices.length < 3) continue;
        const points = face.vertices.map(index => mesh.vertices[index]);
        if (points.some(point => !point || !validPoint(point))) continue;
        const key = face.roof_group ?? '';
        let group = grouped.get(key);
        if (!group) { group = {surfaces: new Map(), darkness: new Map(), z: -Infinity}; grouped.set(key, group); }
        for (const point of points) group.z = Math.max(group.z, point.z);
        // Same world-space illumination as the existing native exterior SVG.
        const [nx, ny, nz] = face.normal;
        const darkness = Math.max(0, Math.min(.3, .16 - .18 * (-nx * .48 - ny * .64 + nz * .6)));
        const base = houseMaterialColor(catalogue, face.material || volume.materials.cladding);
        const color = shadeMaterial(base, darkness); group.darkness.set(color, darkness);
        const surface = group.surfaces.get(color) ?? [];
        surface.push({outer: points, holes: []}); group.surfaces.set(color, surface);
      }
      for (const group of grouped.values()) {
        const groups = [...group.surfaces].map(([color, surface]) => {
          const geometry = geometryPath(surface, metrics); vertices += geometry.vertices; return {color, darkness: group.darkness.get(color)!, geometry};
        });
        layers.push({groups, z: group.z});
      }
    }
    layers.sort((a, b) => a.z - b.z); geometry.facets = layers;
    this.growGeometry(building, geometry, vertices); return layers;
  }

  /** Draws into the caller's world-to-screen Canvas transform. It clips to the
   * viewport and restores state; it neither clears the canvas nor changes DPR.
   * Overview tiles populate progressively: request another animation frame while
   * metrics.rasterTilesPending > 0. Warm overview frames never enumerate buildings. */
  draw(ctx: CanvasRenderingContext2D, options: BuildingDrawOptions): BuildingRenderMetrics {
    if (!validViewport(options.viewport)) throw new Error('Building viewport must contain finite, ordered bounds.');
    if (!(options.metresPerPixel > 0) || !Number.isFinite(options.metresPerPixel)) throw new Error('metresPerPixel must be finite and positive.');
    if (this.options.raster && !this.rasterUnavailable && options.metresPerPixel >= this.options.rasterThresholdMpp) {
      const raster = this.drawRaster(ctx, options); if (raster) return raster;
    }
    return this.drawVector(ctx, options);
  }

  private drawVector(ctx: CanvasRenderingContext2D, options: BuildingDrawOptions): BuildingRenderMetrics {
    const start = performance.now(), frame = this.query(options.viewport, options.metresPerPixel, options.appearance);
    const painted = paintedBuildings(options), shadows: GeometryPath[][] = [[], [], []], landmarks: GeometryPath[] = [];
    const metrics: BuildingRenderMetrics = {...frame.metrics, indexBuildMs: this.indexBuildMs, drawMs: 0, drawCalls: 0,
      submittedVertices: 0, preparedVertices: 0, roofMeshesRead: 0, ridgeSegments: 0, cacheHits: 0, cacheMisses: 0,
      cachedBuildings: 0, cachedVertices: 0, lod: {silhouette: 0, ridges: 0, facets: 0}, renderMode: 'vector', visibleBuildingsExact: true,
      rasterTiles: 0, rasterTilesBuilt: 0, rasterTilesPending: 0, rasterCacheBytes: this.rasterBytes, rasterDrawCalls: 0};
    const fills = new Map<string, GeometryPath[]>(), detailed: {building: CompactBuildingVisual; geometry: CachedGeometry; lod: BuildingLod}[] = [];
    const catalogue = {materials: this.scene.materials ?? []};
    let selected: CachedGeometry | undefined, facetsRemaining = this.options.maxFacetBuildings;
    for (const entry of frame.visible) {
      let lod = entry.lod;
      if (lod === 'facets' && facetsRemaining-- <= 0) lod = 'ridges';
      const building = options.useDetails !== false && lod === 'facets' && options.metresPerPixel < this.options.rasterThresholdMpp
        ? this.details.get(entry.building.id) ?? entry.building : entry.building;
      const geometry = this.geometry(building, metrics);
      metrics.lod[lod]++;
      const paint = buildingPaint(building.materials ?? building.volumes?.[0]?.materials, building.function, visualHeight(building), options.appearance, undefined, catalogue);
      const flat = options.appearance.style === 'silhouette' && options.appearance.diagnostic === 'none', landmark = painted && isLandmark(building);
      const color = flat ? (options.appearance.colors?.building ?? (painted ? PAINTED_SILHOUETTE[landmark ? 'landmark' : building.function] ?? PAINTED_SILHOUETTE.domestic : '#5a4b3c')) : paint.roof;
      const group = fills.get(color) ?? []; group.push(geometry.outline); fills.set(color, group);
      if (painted) {
        const height = visualHeight(building);
        shadows[landmark || height >= 12 ? 2 : height >= 6 ? 1 : 0].push(geometry.outline);
        if (landmark) landmarks.push(geometry.outline);
      }
      if (lod !== 'silhouette') detailed.push({building, geometry, lod});
      if (building.id === options.selectedId) selected = geometry;
    }
    ctx.save();
    try {
      const {viewport, metresPerPixel: mpp} = options;
      ctx.beginPath(); ctx.rect(viewport.minX, viewport.minY, viewport.maxX - viewport.minX, viewport.maxY - viewport.minY); ctx.clip();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // Painted: soft ground shadows to the south-east, longer for taller buildings, under
      // every roof (they fall on yards, streets and courtyards, never on a neighbour's roof).
      if (painted) shadows.forEach((paths, level) => {
        if (!paths.length) return;
        const offset = Math.max(PAINTED_SHADOW_M[level], (level + 1) * .7 * mpp);
        ctx.save(); ctx.translate(offset, offset * .8); ctx.fillStyle = PAINTED_SHADOW;
        fillBatch(ctx, paths, metrics); ctx.restore();
      });
      for (const [color, paths] of fills) {
        ctx.fillStyle = color;
        const batch = typeof Path2D === 'undefined' ? undefined : new Path2D();
        if (batch) { for (const path of paths) { if (path.path) batch.addPath(path.path); else appendRings(batch, path.rings); } ctx.fill(batch, 'nonzero'); }
        else { ctx.beginPath(); for (const path of paths) appendGeometry(ctx, path); ctx.fill('nonzero'); }
        metrics.drawCalls++; for (const path of paths) metrics.submittedVertices += path.vertices;
      }
      // Painted: one dark edge for every footprint (and its courtyards), weighted by zoom;
      // landmarks get a heavier, warmer one.
      if (painted && mpp < 2.5) {
        const all: GeometryPath[] = []; for (const paths of fills.values()) all.push(...paths);
        ctx.strokeStyle = options.appearance.colors?.buildingEdge ?? PAINTED_EDGE; ctx.globalAlpha = mpp < .4 ? .85 : .65; ctx.lineWidth = (mpp < .4 ? .8 : mpp < 1 ? .65 : .5) * mpp;
        strokeBatch(ctx, all, metrics);
        if (landmarks.length) { ctx.strokeStyle = options.appearance.colors?.buildingEdge ?? PAINTED_LANDMARK_EDGE; ctx.globalAlpha = .9; ctx.lineWidth = 1.4 * mpp; strokeBatch(ctx, landmarks, metrics); }
        ctx.globalAlpha = 1;
      }
      const lineGroups = new Map<string, Line[]>();
      for (const {building, geometry, lod} of detailed) {
        if (lod === 'facets' && options.appearance.diagnostic !== 'uses' && options.appearance.diagnostic !== 'height') {
          const facets = this.facets(building, geometry, metrics);
          if (facets.length) {
            ctx.save(); clipGeometry(ctx, geometry.outline);
            for (const layer of facets) for (const group of layer.groups) {
              ctx.fillStyle = options.appearance.colors?.building ? shadeMaterial(options.appearance.colors.building, group.darkness) : group.color; paintGeometry(ctx, group.geometry, metrics);
            }
            ctx.restore();
          }
        }
        for (const line of this.ridges(building, geometry, metrics)) {
          if (Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) / mpp < 1.5) continue;
          const color = options.appearance.colors?.buildingEdge ?? (line.kind === 'valley' ? '#736e53' : '#393a31');
          const lines = lineGroups.get(color) ?? []; lines.push(line); lineGroups.set(color, lines);
        }
      }
      for (const [color, lines] of lineGroups) {
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = .8 * mpp;
        for (const {a, b} of lines) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        ctx.stroke(); metrics.drawCalls++; metrics.ridgeSegments += lines.length; metrics.submittedVertices += lines.length * 2;
      }
      if (options.appearance.diagnostic === 'access') {
        ctx.beginPath(); ctx.fillStyle = '#147e67';
        for (const {building} of frame.visible) if (building.entrance && validPoint(building.entrance)) {
          const radius = 2.2 * mpp, {x, y} = building.entrance;
          ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, Math.PI * 2);
        }
        ctx.fill(); metrics.drawCalls++;
      }
      if (selected) { ctx.strokeStyle = '#197ea4'; ctx.lineWidth = 2 * mpp; paintGeometry(ctx, selected.outline, metrics, true); }
    } finally { ctx.restore(); }
    metrics.cachedBuildings = this.geometryCache.size; metrics.cachedVertices = this.cacheVertices;
    metrics.drawMs = performance.now() - start; return metrics;
  }

  private drawRaster(ctx: CanvasRenderingContext2D, options: BuildingDrawOptions): BuildingRenderMetrics | undefined {
    const start = performance.now(), pixels = Math.floor(this.options.rasterTilePixels), padded = pixels + 2, bytes = padded * padded * 4;
    const capacity = Math.floor(this.options.maxRasterBytes / bytes);
    // Four tiles are the irreducible case for a viewport straddling both axes.
    if (capacity < 4) return undefined;
    const {viewport, appearance} = options;
    let level = Math.floor(Math.log2(options.metresPerPixel)), tileMpp = 2 ** level, worldSize = pixels * tileMpp;
    let x0 = Math.floor(viewport.minX / worldSize), x1 = Math.floor(viewport.maxX / worldSize), y0 = Math.floor(viewport.minY / worldSize), y1 = Math.floor(viewport.maxY / worldSize);
    if (![x0, x1, y0, y1].every(Number.isSafeInteger)) return undefined;
    // A constrained host cache uses coarser tiles instead of endless LRU churn.
    while ((x1 - x0 + 1) * (y1 - y0 + 1) > capacity) {
      level++; tileMpp *= 2; worldSize *= 2;
      x0 = Math.floor(viewport.minX / worldSize); x1 = Math.floor(viewport.maxX / worldSize);
      y0 = Math.floor(viewport.minY / worldSize); y1 = Math.floor(viewport.maxY / worldSize);
    }
    const metrics: BuildingRenderMetrics = {totalBuildings: this.scene.buildings.length, visitedSectors: 0, testedBuildings: 0, visibleBuildings: 0, queryMs: 0,
      indexBuildMs: this.indexBuildMs, drawMs: 0, drawCalls: 0, submittedVertices: 0, preparedVertices: 0, roofMeshesRead: 0, ridgeSegments: 0,
      cacheHits: 0, cacheMisses: 0, cachedBuildings: 0, cachedVertices: 0, lod: {silhouette: 0, ridges: 0, facets: 0},
      renderMode: 'raster', visibleBuildingsExact: false, rasterTiles: 0, rasterTilesBuilt: 0, rasterTilesPending: 0, rasterCacheBytes: 0, rasterDrawCalls: 0};
    const colorKey = this.colorKeyOf(appearance.colors), paint = paintedBuildings(options) ? 'painted' : '';
    const tiles: {key: string; x: number; y: number; tile?: RasterTile}[] = [];
    const protectedKeys = new Set<string>();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = `${level}:${x}:${y}:${appearance.style}:${appearance.diagnostic}:${colorKey}:${paint}`;
      const tile = this.rasterCache.get(key); protectedKeys.add(key); tiles.push({key, x, y, tile});
      if (tile) { this.rasterCache.delete(key); this.rasterCache.set(key, tile); }
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const missing = tiles.filter(tile => !tile.tile);
    if (missing.length > 1) missing.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - (b.x - cx) ** 2 - (b.y - cy) ** 2);
    for (const entry of missing) {
      if (metrics.rasterTilesBuilt >= this.options.maxRasterBuildsPerFrame || (metrics.rasterTilesBuilt > 0 && performance.now() - start >= this.options.maxRasterBuildMs)) break;
      const canvas = this.options.rasterCanvasFactory(padded);
      if (!canvas) { this.rasterUnavailable = true; return undefined; }
      const tileContext = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!tileContext) { this.rasterUnavailable = true; return undefined; }
      const minX = entry.x * worldSize, minY = entry.y * worldSize;
      tileContext.setTransform(1 / tileMpp, 0, 0, 1 / tileMpp, 1 - minX / tileMpp, 1 - minY / tileMpp);
      const generated = this.drawVector(tileContext as CanvasRenderingContext2D, {
        viewport: {minX: minX - tileMpp, minY: minY - tileMpp, maxX: minX + worldSize + tileMpp, maxY: minY + worldSize + tileMpp},
        metresPerPixel: tileMpp, appearance, painted: paintedBuildings(options),
      });
      const tile: RasterTile = {canvas, bytes, buildings: generated.visibleBuildings, lod: generated.lod,
        bounds: {minX: minX - tileMpp, minY: minY - tileMpp, maxX: minX + worldSize + tileMpp, maxY: minY + worldSize + tileMpp}};
      entry.tile = tile; this.rasterCache.set(entry.key, tile); this.rasterBytes += bytes; metrics.rasterTilesBuilt++;
      for (const key of ['visitedSectors', 'testedBuildings', 'queryMs', 'drawCalls', 'submittedVertices', 'preparedVertices', 'roofMeshesRead', 'ridgeSegments', 'cacheHits', 'cacheMisses'] as const) metrics[key] += generated[key];
      // Protect this frame's tiles. The visible set was capped to fit the budget.
      for (const [key, old] of this.rasterCache) {
        if (this.rasterBytes <= this.options.maxRasterBytes) break;
        if (!protectedKeys.has(key)) {
          this.rasterCache.delete(key); this.rasterBytes -= old.bytes;
          old.canvas.width = old.canvas.height = 1;
        }
      }
    }
    ctx.save();
    try {
      ctx.beginPath(); ctx.rect(viewport.minX, viewport.minY, viewport.maxX - viewport.minX, viewport.maxY - viewport.minY); ctx.clip();
      for (const entry of tiles) {
        if (!entry.tile) { metrics.rasterTilesPending++; continue; }
        ctx.drawImage(entry.tile.canvas, 1, 1, pixels, pixels, entry.x * worldSize, entry.y * worldSize, worldSize, worldSize);
        metrics.drawCalls++; metrics.rasterDrawCalls++; metrics.rasterTiles++;
        metrics.visibleBuildings += entry.tile.buildings;
        for (const lod of ['silhouette', 'ridges', 'facets'] as const) metrics.lod[lod] += entry.tile.lod[lod];
      }
      const selected = options.selectedId ? this.byId.get(options.selectedId) : undefined;
      if (selected && overlaps(selected.bounds, viewport)) {
        const geometry = this.geometry(selected.building, metrics);
        ctx.strokeStyle = '#197ea4'; ctx.lineWidth = 2 * options.metresPerPixel; ctx.lineJoin = 'round';
        paintGeometry(ctx, geometry.outline, metrics, true);
      }
    } finally { ctx.restore(); }
    metrics.cachedBuildings = this.geometryCache.size; metrics.cachedVertices = this.cacheVertices;
    metrics.rasterCacheBytes = this.rasterBytes; metrics.drawMs = performance.now() - start; return metrics;
  }
}

// ---------------------------------------------------------------- painted plans (Render background)
const paintedBuildings = (options: BuildingDrawOptions): boolean => options.painted ?? globalThis.document?.documentElement.dataset.cityBackground === 'render';
/** Silhouette tints by function: warm roofs for houses, greyer for stores, a deep slate for landmarks. */
const PAINTED_SILHOUETTE: Record<string, string> = {
  domestic: '#8a5c45', mixed: '#93664a', workshop: '#7c6652', warehouse: '#6e6a63', collective: '#6b5a63', open_space: '#7f8461', landmark: '#4f4459',
};
const PAINTED_SHADOW = 'rgba(22, 18, 10, 0.3)', PAINTED_EDGE = '#241d15', PAINTED_LANDMARK_EDGE = '#d9c79a';
/** Ground shadow offsets (metres) of low (< 6 m), mid and tall (≥ 12 m, landmarks) buildings. */
const PAINTED_SHADOW_M = [1.1, 2, 3.4];
/** Conservative support of THIS painter's shadows/strokes/access markers, not
 * architectural geometry. Used only to frame a complete persisted raster. */
export function urbanOverviewInkPadding(painted: boolean, access: boolean): { world: number; pixels: number } {
  return { world: painted ? Math.max(...PAINTED_SHADOW_M) : 0,
    pixels: Math.max(1, access ? 2.2 : 0, painted ? 3 * .7 + 1.4 / 2 : 0) };
}
function isLandmark(building: CompactBuildingVisual): boolean {
  return !!(building as { programme?: { landmark?: boolean | null } }).programme?.landmark;
}
function fillBatch(ctx: CanvasRenderingContext2D, paths: readonly GeometryPath[], metrics: BuildingRenderMetrics): void {
  const batch = typeof Path2D === 'undefined' ? undefined : new Path2D();
  if (batch) { for (const path of paths) { if (path.path) batch.addPath(path.path); else appendRings(batch, path.rings); } ctx.fill(batch, 'nonzero'); }
  else { ctx.beginPath(); for (const path of paths) appendGeometry(ctx, path); ctx.fill('nonzero'); }
  metrics.drawCalls++; for (const path of paths) metrics.submittedVertices += path.vertices;
}
function strokeBatch(ctx: CanvasRenderingContext2D, paths: readonly GeometryPath[], metrics: BuildingRenderMetrics): void {
  const batch = typeof Path2D === 'undefined' ? undefined : new Path2D();
  if (batch) { for (const path of paths) { if (path.path) batch.addPath(path.path); else appendRings(batch, path.rings); } ctx.stroke(batch); }
  else { ctx.beginPath(); for (const path of paths) appendGeometry(ctx, path); ctx.stroke(); }
  metrics.drawCalls++;
}

function visualHeight(building: CompactBuildingVisual): number {
  if (building.cartographic?.height_m !== undefined) return building.cartographic.height_m;
  if (building.height_m !== undefined) return building.height_m;
  let height = 0;
  for (const volume of building.volumes ?? []) height = Math.max(height, volume.z_m + volume.wall_height_m + volume.roof_height_m - (building.ground_z_m ?? 0));
  return height;
}
function shadeMaterial(color: string, darkness: number): string {
  const value = Number.parseInt(color.slice(1), 16), shade = Math.round(darkness * 24) / 24;
  return `rgb(${Math.round(((value >> 16) & 255) * (1 - shade) + 41 * shade)},${Math.round(((value >> 8) & 255) * (1 - shade) + 51 * shade)},${Math.round((value & 255) * (1 - shade) + 45 * shade)})`;
}
