import { fortificationClearings } from '../render/forestClearance';
import { cityForestInput } from '../render/cityEnvironment';
import { retainedDecorOf } from './decorTerrain';
import { forestRetainedRiverSegments } from '../../../rust/bridge/terrainForestRiparian';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import { nativeTerrainLayer, nativeTerrainOf } from './nativeProducts';
import { riverSegments } from '../ui/vectorWaterRender';
import type { VectorWater } from '../ui/vectorWater';
import { waterClimate } from '../render/waterRegime';
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { buildForestField, type ForestField, type ForestOccupation, type LandDetail } from '../../../rust/bridge/terrainForest';
import type { LandUseLayer, World } from '../gen/types';
import type { V2Settings } from './contracts';
import { effectiveTerrainSettings } from './terrainSettings';
import { buildingOccupationShapes, forestOccupation, forestOccupationRegion, packOccupationShapes, withOccupationShapes, withOccupationShapesRegion, occupationMergeSlot } from '../ui/forestOccupation';
import { localEditRegions, type EditRect } from './localEditRegion';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { landDetail, withLandDetail, worldLandCultures } from '../ui/landDetail';
import { retainTerrainDisplayPreparation, runDisplayJob, registerDisplayLanduse, displayWorkerEpoch, type WorkerOccupation } from './displayPrep';
import { productRevision } from '../render/displayProduct';
import { forestCorridors, streetCorridors, type ForestCorridor } from '../render/forestRoom';
import { layoutStreetPavements } from '../render/roadPavement';
import { nativeCitiesOf } from './nativeProducts';
import { seedSubset } from '../../../rust/bridge/generationSeed';
import { executionRuntime } from '../ui/executionProfile';

/** Displayed river geometry for the gallery envelope (vector water, hydraulic widths). Without it the forest field falls
 * back to one point per routing river cell, and the bank envelope became a chain of discs, one per 78 m cell: the
 * riverside trees and their colour stood in a row of equal round patches. */
