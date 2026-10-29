// One worker of the single-thread urban pool (`urbanPool.ts`): its own WASM
// instance and terrain handle, running independent slices of one request.
import init, { SettlementTerrain } from '../pkg/wasm/magna_urbis_wasm.js';
import type { PoolMessage, PoolReply } from './urbanPool';

let terrain: SettlementTerrain | undefined, version = -1;
let batch = -1, shared: Record<string, string | undefined> = {};
let ready: Promise<unknown> | undefined;

function run(message: Extract<PoolMessage, { type: 'job' }>): string {
  if (!terrain || version !== message.version) throw new Error('Urban pool worker has no terrain for this request.');
  if (message.shared) { batch = message.batch; shared = message.shared; }
  if (batch !== message.batch) throw new Error('Urban pool worker lost the request context.');
  const a = message.args;
  if (message.op === 'quarters') return terrain.urban_quarters(a.seed!, a.sites!, a.config!, a.roads!);
  if (message.op === 'parcels') return terrain.urban_parcels(a.seed!, a.layouts!, a.config!);
  return terrain.urban_building_sites_range(shared.seed!, shared.layouts!, shared.partitions!, shared.culture, Number(a.start), Number(a.end));
}

self.onmessage = async (event: MessageEvent<PoolMessage>) => {
  const message = event.data;
  if (message.type === 'init') { ready = init({ module_or_path: message.module }); return; }
  try { await ready; } catch (error) { if (message.type === 'job') self.postMessage({ id: message.id, error: String(error) } satisfies PoolReply); return; }
  if (message.type === 'raster') {
    terrain?.free(); terrain = undefined; version = -1;
    const r = message.raster;
    try {
      const next = new SettlementTerrain(r.width, r.n, r.height, r.water, r.waterLevel, r.riverWidth, r.riverIds);
      try { if (r.geometry) next.set_urban_geometry(JSON.stringify(r.geometry)); }
      catch (error) { next.free(); throw error; }
      terrain = next; version = message.version;
    } catch { /* the next job reports the missing terrain; the coordinator then runs it locally */ }
    return;
  }
  let reply: PoolReply;
  try { reply = { id: message.id, json: run(message) }; }
  catch (error) { reply = { id: message.id, error: String(error) }; }
  self.postMessage(reply);
};
