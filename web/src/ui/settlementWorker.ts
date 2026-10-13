import { createSettlementEngine } from '../../../rust/bridge/settlementEngine';
import type { SettlementRequest, SettlementResponse } from '../../../rust/bridge/settlements';

// Only the latest request runs; a newer one supersedes those still waiting (the page sends
// placement again in every request until a placement answer has arrived).
let pending: SettlementRequest | undefined, raster: SettlementRequest['raster'], running = false;
const engine = createSettlementEngine();
self.onmessage = (event: MessageEvent<SettlementRequest>) => {
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
      // A raster superseded while waiting still has to reach the engine.
      if (raster && !request.raster) request.raster = raster;
      raster = undefined;
      self.postMessage(e.run(request) satisfies SettlementResponse);
    }
  } catch (error) { if (pending) self.postMessage({ id: pending.id, error: String(error) } satisfies SettlementResponse); pending = undefined; }
  finally { running = false; }
}
