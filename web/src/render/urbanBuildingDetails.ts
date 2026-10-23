/** Bounded on-demand native exterior detail. Retained compact plans remain the
 * city scene; this controller only attaches close-up visuals to its renderer. */
import type { Feature, HouseBatch, HouseUnit, Point, Surface, Vertex3 } from '../../../rust/bridge/housesContract';
import type { ArchitectureVolume, PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { isArchivedPlan, type PlanArchiveScene } from '../../../rust/bridge/compactPlanArchive';
import { UrbanBuildingLodRenderer, type BuildingViewport, type CompactBuildingVisual } from './urbanBuildingLod';
import { projectNativeBuilding } from '../ui/urbanBuildingProjection';

export interface BuildingDetailView {
  viewport: BuildingViewport;
  metresPerPixel: number;
  selectedId?: string;
  /** Set only in the city detailed display mode. */
  enabled?: boolean;
}
export interface BuildingDetailStats {
  queued: number;
  inFlight: number;
  /** Shared work slots, including cold reads and disposed controllers draining
   * a physical native call. Reading a plan never frees a slot early. */
  globalInFlight: number;
  cached: number;
  /** Geometry plus cold retained-plan encoded accounting, not measured JS heap. */
  cacheBytes: number;
  cachedVertices: number;
  refused: number;
  requestsStarted: number;
  responsesDiscarded: number;
}
export interface BuildingDetailStatus {
  state: 'idle' | 'queued' | 'loading' | 'ready' | 'refused';
  message?: string;
  diagnostics?: readonly string[];
}
export interface LoadedBuildingDetailPlan { building: PlacedBuilding; scene: PlanArchiveScene }
export type BuildingDetailLoader<B extends CompactBuildingVisual> = (visual: B) => Promise<LoadedBuildingDetailPlan | undefined>;
interface BuildingDetailCommonOptions<B extends CompactBuildingVisual> {
  renderer: UrbanBuildingLodRenderer<B>;
  /** Never call interiors here. An HTTP abort does not cancel Rust CPU work:
   * keep this promise pending until the physical native response settles. */
  realize(building: PlacedBuilding, options: { interiors: false; scene: PlanArchiveScene }): Promise<HouseBatch>;
  /** Coalesced microtask; schedule a repaint, do not reconstruct the scene. */
  onChange?(stats: BuildingDetailStats): void;
  maxConcurrency?: number;
  maxQueued?: number;
  maxCachedBuildings?: number;
  maxCacheBytes?: number;
  maxCachedVertices?: number;
  maxRefusals?: number;
  maxAutoMetresPerPixel?: number;
  minProjectedSizePx?: number;
}
/** The cold path retains a loader and visual records, never a complete native
 * scene. A shared cold reader must serialize its own physical reads. */
export type BuildingDetailOptions<B extends CompactBuildingVisual = PlacedBuilding> = BuildingDetailCommonOptions<B> & (
  { scene: PlacementBatch; load?: never; canRealize?: never }
  | { scene?: never; load: BuildingDetailLoader<B>; canRealize(visual: B): boolean }
);
interface DetailEntry {
  building: PlacedBuilding;
  visual?: CompactBuildingVisual;
  geometryBytes: number;
  vertices: number;
  diagnostics: string[];
}
interface Job<B> { id: number; building: B; epoch: number }
const DEFAULTS = { maxConcurrency: 2, maxQueued: 32, maxCachedBuildings: 64, maxCacheBytes: 16 * 1024 * 1024,
  maxCachedVertices: 150_000, maxRefusals: 256, maxAutoMetresPerPixel: .5, minProjectedSizePx: 72 };
// Aborting a fetch would free a JS slot while Rust still works. Drain all native
// calls instead. This semaphore survives scene and controller replacement.
let physicalCalls = 0;
const waiting = new Set<{ pump(): void }>();
const EMPTY_MESH: ArchitectureVolume['roof_mesh'] = { vertices: [], faces: [], edges: [], groups: [] };

function transformSurface(surface: Surface, map: (point: Point) => Point): Surface {
  return surface.map(polygon => ({ outer: polygon.outer.map(map), holes: polygon.holes.map(ring => ring.map(map)) }));
}
function pointsIn(surface: Surface): number {
  return surface.reduce((count, polygon) => count + polygon.outer.length + polygon.holes.reduce((n, ring) => n + ring.length, 0), 0);
}
function assertRetainedBody(local: Surface, world: Surface, map: (point: Point) => Point): void {
  if (local.length !== world.length) throw new Error('Native exterior changed retained body polygons.');
  for (let i = 0; i < local.length; i++) {
    const a = [local[i].outer, ...local[i].holes], b = [world[i].outer, ...world[i].holes];
    if (a.length !== b.length) throw new Error('Native exterior changed retained body holes.');
    for (let j = 0; j < a.length; j++) {
      if (a[j].length !== b[j].length) throw new Error('Native exterior changed retained body vertices.');
      for (let k = 0; k < a[j].length; k++) {
        const p = map(a[j][k]), q = b[j][k];
        if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-4) throw new Error('Native exterior moved the retained body footprint.');
      }
    }
  }
}

