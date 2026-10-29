// Pool worker of bench_urban_wasm.mjs --pool N: one single-thread WASM instance
// and terrain, answering building-site ranges (same API as rust/bridge/urbanPoolWorker.ts).
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { pkg, casePath, riverFill } = workerData;
const mod = await import(pathToFileURL(resolve(pkg, 'magna_urbis_wasm.js')).href);
await mod.default({ module_or_path: readFileSync(resolve(pkg, 'magna_urbis_wasm_bg.wasm')) });
const c = JSON.parse(readFileSync(casePath, 'utf8'));
const cells = c.n * c.n;
const terrain = new mod.SettlementTerrain(c.width, c.n, Float32Array.from(c.height), Uint8Array.from(c.water),
  Float32Array.from(c.waterLevel), new Float32Array(cells), new Int32Array(cells).fill(riverFill));
terrain.set_urban_geometry(JSON.stringify(c.geometry));
let shared, lid = 0, pid = 0;
parentPort.on('message', m => {
  // A binary resident image (--resident) is decoded once per batch, not per range.
  if (m.shared) { shared = m.shared; if (shared.image) { lid = terrain.import_resident(shared.image); pid = terrain.resident_partitions_id(); } }
  try {
    const json = shared.image ? terrain.urban_building_sites_resident(shared.seed, lid, pid, shared.culture, m.start, m.end)
      : terrain.urban_building_sites_range(shared.seed, shared.layouts, shared.partitions, shared.culture, m.start, m.end);
    parentPort.postMessage({ id: m.id, json });
  }
  catch (error) { parentPort.postMessage({ id: m.id, error: String(error) }); }
});
parentPort.postMessage({ ready: true });
