/// <reference lib="webworker" />
import { generateTerrain, planRegion, rerouteRegion, generateTowns, generateTown, generateTownStage, clearTerrainPreviews, namesRenamedAfterActions } from './engine';
import type { V2WorkerRequest, V2WorkerResponse, V2ResourceRequest, ProgressCallback } from './contracts';
import { WorkerWorld } from './workerWorld';
import { renameMap } from './mapNaming';
import { wasmThreadsInfo } from '../../../rust/bridge/wasmThreads';
import { showCityStageOutput } from './cityStageOutput';
import { packWorldLanduse } from './landusePack';
import { HEAVY_RESULT_BYTES, packWorldPartitions, unpackWorldPartitions } from './urbanPack';
import { browserRuntimeSettings, retryNativeStage, runtimeForRun, usesNativeRuntime, F } from './runtimeChoices';
import { onNativeConnectionFailure } from '../../../rust/bridge/nativeAvailability';
import type { V2Settings } from './contracts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
// Serialize actions; the procedural cores retain per-thread scratch buffers.
let queue = Promise.resolve();
const retained=new WorkerWorld();
// Every action below ends with renameMap: the town stage need not name its result first.
namesRenamedAfterActions();
scope.onmessage = ({ data: request }: MessageEvent<V2WorkerRequest|V2ResourceRequest|{type:'release'|'release-urban-lanes'}>) => {
  if('type'in request&&request.type==='resources'){
    const {id,settings}=request;
    queue=queue.then(async()=>{
      try{
        const world=retained.resolve(request.retainedWorldId,unpackWorldPartitions(request.world));
        if(!world)throw new Error('No map to process.');
        const selected = await runtimeForRun(settings);
        const payload = await retryNativeStage(selected.settings, effective => import('./region').then(module => module.regionResources(world, effective)), () => {});
        scope.postMessage({id,type:'resources',payload} satisfies V2WorkerResponse);
      }catch(error){scope.postMessage({id,type:'error',error:error instanceof Error?error.message:String(error)} satisfies V2WorkerResponse);}
    });
    return;
  }
  if('type'in request){queue=queue.then(async()=>{
    await(await import('./rustUrban')).releaseUrbanLanes();
    if(request.type==='release'){
      retained.clear();clearTerrainPreviews();const {releaseTerrainCheckpoints}=await import('../../../rust/bridge/terrain');releaseTerrainCheckpoints();
    }
  });return;}
  queue = queue.then(async () => {
    const { id, action } = request;
    let settings = request.settings;
    const send = (message: V2WorkerResponse): void => scope.postMessage(message);
    const progress: ProgressCallback = value => send({ id, type: 'progress', progress: value });
    const fallback = (effective: V2Settings, note: string, server = effective.runtime?.localServer ?? 'http://127.0.0.1:8791'): void => {
      const changed = usesNativeRuntime(settings);
      settings = effective;
      if (changed) progress({ stage: 'runtime-fallback', label: note, detail: server, completed: 0, total: 0 });
    };
    const stopObserving = onNativeConnectionFailure(server => {
      if (usesNativeRuntime(settings)) fallback(browserRuntimeSettings(settings), F.engineToBrowser, server);
    });
    const stage = <T>(run: (effective: V2Settings) => Promise<T>): Promise<T> => retryNativeStage(settings, run, fallback);
    try {
      // A world sent by the page carries its town partitions packed (urbanPack.ts).
      let world = retained.resolve(request.retainedWorldId,unpackWorldPartitions(request.world));
      if (action === 'terrain' || action === 'all') world = await stage(effective => generateTerrain(effective, progress, undefined, request.assetBase, request.terrainStage));
      if (!world) throw new Error('No map to process.');
      if (action === 'region' || action === 'settlements' || action === 'all') world = await stage(effective => planRegion(world!, effective, progress, action === 'all'));
      if (action === 'roads') world = await stage(effective => rerouteRegion(world!, effective, progress));
      if (action === 'towns' || action === 'all') world = await stage(effective => generateTowns(world!, effective, progress, action === 'towns' ? request.keys : undefined, action === 'towns' ? request.townStage : undefined, !!request.keepUrbanLanes));
      if (action === 'town') {
        if (!request.key) throw new Error('Choose a settlement.');
        world = await stage(effective => request.townStage ? generateTownStage(world!, effective, request.key!, request.townStage, progress)
          : generateTown(world!, effective, request.key!, progress));
      }
      if (!['terrain', 'region', 'roads', 'towns', 'town', 'settlements', 'all'].includes(action)) throw new Error('Unknown action.');
      world = renameMap(world, settings);
      if (request.cityOutput) world = showCityStageOutput(world, request.cityOutput, request.key ? [request.key] : request.keys);
      else if (world.stats['v2.cityOutput']) { world = { ...world, stats: { ...world.stats } }; delete world.stats['v2.cityOutput']; delete world.stats['v2.cityOutputKeys']; }
      retained.retain(id,world);
      // The WASM mode this worker actually runs (window.magnaWasmThreads on the page).
      // Land-use areas and town partitions travel packed (landusePack.ts, urbanPack.ts); the retained world keeps its own objects.
      const landuse = packWorldLanduse(world), packed = packWorldPartitions(landuse.world);
      const heavy = packed.transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0) > HEAVY_RESULT_BYTES;
      // A heavy result (a town of about a million people): the page replaces this worker, so nothing is retained here.
      if (heavy) {retained.clear();await(await import('./rustUrban')).releaseUrbanLanes();}
      scope.postMessage({ id, type: 'result', world: packed.world, wasm: wasmThreadsInfo(), ...(heavy ? { heavy } : {}) } satisfies V2WorkerResponse, [...landuse.transfer, ...packed.transfer]);
    } catch (error) { await(await import('./rustUrban')).releaseUrbanLanes();send({ id, type: 'error', error: error instanceof Error ? error.message : String(error), wasm: wasmThreadsInfo() }); }
    finally { stopObserving(); }
  });
};
