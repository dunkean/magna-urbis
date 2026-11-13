import { cityForestInput } from '../render/cityEnvironment';
import { retainedDecorOf } from './decorTerrain';
import { forestRetainedRiverSegments } from '../../../rust/bridge/terrainForestRiparian';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import { nativeTerrainLayer } from './nativeProducts';
import { buildForestField, type ForestField, type ForestOccupation, type LandDetail } from '../../../rust/bridge/terrainForest';
import type { LandUseLayer, World } from '../gen/types';
import type { V2Settings } from './contracts';
import { effectiveTerrainSettings } from './terrainSettings';
import { buildingOccupationShapes, forestOccupation, packOccupationShapes, withOccupationShapes, occupationMergeSlot } from '../ui/forestOccupation';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { landDetail, withLandDetail } from '../ui/landDetail';
import { retainTerrainDisplayPreparation, runDisplayJob, registerDisplayLanduse, displayWorkerEpoch, type WorkerOccupation } from './displayPrep';
import { productRevision } from '../render/displayProduct';
import { forestCorridors } from '../render/forestRoom';
import { seedSubset } from '../../../rust/bridge/generationSeed';
import { executionRuntime } from '../ui/executionProfile';

/** Fields are terrain products: keyed by the terrain object (kept across town builds, see terrainIntern.ts), not the World. */
const cache = new WeakMap<object, Map<string, ForestField>>();
type OccupationParts = { occupation: Promise<ForestOccupation | undefined>; detail: Promise<LandDetail | undefined> };
interface OccupationEntry { whole?: ForestOccupation; complete?: boolean; parts?: OccupationParts }
const workerOccupations = new WeakMap<Uint8Array, WorkerOccupation>();
const occupations = new WeakMap<LandUseLayer, Map<string, OccupationEntry>>();
function occupationEntry(world: World): OccupationEntry | undefined {
  retainTerrainDisplayPreparation(world);
  const landuse = world.landuse; if (!landuse) return;
  const region = world.debug?.v2RustRegion as { placement?: { activities?: object }; roads?: { nodes?: object } } | undefined;
  const key = `1:${productRevision(world.roads)}:${productRevision(region?.placement?.activities)}:${productRevision(region?.roads?.nodes)}`;
  let entries = occupations.get(landuse); if (!entries) { entries = new Map(); occupations.set(landuse, entries); }
  let entry = entries.get(key); if (!entry) { entry = {}; entries.set(key, entry); if (entries.size > 4) entries.delete(entries.keys().next().value!); }
  return entry;
}
/** Land-use/corridor revision, independent from presentation and visibility. Synchronous consumers reuse the async product. */
export function v2ForestOccupation(world: World): ForestOccupation | undefined {
  const entry = occupationEntry(world); if (!entry) return;
  if (!entry.complete) { entry.whole = withLandDetail(forestOccupation(world.landuse!, undefined, undefined, forestCorridors(world, false)), world.landuse!); entry.complete = true; }
  return entry.whole;
}
/** One preparation lane for occupation, holdings, footprint merges and display forest overrides. */
export function v2ForestOccupationParts(world: World): OccupationParts {
  const entry = occupationEntry(world), landuse = world.landuse;
  if (!entry || !landuse) return { occupation: Promise.resolve(undefined), detail: Promise.resolve(undefined) };
  if (entry.complete || typeof Worker === 'undefined' || typeof document === 'undefined') {
    const whole = v2ForestOccupation(world);
    return entry.parts ??= { occupation: Promise.resolve(whole && { ...whole, detail: undefined }), detail: Promise.resolve(whole?.detail) };
  }
  if (!entry.parts) {
    const registered = registerDisplayLanduse(landuse), revision = productRevision(entry);
    const occupation = registered.ready.then(() => runDisplayJob('occupation', { landuseRevision: registered.revision, revision, corridors: forestCorridors(world, false) }))
      .then(result => {
        if (result) workerOccupations.set(result.rgba, { landuseRevision: registered.revision, revision, epoch: registered.epoch });
        return result;
      }).catch(() => forestOccupation(landuse, undefined, undefined, forestCorridors(world, false)));
    // Let every occupation subscriber post its dependent merge before sending optional detail.
    // A main-thread task boundary preserves that order even when the page is CPU-throttled.
    const detail = occupation.then(() => new Promise<void>(resolve => setTimeout(resolve, 0)))
      .then(() => registered.ready).then(() => runDisplayJob('detail', { landuseRevision: registered.revision })).catch(() => landDetail(landuse));
    entry.parts = { occupation, detail };
    void Promise.all([occupation, detail]).then(([o, d]) => { entry.whole = o && { ...o, detail: d }; entry.complete = true; });
  }
  return entry.parts;
}
export async function v2ForestOccupationAsync(world: World): Promise<ForestOccupation | undefined> {
  const parts = v2ForestOccupationParts(world), [occupation, detail] = await Promise.all([parts.occupation, parts.detail]);
  return occupation && { ...occupation, detail };
}
/** One merge per base-plane/accepted-footprint revision; 3D's sync consumer reads the same slot. */
export function withBuildingOccupationAsync(base: ForestOccupation | undefined, scene: Building3dScene): Promise<ForestOccupation | undefined> {
  if (!(scene.occupationBuildings ?? scene.buildings).length) return Promise.resolve(base);
  const slot = occupationMergeSlot(base, scene);
  if (slot.value) return Promise.resolve(slot.value.detail === base?.detail ? slot.value : { ...slot.value, detail: base?.detail });
  if (slot.pending) return slot.pending.then(value => value && (value.detail === base?.detail ? value : { ...value, detail: base?.detail }));
  const shapes = buildingOccupationShapes(scene);
  if (!shapes) return Promise.resolve(base);
  const local = (): ForestOccupation => withOccupationShapes(base, shapes);
  const packed = packOccupationShapes(shapes);
  const ref = base && workerOccupations.get(base.rgba), retained = ref?.epoch === displayWorkerEpoch() ? ref : undefined;
  const job = typeof Worker === 'undefined' || typeof document === 'undefined' ? Promise.resolve(local())
    : runDisplayJob('merge', { retained, source: !retained && base ? { x: base.x, y: base.y, width: base.width, n: base.n, rgba: base.rgba, key: base.key } : undefined, shapes: packed }, [packed.buffer]).catch(local);
  slot.pending = job.then(result => slot.value = { ...result, detail: base?.detail }).finally(() => { slot.pending = undefined; });
  return slot.pending;
}
const pending = new WeakMap<object, Map<string, Promise<ForestField | undefined>>>();
function displayForestRequest(world: World, settings: V2Settings, resolved: ResolvedAppearance): { key: string; build: () => Promise<ForestField> } | ForestField | undefined {
  retainTerrainDisplayPreparation(world);
  if (!resolved.composition.vegetation.procedural) return;
  const configuration = effectiveTerrainSettings(settings, world.mapSize), overrides = resolved.vegetation.forest;
  const { enabled: _enabled, ...parameters } = overrides, forest = { ...configuration.forest, ...parameters, enabled: true };
  const decor = retainedDecorOf(world.terrain);
  if (!decor && !Object.keys(parameters).length) return nativeTerrainLayer(world)?.v2ForestField;
  const climate = configuration.climateValues!, clearingProfile = resolved.traits.forestClearingProfile;
  // A town's own seed variations never move the woods of the whole map.
  const seed = seedSubset(world.seed, step => !step.startsWith('city/'));
  const raster = decor?.raster;
  const key = JSON.stringify([forest, climate, seed, clearingProfile, productRevision(raster?.height ?? world.terrain.height.data),
    productRevision(raster?.water ?? world.terrain.water), raster?.n ?? world.terrain.height.w, raster?.width ?? world.mapSize]);
  const input = cityForestInput(seed, climate,
    raster ? { x: 0, y: 0, width: raster.width, n: raster.n, data: raster.height }
      : { x: 0, y: 0, width: world.mapSize, n: world.terrain.height.w, data: world.terrain.height.data },
    raster?.water ?? world.terrain.water, { clearingProfile,
      ...(decor ? { riverSegments: forestRetainedRiverSegments(decor.meta.waterSvg, decor.raster.width) } : {}) });
  return { key, build: () => typeof Worker === 'undefined' || typeof document === 'undefined'
    ? buildForestField(input, forest) : runDisplayJob('forest', { input, settings: forest, runtime: executionRuntime }).catch(() => buildForestField(input, forest)) };
}
const isField = (v: unknown): v is ForestField => !!v && typeof (v as ForestField).rgba !== 'undefined';
/** Repaint the forest over retained heights (Rust: native or WASM, hence async). Never call terrain or settlement generation. */
export async function v2DisplayForestAsync(world: World, settings: V2Settings, resolved: ResolvedAppearance): Promise<ForestField | undefined> {
  const request = displayForestRequest(world, settings, resolved);
  if (!request || isField(request)) return request;
  let fields = cache.get(world.terrain); if (!fields) { fields = new Map(); cache.set(world.terrain, fields); }
  const found = fields.get(request.key); if (found) return found;
  let jobs = pending.get(world.terrain); if (!jobs) { jobs = new Map(); pending.set(world.terrain, jobs); }
  let job = jobs.get(request.key);
  if (!job) {
    job = request.build().then(field => {
      fields!.set(request.key, field); if (fields!.size > 3) fields!.delete(fields!.keys().next().value!);
      return field;
    }).finally(() => jobs!.delete(request.key));
    jobs.set(request.key, job);
  }
  return job;
}
/** Cached field for render callbacks that cannot wait: on a miss it starts the build and calls `onReady` once it is cached. */
export function v2DisplayForest(world: World, settings: V2Settings, resolved: ResolvedAppearance, onReady?: () => void): ForestField | undefined {
  const request = displayForestRequest(world, settings, resolved);
  if (!request || isField(request)) return request;
  const found = cache.get(world.terrain)?.get(request.key); if (found) return found;
  if (!pending.get(world.terrain)?.has(request.key)) void v2DisplayForestAsync(world, settings, resolved).then(() => onReady?.(), error => console.warn('Forest field failed:', error));
  return undefined;
}