/** Exact native local → world conversion. The complete roof mesh is installed
 * once on the first retained volume (faces retain their body/group/material IDs)
 * to avoid duplicating shared roof vertices. No footprint is regenerated. */
export function nativeExteriorDetail(base: PlacedBuilding, result: HouseBatch, maxVertices = DEFAULTS.maxCachedVertices): DetailEntry {
  if (result.units.length !== 1) throw new Error('Native detail must contain exactly one retained unit.');
  const unit: HouseUnit = result.units[0];
  if (unit.recipe_id !== base.recipe_id || unit.variant_id !== base.variant_id || unit.bodies.length !== base.volumes.length || !unit.bodies.length) {
    throw new Error('Native detail does not match the retained recipe, variant and bodies.');
  }
  const transform = unit.transform;
  if (Math.abs(transform.orientation_deg - base.transform.orientation_deg) > 1e-7
    || Math.hypot(transform.origin.x - base.transform.origin.x, transform.origin.y - base.transform.origin.y) > 1e-6) {
    throw new Error('Native detail changed the retained world transform.');
  }
  const angle = transform.orientation_deg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const map = (p: Point): Point => ({ x: transform.origin.x + p.x * c - p.y * s, y: transform.origin.y + p.x * s + p.y * c });
  const map3 = (p: Vertex3): Vertex3 => {
    const point = { ...map(p), z: base.ground_z_m + p.z };
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('Native exterior contains a non-finite vertex.');
    return point;
  };
  for (let i = 0; i < unit.bodies.length; i++) assertRetainedBody(unit.bodies[i].footprint, base.volumes[i].footprint, map);
  const mesh = unit.roofs;
  let vertices = mesh.vertices.length;
  for (const group of mesh.groups ?? []) vertices += pointsIn(group.domain);
  for (const feature of unit.features) {
    vertices += pointsIn(feature.surface) + feature.vertices3d.length;
    if (feature.roof) { vertices += pointsIn(feature.roof.domain); for (const arm of feature.roof.arms) vertices += pointsIn(arm.domain) + 1; }
  }
  if (vertices > maxVertices) throw new Error(`Native exterior exceeds the detail vertex budget (${vertices}).`);
  let indices = 0;
  const worldMesh: ArchitectureVolume['roof_mesh'] = {
    vertices: mesh.vertices.map(map3),
    faces: mesh.faces.map(face => {
      if (!face.normal.every(Number.isFinite) || face.vertices.some(index => !Number.isInteger(index) || index < 0 || index >= mesh.vertices.length)) throw new Error('Native exterior has invalid roof indices or normal.');
      indices += face.vertices.length;
      const [nx, ny, nz] = face.normal;
      return { ...face, normal: [nx * c - ny * s, nx * s + ny * c, nz] };
    }),
    edges: mesh.edges,
    groups: mesh.groups.map(group => ({ ...group, domain: transformSurface(group.domain, map) })),
  };
  const features: Feature[] = unit.features.map(feature => ({ ...feature, surface: transformSurface(feature.surface, map),
    z_m: base.ground_z_m + feature.z_m, vertices3d: feature.vertices3d.map(map3),
    ...(feature.roof ? { roof: { ...feature.roof, domain: transformSurface(feature.roof.domain, map), support_z_m: base.ground_z_m + feature.roof.support_z_m,
      arms: feature.roof.arms.map(arm => ({ ...arm, origin: map(arm.origin), domain: transformSurface(arm.domain, map),
        axis: [arm.axis[0] * c - arm.axis[1] * s, arm.axis[0] * s + arm.axis[1] * c] })) } } : {}),
  }));
  // Per-body bounds from actual native roof faces, without copying the mesh N times.
  const tops = new Map<string, number>();
  for (const face of worldMesh.faces) for (const index of face.vertices) tops.set(face.body_id ?? '', Math.max(tops.get(face.body_id ?? '') ?? -Infinity, worldMesh.vertices[index].z));
  const volumes = base.volumes.map((volume, i) => ({ ...volume, roof_system: unit.bodies[i].roof_system,
    roof_height_m: Math.max(0, (tops.get(unit.bodies[i].id) ?? volume.z_m + volume.wall_height_m + volume.roof_height_m) - volume.z_m - volume.wall_height_m),
    roof_mesh: i === 0 ? worldMesh : EMPTY_MESH }));
  const diagnostics = [...unit.diagnostics, ...result.diagnostics];
  const building: PlacedBuilding = { ...base, volumes, structural_features: features,
    // Native edges supersede proxy ridges, while simplification/capacity and the
    // retained plan/archive remain unchanged and do not gain certification.
    cartographic: undefined, diagnostics: [...base.diagnostics, ...diagnostics] };
  const geometryBytes = vertices * 64 + indices * 8 + mesh.faces.length * 192 + mesh.edges.length * 80
    + mesh.groups.length * 128 + features.length * 192 + diagnostics.reduce((n, line) => n + line.length * 2, 0);
  return { building, geometryBytes, vertices, diagnostics };
}

