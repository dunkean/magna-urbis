/** Lightweight diagnostic metadata only; no sampling and no binary inspection. */
export function installSurfaceProcessorTiming() {
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    postMessage(...args) {
      if (args[0]?.kind === 'compile') args[0].diagnosticTiming = true;
      return super.postMessage(...args);
    }
  };
}

/** Call immediately on receipt, before decoding/summarizing the packet. */
export function captureSurfaceProcessorTiming(message) {
  return {
    processorTiming: message.processorTiming,
    pageReceiveNowMs: performance.now(),
    pageTimeOriginMs: performance.timeOrigin,
    pageReceiveUtcMs: Date.now(),
    visibilityState: document.visibilityState,
  };
}
