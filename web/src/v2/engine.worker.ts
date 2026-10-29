/// <reference lib="webworker" />
import { generateTerrain, planRegion, rerouteRegion, generateTowns, generateTown, generateTownStage } from './engine';
import type { V2WorkerRequest, V2WorkerResponse, ProgressCallback } from './contracts';
import { WorkerWorld } from './workerWorld';

const scope = self as unknown as DedicatedWorkerGlobalScope;
// Serialize actions; the procedural cores retain per-thread scratch buffers.
let queue = Promise.resolve();
const retained=new WorkerWorld();
scope.onmessage = ({ data: request }: MessageEvent<V2WorkerRequest|{type:'release'}>) => {
  if('type'in request){queue=queue.then(()=>retained.clear());return;}
  queue = queue.then(async () => {
    const { id, action, settings } = request;
    const send = (message: V2WorkerResponse): void => scope.postMessage(message);
    const progress: ProgressCallback = value => send({ id, type: 'progress', progress: value });
    try {
      let world = retained.resolve(request.retainedWorldId,request.world);
      if (action === 'terrain' || action === 'all') world = await generateTerrain(settings, progress, undefined, request.assetBase);
      if (!world) throw new Error('Aucune carte à traiter.');
      if (action === 'region' || action === 'all') world = await planRegion(world, settings, progress);
      if (action === 'roads') world = await rerouteRegion(world, settings, progress);
      if (action === 'towns' || action === 'all') world = await generateTowns(world, settings, progress);
      if (action === 'town') {
        if (!request.key) throw new Error('Choisissez un lieu.');
        world = request.townStage ? await generateTownStage(world, settings, request.key, request.townStage, progress)
          : await generateTown(world, settings, request.key, progress);
      }
      if (!['terrain', 'region', 'roads', 'towns', 'town', 'all'].includes(action)) throw new Error('Action inconnue.');
      retained.retain(id,world);
      send({ id, type: 'result', world });
    } catch (error) { send({ id, type: 'error', error: error instanceof Error ? error.message : String(error) }); }
  });
};
