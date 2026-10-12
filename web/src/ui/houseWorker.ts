import { callHouses, type HouseRequest, type HouseResponse } from '../../../rust/bridge/houses';

self.onmessage = async (event: MessageEvent<HouseRequest>) => {
  const request = event.data;
  const started = performance.now();
  try {
    const json = await callHouses(request);
    self.postMessage({ticket: request.ticket, kind: request.kind, json, elapsed_ms: performance.now() - started} satisfies HouseResponse);
  } catch (error) {
    self.postMessage({ticket: request.ticket, kind: request.kind, fatal: error instanceof WebAssembly.RuntimeError, error: {code: error instanceof WebAssembly.RuntimeError ? 'wasm_runtime' : 'worker_failed', field: null, message: error instanceof Error ? error.message : String(error)}} satisfies HouseResponse);
  }
};
