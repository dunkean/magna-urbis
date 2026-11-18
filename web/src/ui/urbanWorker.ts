import { createUrbanEngine, type UrbanRequest, type UrbanResponse } from '../../../rust/bridge/urban';
import { runActivityPlacement } from './urbanActivityPlacement';

let pending: UrbanRequest | undefined,
  raster: UrbanRequest['raster'],
  running = false;
let engine: ReturnType<typeof createUrbanEngine> | undefined;
self.onmessage = (event: MessageEvent<UrbanRequest>) => {
  engine ??= createUrbanEngine(event.data.runtime);
  if (event.data.raster) raster = event.data.raster;
  pending = event.data;
  if (!running) void drain();
};
async function drain(): Promise<void> {
  running = true;
  try {
    const e = await engine!;
    while (pending) {
      const request = pending;
      pending = undefined;
      if (raster && !request.raster) request.raster = raster;
      raster = undefined;
      // A parcel pack is transferred, never copied: the page materialises it and this worker keeps nothing.
      const response = await runActivityPlacement(e, request, () => !pending);
      self.postMessage(response, { transfer: response.partitionsPack ? [response.partitionsPack] : [] });
    }
  } catch (error) {
    if (pending) self.postMessage({ id: pending.id, error: String(error) } satisfies UrbanResponse);
    pending = undefined;
  } finally {
    running = false;
  }
}
