/** `buildCityBuildings` (cityCanvas.ts) split over workers for the unedited city volumes of a native town: each worker
 * decodes its own copy of the binary site visuals (render/cityDisplayBuffers.ts), rebuilds the same scene
 * (ui/urbanSilhouettes.ts `siteVisualScene`) and builds the roofs, shadows and outlines of every K-th building with the
 * very same code; the page links the items to its plan and merges them in the town's order. The result equals the
 * one-thread build (same items, pans and shadows in the same order); only the work is spread. Roof pans and cast
 * shadows (polygon booleans) are most of the time the V2 spends preparing a town's drawing. */
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../../rust/bridge/housesContract';
import type { Shape } from '../../../rust/bridge/urban';
import type { CityGround, GroundClipTask } from './cityGround';
import { buildCityBuildings, cityBuildingBins, cityBuildingCulture, cityBuildingLink, citySnowAltitudes, type CityBuilding, type CityBuildings, type CityRoofs, type CityScene } from './cityCanvas';
import { decodeCitySiteVisuals, decodeCitySiteVisualsAt, siteVisualsPackOf } from './cityDisplayBuffers';
import { siteVisualScene, siteVisualSceneSource } from '../ui/urbanSilhouettes';
import type { UrbanSiteVisual } from '../ui/urbanSiteStore';
import { handheldDevice } from '../../../rust/bridge/deviceClass';

/** Below this many buildings the one-thread build is as fast (a 20k town has about 6,500 and builds them in ~1.5 s;
 * a worker takes about 2 s to load its modules from the dev server and JIT them). */
const PARALLEL_MIN_BUILDINGS = 12000;
/** The same once the workers are started (`prewarmCityBuildingWorkers`): only their decode and JIT warm-up remain,
 * less than the ~1.1 s a 20k town spends on its roofs and shadows on the page. */
const PARALLEL_WARM_MIN_BUILDINGS = 3000;
/** Budget of the site buffers copied to the workers (each decodes about three times its buffer in objects). */
const PARALLEL_SITE_BYTES = 256 * 2 ** 20;
/** A surface equal to the building's own footprint travels as this marker (the page puts its own object back). */
const OWN_FOOTPRINT = 1;
export interface CityBuildingsTask {
  buffer: ArrayBuffer;
  worker: number;
  workers: number;
  cultures: string[];
  roofs: boolean;
  /** Site indices of this worker's buildings, ascending: only those sites are decoded (absent: the whole town). */
  sites?: Uint32Array;
}
type ChunkItem = Omit<CityBuilding, 'building' | 'surface' | 'footprint' | 'ruins'> & { b: number; surface: Surface | typeof OWN_FOOTPRINT; footprint?: Surface | typeof OWN_FOOTPRINT; ruins?: Surface | typeof OWN_FOOTPRINT };
export interface CityBuildingsChunk {
  items: ChunkItem[];
  roofs: CityRoofs;
}

/** Worker side: the items and roof arrays of buildings `worker`, `worker + workers`… of the scene rebuilt from `buffer`. */
export function cityBuildingsChunk(task: CityBuildingsTask): CityBuildingsChunk {
  // Each site makes at most one building, independently of the others: the share's sites make exactly its buildings.
  if (task.sites) {
    const own = siteVisualScene(decodeCitySiteVisualsAt(task.buffer, task.sites) as unknown as UrbanSiteVisual[]).buildings;
    if (own.length === task.sites.length) return cityBuildingsShare(own, { ...task, worker: 0, workers: 1 });
  }
  return cityBuildingsShare(siteVisualScene(decodeCitySiteVisuals(task.buffer) as unknown as UrbanSiteVisual[]).buildings, task);
}
/** The chunk of `task` from the scene's buildings (tests run it without a worker). */
export function cityBuildingsShare(all: readonly PlacedBuilding[], task: Omit<CityBuildingsTask, 'buffer'>): CityBuildingsChunk {
  const mine: PlacedBuilding[] = [];
  for (let g = task.worker; g < all.length; g += task.workers) mine.push(all[g]);
  const local = new Map(mine.map((building, i) => [building, i]));
  const built = buildCityBuildings({ buildings: mine }, undefined, { roofs: task.roofs, cultures: task.cultures, rawRoofs: true });
  const own = (surface: Surface | undefined, building: PlacedBuilding): Surface | typeof OWN_FOOTPRINT | undefined => (surface === building.footprint ? OWN_FOOTPRINT : surface);
  const items = built.items.map(({ building, surface, footprint, ruins, ...rest }) => ({
    ...rest,
    b: local.get(building)!,
    surface: surface === building.roof_footprint || surface === building.footprint ? OWN_FOOTPRINT : surface,
    ...(footprint ? { footprint: own(footprint, building) } : {}),
    ...(ruins ? { ruins: own(ruins, building) } : {}),
  })) as ChunkItem[];
  return { items, roofs: built.roofs! };
}

