/** Native geometry and V8 heap measurement; owns an isolated local process.
 * From web/: node --expose-gc --import tsx scripts/benchmark_plan_archives.ts
 *   [local-executable] [count=1000] [output-directory]
 * Compression timing here is the async UI path; city workers use sync gzip.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  archivePlanBatch, clearPlanArchiveCache, planArchiveCacheStats, resolveArchivedPlan,
} from '../../rust/bridge/compactPlanArchive';
import type { PlacementBatch, PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import type { HouseConfig } from '../../rust/bridge/housesContract';

const executable = resolve(process.argv[2] ?? '../rust/target/debug/magna-urbis-local.exe');
const count = Number(process.argv[3] ?? 1000);
const output = resolve(process.argv[4] ?? 'out/plan-archive-benchmark');
if (!global.gc) throw new Error('Use node --expose-gc --import tsx to measure retained V8 heap.');
if (!Number.isInteger(count) || count < 1 || count > 100_000) throw new Error('Count must be 1..100000.');
await mkdir(output, { recursive: true });
const socket = createServer();
await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
const address = socket.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>(resolve => socket.close(() => resolve()));
const child = spawn(executable, ['--port', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const base = `http://127.0.0.1:${port}`;
let log = '';
const ready = new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Native startup timeout: ${log}`)), 30_000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`Native server exited ${code}: ${log}`)); });
  child.stdout.on('data', bytes => { log += String(bytes); if (log.includes('"ready":true')) { clearTimeout(timer); resolve(); } });
  child.stderr.on('data', bytes => { log += String(bytes); });
});
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Let completed async compression frames release their arguments before GC.
const heap = async () => {
  await new Promise<void>(resolve => setImmediate(resolve)); global.gc!();
  await new Promise<void>(resolve => setImmediate(resolve)); global.gc!();
  return process.memoryUsage().heapUsed;
};
const visibleDigest = (scene: PlacementBatch) => digest(scene.buildings.map(({ resolved: _resolved, ...visible }) => visible));
function visibleReferences(scene: PlacementBatch) {
  const surfaces = new Set<object>(), materials = new Set<object>(), roofs = new Set<object>();
  let surfaceReferences = 0, materialReferences = 0, roofReferences = 0;
  const surface = (value: object) => { surfaces.add(value); surfaceReferences++; };
  const material = (value: object | null | undefined) => { if (value) { materials.add(value); materialReferences++; } };
  for (const building of scene.buildings) {
    for (const value of [building.footprint, building.roof_footprint, building.courtyards, building.circulation]) surface(value);
    for (const volume of building.volumes) {
      surface(volume.footprint); surface(volume.foundation.footprint); material(volume.materials);
      roofs.add(volume.roof_spec); roofReferences++;
      for (const level of volume.levels) { surface(level.footprint); material(level.materials); }
    }
    for (const foundation of building.structural_foundations ?? []) surface(foundation.footprint);
  }
  return { surfaceReferences, uniqueSurfaces: surfaces.size, materialReferences, uniqueMaterials: materials.size, roofReferences, uniqueRoofs: roofs.size };
}
const surface = (x: number, y: number) => [{ outer: [{ x, y }, { x: x + 30, y }, { x: x + 30, y: y + 38 }, { x, y: y + 38 }], holes: [] }];
// Native HouseConfig uses serde defaults; this fixture pins only its recipe.
function request(index: number): Omit<PlacementRequest, 'config'> & { config: Pick<HouseConfig, 'recipe'> } {
  const x = index % 100 * 32, y = Math.floor(index / 100) * 40;
  return {
    id: `archive-house-${index}`, parcel_id: `archive-parcel-${index}`, seed: `plan-scale:${index}`,
    cadastral: surface(x, y), buildable: surface(x, y), reserves: [], accesses: [{ id: 'front', segment: [{ x, y: y + 38 }, { x: x + 30, y: y + 38 }], kind: 'public', width_m: 2 }],
    party_boundaries: [], neighbors: [], culture: { culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null },
    function: 'domestic', terrain: { origin: { x, y }, ground_z_m: 10, gradient: [0, 0], water_z_m: null, max_foundation_step_m: 1 },
    config: { recipe: 'EUR-MED-B02' },
  };
}
async function nativeBatch(start: number): Promise<PlacementBatch> {
  const requests = Array.from({ length: Math.min(64, count - start) }, (_, offset) => request(start + offset));
  const response = await fetch(`${base}/houses/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema_version: '1', requests }) });
  assert(response.ok, `Native plan HTTP ${response.status}`);
  const result = await response.json();
  assert(result.ok, JSON.stringify(result.error));
  return result.data;
}

try {
  await ready;
  const status = await fetch(`${base}/status`).then(response => response.json());
  assert(status.capabilities.includes('houses.compact-plans'), 'Rebuild the local executable with compact-plan endpoints.');
  // Warm the package itself before accounting retained scene heap.
  await import('fflate');
  const heapBaseline = await heap(), generationStart = performance.now();
  let scene: PlacementBatch | undefined;
  for (let start = 0; start < count; start += 64) {
    const chunk = await nativeBatch(start);
    if (!scene) scene = { ...chunk, buildings: [], refusals: [], open_spaces: [] };
    scene.buildings.push(...chunk.buildings); scene.refusals.push(...chunk.refusals);
    if (start === 0) await writeFile(resolve(output, 'native-first-chunk.json'), JSON.stringify(chunk));
  }
  assert(scene && scene.buildings.length, 'Native fixture generated no plans.');
  const generationMs = performance.now() - generationStart;
  const nativeSceneBytes = bytes(scene), retainedBytes = scene.buildings.reduce((sum, building) => sum + bytes(building.resolved), 0);
  const samples = [0, Math.floor(scene.buildings.length / 2), scene.buildings.length - 1].map(index => ({ index, digest: digest(scene!.buildings[index].resolved) }));
  const visibleHash = visibleDigest(scene), referencesBefore = visibleReferences(scene);
  const nativeHeap = await heap();
  const compressionStart = performance.now();
  let archived: PlacementBatch | undefined = await archivePlanBatch(scene);
  const compressionMs = performance.now() - compressionStart;
  assert.equal(planArchiveCacheStats().entries, 0, 'Archival must not eagerly decode retained geometry.');
  assert.equal(visibleDigest(archived), visibleHash, 'Visible native geometry changed during archival.');
  // Reconstruct the previous archive representation from the SAME native objects
  // and compressed references, then drop all other scene owners before sampling.
  let unshared: PlacementBatch | undefined = { ...archived, buildings: scene.buildings.map((building, index) => ({ ...building, resolved: archived!.buildings[index].resolved })) };
  archived = undefined;
  scene = undefined;
  const archiveUnsharedHeap = await heap();
  const sharingStart = performance.now();
  archived = await archivePlanBatch(unshared);
  const sharingMs = performance.now() - sharingStart;
  unshared = undefined;
  const archiveHeap = await heap();
  assert.equal(visibleDigest(archived), visibleHash, 'Visible values changed during structural sharing.');
  const referencesAfter = visibleReferences(archived);
  const archivedSceneBytes = bytes(archived), sources = Object.values(archived.plan_archives ?? {});
  const descriptorBytes = archived.buildings.reduce((sum, building) => sum + bytes(building.resolved), 0);
  const archiveBase64Bytes = sources.reduce((sum, value) => sum + value.length, 0);
  const archiveGzipBytes = sources.reduce((sum, value) => sum + atob(value).length, 0);
  const restoreStart = performance.now();
  for (const sample of samples) assert.equal(digest(await resolveArchivedPlan(archived.buildings[sample.index])), sample.digest, 'Retained native plan changed on archive replay.');
  const report = {
    fixture: 'Actual native EUR-MED-B02 plans; disjoint flat 30x38m sites; distinct deterministic seeds; no roof realization',
    requested: count, accepted: archived.buildings.length, refused: archived.refusals.length,
    nativeGenerationMs: generationMs, archiveCompressionMsAsyncUiPath: compressionMs, visibleStructuralSharingMs: sharingMs,
    nativeSceneJsonBytes: nativeSceneBytes, nativeRetainedPlanJsonBytes: retainedBytes,
    archivedSceneJsonBytes: archivedSceneBytes, archiveCount: sources.length, archiveBase64Bytes, archiveGzipBytes, descriptorBytes,
    totalJsonReductionPercent: 100 * (1 - archivedSceneBytes / nativeSceneBytes),
    retainedJsonReductionPercent: 100 * (1 - (archiveBase64Bytes + descriptorBytes) / retainedBytes),
    visibleSharing: { exactVisibleJson: true, before: referencesBefore, after: referencesAfter },
    v8Heap: { baselineBytes: heapBaseline, withNativeSceneBytes: nativeHeap, withArchivedUnsharedSceneBytes: archiveUnsharedHeap,
      withArchivedSceneBytes: archiveHeap, structuralSharingReductionBytes: archiveUnsharedHeap - archiveHeap, retainedReductionBytes: nativeHeap - archiveHeap,
      note: 'Two event-loop turns and explicit GCs per sample; includes live runtime/transport allocations, excludes native server and worker heaps. Serialized sizes are the stable comparison.' },
    selectedReplay: { count: samples.length, exact: true, elapsedMs: performance.now() - restoreStart, cache: planArchiveCacheStats() },
  };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  clearPlanArchiveCache();
} finally {
  child.kill();
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
}
