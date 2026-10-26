import { createSurfaceWorkerProcessor } from '../surface/workerProcessor';
import type { SurfaceWorkerRequest } from '../surface/workerProtocol';
import { prepareSurfaceDecorWorkerSource } from './surfaceWorkerSource';
import { handleSurfaceWorkerWithTiming } from '../surface/workerTiming';

const processor = createSurfaceWorkerProcessor(prepareSurfaceDecorWorkerSource);
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<SurfaceWorkerRequest>) => {
  const response = handleSurfaceWorkerWithTiming(processor,event.data);
  scope.postMessage(response, response.kind === 'compiled' ? [response.binary] : []);
};
