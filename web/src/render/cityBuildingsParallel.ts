/** `buildCityBuildings` (cityCanvas.ts) split over workers for the unedited city volumes of a native town: each worker
 * decodes its own copy of the binary site visuals (render/cityDisplayBuffers.ts), rebuilds the same scene
 * (ui/urbanSilhouettes.ts `siteVisualScene`) and builds the roofs, shadows and outlines of every K-th building with the
 * very same code; the page links the items to its plan and merges them in the town's order. The result equals the
 * one-thread build (same items, pans and shadows in the same order); only the work is spread. Roof pans and cast
 * shadows (polygon booleans) are most of the time the V2 spends preparing a town's drawing. */
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../../rust/bridge/housesContract';
import type { Shape } from '../../../rust/bridge/urban';
import { buildCityBuildings, cityBuildingBins, cityBuildingCulture, cityBuildingLink, citySnowAltitudes, type CityBuilding, type CityBuildings, type CityRoofs, type CityScene } from './cityCanvas';
import { decodeCitySiteVisuals, siteVisualsPackOf } from './cityDisplayBuffers';
import { siteVisualScene, siteVisualSceneSource } from '../ui/urbanSilhouettes';
import type { UrbanSiteVisual } from '../ui/urbanSiteStore';

/** Below this many buildings the one-thread build is as fast (a 20k town has about 6,500 and builds them in ~1.5 s;
 * a worker takes about 2 s to load its modules from the dev server and JIT them). */
const PARALLEL_MIN_BUILDINGS = 12000;
/** Budget of the site buffers copied to the workers (each decodes about three times its buffer in objects). */
const PARALLEL_SITE_BYTES = 256 * 2 ** 20;
/** A surface equal to the building's own footprint travels as this marker (the page puts its own object back). */
const OWN_FOOTPRINT = 1;
export interface CityBuildingsTask { buffer: ArrayBuffer; worker: number; workers: number; cultures: string[]; roofs: boolean }
type ChunkItem = Omit<CityBuilding, 'building' | 'surface' | 'footprint' | 'ruins'> & { b: number; surface: Surface | typeof OWN_FOOTPRINT; footprint?: Surface | typeof OWN_FOOTPRINT; ruins?: Surface | typeof OWN_FOOTPRINT };
export interface CityBuildingsChunk { items: ChunkItem[]; roofs: CityRoofs }

/** Worker side: the items and roof arrays of buildings `worker`, `worker + workers`… of the scene rebuilt from `buffer`. */
export function cityBuildingsChunk(task: CityBuildingsTask): CityBuildingsChunk {
  return cityBuildingsShare(siteVisualScene(decodeCitySiteVisuals(task.buffer) as unknown as UrbanSiteVisual[]).buildings, task);
}
/** The chunk of `task` from the scene's buildings (tests run it without a worker). */
export function cityBuildingsShare(all: readonly PlacedBuilding[], task: Omit<CityBuildingsTask, 'buffer'>): CityBuildingsChunk {
  const mine: PlacedBuilding[] = [];
  for (let g = task.worker; g < all.length; g += task.workers) mine.push(all[g]);
  const local = new Map(mine.map((building, i) => [building, i]));
  const built = buildCityBuildings({ buildings: mine }, undefined, { roofs: task.roofs, cultures: task.cultures, rawRoofs: true });
  const own = (surface: Surface | undefined, building: PlacedBuilding): Surface | typeof OWN_FOOTPRINT | undefined => surface === building.footprint ? OWN_FOOTPRINT : surface;
  const items = built.items.map(({ building, surface, footprint, ruins, ...rest }) => ({ ...rest, b: local.get(building)!,
    surface: surface === building.roof_footprint || surface === building.footprint ? OWN_FOOTPRINT : surface,
    ...(footprint ? { footprint: own(footprint, building) } : {}), ...(ruins ? { ruins: own(ruins, building) } : {}) })) as ChunkItem[];
  return { items, roofs: built.roofs! };
}

