import { createUrbanEngine, type UrbanRequest, type UrbanResponse } from '../../../rust/bridge/urban';

let pending: UrbanRequest | undefined, raster: UrbanRequest['raster'], running = false;
const engine = createUrbanEngine();
self.onmessage = (event: MessageEvent<UrbanRequest>) => {
  if (event.data.raster) raster = event.data.raster;
  pending = event.data;
  if (!running) void drain();
};
async function drain(): Promise<void> {
  running = true;
  try {
    const e = await engine;
    while (pending) {
      const request = pending; pending = undefined;
      if (raster && !request.raster) request.raster = raster;
      raster = undefined;
      self.postMessage(e.run(request));
    }
  } catch (error) {
    if (pending) self.postMessage({ id: pending.id, error: String(error) } satisfies UrbanResponse);
    pending = undefined;
  } finally { running = false; }
}
