import { createSurfaceWorkerProcessor } from '../surface/workerProcessor';
import type { SurfaceWorkerRequest } from '../surface/workerProtocol';
import { prepareSurfaceDecorWorkerSource } from './surfaceWorkerSource';

const processor = createSurfaceWorkerProcessor(prepareSurfaceDecorWorkerSource);
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<SurfaceWorkerRequest>) => {
  const response = processor.handle(event.data);
  scope.postMessage(response, response.kind === 'compiled' ? [response.binary] : []);
};