export function forestDisplayRivers(water: VectorWater | undefined, zone?: ClimateZone): Float32Array | undefined {
  if (!water?.rivers?.rivers.length) return undefined;
  // Material segments carry the regime of an average year in their colour (r: running water share, b > .5: plume).
  const segments = riverSegments(water, { style: 'render-v2', showLakes: true, showOxbows: false, riverArea: water.riverArea ?? 0.02, riverMode: 'vector', overlay: 'none', material: true, ...(zone ? { season: { zone } } : {}) });
  const aridity = zone ? waterClimate({ zone }).aridity : 0,
    out: number[] = [];
  for (let k = 0; k + 8 < segments.length; k += 9) {
    if (segments[k + 8] > 0.5) continue;
    // The gallery follows the water a course has. Humid zones keep every bank. In dry zones a flowing reach keeps
    // clumps with breaks of irregular length, a dry bed only small clumps at long intervals: a seeded noise along the
    // course (world position, so stable under resegmentation) keeps a share of the bank set by the running water.
    if (aridity > 0) {
      const running = segments[k + 6],
        x = 0.5 * (segments[k] + segments[k + 2]),
        y = 0.5 * (segments[k + 1] + segments[k + 3]);
      const share = 1 - aridity * (1 - (0.12 + 0.5 * running));
      const clumps = 0.65 * galleryNoise(x / 260, y / 260) + 0.35 * galleryNoise(x / 90 + 17.3, y / 90 - 5.1);
      if (clumps > galleryQuantile(share)) continue;
    }
    for (let i = 0; i < 9; i++) out.push(segments[k + i]);
  }
  return Float32Array.from(out);
}
/** Level of the clump noise below which a share of the bank lies (its measured quantiles), so the kept share is the asked one. */
const GALLERY_QUANTILES: readonly [number, number][] = [
  [0, 0],
  [0.05, 0.239],
  [0.12, 0.305],
  [0.25, 0.385],
  [0.5, 0.499],
  [0.75, 0.613],
  [0.95, 0.759],
  [1, 1],
];
function galleryQuantile(share: number): number {
  for (let i = 1; i < GALLERY_QUANTILES.length; i++) {
    const [q1, v1] = GALLERY_QUANTILES[i],
      [q0, v0] = GALLERY_QUANTILES[i - 1];
    if (share <= q1) return v0 + ((v1 - v0) * (share - q0)) / (q1 - q0);
  }
  return 1;
}
/** Value noise in [0, 1] (smooth, fixed seed): the clumping of dry-zone galleries along their course. */
function galleryNoise(x: number, y: number): number {
  const hash = (i: number, j: number): number => {
    let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ 0x5bd1e995;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };
  const i = Math.floor(x),
    j = Math.floor(y),
    u = x - i,
    v = y - j,
    su = u * u * (3 - 2 * u),
    sv = v * v * (3 - 2 * v);
  const a = hash(i, j),
    b = hash(i + 1, j),
    c = hash(i, j + 1),
    d = hash(i + 1, j + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
/** Field key part of its river geometry (terrainForest key: …:water:segments:enabled:density:clearings:occupation…). */
const builtWithRivers = (field: ForestField): boolean => field.key.split(':')[7] !== '-';
/** Fields are terrain products: keyed by the terrain object (kept across town builds, see terrainIntern.ts), not the World. */
const cache = new WeakMap<object, Map<string, ForestField>>();
type OccupationParts = { occupation: Promise<ForestOccupation | undefined>; detail: Promise<LandDetail | undefined> };
interface OccupationEntry {
  whole?: ForestOccupation;
  complete?: boolean;
  parts?: OccupationParts;
}
const workerOccupations = new WeakMap<Uint8Array, WorkerOccupation>();
const occupations = new WeakMap<LandUseLayer, Map<string, OccupationEntry>>();
/** A map with roads but no land use yet still clears its road corridors through the natural woods. */
const emptyLanduse: LandUseLayer = { areas: [], reserve: [], farmsteads: [] };
/** Every way of the world as a forest corridor: regional roads by class (tracks stay covered, country roads clear)
 * and the streets of the towns, so no tree is rooted on a street, in 2D as in 3D. */
function v2Corridors(world: World): ForestCorridor[] {
  const layouts = nativeCitiesOf(world).flatMap(city => city.layouts ?? []);
  return forestCorridors(
    world,
    false,
    layouts.flatMap(layout => streetCorridors(layout.streets, layoutStreetPavements(layout))),
  );
}
/** The exact ways ride with the occupation raster to the modelled trees (terrain3dTrees.ts). */
const withWays = (occupation: ForestOccupation | undefined, ways: readonly ForestCorridor[]): ForestOccupation | undefined => occupation && { ...occupation, ways };
function occupationEntry(world: World): OccupationEntry {
  retainTerrainDisplayPreparation(world);
  const landuse = world.landuse ?? emptyLanduse;
  const region = world.debug?.v2RustRegion as { placement?: { activities?: object }; roads?: { nodes?: object } } | undefined;
  const key = `1:${productRevision(world.roads)}:${productRevision(region?.placement?.activities)}:${productRevision(region?.roads?.nodes)}:${nativeCitiesOf(world)
    .map(city => productRevision(city.layouts))
    .join(',')}`;
  let entries = occupations.get(landuse);
  if (!entries) {
    entries = new Map();
    occupations.set(landuse, entries);
  }
  let entry = entries.get(key);
  if (!entry) {
    entry = {};
    entries.set(key, entry);
    if (entries.size > 4) entries.delete(entries.keys().next().value!);
  }
  return entry;
}
/** The last occupation made whole, and the world it was made for: a local town edit of that world rasterises again only
 * the region it changed (localEditRegion.ts), on the page, in a few milliseconds. */
let lastOccupation: { world: World; entry: OccupationEntry } | undefined;
function noteOccupation(world: World, entry: OccupationEntry): void {
  if (entry.complete) lastOccupation = { world, entry };
}
/** Completes `entry` from the last occupation when `world` is a local edit of its world; false otherwise. */
function regionalOccupation(world: World, entry: OccupationEntry): boolean {
  const held = lastOccupation,
    previous = held?.entry.whole;
  if (!held || !previous || held.world === world || held.world.landuse !== world.landuse) return false;
  const rects = localEditRegions(held.world, world);
  if (!rects) return false;
  const ways = v2Corridors(world),
    occupation = rects.length ? forestOccupationRegion(previous, world.landuse ?? emptyLanduse, rects, ways, fortificationClearings(nativeCitiesOf(world).flatMap(city => city.layouts ?? []))) : previous;
  if (!occupation) return false;
  // The holdings detail is a land-use product: the edit kept it.
  entry.whole = { ...withWays(occupation, ways)!, detail: previous.detail };
  entry.complete = true;
  entry.parts = { occupation: Promise.resolve({ ...entry.whole, detail: undefined }), detail: Promise.resolve(previous.detail) };
  noteOccupation(world, entry);
  return true;
}
/** Land-use/corridor revision, independent from presentation and visibility. Synchronous consumers reuse the async product. */
export function v2ForestOccupation(world: World): ForestOccupation | undefined {
  const entry = occupationEntry(world);
  if (!entry.complete && !regionalOccupation(world, entry)) {
    const ways = v2Corridors(world),
      landuse = world.landuse ?? emptyLanduse;
    entry.whole = withLandDetail(withWays(forestOccupation(landuse, undefined, undefined, ways, fortificationClearings(nativeCitiesOf(world).flatMap(city => city.layouts ?? []))), ways), landuse, worldLandCultures(world));
    entry.complete = true;
    noteOccupation(world, entry);
  }
  return entry.whole;
}
/** One preparation lane for occupation, holdings, footprint merges and display forest overrides. */
export function v2ForestOccupationParts(world: World): OccupationParts {
  const entry = occupationEntry(world),
    landuse = world.landuse ?? emptyLanduse;
  if (!entry.complete && !entry.parts) regionalOccupation(world, entry);
  if (entry.complete || typeof Worker === 'undefined' || typeof document === 'undefined') {
    const whole = v2ForestOccupation(world);
    return (entry.parts ??= { occupation: Promise.resolve(whole && { ...whole, detail: undefined }), detail: Promise.resolve(whole?.detail) });
  }
  if (!entry.parts) {
    const registered = registerDisplayLanduse(landuse),
      revision = productRevision(entry),
      ways = v2Corridors(world);
    const occupation = registered.ready
      .then(() => runDisplayJob('occupation', { landuseRevision: registered.revision, revision, corridors: ways, clearings: fortificationClearings(nativeCitiesOf(world).flatMap(city => city.layouts ?? [])) }))
      .then(result => {
        if (result) workerOccupations.set(result.rgba, { landuseRevision: registered.revision, revision, epoch: registered.epoch });
        return withWays(result, ways);
      })
      .catch(() => withWays(forestOccupation(landuse, undefined, undefined, ways, fortificationClearings(nativeCitiesOf(world).flatMap(city => city.layouts ?? []))), ways));
    // Let every occupation subscriber post its dependent merge before sending optional detail.
    // A main-thread task boundary preserves that order even when the page is CPU-throttled.
    // Holdings take the crops of the culture of the nearest place.
    const cultures = worldLandCultures(world);
    const detail = occupation
      .then(() => new Promise<void>(resolve => setTimeout(resolve, 0)))
      .then(() => registered.ready)
      .then(() => runDisplayJob('detail', { landuseRevision: registered.revision, cultures }))
      .catch(() => landDetail(landuse, cultures));
    entry.parts = { occupation, detail };
    void Promise.all([occupation, detail]).then(([o, d]) => {
      entry.whole = o && { ...o, detail: d };
      entry.complete = true;
      noteOccupation(world, entry);
    });
  }
  return entry.parts;
}
export async function v2ForestOccupationAsync(world: World): Promise<ForestOccupation | undefined> {
  const parts = v2ForestOccupationParts(world),
    [occupation, detail] = await Promise.all([parts.occupation, parts.detail]);
  return occupation && { ...occupation, detail };
}
/** One merge per base-plane/accepted-footprint revision; 3D's sync consumer reads the same slot. `region`: the merge
 * of the world a local edit was made from and the boxes it changed (localEditRegion.ts): only those are merged again. */
export function withBuildingOccupationAsync(base: ForestOccupation | undefined, scene: Building3dScene, region?: { previous: ForestOccupation; rects: readonly EditRect[] }): Promise<ForestOccupation | undefined> {
  if (!(scene.occupationBuildings ?? scene.buildings).length) return Promise.resolve(base);
  const slot = occupationMergeSlot(base, scene);
  if (slot.value) return Promise.resolve(slot.value.detail === base?.detail ? slot.value : { ...slot.value, detail: base?.detail });
  if (slot.pending) return slot.pending.then(value => value && (value.detail === base?.detail ? value : { ...value, detail: base?.detail }));
  const shapes = buildingOccupationShapes(scene);
  if (!shapes) return Promise.resolve(base);
  const regional = region && withOccupationShapesRegion(region.previous, base, shapes, region.rects);
  if (regional) return Promise.resolve((slot.value = { ...regional, detail: base?.detail, ways: base?.ways }));
  const local = (): ForestOccupation => withOccupationShapes(base, shapes);
  const packed = packOccupationShapes(shapes);
  const ref = base && workerOccupations.get(base.rgba),
    retained = ref?.epoch === displayWorkerEpoch() ? ref : undefined;
  const job =
    typeof Worker === 'undefined' || typeof document === 'undefined'
      ? Promise.resolve(local())
      : runDisplayJob('merge', { retained, source: !retained && base ? { x: base.x, y: base.y, width: base.width, n: base.n, rgba: base.rgba, key: base.key, clearings: base.clearings } : undefined, shapes: packed }, [packed.buffer]).catch(local);
  slot.pending = job
    .then(result => (slot.value = { ...result, detail: base?.detail, ways: base?.ways }))
    .finally(() => {
      slot.pending = undefined;
    });
  return slot.pending;
}
const pending = new WeakMap<object, Map<string, Promise<ForestField | undefined>>>();
function displayForestRequest(world: World, settings: V2Settings, resolved: ResolvedAppearance): { key: string; build: () => Promise<ForestField> } | ForestField | undefined {
  retainTerrainDisplayPreparation(world);
  if (!resolved.composition.vegetation.procedural) return;
  const configuration = effectiveTerrainSettings(settings, world.mapSize),
    overrides = resolved.vegetation.forest;
  const { enabled: _enabled, ...parameters } = overrides,
    forest = { ...configuration.forest, ...parameters, enabled: true };
  const decor = retainedDecorOf(world.terrain);
  const vectorRivers = decor ? undefined : forestDisplayRivers(nativeTerrainOf(world)?.water, configuration.climateZone);
  const retained = !decor && !Object.keys(parameters).length ? nativeTerrainLayer(world)?.v2ForestField : undefined;
  // A retained field built without the displayed rivers (older projects) is rebuilt with them.
  if (retained && (!vectorRivers || builtWithRivers(retained))) return retained;
  // Imported and older projects may have retained heights without a forest field.
  // Build the display product over those heights instead of silently losing all trees.
  const climate = configuration.climateValues!,
    clearingProfile = resolved.traits.forestClearingProfile;
  // A town's own seed variations never move the woods of the whole map.
  const seed = seedSubset(world.seed, step => !step.startsWith('city/'));
  const raster = decor?.raster;
  const key = JSON.stringify([
    forest,
    climate,
    seed,
    clearingProfile,
    productRevision(raster?.height ?? world.terrain.height.data),
    productRevision(raster?.water ?? world.terrain.water),
    raster?.n ?? world.terrain.height.w,
    raster?.width ?? world.mapSize,
    vectorRivers?.length ?? 0,
  ]);
  const input = cityForestInput(seed, climate, raster ? { x: 0, y: 0, width: raster.width, n: raster.n, data: raster.height } : { x: 0, y: 0, width: world.mapSize, n: world.terrain.height.w, data: world.terrain.height.data }, raster?.water ?? world.terrain.water, {
    clearingProfile,
    ...(decor ? { riverSegments: forestRetainedRiverSegments(decor.meta.waterSvg, decor.raster.width) } : vectorRivers ? { riverSegments: vectorRivers } : {}),
  });
  return { key, build: () => (typeof Worker === 'undefined' || typeof document === 'undefined' ? buildForestField(input, forest) : runDisplayJob('forest', { input, settings: forest, runtime: executionRuntime }).catch(() => buildForestField(input, forest))) };
}
const isField = (v: unknown): v is ForestField => !!v && typeof (v as ForestField).rgba !== 'undefined';
/** Repaint the forest over retained heights (Rust: native or WASM, hence async). Never call terrain or settlement generation. */
export async function v2DisplayForestAsync(world: World, settings: V2Settings, resolved: ResolvedAppearance): Promise<ForestField | undefined> {
  const request = displayForestRequest(world, settings, resolved);
  if (!request || isField(request)) return request;
  let fields = cache.get(world.terrain);
  if (!fields) {
    fields = new Map();
    cache.set(world.terrain, fields);
  }
  const found = fields.get(request.key);
  if (found) return found;
  let jobs = pending.get(world.terrain);
  if (!jobs) {
    jobs = new Map();
    pending.set(world.terrain, jobs);
  }
  let job = jobs.get(request.key);
  if (!job) {
    job = request
      .build()
      .then(field => {
        fields!.set(request.key, field);
        if (fields!.size > 3) fields!.delete(fields!.keys().next().value!);
        return field;
      })
      .finally(() => jobs!.delete(request.key));
    jobs.set(request.key, job);
  }
  return job;
}
/** Cached field for render callbacks that cannot wait: on a miss it starts the build and calls `onReady` once it is cached. */
export function v2DisplayForest(world: World, settings: V2Settings, resolved: ResolvedAppearance, onReady?: () => void): ForestField | undefined {
  const request = displayForestRequest(world, settings, resolved);
  if (!request || isField(request)) return request;
  const found = cache.get(world.terrain)?.get(request.key);
  if (found) return found;
  if (!pending.get(world.terrain)?.has(request.key))
    void v2DisplayForestAsync(world, settings, resolved).then(
      () => onReady?.(),
      error => console.warn('Forest field failed:', error),
    );
  return undefined;
}