function sameSurface(a: Surface, b: Surface): boolean {
  if (a.length !== b.length) return false;
  return a.every((polygon, i) => {
    const rings = [polygon.outer, ...polygon.holes], other = [b[i].outer, ...b[i].holes];
    return rings.length === other.length && rings.every((ring, j) => ring.length === other[j].length
      && ring.every((point, k) => Object.is(point.x, other[j][k].x) && Object.is(point.y, other[j][k].y)));
  });
}
function assertLoadedVisual(visual: CompactBuildingVisual, loaded: LoadedBuildingDetailPlan): void {
  const native = loaded.building;
  if (native.id !== visual.id || native.function !== visual.function || native.simplification !== 'architectural_plan'
    || loaded.scene.buildings.length !== 1 || loaded.scene.buildings[0] !== native || !sameSurface(visual.footprint, native.footprint)
    || !sameSurface(visual.roof_footprint, native.roof_footprint)
    || visual.ground_z_m !== undefined && !Object.is(visual.ground_z_m, native.ground_z_m)
    || visual.entrance && (!Object.is(visual.entrance.x, native.entrance.x) || !Object.is(visual.entrance.y, native.entrance.y))
    || 'recipe_id' in visual && visual.recipe_id !== native.recipe_id
    || 'variant_id' in visual && visual.variant_id !== native.variant_id
    || 'parcel_id' in visual && visual.parcel_id !== native.parcel_id) {
    throw new Error('Loaded native plan does not match the indexed building visual.');
  }
  const height = native.cartographic?.height_m ?? native.volumes.reduce((n, volume) =>
    Math.max(n, volume.z_m + volume.wall_height_m + volume.roof_height_m - native.ground_z_m), 0);
  if (visual.height_m !== undefined && !Object.is(visual.height_m, height)) throw new Error('Loaded native plan changed the indexed building height.');
  if ('projection' in visual && visual.projection === 'native-building-visual-1' && !sameVisual(visual, projectNativeBuilding(native)))
    throw new Error('Loaded native plan changed the indexed cartography, occupation or ground constraints.');
}
function isRetainedNativeVisual(visual: CompactBuildingVisual): visual is PlacedBuilding {
  // The legacy scene already owns these records. This guard excludes DTOs
  // without rescanning a whole-city array for each close-up request.
  return 'simplification' in visual && visual.simplification === 'architectural_plan'
    && 'resolved' in visual && 'transform' in visual && 'recipe_id' in visual && 'variant_id' in visual
    && 'parcel_id' in visual && 'culture' in visual && 'diagnostics' in visual
    && 'useful_area_m2' in visual && 'domestic_units' in visual && Array.isArray(visual.volumes);
}
function sameVisual(a: CompactBuildingVisual, b: CompactBuildingVisual): boolean {
  if (!sameSurface(a.footprint, b.footprint) || !sameSurface(a.roof_footprint, b.roof_footprint)) return false;
  // DTOs have no parent/native graph. Compare all remaining metadata exactly,
  // including signed zero, without a JSON round trip or assumptions about keys.
  const equal = (x: unknown, y: unknown): boolean => {
    if (Object.is(x, y)) return true;
    if (!x || !y || typeof x !== 'object' || typeof y !== 'object' || Array.isArray(x) !== Array.isArray(y)) return false;
    const keys = Object.keys(x), other = Object.keys(y);
    return keys.length === other.length && keys.every(key => Object.hasOwn(y, key) && equal(Reflect.get(x, key), Reflect.get(y, key)));
  };
  const keys = Object.keys(a).filter(key => key !== 'footprint' && key !== 'roof_footprint');
  return keys.length === Object.keys(b).filter(key => key !== 'footprint' && key !== 'roof_footprint').length
    && keys.every(key => Object.hasOwn(b, key) && equal(Reflect.get(a, key), Reflect.get(b, key)));
}
function coldPlanEncodedBytes(plan: LoadedBuildingDetailPlan): number {
  const ref = plan.building.resolved;
  const archive = isArchivedPlan(ref) ? plan.scene.plan_archives?.[ref.archive_id] : undefined;
  if (isArchivedPlan(ref) && typeof archive !== 'string') throw new Error('Cold native plan is missing its retained archive.');
  // The reference's weak registration keeps the whole compressed chunk alive.
  // Charge it per cached plan, even when strings are shared, plus the record.
  return 2 * ((archive?.length ?? 0) + JSON.stringify(plan.building).length);
}

