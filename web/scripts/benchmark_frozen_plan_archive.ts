/** Bounded archive proof from 64 already generated native plans; no native/UI/server.
 * From web/: node --expose-gc --import tsx scripts/benchmark_frozen_plan_archive.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  archivePlanBatch, clearPlanArchiveCache, planArchiveCacheStats,
  registerPlanArchives, resolveArchivedPlan, PLAN_ARCHIVE_CACHE_BYTES,
  PLAN_ARCHIVE_CACHE_COUNT, type ArchivedPlanReference,
} from '../../rust/bridge/compactPlanArchive';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';

const sourcePath = resolve('out/java-row-selection-proof/after-plans.json');
const output = resolve('out/frozen-plan-archive-bench');
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const originalBytes = await readFile(sourcePath);
const source = JSON.parse(originalBytes.toString('utf8')) as PlacementBatch;
assert.equal(source.buildings.length, 64, 'Use the exact bounded real fixture.');
const input: PlacementBatch = { ...source, refusals: [], open_spaces: [] };
const expected = input.buildings.map(b => b.resolved);
const inputBefore = structuredClone(input);
await mkdir(output, { recursive: false }); // Fail on an existing proof; no overwrite.
await import('fflate'); // Timings exclude module import, but include async gzip/gunzip work.
clearPlanArchiveCache();
const archiveStart = performance.now();
const archived = await archivePlanBatch(input);
const archiveMs = performance.now() - archiveStart;
assert.deepStrictEqual(input, inputBefore, 'Archive mutated native input.');
assert.equal(Object.keys(archived.plan_archives ?? {}).length, 1);
assert.deepStrictEqual(planArchiveCacheStats(), { entries: 0, bytes: 0, ids: [], hits: 0, misses: 0, evictions: 0 });
const archiveJson = JSON.stringify(archived);
await writeFile(resolve(output, 'archived-scene.json'), archiveJson, { flag: 'wx' });
const restored = JSON.parse(archiveJson) as PlacementBatch;
await assert.rejects(resolveArchivedPlan(restored.buildings[0]), /register the restored scene/);
const registrationStart = performance.now();
registerPlanArchives(restored);
const registrationMs = performance.now() - registrationStart;
assert.equal(planArchiveCacheStats().misses, 0, 'Registration eagerly decoded an archive.');
const id = (restored.buildings[0].resolved as ArchivedPlanReference).archive_id;
const base64 = restored.plan_archives![id];
const compressed = Buffer.from(base64, 'base64');
const rawBytes = compressed.readUInt32LE(compressed.length - 4);
const expectedRecordBytes = expected.map(v => Buffer.byteLength(JSON.stringify(v)));
assert.equal(rawBytes, expectedRecordBytes.reduce((a,b) => a+b,0) + expected.length-1);

const statsDelta = (a: ReturnType<typeof planArchiveCacheStats>, b: ReturnType<typeof planArchiveCacheStats>) => ({
  misses: b.misses-a.misses, hits: b.hits-a.hits, evictions: b.evictions-a.evictions,
});
const summary = (samples: number[]) => {
  const sorted = [...samples].sort((a,b)=>a-b);
  return { samplesMs: samples, minMs: sorted[0], medianMs: sorted[Math.floor(sorted.length/2)], maxMs: sorted.at(-1) };
};
const cold: number[] = [], concurrent: number[] = [], warm: number[] = [];
const concurrentIndices = [0,9,18,27,36,45,54,63];
for (let repeat=0; repeat<7; repeat++) {
  clearPlanArchiveCache();
  const start = performance.now();
  const value = await resolveArchivedPlan(restored.buildings[31]);
  cold.push(performance.now()-start);
  assert.deepStrictEqual(value, expected[31]);
  assert.equal(planArchiveCacheStats().misses, 1);
}
for (let repeat=0; repeat<5; repeat++) {
  clearPlanArchiveCache();
  const start = performance.now();
  const values = await Promise.all(concurrentIndices.map(i=>resolveArchivedPlan(restored.buildings[i])));
  concurrent.push(performance.now()-start);
  values.forEach((v,j)=>assert.deepStrictEqual(v,expected[concurrentIndices[j]]));
  assert.equal(planArchiveCacheStats().misses,1,'Concurrent same-archive requests duplicated uncached decoding.');
}
clearPlanArchiveCache();
await resolveArchivedPlan(restored.buildings[31]);
for (let i=0;i<64;i++) {
  const start=performance.now();
  const value=await resolveArchivedPlan(restored.buildings[i]);
  warm.push(performance.now()-start);
  assert.deepStrictEqual(value,expected[i]);
}
assert.equal(planArchiveCacheStats().hits,64);

// Parsing instrumentation is separate from every latency sample above. It
// wraps globals in this isolated benchmark process, never production files.
async function trace(indices: number[], coldCache: boolean) {
  if (coldCache) clearPlanArchiveCache();
  const before=planArchiveCacheStats();
  const parse=JSON.parse, decode=TextDecoder.prototype.decode;
  const parsedBytes: number[]=[], decodedBytes: number[]=[], formats: unknown[]=[];
  JSON.parse=((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
    parsedBytes.push(Buffer.byteLength(text));
    const value=parse(text,reviver);
    formats.push(value?.format);
    return value;
  }) as typeof JSON.parse;
  TextDecoder.prototype.decode=function(input?, options?) {
    decodedBytes.push(input?.byteLength ?? 0);
    return decode.call(this,input,options);
  };
  let values: unknown[];
  try { values=await Promise.all(indices.map(i=>resolveArchivedPlan(restored.buildings[i]))); }
  finally { JSON.parse=parse; TextDecoder.prototype.decode=decode; }
  values!.forEach((v,j)=>assert.deepStrictEqual(v,expected[indices[j]]));
  assert.deepStrictEqual(parsedBytes,indices.map(i=>expectedRecordBytes[i]));
  assert.deepStrictEqual(decodedBytes,parsedBytes);
  assert(formats.every(f=>f==='compact-plan-1'));
  const after=planArchiveCacheStats();
  return { indices, jsonParseCalls:parsedBytes.length, parsedBytes, textDecodeCalls:decodedBytes.length,
    decodedBytes, successfulUncachedDecodes:after.misses-before.misses,
    cacheDelta:statsDelta(before,after), cacheAfter:after };
}
const traces={ cold:await trace([31],true), concurrent:await trace(concurrentIndices,true), warm:await trace([31],false) };
assert.equal(traces.cold.successfulUncachedDecodes,1);
assert.equal(traces.concurrent.successfulUncachedDecodes,1);
assert.equal(traces.warm.successfulUncachedDecodes,0);
const replayA=await resolveArchivedPlan(restored.buildings[31]);
const replayB=await resolveArchivedPlan(restored.buildings[31]);
assert.notEqual(replayA,replayB,'Parsed records must be caller-owned, not a global mutable cache.');
assert.deepStrictEqual(replayA,replayB);
const cache=planArchiveCacheStats();
assert.equal(cache.entries,1);
assert.equal(cache.bytes,rawBytes+64*2*4+(base64.length+id.length)*2);
assert(cache.bytes<=PLAN_ARCHIVE_CACHE_BYTES && cache.entries<=PLAN_ARCHIVE_CACHE_COUNT);

let taggedF64=0, taggedNegativeZero=0, plainNegativeZero=0;
function numeric(v: unknown) {
  if (typeof v==='number') { if(Object.is(v,-0))plainNegativeZero++; return; }
  if (!v || typeof v!=='object') return;
  if ('$f64' in v) { taggedF64++; if(v.$f64==='8000000000000000')taggedNegativeZero++; }
  for(const value of Object.values(v)) numeric(value);
}
expected.forEach(numeric);
assert.equal(taggedNegativeZero,58,'Use the actual recent native fixture, including its signed-zero tags.');
// Fresh weak references created by a transfer bind without any native replay.
const transferred=structuredClone(restored);
registerPlanArchives(transferred);
assert.deepStrictEqual(await resolveArchivedPlan(transferred.buildings[63]),expected[63]);

const gc=global.gc;
const memory = async () => {
  await new Promise<void>(r=>setImmediate(r)); gc?.();
  await new Promise<void>(r=>setImmediate(r)); gc?.();
  const {heapUsed,arrayBuffers,external}=process.memoryUsage(); return {heapUsed,arrayBuffers,external};
};
clearPlanArchiveCache();
const memoryCold=await memory();
await resolveArchivedPlan(restored.buildings[31]);
const memoryCached=await memory();
const memoryCacheStats=planArchiveCacheStats();
const sourceModules=['../rust/bridge/compactPlanArchive.ts','src/io/planArchiveCompression.ts'];
const report={
  schema_version:'frozen-native-plan-archive-benchmark-1',
  node:process.version,fixture:{source:sourcePath,sha256:sha(originalBytes),buildings:64,
    adaptation:'Only omitted unrelated refusal/open-space arrays; all64 native building objects and resolved plans unchanged.',
    nativeGeneratorVersions:[...new Set(expected.map(v=>(v as {generator_version:string}).generator_version))]},
  productionSources:await Promise.all(sourceModules.map(async path=>({path,sha256:sha(await readFile(path))}))),
  scriptSha256:sha(await readFile(new URL(import.meta.url))),
  sizes:{nativeRetainedJsonBytes:expectedRecordBytes.reduce((a,b)=>a+b,0),uncompressedNdjsonBytes:rawBytes,
    compressedBytes:compressed.length,base64Characters:base64.length,archiveCount:1,
    selectedRecord31Bytes:expectedRecordBytes[31],recordMinBytes:Math.min(...expectedRecordBytes),recordMaxBytes:Math.max(...expectedRecordBytes),
    archivedSceneJsonBytes:Buffer.byteLength(archiveJson),cacheAccountedBytes:memoryCacheStats.bytes,
    cacheLimitBytes:PLAN_ARCHIVE_CACHE_BYTES,cacheLimitCount:PLAN_ARCHIVE_CACHE_COUNT},
  archiveMsAsyncNodePath:archiveMs,registerRestoredSceneMs:registrationMs,
  uninstrumentedLatency:{coldRecord31:summary(cold),concurrentEightColdArchive:summary(concurrent),warmSequential64:summary(warm)},
  parseAndDecodeTraces:traces,
  decompressionCounterDefinition:'On these valid integrity-checked archives, each successful cache miss executes exactly one gunzipPlanBytes in decodeUncached. Pending deduplication adds no miss. This count is verified through cache stats, not a monkeypatch of fflate.',
  fidelity:{all64DeepStrictEqual:true,inputUnchanged:true,callerOwnedParsedObjects:true,jsonRestoreAndRegister:true,structuredCloneAndRegister:true,
    taggedF64,taggedNegativeZero,plainNegativeZero,
    signedZeroScope:'Native compact f64 values remain hexadecimal tags, including58 negative zeros. No untagged native -0 exists in this retained fixture; arbitrary plain-JSON -0 is not claimed lossless.'},
  observedProcessMemory:{explicitGc:!!gc,beforeColdDecode:memoryCold,afterCachedDecode:memoryCached,
    note:'Whole-process snapshots with source/restored scenes still retained. Not isolated cache heap, excludes fflate worker heap and is not a city-memory estimate.'},
  limits:['One real64-plan Java chunk in Node, not a browser frame or city-scale benchmark.',
    'Cold access decompresses and scans the entire one64-record archive; only selected record bytes are UTF8-decoded and JSON-parsed.',
    'Every request reparses its selected record into an independent object; parsed plans are intentionally not retained in a global cache.',
    'Concurrent selections share one decompression, not one parsed result.',
    'No production source, native geometry, server or UI was changed or executed.'],
};
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({sizes:report.sizes,latency:report.uninstrumentedLatency,
  traces:Object.fromEntries(Object.entries(traces).map(([k,v])=>[k,{parseCalls:v.jsonParseCalls,parseBytes:v.parsedBytes,uncachedDecodes:v.successfulUncachedDecodes,cache:v.cacheAfter}])),
  fidelity:report.fidelity},null,2));
clearPlanArchiveCache();