/** Page side: the chunks of `workers` workers merged in the batch's order, linked to `plan` (as `buildCityBuildings`). */
export function mergeCityBuildingChunks(batch: Pick<PlacementBatch, 'buildings'>, plan: CityScene | undefined, chunks: CityBuildingsChunk[]): CityBuildings {
  const buildings = batch.buildings,
    workers = chunks.length,
    next = new Array<number>(workers).fill(0);
  // Pans of an item are contiguous in its chunk (owner ascending): the first pan of each item.
  const panStart = chunks.map(c => {
    const start = new Uint32Array(c.items.length + 1);
    let k = 0;
    for (let j = 0; j < c.items.length; j++) {
      start[j] = k;
      while (k < c.roofs.owner.length && c.roofs.owner[k] === j) k++;
    }
    start[c.items.length] = k;
    return start;
  });
  const items: CityBuilding[] = [],
    byId = new Map<string, number>();
  const shapes: Shape[] = [],
    owner: number[] = [],
    light: number[] = [],
    cover: string[] = [],
    wall: string[] = [],
    tone: number[] = [],
    dir: number[] = [],
    flat: number[] = [],
    snow: number[] = [],
    patch: number[] = [],
    grain: number[] = [],
    rim: number[] = [],
    tint: (string | undefined)[] = [],
    shadows: Shape[][] = [];
  for (let g = 0; g < buildings.length; g++) {
    const w = g % workers,
      c = chunks[w],
      j = next[w],
      item = c.items[j];
    if (!item || item.b !== (g - w) / workers) continue;
    next[w]++;
    const building = buildings[g],
      { b: _b, surface, footprint, ruins, ...rest } = item,
      index = items.length,
      back = (s: Surface | typeof OWN_FOOTPRINT): Surface => (s === OWN_FOOTPRINT ? building.footprint : s);
    const link = cityBuildingLink(building, plan);
    items.push({
      ...rest,
      surface: surface === OWN_FOOTPRINT ? (building.roof_footprint.length ? building.roof_footprint : building.footprint) : surface,
      ...(footprint !== undefined ? { footprint: back(footprint) } : {}),
      ...(ruins !== undefined ? { ruins: back(ruins) } : {}),
      role: link.role,
      family: link.family,
      landmark: link.landmark,
      parcel: link.parcel,
      building,
    } as CityBuilding);
    byId.set(building.id, index);
    const r = c.roofs;
    for (let k = panStart[w][j]; k < panStart[w][j + 1]; k++) {
      shapes.push(r.shapes[k]);
      owner.push(index);
      light.push(r.light[k]);
      cover.push(r.cover[k]);
      wall.push(r.wall![k]);
      tone.push(r.tone[k]);
      dir.push(r.dir[k]);
      flat.push(r.flat![k]);
      snow.push(r.snow![k]);
      patch.push(r.patch![k]);
      grain.push(r.grain![k]);
      rim.push(r.rim![k]);
      tint.push(r.tint![k]);
    }
    shadows.push(r.shadows[j]);
  }
  citySnowAltitudes(items, plan);
  const roofs = shapes.length
    ? {
        shapes,
        owner: Uint32Array.from(owner),
        light: Float32Array.from(light),
        cover,
        wall,
        tone: Float32Array.from(tone),
        dir: Float32Array.from(dir),
        flat: Uint8Array.from(flat),
        snow: Float32Array.from(snow),
        patch: Uint8Array.from(patch),
        grain: Uint8Array.from(grain),
        rim: Uint8Array.from(rim),
        tint,
        shadows,
      }
    : undefined;
  return { items, byId, bins: cityBuildingBins(items), ...(roofs ? { roofs } : {}) };
}

const MAX_WORKERS = 8;
/** Idle workers started ahead (`prewarmCityBuildingWorkers`), and when they are dropped unused. */
let warm: Worker[] = [],
  warmTimer: ReturnType<typeof setTimeout> | undefined;
