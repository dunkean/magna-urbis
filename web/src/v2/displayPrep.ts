import type { TerrainLayer, LandUseLayer, World } from '../gen/types';
import type { TerrainData } from '../../../rust/bridge/terrain';
import type { ForestField, ForestFieldInput, ForestSettings, ForestOccupation, LandDetail } from '../../../rust/bridge/terrainForest';
import { retainShoreRing, type ForestBeachLayer, type ShoreRingGrid } from '../../../rust/bridge/terrainForestBeach';
import { lakeDistances, retainLakeDistances, retainPlanningWaterDistances, type WaterSurface } from '../render/terrainWater';
import type { ForestCorridor } from '../render/forestRoom';
import { DISPLAY_PRODUCT_VERSION, measureDisplayProduct, productRevision } from '../render/displayProduct';
import { retainFloatPyramid } from '../render/floatPyramid';
import { packOccupationLanduse, type PackedOccupationLanduse } from '../ui/occupationLanduse';
import type { ExecutionRuntime } from '../ui/executionProfile';

export interface LakeInput { field: Float32Array; n: number; width: number; referenceWidth: number }
export interface TerrainPrepInput { layer: ForestBeachLayer; lakes: LakeInput[]; sea?: WaterSurface; planning: { water: Uint8Array; n: number; width: number } }
export interface TerrainPrepResult { shore: ShoreRingGrid; lakes: Float32Array[]; sea?: WaterSurface; planning: Float32Array; heightMips: Float32Array[]; lakeMips: { field: Float32Array[]; distance: Float32Array[] }[]; timings: { product: string; ms: number }[] }
interface DisplayJobs {
  terrain: { input: TerrainPrepInput; output: TerrainPrepResult };
  register: { input: { revision: number; packed: PackedOccupationLanduse }; output: void };
  release: { input: { revision: number }; output: void };
  occupation: { input: { landuseRevision: number; revision: number; corridors: ForestCorridor[] }; output: ForestOccupation | undefined };
  detail: { input: { landuseRevision: number }; output: LandDetail | undefined };
  merge: { input: { retained?: WorkerOccupation; source?: Omit<ForestOccupation, 'detail'>; shapes: Float64Array }; output: ForestOccupation };
  forest: { input: { input: ForestFieldInput; settings: ForestSettings; runtime?: ExecutionRuntime }; output: ForestField };
}
export type DisplayPrepRequest = { [K in keyof DisplayJobs]: { id: number; kind: K; input: DisplayJobs[K]['input'] } }[keyof DisplayJobs];
type Reply = { id: number; result?: unknown; error?: string; ms: number };
let worker: Worker | undefined, serial = 0, workerEpoch = 1;
export interface WorkerOccupation { landuseRevision: number; revision: number; epoch: number }
export const displayWorkerEpoch = (): number => workerEpoch;
const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void; kind: string }>();
function failed(error: Error): void {
  worker?.terminate(); worker = undefined; workerEpoch++;
  for (const job of pending.values()) job.reject(error);
  pending.clear();
}
/** One persistent numeric preparation lane per realm; no WASM thread pool per product/style. */
export function runDisplayJob<K extends keyof DisplayJobs>(kind: K, input: DisplayJobs[K]['input'], transfer: Transferable[] = []): Promise<DisplayJobs[K]['output']> {
  return new Promise((resolve, reject) => {
    try {
      if (!worker) {
        worker = new Worker(new URL('./occupation.worker.ts', import.meta.url), { type: 'module', name: 'magna-display-prep threads=off' });
        worker.onmessage = ({ data }: MessageEvent<Reply>) => {
          const job = pending.get(data.id); if (!job) return;
          pending.delete(data.id);
          const end = performance.now();
          performance.measure(`displayprep:${job.kind}:worker`, { start: Math.max(0, end - data.ms), end });
          if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
        };
        worker.onerror = event => failed(new Error(event.message || 'Display preparation worker failed.'));
        worker.onmessageerror = () => failed(new Error('Display preparation reply could not be decoded.'));
      }
      const id = ++serial;
      pending.set(id, { resolve: resolve as (result: unknown) => void, reject, kind });
      try { measureDisplayProduct(`${kind}:post`, () => worker!.postMessage({ id, kind, input }, transfer)); }
      catch (error) { pending.delete(id); reject(error); }
    } catch (error) { reject(error); }
  });
}
interface LanduseRegistration { revision: number; epoch: number; ready: Promise<void> }
const registeredLanduse = new WeakMap<LandUseLayer, LanduseRegistration>();
const releases = new FinalizationRegistry<{ revision: number; epoch: number }>(ref => {
  if (worker && ref.epoch === workerEpoch) void runDisplayJob('release', { revision: ref.revision }).catch(() => {});
});
/** Pack/register once per immutable land-use revision and worker lifetime. Other requests send only IDs. */
export function registerDisplayLanduse(landuse: LandUseLayer): LanduseRegistration {
  const found = registeredLanduse.get(landuse);
  if (found?.epoch === workerEpoch) return found;
  const revision = productRevision(landuse), epoch = workerEpoch;
  const packed = measureDisplayProduct('landuse-pack', () => packOccupationLanduse(landuse));
  performance.mark('displayprep:landuse:register', { detail: { revision, coordinateBytes: packed.coordinates.byteLength, rings: packed.lengths.length } });
  const ready = runDisplayJob('register', { revision, packed }, [packed.lengths.buffer, packed.coordinates.buffer]);
  const entry = { revision, epoch, ready };
  registeredLanduse.set(landuse, entry);
  releases.register(landuse, { revision, epoch });
  void ready.catch(() => { if (registeredLanduse.get(landuse) === entry) registeredLanduse.delete(landuse); });
  return entry;
}
interface PreparedTerrain { version: number; input: TerrainPrepInput; result?: TerrainPrepResult }
const preparingTerrains = new WeakSet<PreparedTerrain>();
type PreparedLayer = TerrainLayer & { v2NativeTerrain?: TerrainData; v2DisplayPreparation?: PreparedTerrain };
function inputs(terrain: PreparedLayer, width: number): TerrainPrepInput {
  const native = terrain.v2NativeTerrain, field = native?.field;
  const layer = { x: native?.x ?? 0, y: native?.y ?? 0, width, n: field?.n ?? native?.resolution ?? terrain.height.w,
    data: field?.data ?? native?.height ?? terrain.height.data };
  const lakes: LakeInput[] = [];
  if (native?.water) lakes.push({ field: native.water.lakeField.values, n: native.water.hydro.n, width, referenceWidth: width });
  if (native?.hydrology) lakes.push({ field: native.hydrology.waterField, n: native.hydrology.resolution, width, referenceWidth: width });
  return { layer, lakes, sea: native?.waterSurface, planning: { water: terrain.water, n: terrain.height.w, width } };
}
const sameInput = (a: TerrainPrepInput, b: TerrainPrepInput): boolean => a.layer.data === b.layer.data && a.layer.n === b.layer.n
  && a.layer.width === b.layer.width && a.layer.x === b.layer.x && a.layer.y === b.layer.y
  && a.planning.water === b.planning.water && a.planning.n === b.planning.n && a.planning.width === b.planning.width
  && a.lakes.length === b.lakes.length && a.lakes.every((v, i) => v.field === b.lakes[i].field && v.n === b.lakes[i].n && v.width === b.lakes[i].width);
