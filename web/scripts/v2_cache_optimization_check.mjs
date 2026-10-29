import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const output = new URL('../out/v2-project-optimization/', import.meta.url); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true, args: ['--enable-precise-memory-info'] });
try {
  const page = await browser.newPage(); await page.goto(`${process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5175'}/v2.html?empty`);
  const cdp = await page.context().newCDPSession(page);
  const moduleUrl = '/@fs/' + fileURLToPath(new URL('../src/v2/cache.ts', import.meta.url)).replaceAll('\\', '/');
  const results = await page.evaluate(async moduleUrl => {
    const { IndexedTerrainStore } = await import(moduleUrl);
    const n = 512, count = n * n, grid = data => ({ w: n, h: n, cell: 1000 / n, data });
    const terrain = { height: grid(new Float32Array(count)), slope: grid(new Float32Array(count)), flow: grid(new Float32Array(count)), water: new Uint8Array(count), receiver: new Int32Array(count).fill(-1), filled: new Float32Array(count), coastline: [], rivers: [], lakes: [], downSide: 'S', seaSide: null, seaLevel: 0, seaFraction: 0 };
    window.optimizationTerrain = terrain;
    const bytes = 21 * count;
    const open = (name, version = 1) => new Promise((resolve, reject) => { const request = indexedDB.open(name, version); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('terrain')) request.result.createObjectStore('terrain', { keyPath: 'key' }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const baselineDb = await open('magna-urbis-v2-optimization-baseline');
    let readBackBytes = 0, readBackPeak = 0, baselinePeakHeap = 0;
    const heap = () => performance.memory?.usedJSHeapSize ?? 0;
    const legacyPut = (key, saved = Date.now()) => new Promise((resolve, reject) => {
      const transaction = baselineDb.transaction('terrain', 'readwrite'), store = transaction.objectStore('terrain'); store.put({ key, value: terrain, saved });
      const request = store.getAll(); request.onsuccess = () => { const entries = request.result.sort((a, b) => b.saved - a.saved); readBackBytes += entries.length * bytes; readBackPeak = Math.max(readBackPeak, entries.length * bytes); baselinePeakHeap = Math.max(baselinePeakHeap, heap()); for (const entry of entries.slice(3)) store.delete(entry.key); };
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    });
    // A real schema-1 database with a saved map must survive the index-only migration.
    const old = await open('magna-urbis-v2');
    await new Promise((resolve, reject) => { const transaction = old.transaction('terrain', 'readwrite'); transaction.objectStore('terrain').put({ key: 'schema-1-retained', value: terrain, saved: 1 }); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
    const optimized = new IndexedTerrainStore(); let blockedOpenRejected = false;
    try { await optimized.get('schema-1-retained'); } catch { blockedOpenRejected = true; }
    if (!blockedOpenRejected) throw new Error('Expected the deliberately open old tab to block migration');
    old.close(); const migrated = await optimized.get('schema-1-retained');
    if (migrated.height.data.length !== count) throw new Error('Schema-1 terrain did not survive migration'); await optimized.clear();
    const beforeBaseline = heap(), t0 = performance.now(); for (const key of ['d', 'c', 'b', 'a']) await legacyPut(key, 1000);
    const baselineMs = performance.now() - t0, baselineAfterHeap = heap();
    const originalGetAll = IDBObjectStore.prototype.getAll; let optimizedGetAllCalls = 0;
    IDBObjectStore.prototype.getAll = function (...args) { optimizedGetAllCalls++; return originalGetAll.apply(this, args); };
    const originalNow = Date.now; Date.now = () => 1000;
    let optimizedMs, optimizedHeapDelta;
    try { const before = heap(), start = performance.now(); for (const key of ['d', 'c', 'b', 'a']) await optimized.put(key, terrain); optimizedMs = performance.now() - start; optimizedHeapDelta = heap() - before; }
    finally { Date.now = originalNow; IDBObjectStore.prototype.getAll = originalGetAll; }
    const kept = []; for (const key of ['a', 'b', 'c', 'd']) if (await optimized.get(key)) kept.push(key);
    const baselineKeys = await new Promise(resolve => { const request = baselineDb.transaction('terrain').objectStore('terrain').getAllKeys(); request.onsuccess = () => resolve(request.result); });
    return { grid: n, terrainBytes: bytes, baseline: { put4Ms: baselineMs, readBackRasterBytes: readBackBytes, peakReadBackBytes: readBackPeak, peakObservedJSHeapDeltaBytes: baselinePeakHeap - beforeBaseline, postOperationJSHeapDeltaBytes: baselineAfterHeap - beforeBaseline, kept: baselineKeys }, optimized: { put4Ms: optimizedMs, readBackRasterBytes: 0, getAllCalls: optimizedGetAllCalls, postOperationJSHeapDeltaBytes: optimizedHeapDelta, kept }, schema1Migration: true, blockedUpgradeRecovers: blockedOpenRejected };
  }, moduleUrl);
  assert.deepEqual(results.optimized.kept, ['a', 'b', 'c']); assert.deepEqual(results.baseline.kept, results.optimized.kept); assert.equal(results.optimized.getAllCalls, 0);
  // Moving a disposable result's buffers eliminates a second full receiver-side copy.
  await cdp.send('HeapProfiler.collectGarbage');
  const transport = await page.evaluate(() => {
    const result = window.optimizationTerrain, buffers = [result.height.data.buffer, result.slope.data.buffer, result.flow.data.buffer, result.water.buffer, result.receiver.buffer, result.filled.buffer];
    const startClone = performance.now(); const cloned = structuredClone(result); const cloneMs = performance.now() - startClone;
    const sourceBytes = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    const startMove = performance.now(); const moved = structuredClone(result, { transfer: buffers }); const transferMs = performance.now() - startMove;
    return { sourceBytes, clonedExtraBufferBytes: sourceBytes, transferredExtraBufferBytes: 0, cloneMs, transferMs, originalDetached: buffers.every(buffer => buffer.byteLength === 0), equalResult: cloned.height.data.length === moved.height.data.length && cloned.receiver[0] === moved.receiver[0] };
  });
  assert(transport.originalDetached && transport.equalResult);
  const workers = await page.evaluate(async moduleUrl => {
    const [{ defaultSettings }, { serializeProject }, { default: ProjectWorker }, { default: ComposeWorker }] = await Promise.all([
      import(moduleUrl.replace('cache.ts', 'settings.ts')), import(moduleUrl.replace('cache.ts', 'project.ts')),
      import(moduleUrl.replace('cache.ts', 'project.worker.ts?worker')), import(moduleUrl.replace('cache.ts', 'compose.worker.ts?worker')),
    ]);
    const settings = defaultSettings(); settings.extent = 1000; settings.options.mapSize = 1000;
    const n = 32, length = n * n, grid = () => ({ w: n, h: n, cell: 1000 / n, data: new Float32Array(length).fill(20) });
    const world = { seed: settings.options.seed, mapSize: 1000, options: settings.options, terrain: { height: grid(), slope: grid(), flow: grid(), water: new Uint8Array(length), receiver: new Int32Array(length).fill(-1), filled: new Float32Array(length).fill(20), coastline: [], rivers: [], lakes: [], seaFraction: 0, seaLevel: 0, seaSide: null, downSide: 'S' }, stats: { backend: 'test-worker-fixture' } };
    const text = serializeProject(settings, world), projectWorker = new ProjectWorker(), composeWorker = new ComposeWorker();
    const job = (worker, request) => new Promise((resolve, reject) => { worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.result); worker.onerror = error => reject(new Error(error.message)); worker.postMessage(request); });
    try {
      const parsed = await job(projectWorker, { action: 'parse', text });
      const blob = await job(projectWorker, { action: 'serialize', settings: parsed.settings, world: parsed.world, mods: parsed.mods });
      const composed = await job(composeWorker, { scope: 'terrain', text, current: settings });
      return { parseTypedArrays: parsed.world.terrain.height.data instanceof Float32Array && parsed.world.terrain.receiver instanceof Int32Array,
        identicalBlob: await blob.text() === text, originalSourceAttached: world.terrain.height.data.byteLength === length * 4 && world.terrain.height.data[0] === 20,
        composedTypedArrays: composed.world.terrain.height.data instanceof Float32Array && composed.world.terrain.height.data[0] === 20, composedTerrainOnly: composed.world.stats['v2.stage'] === 'terrain' && !composed.world.urban };
    } finally { projectWorker.terminate(); composeWorker.terminate(); }
  }, moduleUrl);
  assert(Object.values(workers).every(Boolean));
  await writeFile(new URL('cache-browser.json', output), JSON.stringify({ ok: true, cache: results, transport, workers }, null, 2));
  console.log(JSON.stringify({ ok: true, cache: results, transport, workers }, null, 2));
} finally { await browser.close(); }