const WARM_MS = 10 * 60000;
const spawn = (): Worker => new Worker(new URL('./cityBuildingsWorker.ts', import.meta.url), { type: 'module' });
// Each worker holds its own core WASM instance and site copies: a handheld tab (killed near 1-1.5 GB) keeps 2, 1 on a
// 4 GB device (below 2 the page builds alone).
const workerCount = (): number => {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
    memory = typeof navigator !== 'undefined' ? (navigator as { deviceMemory?: number }).deviceMemory : undefined;
  return Math.min(MAX_WORKERS, cores - 2, handheldDevice() ? (memory !== undefined && memory <= 4 ? 1 : 2) : MAX_WORKERS);
};
/** Starts the build workers while the engine computes a town, so their module load is not on the drawing's path. */
export function prewarmCityBuildingWorkers(): void {
  if (typeof Worker === 'undefined' || workerCount() < 2) return;
  try {
    while (warm.length < workerCount()) warm.push(spawn());
  } catch {
    return;
  }
  clearTimeout(warmTimer);
  warmTimer = setTimeout(releaseCityBuildingWorkers, WARM_MS);
}
/** Drops the warm workers left unused (a small town built on the page, a heavy result that needs the heap). */
export function releaseCityBuildingWorkers(): void {
  clearTimeout(warmTimer);
  for (const w of warm) w.terminate();
  warm = [];
}
/** `n` workers: the warm ones first; successful jobs return them to the pool. */
function takeWorkers(n: number): Worker[] {
  const pool = warm.splice(0, n);
  if (!warm.length) clearTimeout(warmTimer);
  while (pool.length < n) pool.push(spawn());
  return pool;
}
/** Below this many shapes the page clips a plan's ground itself (about 20 µs a shape; a worker round trip costs more). */
const CLIP_AHEAD_MIN_SHAPES = 4000;
/** A clip ahead that does not answer in time is dropped and the page clips as it always did: a few times what the
 * page itself would take (starved workers, on a saturated machine, were seen ten times slower than the page). */
const CLIP_AHEAD_MS_PER_SHAPE = 0.1,
  CLIP_AHEAD_MIN_MS = 1500,
  CLIP_AHEAD_MAX_MS = 15000;
/** Clips the ground of plans about to be built (`cityGroundSubjects`) on the warm build workers, in shares: the page
 * no longer runs the water boolean of a region's towns on its own thread. Only with workers already started
 * (`prewarmCityBuildingWorkers`): they are idle until the buildings are built, right after the plans. Any failure
 * leaves the shapes to the plans' own clip, with the same result. */
export async function clipCityGroundAhead(ground: CityGround, shapes: readonly Shape[]): Promise<void> {
  const count = typeof Worker === 'undefined' || warm.length < 2 ? 0 : ground.unclipped(shapes);
  if (count < CLIP_AHEAD_MIN_SHAPES) return;
  const patience = Math.max(CLIP_AHEAD_MIN_MS, Math.min(CLIP_AHEAD_MAX_MS, count * CLIP_AHEAD_MS_PER_SHAPE));
  // The workers leave the warm list while they clip: a second caller cannot reuse them, a release cannot end them.
  const pool = warm.splice(0, warm.length),
    start = performance.now();
  let lost = false;
  try {
    await ground.clipAhead(shapes, pool.length, tasks =>
      Promise.all(
        tasks.map(
          (task, k) =>
            new Promise<Float64Array>((resolve, reject) => {
              const w = pool[k],
                timer = setTimeout(() => reject(new Error('city ground clip timed out')), patience);
              w.onmessage = ({ data }: MessageEvent<{ clipped?: Float64Array; error?: string }>) => {
                clearTimeout(timer);
                if (data.clipped) resolve(data.clipped);
                else reject(new Error(data.error ?? 'city ground clip failed'));
              };
              w.onerror = e => {
                clearTimeout(timer);
                reject(new Error(e.message || 'city ground clip failed'));
              };
              w.postMessage({ clip: task }, [task.subjects.buffer]);
            }),
        ),
      ),
    );
  } catch (error) {
    lost = true;
    console.warn('Parallel city ground clip failed, clipping on the page:', error);
  }
  if (lost) {
    for (const w of pool) w.terminate();
    return;
  }
  for (const w of pool) {
    w.onmessage = null;
    w.onerror = null;
  }
  performance.measure('displayprep:ground-clip:workers', { start });
  warm.unshift(...pool);
  clearTimeout(warmTimer);
  warmTimer = setTimeout(releaseCityBuildingWorkers, WARM_MS);
}
/** Per worker, the indices of the sites its buildings (`worker`, `worker + workers`…) come from: the scene keeps the
 * sites' order and skips some (open spaces, empty surfaces), so each building is the next site with its id. Undefined
 * when a building cannot be matched (the workers then decode the whole town). */
