// From web/: node scripts/urban_native_api_check.mjs [isolated local executable]
// Owns its ephemeral port/process; never connects to or stops the user's service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';

const executable = process.argv[2] ?? 'E:/CodexArtifacts/city-generator-local-review-2026-10-21/release/magna-urbis-local.exe';
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const child = spawn(executable, ['--port', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stderr.on('data', bytes => { log += bytes; });
child.stdout.on('data', bytes => { log += bytes; });
const base = `http://127.0.0.1:${port}`;
const session = 'urban-native-review-v1';
let id = 0;
async function post(path, input) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  assert.ok(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
  const output = await response.json();
  assert.notEqual(output.ok, false, `${path}: ${JSON.stringify(output.error)}`);
  return output.data ?? output;
}
const urban = (kind, input) => post('/urban', { session, id: ++id, seed: 'urban-native-review-v1', kind, ...input });
try {
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    const timer = setTimeout(() => reject(new Error(`Native startup timeout: ${log}`)), 30000);
    child.stdout.on('data', bytes => { if (bytes.toString().includes('"ready":true')) { clearTimeout(timer); resolve(); } });
  });
  assert.equal((await fetch(`${base}/status`).then(r => r.json())).backend, 'rust-native');
  const n = 32, width = 1000, count = n * n;
  let header = Buffer.from(JSON.stringify({ session, n, width }));
  header = Buffer.concat([header, Buffer.alloc((4 - header.length % 4) % 4, 32)]);
  const bytes = Buffer.alloc(4 + header.length + 17 * count);
  bytes.writeUInt32LE(header.length); header.copy(bytes, 4);
  const start = 4 + header.length;
  for (let i = 0; i < count; i++) {
    bytes.writeFloatLE(30, start + i * 4);
    bytes.writeInt32LE(-1, start + count * 12 + i * 4);
  }
  const uploaded = await fetch(`${base}/raster`, { method: 'POST', body: bytes });
  assert.ok(uploaded.ok); assert.equal((await uploaded.json()).ok, true);
  const context = { role: 'artisan', resources: ['timber', 'clay'], period: '', mode: 'inspired', navigableAccess: false, lore: ['temple'] };
  const { layouts } = await urban('quarters', {
    sites: [{ key: 'review', name: 'Review', population: 300, culture: 'european-organic', center: { x: 500, y: 500 }, radius: 140 }], roads: [],
    layoutConfig: { composition: 'district', count: 4, radius: 140, culture: 'site', programme: context, footprint: { mechanism: 'legacy', budget: 'radius' } },
  });
  let { partitions } = await urban('parcels', { layouts, parcelConfig: {} });
  const before = partitions.map(p => p.parcels);
  const reallocated = await urban('programme', { layouts, partitions });
  const metric = value => JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'number' ? Math.round(v * 1e8) / 1e8 : v));
  assert.deepEqual(metric(reallocated.partitions.map(p => p.parcels)), metric(before), 'Parcels changed beyond JSON numeric precision (10 nm)');
  partitions = reallocated.partitions;
  const { placementRequests } = await urban('buildingSites', { layouts, partitions });
  assert.ok(placementRequests.length > 0);
  const scene = await post('/houses/placement', { schema_version: '1', requests: placementRequests });
  assert.ok(scene.buildings.length > 0, JSON.stringify(scene.refusals));
  const reconciled = await urban('builtCapacity', { partitions, scene });
  assert.ok(reconciled.partitions.flatMap(p => p.programme.demands).some(d => d.builtCapacity > 0));
  mkdirSync('out/urban-native', { recursive: true });
  writeFileSync('out/urban-native/pipeline.json', JSON.stringify({ layouts, partitions: reconciled.partitions, placementRequests, scene }));
  const domestic = scene.buildings.find(b => ['domestic', 'mixed'].includes(b.function));
  assert.ok(domestic);
  mkdirSync('out/urban-native', { recursive: true });
  writeFileSync('out/urban-native/enrich-input.json', JSON.stringify(domestic));
  const sourceRequest = placementRequests.find(r => r.parcel_id === domestic.parcel_id);
  const ancient = structuredClone(sourceRequest);
  ancient.config.era = 'A';
  const ancientScene = await post('/houses/placement', { schema_version: '1', requests: [ancient] });
  assert.equal(ancientScene.buildings.length, 0, 'Medieval pinned recipe must respect the ancient period');
  const borrowed = structuredClone(sourceRequest);
  borrowed.culture.borrowing = 'Explicit native API test borrowing';
  borrowed.culture.mode = borrowed.config.mode = 'historical_strict';
  const strictScene = await post('/houses/placement', { schema_version: '1', requests: [borrowed] });
  assert.equal(strictScene.refusals[0]?.code, 'cultural_borrowing');
  borrowed.culture.mode = borrowed.config.mode = 'historical_inspired';
  const inspiredScene = await post('/houses/placement', { schema_version: '1', requests: [borrowed] });
  assert.equal(inspiredScene.buildings.length, 1);
  borrowed.culture.mode = borrowed.config.mode = 'fantasy_mix';
  const fantasyScene = await post('/houses/placement', { schema_version: '1', requests: [borrowed] });
  assert.equal(fantasyScene.buildings.length, 1);
  const contextualChecks = { loreCollectiveAccepted: scene.buildings.some(b => b.function === 'collective'),
    ancientRefusal: ancientScene.refusals[0]?.code, strictBorrowingRefusal: strictScene.refusals[0]?.code,
    inspiredAccepted: inspiredScene.buildings.length, fantasyAccepted: fantasyScene.buildings.length };
  writeFileSync('out/urban-native/context.json', JSON.stringify(contextualChecks, null, 2));
  // Real native geometry, not a mocked placer: overlapping pairs cross both
  // seven- and64-request boundaries. Earlier chunks supply exact occupied land.
  const shifted = (value, dx) => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(v => shifted(v, dx));
    if (typeof value.x === 'number' && typeof value.y === 'number') return { ...value, x: value.x + dx };
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shifted(child, dx)]));
  };
  const repeated = Array.from({ length: 70 }, (_, i) => ({ ...shifted(sourceRequest, Math.floor(i / 2) * 200), id: `native-batch/${i}`, parcel_id: `native-batch/${i}/parcel` }));
  const occupied = b => [b.footprint, b.courtyards, b.circulation, ...b.structural_features.map(f => f.surface)]
    .filter(s => s.length).map((footprint, i) => ({ id: `${b.id}/occupation/${i}`, footprint, height_m: 100 }));
  const single = await post('/houses/placement', { schema_version: '1', requests: repeated });
  assert.ok(single.buildings.length > 0);
  const first = single.buildings.find(b => b.id === 'native-batch/0'), second = single.buildings.find(b => b.id === 'native-batch/1');
  assert.ok(first);
  if (second) assert.notDeepEqual(second.transform, first.transform, 'Overlapping native houses must use different legal placements');
  else assert.ok(single.refusals.some(r => r.id === 'native-batch/1'));
  const batching = [];
  for (const chunkSize of [1, 7, 64]) {
    const result = { ...single, buildings: [], refusals: [], open_spaces: [] };
    for (let start = 0; start < repeated.length; start += chunkSize) {
      const neighbors = result.buildings.flatMap(occupied);
      const requests = repeated.slice(start, start + chunkSize).map(r => ({ ...r, neighbors: [...r.neighbors, ...neighbors] }));
      const chunk = await post('/houses/placement', { schema_version: '1', requests });
      result.buildings.push(...chunk.buildings); result.refusals.push(...chunk.refusals); result.open_spaces.push(...chunk.open_spaces);
    }
    assert.deepEqual(result.buildings, single.buildings, `Native geometry or retained plans changed at chunk size${chunkSize}`);
    assert.deepEqual(result.refusals, single.refusals, `Native refusal decisions changed at chunk size${chunkSize}`);
    assert.deepEqual(result.open_spaces, single.open_spaces);
    batching.push({ chunkSize, buildings: result.buildings.length, refusals: result.refusals.length, exact: true });
  }
  const imported = await tsImport('../../rust/bridge/architectureBatch.ts', import.meta.url);
  const { placeArchitectureBatches } = imported.placeArchitectureBatches ? imported : imported.default;
  const transported = await placeArchitectureBatches({ schema_version: '1', requests: repeated }, input => post('/houses/placement', input));
  assert.deepEqual(transported, single, 'The actual spatially indexed transport must preserve the complete native result');
  writeFileSync('out/urban-native/batch-invariance.json', JSON.stringify({ seed: sourceRequest.seed, requests: repeated.length, batching, actualTransport64Exact: true }, null, 2));
  const enriched = await post('/houses/enrich', domestic);
  assert.ok(enriched.units.length > 0);
  const report = { backend: 'rust-native', port, seed: 'urban-native-review-v1',
    layouts: layouts.length, parcels: partitions.reduce((n, p) => n + p.parcels.length, 0),
    requests: placementRequests.length, accepted: scene.buildings.length, refused: scene.refusals.length,
    functions: Object.fromEntries([...new Set(placementRequests.map(r => r.function))].map(f => [f, placementRequests.filter(r => r.function === f).length])),
    demands: reconciled.partitions.flatMap(p => p.programme.demands).map(({ function: f, requested, parcelCapacity, builtCapacity, openCapacity, deficit }) => ({ function: f, requested, parcelCapacity, builtCapacity, openCapacity, deficit })),
    enrichedUnits: enriched.units.length, contextualChecks, batching, checks: ['retained-raster', 'quarters', 'parcels', 'programme-immutable-parcels', 'buildingSites', 'placement', 'builtCapacity', 'native-batch-invariance-1-7-64', 'actual-transport-invariance', 'enrich'] };
  mkdirSync('out/urban-native', { recursive: true });
  writeFileSync('out/urban-native/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.kill();
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
}