/** Page side: the chunks of `workers` workers merged in the batch's order, linked to `plan` (as `buildCityBuildings`). */
export function mergeCityBuildingChunks(batch: Pick<PlacementBatch, 'buildings'>, plan: CityScene | undefined, chunks: CityBuildingsChunk[]): CityBuildings {
  const buildings = batch.buildings, workers = chunks.length, next = new Array<number>(workers).fill(0);
  // Pans of an item are contiguous in its chunk (owner ascending): the first pan of each item.
  const panStart = chunks.map(c => { const start = new Uint32Array(c.items.length + 1); let k = 0; for (let j = 0; j < c.items.length; j++) { start[j] = k; while (k < c.roofs.owner.length && c.roofs.owner[k] === j) k++; } start[c.items.length] = k; return start; });
  const items: CityBuilding[] = [], byId = new Map<string, number>();
  const shapes: Shape[] = [], owner: number[] = [], light: number[] = [], cover: string[] = [], wall: string[] = [], tone: number[] = [], dir: number[] = [], flat: number[] = [], snow: number[] = [], patch: number[] = [], grain: number[] = [], rim: number[] = [], tint: (string | undefined)[] = [], shadows: Shape[][] = [];
  for (let g = 0; g < buildings.length; g++) {
    const w = g % workers, c = chunks[w], j = next[w], item = c.items[j];
    if (!item || item.b !== (g - w) / workers) continue;
    next[w]++;
    const building = buildings[g], { b: _b, surface, footprint, ruins, ...rest } = item, index = items.length, back = (s: Surface | typeof OWN_FOOTPRINT): Surface => s === OWN_FOOTPRINT ? building.footprint : s;
    const link = cityBuildingLink(building, plan);
    items.push({ ...rest, surface: surface === OWN_FOOTPRINT ? (building.roof_footprint.length ? building.roof_footprint : building.footprint) : surface,
      ...(footprint !== undefined ? { footprint: back(footprint) } : {}), ...(ruins !== undefined ? { ruins: back(ruins) } : {}),
      role: link.role, family: link.family, landmark: link.landmark, parcel: link.parcel, building } as CityBuilding);
    byId.set(building.id, index);
    const r = c.roofs;
    for (let k = panStart[w][j]; k < panStart[w][j + 1]; k++) {
      shapes.push(r.shapes[k]); owner.push(index); light.push(r.light[k]); cover.push(r.cover[k]); wall.push(r.wall![k]); tone.push(r.tone[k]); dir.push(r.dir[k]);
      flat.push(r.flat![k]); snow.push(r.snow![k]); patch.push(r.patch![k]); grain.push(r.grain![k]); rim.push(r.rim![k]); tint.push(r.tint![k]);
    }
    shadows.push(r.shadows[j]);
  }
  citySnowAltitudes(items, plan);
  const roofs = shapes.length ? { shapes, owner: Uint32Array.from(owner), light: Float32Array.from(light), cover, wall, tone: Float32Array.from(tone), dir: Float32Array.from(dir), flat: Uint8Array.from(flat), snow: Float32Array.from(snow), patch: Uint8Array.from(patch), grain: Uint8Array.from(grain), rim: Uint8Array.from(rim), tint, shadows } : undefined;
  return { items, byId, bins: cityBuildingBins(items), ...(roofs ? { roofs } : {}) };
}

const MAX_WORKERS = 8;
/** Idle workers started ahead (`prewarmCityBuildingWorkers`), and when they are dropped unused. */
let warm: Worker[] = [], warmTimer: ReturnType<typeof setTimeout> | undefined;
const WARM_MS = 10 * 60000;
const spawn = (): Worker => new Worker(new URL('./cityBuildingsWorker.ts', import.meta.url), { type: 'module' });
const workerCount = (): number => Math.min(MAX_WORKERS, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4) - 2);
/** Starts the build workers while the engine computes a town, so their module load is not on the drawing's path. */
export function prewarmCityBuildingWorkers(): void {
  if (typeof Worker === 'undefined' || workerCount() < 2) return;
  try { while (warm.length < workerCount()) warm.push(spawn()); } catch { return; }
  clearTimeout(warmTimer);
  warmTimer = setTimeout(releaseCityBuildingWorkers, WARM_MS);
}
/** Drops the warm workers left unused (a small town built on the page, a heavy result that needs the heap). */
export function releaseCityBuildingWorkers(): void { clearTimeout(warmTimer); for (const w of warm) w.terminate(); warm = []; }
/** `n` workers: the warm ones first; the caller terminates them after use. */
function takeWorkers(n: number): Worker[] {
  const pool = warm.splice(0, n);
  if (!warm.length) clearTimeout(warmTimer);
  while (pool.length < n) pool.push(spawn());
  return pool;
}
/** The site visuals `scene` was built from, when it is the unedited silhouette scene of a decoded site buffer. */
function sceneBuffer(scene: PlacementBatch | undefined, sites: unknown): ArrayBuffer | undefined {
  if (!scene || !Array.isArray(sites) || siteVisualSceneSource(scene) !== sites) return undefined;
  return siteVisualsPackOf(sites as never);
}
/** `buildCityBuildings(scene, plan, options)` over workers, or undefined when it cannot run there (no workers, a small
 * or edited scene, a scene not built from binary site visuals): the caller then builds on its own thread. */
export async function buildCityBuildingsParallel(scene: PlacementBatch | undefined, plan: CityScene | undefined, sites: unknown, options: { roofs?: boolean } = {}): Promise<CityBuildings | undefined> {
  const buffer = sceneBuffer(scene, sites);
  if (!buffer || !scene || scene.buildings.length < PARALLEL_MIN_BUILDINGS || typeof Worker === 'undefined') return undefined;
  // Each worker holds a decoded copy of the sites, in the renderer's shared JS heap: the copies stay within a budget
  // (a town of 1,000,000 inhabitants, 325 MB of sites, keeps its one-thread build of the roofless base).
  const workers = Math.min(workerCount(), Math.floor(PARALLEL_SITE_BYTES / buffer.byteLength));
  if (workers < 2) return undefined;
  const cultures = Array.from({ length: workers }, () => [] as string[]);
  scene.buildings.forEach((building, g) => cultures[g % workers].push(cityBuildingCulture(building, plan)));
  let pool: Worker[] = [];
  try {
    pool = takeWorkers(workers);
    const chunks = await Promise.all(cultures.map((list, worker) => new Promise<CityBuildingsChunk>((resolve, reject) => {
      const w = pool[worker];
      w.onmessage = ({ data }: MessageEvent<{ chunk?: CityBuildingsChunk; error?: string }>) => data.chunk ? resolve(data.chunk) : reject(new Error(data.error ?? 'city buildings worker failed'));
      w.onerror = e => reject(new Error(e.message || 'city buildings worker failed'));
      const task: CityBuildingsTask = { buffer: buffer.slice(0), worker, workers, cultures: list, roofs: options.roofs !== false };
      w.postMessage(task, [task.buffer]);
    })));
    return mergeCityBuildingChunks(scene, plan, chunks);
  } catch (error) { console.warn('Parallel city buildings failed, building on the page:', error); return undefined; }
  finally { for (const w of pool) w.terminate(); }
}
