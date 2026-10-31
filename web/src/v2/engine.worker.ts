/// <reference lib="webworker" />
import { generateTerrain, planRegion, rerouteRegion, generateTowns, generateTown, generateTownStage, clearTerrainPreviews } from './engine';
import type { V2WorkerRequest, V2WorkerResponse, ProgressCallback } from './contracts';
import { WorkerWorld } from './workerWorld';
import { renameMap } from './mapNaming';
import { wasmThreadsInfo } from '../../../rust/bridge/wasmThreads';

const scope = self as unknown as DedicatedWorkerGlobalScope;
// Serialize actions; the procedural cores retain per-thread scratch buffers.
let queue = Promise.resolve();
const retained=new WorkerWorld();
scope.onmessage = ({ data: request }: MessageEvent<V2WorkerRequest|{type:'release'}>) => {
  if('type'in request){queue=queue.then(async()=>{retained.clear();clearTerrainPreviews();const {releaseTerrainCheckpoints}=await import('../../../rust/bridge/terrain');releaseTerrainCheckpoints();});return;}
  queue = queue.then(async () => {
    const { id, action, settings } = request;
    const send = (message: V2WorkerResponse): void => scope.postMessage(message);
    const progress: ProgressCallback = value => send({ id, type: 'progress', progress: value });
    try {
      let world = retained.resolve(request.retainedWorldId,request.world);
      if (action === 'terrain' || action === 'all') world = await generateTerrain(settings, progress, undefined, request.assetBase, request.terrainStage);
      if (!world) throw new Error('Aucune carte à traiter.');
      if (action === 'region' || action === 'settlements' || action === 'all') world = await planRegion(world, settings, progress);
      if (action === 'roads') world = await rerouteRegion(world, settings, progress);
      if (action === 'towns' || action === 'all') world = await generateTowns(world, settings, progress, action === 'towns' ? request.keys : undefined, action === 'towns' ? request.townStage : undefined);
      if (action === 'town') {
        if (!request.key) throw new Error('Choisissez un lieu.');
        world = request.townStage ? await generateTownStage(world, settings, request.key, request.townStage, progress)
          : await generateTown(world, settings, request.key, progress);
      }
      if (!['terrain', 'region', 'roads', 'towns', 'town', 'settlements', 'all'].includes(action)) throw new Error('Action inconnue.');
      world = renameMap(world, settings);
      retained.retain(id,world);
      // The WASM mode this worker actually runs (window.magnaWasmThreads on the page).
      send({ id, type: 'result', world, wasm: wasmThreadsInfo() });
    } catch (error) { send({ id, type: 'error', error: error instanceof Error ? error.message : String(error), wasm: wasmThreadsInfo() }); }
  });
};
