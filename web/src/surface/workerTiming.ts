import type {SurfaceWorkerRequest,SurfaceWorkerResponse} from './workerProtocol';

/** Sample immediately around synchronous processor execution. The UTC pair can
 * be compared with Page post/receive clocks. Finish-to-receive also contains
 * postMessage/queue/delivery overhead; it is not itself proof of main starvation. */
export function handleSurfaceWorkerWithTiming(
  processor:{handle(message:SurfaceWorkerRequest):SurfaceWorkerResponse},message:SurfaceWorkerRequest,
  clock:Pick<Performance,'now'|'timeOrigin'>=performance,
):SurfaceWorkerResponse {
  if(message.kind!=='compile'||message.diagnosticTiming!==true)return processor.handle(message);
  const timeOriginMs=clock.timeOrigin,startNowMs=clock.now();
  const response=processor.handle(message);
  const finishNowMs=clock.now();
  return {...response,processorTiming:{version:'surface-worker-processor-timing-1',timeOriginMs,startNowMs,finishNowMs,
    synchronousMs:finishNowMs-startNowMs,startedUtcMs:timeOriginMs+startNowMs,finishedUtcMs:timeOriginMs+finishNowMs}};
}