/** Called at the final physical terrain/water boundary. Never await at the generation tail.
 * Stage clones retain this small holder by reference, so completed products join the normal world reply. */
export function startTerrainDisplayPreparation(terrain: TerrainLayer, width: number): void {
  if (typeof Worker === 'undefined') return;
  const target = terrain as PreparedLayer, input = inputs(target, width), old = target.v2DisplayPreparation;
  // A cache snapshot can contain an unfinished holder cloned from another realm/job.
  if (old?.version === DISPLAY_PRODUCT_VERSION && sameInput(old.input, input) && (old.result || preparingTerrains.has(old))) return;
  const prepared: PreparedTerrain = { version: DISPLAY_PRODUCT_VERSION, input };
  target.v2DisplayPreparation = prepared;
  preparingTerrains.add(prepared);
  void runDisplayJob('terrain', input).then(result => {
    prepared.result = result;
    if (target.v2NativeTerrain && target.v2DisplayPreparation === prepared && sameInput(input, inputs(target, width)))
      target.v2NativeTerrain.waterSurface ??= result.sea;
  }, error => {
    if (target.v2DisplayPreparation === prepared) delete target.v2DisplayPreparation;
    console.warn('Terrain display preparation failed:', error);
  }).finally(() => { preparingTerrains.delete(prepared); });
}
const installed = new WeakSet<PreparedTerrain>();
/** No hashing/cloning on style switches. Structured clone preserves the envelope's source-array identities. */
export function retainTerrainDisplayPreparation(world: World): void {
  const terrain = world.terrain as PreparedLayer, prepared = terrain.v2DisplayPreparation;
  if (!prepared?.result || installed.has(prepared) || prepared.version !== DISPLAY_PRODUCT_VERSION || !sameInput(prepared.input, inputs(terrain, world.mapSize))) return;
  installed.add(prepared);
  retainShoreRing(prepared.input.layer, prepared.result.shore);
  retainPlanningWaterDistances(prepared.input.planning.water, prepared.input.planning.n, prepared.input.planning.width, prepared.result.planning);
  retainFloatPyramid(prepared.input.layer.data, prepared.input.layer.n, prepared.result.heightMips);
  for (let i = 0; i < prepared.input.lakes.length; i++) {
    const v = prepared.input.lakes[i]; retainLakeDistances(v.field, v.n, v.width, v.referenceWidth, prepared.result.lakes[i]);
    retainFloatPyramid(v.field, v.n, prepared.result.lakeMips[i].field);
    retainFloatPyramid(lakeDistances(v.field, v.n, v.width, v.referenceWidth), v.n, prepared.result.lakeMips[i].distance);
  }
  performance.mark('displayprep:terrain:retained', { detail: prepared.result.timings });
}