function siteShares(buildings: readonly PlacedBuilding[], sites: readonly { id: string }[], workers: number): Uint32Array[] | undefined {
  const shares = Array.from({ length: workers }, (_, w) => new Uint32Array(Math.ceil((buildings.length - w) / workers)));
  let k = 0;
  for (let g = 0; g < buildings.length; g++, k++) {
    while (k < sites.length && sites[k].id !== buildings[g].id) k++;
    if (k === sites.length) return undefined;
    shares[g % workers][Math.floor(g / workers)] = k;
  }
  return shares;
}
/** The site visuals `scene` was built from, when it is the unedited silhouette scene of a decoded site buffer. */
function sceneBuffer(scene: PlacementBatch | undefined, sites: unknown): ArrayBuffer | undefined {
  if (!scene || !Array.isArray(sites) || siteVisualSceneSource(scene) !== sites) return undefined;
  return siteVisualsPackOf(sites as never);
}
/** `buildCityBuildings(scene, plan, options)` over workers, or undefined when it cannot run there (no workers, a small
 * or edited scene, a scene not built from binary site visuals): the caller then builds on its own thread. */
export async function buildCityBuildingsParallel(scene: PlacementBatch | undefined, plan: CityScene | undefined, sites: unknown, options: { roofs?: boolean; batchBuildings?: number } = {}): Promise<CityBuildings | undefined> {
  const buffer = sceneBuffer(scene, sites);
  if (!buffer || !scene || (options.batchBuildings ?? scene.buildings.length) < (warm.length >= 2 ? PARALLEL_WARM_MIN_BUILDINGS : PARALLEL_MIN_BUILDINGS) || typeof Worker === 'undefined') return undefined;
  // Each worker holds a decoded copy of the sites, in the renderer's shared JS heap: the copies stay within a budget
  // (a town of 1,000,000 inhabitants, 325 MB of sites, keeps its one-thread build of the roofless base).
  const workers = Math.min(workerCount(), Math.max(2, Math.ceil(scene.buildings.length / 500)), Math.floor(PARALLEL_SITE_BYTES / buffer.byteLength));
  if (workers < 2) return undefined;
  const cultures = Array.from({ length: workers }, () => [] as string[]);
  scene.buildings.forEach((building, g) => cultures[g % workers].push(cityBuildingCulture(building, plan)));
  const shares = siteShares(scene.buildings, sites as readonly { id: string }[], workers);
  let pool: Worker[] = [],
    reusable = false;
  const start = performance.now();
  try {
    pool = takeWorkers(workers);
    const chunks = await Promise.all(
      cultures.map(
        (list, worker) =>
          new Promise<CityBuildingsChunk>((resolve, reject) => {
            const w = pool[worker];
            w.onmessage = ({ data }: MessageEvent<{ chunk?: CityBuildingsChunk; error?: string }>) => (data.chunk ? resolve(data.chunk) : reject(new Error(data.error ?? 'city buildings worker failed')));
            w.onerror = e => reject(new Error(e.message || 'city buildings worker failed'));
            const task: CityBuildingsTask = { buffer: buffer.slice(0), worker, workers, cultures: list, roofs: options.roofs !== false, ...(shares ? { sites: shares[worker] } : {}) };
            w.postMessage(task, [task.buffer]);
          }),
      ),
    );
    const result = mergeCityBuildingChunks(scene, plan, chunks);
    reusable = true;
    performance.measure('displayprep:city-buildings:workers', { start });
    return result;
  } catch (error) {
    console.warn('Parallel city buildings failed, building on the page:', error);
    return undefined;
  } finally {
    if (reusable) {
      for (const w of pool) {
        w.onmessage = null;
        w.onerror = null;
      }
      warm.unshift(...pool);
      clearTimeout(warmTimer);
      warmTimer = setTimeout(releaseCityBuildingWorkers, WARM_MS);
    } else for (const w of pool) w.terminate();
  }
}