export class UrbanBuildingDetailController<B extends CompactBuildingVisual = PlacedBuilding> {
  private scene?: PlacementBatch;
  private renderer: UrbanBuildingLodRenderer<B>;
  private load?: BuildingDetailLoader<B>;
  private canRealize?: (visual: B) => boolean;
  private readonly realize: BuildingDetailCommonOptions<B>['realize'];
  private readonly onChange?: BuildingDetailCommonOptions<B>['onChange'];
  private readonly limits: typeof DEFAULTS;
  private cache = new Map<string, DetailEntry>();
  private failures = new Map<string, string>();
  private desired = new Map<string, B>();
  private attempted = new Set<string>();
  private jobs = new Map<number, Job<B>>();
  private epoch = 0;
  private nextJob = 0;
  private enabled = false;
  private disposed = false;
  private notifyPending = false;
  private viewKey = '';
  private sceneAppended = false;
  private selectedId?: string;
  private bytes = 0;
  private vertices = 0;
  private started = 0;
  private discarded = 0;

  constructor(options: BuildingDetailOptions<B>) {
    this.scene = options.scene; this.renderer = options.renderer; this.realize = options.realize; this.onChange = options.onChange;
    this.load = options.load; this.canRealize = options.canRealize;
    this.limits = { ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, options[key as keyof typeof DEFAULTS] ?? DEFAULTS[key as keyof typeof DEFAULTS]])) };
    for (const [key, value] of Object.entries(this.limits)) if (!(value > 0) || !Number.isFinite(value)) throw new Error(`Invalid building detail option ${key}.`);
    for (const key of ['maxConcurrency', 'maxQueued', 'maxCachedBuildings', 'maxCachedVertices', 'maxRefusals'] as const) {
      if (!Number.isInteger(this.limits[key])) throw new Error(`Building detail option ${key} must be an integer.`);
    }
    this.limits.maxConcurrency = Math.min(2, this.limits.maxConcurrency);
  }

  /** Reuse the controller across scene replacement so old physical calls drain
   * before new calls dispatch. The renderer must already index the new scene. */
  replaceScene(scene: PlacementBatch, renderer: UrbanBuildingLodRenderer<B> = this.renderer): void {
    if (this.load) throw new Error('Use replaceSource for a cold building detail controller.');
    this.reset(renderer); this.scene = scene;
  }

  /** A different committed cold generation invalidates every pending result.
   * No native city array is constructed or retained by this path. */
  replaceSource(source: { renderer: UrbanBuildingLodRenderer<B>; load: BuildingDetailLoader<B>; canRealize(visual: B): boolean }): void {
    if (!this.load) throw new Error('Use replaceScene for an in-memory building detail controller.');
    this.reset(source.renderer); this.load = source.load; this.canRealize = source.canRealize;
  }
  private reset(renderer: UrbanBuildingLodRenderer<B>): void {
    if (this.disposed) throw new Error('Building detail controller is disposed.');
    for (const id of this.cache.keys()) this.renderer.setDetail(id, undefined);
    this.epoch++; this.scene = undefined; this.renderer = renderer;
    this.cache.clear(); this.failures.clear(); this.desired.clear(); this.attempted.clear();
    this.bytes = this.vertices = 0; this.viewKey = ''; this.sceneAppended = false; waiting.delete(this); this.notify();
  }

  /** After renderer.appendScene(delta), supply the expanded scene/archive table.
   * Existing IDs and building objects must be preserved. No index/cache reset or
   * city-array copy occurs here; the next update considers the new visible plans. */
  appendScene(scene: PlacementBatch): void {
    if (this.disposed) throw new Error('Building detail controller is disposed.');
    if (this.load) throw new Error('A cold detail controller cannot retain a native city scene.');
    this.scene = scene; this.sceneAppended = true;
  }

  /** Same committed generation, new bounded viewport index. Keep matching
   * overlays; remove dropped/changed visuals without reading any native plan.
   * Use replaceSource instead when the storage generation itself changes. */
  refreshProjection(): void {
    if (this.disposed) throw new Error('Building detail controller is disposed.');
    if (!this.load) throw new Error('Use appendScene for an in-memory building detail controller.');
    for (const [id, entry] of this.cache) {
      const visual = this.renderer.getBuilding(id), native = entry.building;
      if (!visual || !entry.visual || !sameVisual(visual, entry.visual)) {
        this.renderer.setDetail(id, undefined); this.cache.delete(id);
        this.bytes -= entry.geometryBytes; this.vertices -= entry.vertices;
      } else { entry.building = { ...native, footprint: visual.footprint, roof_footprint: visual.roof_footprint }; entry.visual = visual; }
    }
    // A previous read can finish on its old DTO and must drain before retry.
    for (const [id, old] of this.desired) if (this.renderer.getBuilding(id) !== old) { this.attempted.delete(id); this.desired.delete(id); }
    this.sceneAppended = true;
  }

  /** Stop demand immediately while retaining native cache entries for the next
   * update(). Already dispatched calls keep their physical slots until settled;
   * their results cannot reinstall overlays while suspended. */
  suspend(): void {
    if (this.disposed || (!this.enabled && this.desired.size === 0)) return;
    this.enabled = false; this.desired.clear(); this.viewKey = '';
    waiting.delete(this);
    for (const id of this.cache.keys()) this.renderer.setDetail(id, undefined);
    this.notify();
  }

  update(view: BuildingDetailView): BuildingDetailStats {
    if (this.disposed) return this.stats;
    if (!(view.metresPerPixel > 0) || !Number.isFinite(view.metresPerPixel)
      || !Object.values(view.viewport).every(Number.isFinite) || view.viewport.minX > view.viewport.maxX || view.viewport.minY > view.viewport.maxY) throw new Error('Invalid building detail viewport or scale.');
    const key = JSON.stringify([view.viewport.minX, view.viewport.minY, view.viewport.maxX, view.viewport.maxY, view.metresPerPixel, view.selectedId, view.enabled !== false]);
    if (key === this.viewKey && !this.sceneAppended) return this.stats;
    if (key !== this.viewKey) this.attempted.clear();
    this.viewKey = key; this.sceneAppended = false; this.selectedId = view.selectedId; this.enabled = view.enabled !== false; this.desired.clear();
    if (this.enabled) {
      const canRealize = (building: B): boolean => this.canRealize ? this.canRealize(building)
        : 'simplification' in building && building.simplification === 'architectural_plan'
          && 'recipe_id' in building && building.recipe_id !== 'silhouette';
      const selected = view.selectedId ? this.renderer.getBuilding(view.selectedId) : undefined;
      if (selected && canRealize(selected)) this.desired.set(selected.id, selected);
      // Overview camera changes do no city-wide query or mesh work.
      if (view.metresPerPixel <= this.limits.maxAutoMetresPerPixel) {
        const cx = (view.viewport.minX + view.viewport.maxX) / 2, cy = (view.viewport.minY + view.viewport.maxY) / 2;
        const visible = this.renderer.query(view.viewport, view.metresPerPixel).visible
          .filter(entry => entry.projectedSizePx >= this.limits.minProjectedSizePx && canRealize(entry.building));
        visible.sort((a, b) => ((a.bounds.minX + a.bounds.maxX) / 2 - cx) ** 2 + ((a.bounds.minY + a.bounds.maxY) / 2 - cy) ** 2
          - ((b.bounds.minX + b.bounds.maxX) / 2 - cx) ** 2 - ((b.bounds.minY + b.bounds.maxY) / 2 - cy) ** 2 || a.building.id.localeCompare(b.building.id));
        for (const entry of visible) {
          if (this.desired.size >= this.limits.maxCachedBuildings) break;
          this.desired.set(entry.building.id, entry.building);
        }
      }
    }
    for (const [id, entry] of [...this.cache]) {
      const active = this.enabled && this.desired.has(id);
      this.renderer.setDetail(id, active ? entry.building : undefined);
      if (active) { this.cache.delete(id); this.cache.set(id, entry); }
    }
    this.pump(); return this.stats;
  }

  private pending(): B[] {
    const busy = new Set([...this.jobs.values()].filter(job => job.epoch === this.epoch).map(job => job.building));
    return [...this.desired.values()].filter(building => !this.cache.has(building.id) && !this.failures.has(building.id)
      && !this.attempted.has(building.id) && !busy.has(building)).slice(0, this.limits.maxQueued);
  }

  /** Public only to the module semaphore; hosts call update(). */
  pump(): void {
    waiting.delete(this);
    if (this.disposed || !this.enabled) return;
    let pending = this.pending();
    while (pending.length && this.jobs.size < this.limits.maxConcurrency && physicalCalls < 2) {
      const building = pending[0], job = { id: ++this.nextJob, building, epoch: this.epoch };
      this.jobs.set(job.id, job); this.attempted.add(building.id); this.started++; physicalCalls++;
      // A rejected callback is still accounted for; no detached native promise.
      const scene = this.scene, load = this.load;
      void Promise.resolve().then(async () => {
        if (!this.wanted(job)) throw new Error('Detail request superseded before native dispatch.');
        const native = !load && isRetainedNativeVisual(building) ? building : undefined;
        const loaded = load ? await load(building) : native && scene ? { building: native, scene } : undefined;
        if (!this.wanted(job)) throw new Error('Detail plan read superseded before native dispatch.');
        if (!loaded) throw new Error('Retained native building plan is unavailable.');
        if (load) assertLoadedVisual(building, loaded);
        const retainedBytes = load ? coldPlanEncodedBytes(loaded) : 0;
        if (retainedBytes > this.limits.maxCacheBytes) throw new Error(`Retained native plan exceeds the detail byte budget (${retainedBytes}).`);
        return { native: loaded.building, retainedBytes, result: await this.realize(loaded.building, { interiors: false, scene: loaded.scene }) };
      }).then(({ native, retainedBytes, result }) => {
        if (!this.wanted(job)) { this.discarded++; return; }
        const entry = nativeExteriorDetail(native, result, this.limits.maxCachedVertices);
        // A cold read parses fresh objects. Only after exact coordinate/identity
        // validation may the overlay share the visual index's contour references.
        entry.building = { ...entry.building, footprint: building.footprint, roof_footprint: building.roof_footprint };
        entry.geometryBytes += retainedBytes; if (load) entry.visual = building;
        if (entry.geometryBytes > this.limits.maxCacheBytes) throw new Error(`Native exterior exceeds the detail byte budget (${entry.geometryBytes}).`);
        this.renderer.setDetail(building.id, entry.building);
        this.cache.set(building.id, entry); this.bytes += entry.geometryBytes; this.vertices += entry.vertices;
        while (this.cache.size > this.limits.maxCachedBuildings || this.bytes > this.limits.maxCacheBytes || this.vertices > this.limits.maxCachedVertices) {
          const oldest = [...this.cache.keys()].find(id => id !== this.selectedId) ?? this.cache.keys().next().value!;
          const removed = this.cache.get(oldest)!; this.cache.delete(oldest); this.bytes -= removed.geometryBytes; this.vertices -= removed.vertices;
          this.renderer.setDetail(oldest, undefined);
          // Do not regenerate an evicted member endlessly in this same camera view.
          this.attempted.add(oldest);
        }
      }).catch(error => {
        if (!this.wanted(job)) { this.discarded++; return; }
        this.failures.delete(building.id); this.failures.set(building.id, error instanceof Error ? error.message : String(error));
        while (this.failures.size > this.limits.maxRefusals) this.failures.delete(this.failures.keys().next().value!);
      }).finally(() => {
        this.jobs.delete(job.id); physicalCalls--; this.notify(); this.pump();
        for (const controller of [...waiting]) controller.pump();
      });
      pending = this.pending();
    }
    if (pending.length) waiting.add(this);
    this.notify();
  }

  private wanted(job: Job<B>): boolean {
    return !this.disposed && this.enabled && job.epoch === this.epoch && this.desired.get(job.building.id) === job.building
      && this.renderer.getBuilding(job.building.id) === job.building;
  }
  private notify(): void {
    if (!this.onChange || this.notifyPending || this.disposed) return;
    this.notifyPending = true;
    queueMicrotask(() => { this.notifyPending = false; if (!this.disposed) this.onChange?.(this.stats); });
  }
  get stats(): BuildingDetailStats {
    return { queued: this.pending().length, inFlight: this.jobs.size, globalInFlight: physicalCalls, cached: this.cache.size,
      cacheBytes: this.bytes, cachedVertices: this.vertices, refused: this.failures.size, requestsStarted: this.started, responsesDiscarded: this.discarded };
  }
  status(id: string): BuildingDetailStatus {
    const entry = this.cache.get(id); if (entry) return { state: 'ready', diagnostics: entry.diagnostics };
    const message = this.failures.get(id); if (message !== undefined) return { state: 'refused', message };
    if ([...this.jobs.values()].some(job => job.epoch === this.epoch && job.building.id === id)) return { state: 'loading' };
    return { state: this.pending().some(building => building.id === id) ? 'queued' : 'idle' };
  }
  getDetail(id: string): PlacedBuilding | undefined { return this.cache.get(id)?.building; }
  /** Shared 2D/3D consumers reconcile only this bounded set, never the city. */
  cachedDetails(): readonly PlacedBuilding[] { return [...this.cache.values()].map(entry => entry.building); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.epoch++; waiting.delete(this);
    for (const id of this.cache.keys()) this.renderer.setDetail(id, undefined);
    this.cache.clear(); this.failures.clear(); this.desired.clear(); this.attempted.clear(); this.bytes = this.vertices = 0;
    this.scene = undefined; this.load = undefined; this.canRealize = undefined;
    // Already dispatched calls keep their shared physical slots until settled.
  }
}
