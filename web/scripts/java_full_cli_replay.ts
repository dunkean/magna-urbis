/** Offline proof: use the actual production batching/occupation bridge.
 * No HTTP, city regeneration, detail construction, or substitute TS placement. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { streamArchitectureSource } from '../../rust/bridge/architectureBatch';
import type { ArchitectureNeighbor, PlacementBatch, PlacementBatchRequest, PlacementRequest, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../rust/bridge/housesContract';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'web/out/java-full-terrain-entry-proof');
const SOURCE_MANIFEST = resolve(ROOT, 'web/out/java-row-selection-proof/manifest.json');
const CLIS = {
  before: { path: 'web/out/source-aspect-budget-cli-proof/plan_replay.exe', sha256: 'cac76c96c1a997288f51b9764005f6e4181719b0e55962e88bc4c693f398d777' },
  after: { path: 'web/out/single-entry-terrain-cli-proof/plan_replay.exe', sha256: 'c90c4d64eb6815dbd39e1d85f673bbb6d87086391695aaa3909721cb378a0c64' },
};
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8'));
const save = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
type Box = [number, number, number, number];
const bbox = (s: Surface): Box => {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of s.flatMap(shape => shape.outer)) { b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y); b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y); }
  return b;
};
const overlaps = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
type Occupant = { box: Box; neighbor: ArchitectureNeighbor };
// Independent brute-force audit, deliberately without the production grid.
function occupations(building: PlacedBuilding): Occupant[] {
  const height = Math.max(0, ...building.volumes.map(v => v.z_m + v.wall_height_m + v.roof_height_m - building.ground_z_m));
  return [building.footprint, building.courtyards, building.circulation, ...building.structural_features.map(f => f.surface)]
    .map((surface, i) => ({ box: bbox(surface), neighbor: { id: `${building.id}/occupation/${i}`, footprint: surface, height_m: height } }))
    .filter(v => v.neighbor.footprint.length > 0);
}
function cli(executable: string, input: string, output: string): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((yes, no) => {
    const child = spawn(executable, [input, output], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); no(new Error('CLI batch exceeded 120 seconds.')); }, 120_000);
    child.stdout.on('data', b => stdout.push(b)); child.stderr.on('data', b => stderr.push(b));
    child.on('error', e => { clearTimeout(timer); no(e); });
    child.on('close', code => { clearTimeout(timer); const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      if (code !== 0) no(new Error(`CLI exited ${code}: ${result.stderr.toString('utf8')}`)); else yes(result); });
  });
}

await mkdir(OUT); // Deliberately refuse an existing proof directory.
const sourceManifest = await json<any>(SOURCE_MANIFEST);
const pages: { offset: number; next: number; total: number; placementRequests: PlacementRequest[] }[] = [];
const sourceProof: unknown[] = [];
let cursor = 0;
for (const file of sourceManifest.source_files) {
  const raw = await readFile(resolve(ROOT, file.path)); assert.equal(hash(raw), file.sha256);
  const page = JSON.parse(raw.toString('utf8')); assert.equal(page.offset, cursor); assert.equal(page.total, 1752);
  assert.equal(page.next, cursor + page.placementRequests.length); cursor = page.next;
  pages.push(page); sourceProof.push({ path: file.path, sha256: file.sha256, offset: page.offset, next: page.next, count: page.placementRequests.length });
}
const requests = pages.flatMap(p => p.placementRequests);
assert.equal(cursor, 1752); assert.equal(new Set(requests.map(r => r.id)).size, 1752);
assert(requests.every(r => r.neighbors.length === 0 && r.terrain && r.seed));
const sourceContentHash = hash(JSON.stringify(requests));
for (const c of Object.values(CLIS)) assert.equal(hash(await readFile(resolve(ROOT, c.path))), c.sha256);
const header = { schema_version: '1' as const, settings: { parcel_fit: true } };
await writeFile(resolve(OUT, 'requests.json'), JSON.stringify({ ...header, requests }), { encoding: 'utf8', flag: 'wx' });
await writeFile(resolve(OUT, 'catalogue-snapshot.json'), await readFile(resolve(ROOT, 'web/out/java-terrain-entry-proof/catalogue-snapshot.json')), { flag: 'wx' });
await save(resolve(OUT, 'manifest.json'), { version: 'java-full-cli-replay-1', count: 1752, sourceProof, settings: header.settings,
  clis: CLIS, sourceContentHash, requestSha256: hash(await readFile(resolve(OUT, 'requests.json'))),
  bridgeSha256: hash(await readFile(resolve(ROOT, 'rust/bridge/architectureBatch.ts'))), runnerSha256: hash(await readFile(import.meta.filename)),
  scope: 'Complete archived historic sites replayed with current frozen house CLIs and independently regenerated occupation per phase. Not historical runtime replication, a new R5 city, interiors, or population capacity.' });

async function run(name: 'preflight' | 'before' | 'after', total: number, reusePreflight = false) {
  const phase = name === 'preflight' ? 'before' : name, executable = resolve(ROOT, CLIS[phase].path);
  const folder = resolve(OUT, name); await mkdir(folder);
  let offset = 0, batchNumber = 0;
  const prior: Occupant[] = [], enriched: PlacementRequest[] = [], metrics: any[] = [];
  const aggregate: PlacementBatch = { schema_version: '1', generator_version: '', buildings: [], refusals: [], open_spaces: [] };
  const source = { total, read: async (start: number, limit: number) => {
    const p = pages.find(page => page.offset <= start && page.next > start);
    assert(p); return p.placementRequests.slice(start - p.offset, Math.min(p.next, start + limit, total) - p.offset);
  } };
  const complete = await streamArchitectureSource(header, source, async input => {
    const start = offset, count = input.requests.length, index = batchNumber++;
    assert(count > 0 && count <= 64); assert(start + count <= total);
    const neighborEvidence: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const actual = input.requests[i], original = requests[start + i]; assert.equal(actual.id, original.id);
      assert.deepEqual({ ...actual, neighbors: original.neighbors }, original);
      const expected = prior.filter(p => overlaps(bbox(original.cadastral), p.box)).map(p => p.neighbor);
      const added = actual.neighbors.slice(original.neighbors.length);
      assert.deepEqual([...added].sort((a,b) => a.id.localeCompare(b.id)), [...expected].sort((a,b) => a.id.localeCompare(b.id)));
      assert.equal(new Set(added.map(n => n.id)).size, added.length);
      neighborEvidence.push({ id: actual.id, added: added.map(n => ({ id: n.id, sha256: hash(JSON.stringify(n)) })) });
    }
    const stem = String(index).padStart(3, '0'), payload = JSON.stringify(input);
    const inputPath = resolve(folder, `${stem}-request.json`), outputPath = resolve(folder, `${stem}-plans.json`);
    await writeFile(inputPath, payload, { encoding: 'utf8', flag: 'wx' });
    let stdout: Buffer, stderr: Buffer, cached = false;
    if (reusePreflight && index < 2) {
      const original = resolve(OUT, 'preflight', `${stem}-request.json`); assert.equal(payload, await readFile(original, 'utf8'));
      await writeFile(outputPath, await readFile(resolve(OUT, 'preflight', `${stem}-plans.json`)), { flag: 'wx' });
      stdout = await readFile(resolve(OUT, 'preflight', `${stem}-stdout.log`)); stderr = await readFile(resolve(OUT, 'preflight', `${stem}-stderr.log`)); cached = true;
    } else ({ stdout, stderr } = await cli(executable, inputPath, outputPath));
    await writeFile(resolve(folder, `${stem}-stdout.log`), stdout, { flag: 'wx' });
    await writeFile(resolve(folder, `${stem}-stderr.log`), stderr, { flag: 'wx' });
    const raw = await readFile(outputPath), output = JSON.parse(raw.toString('utf8')) as PlacementBatch;
    assert(raw.length <= 64 * 1024 * 1024); // No bypass of the production response budget.
    const native = JSON.parse(stdout.toString('utf8').trim().split(/\r?\n/).at(-1)!);
    const returned = [...output.buildings, ...output.refusals, ...output.open_spaces].map(x => x.id);
    assert.equal(returned.length, count); assert.equal(new Set(returned).size, count);
    assert.deepEqual([...returned].sort(), input.requests.map(r => r.id).sort());
    if (aggregate.generator_version) assert.equal(output.generator_version, aggregate.generator_version);
    aggregate.generator_version = output.generator_version; aggregate.materials = output.materials;
    // Independent copies: later mutation of the consumer's onBatch snapshot
    // must not influence either the native output proof or the neighbor audit.
    const frozen = structuredClone(output);
    aggregate.buildings.push(...frozen.buildings); aggregate.refusals.push(...frozen.refusals); aggregate.open_spaces.push(...frozen.open_spaces);
    prior.push(...frozen.buildings.flatMap(occupations)); enriched.push(...structuredClone(input.requests));
    offset += count;
    const record = { index, start, completed: offset, count, inputBytes: Buffer.byteLength(payload), inputSha256: hash(payload),
      outputBytes: raw.length, outputSha256: hash(raw), native, cachedFromPreflight: cached,
      addedNeighbors: input.requests.reduce((sum, r, i) => sum + r.neighbors.length - requests[start + i].neighbors.length, 0) };
    metrics.push(record);
    await save(resolve(folder, `${stem}-evidence.json`), { ...record, neighbors: neighborEvidence });
    if (index % 4 === 0 || offset === total) console.log(JSON.stringify({ phase: name, completed: offset, total, accepted: aggregate.buildings.length, refused: aggregate.refusals.length }));
    return output;
  }, { onBatch: (delta, progress) => {
    assert.equal(progress.completed, offset);
    if (name === 'preflight' && progress.start === 0) {
      assert(delta.buildings.length > 0);
      // Deliberately corrupt only the consumer clone. The second callback above
      // compares the bridge neighbors with untouched native output geometry.
      delta.buildings[0].footprint[0].outer[0].x += 100000;
      delta.buildings[0].id = 'consumer-mutation-must-not-escape';
    }
  } });
  assert.equal(offset, total); assert.equal(hash(JSON.stringify(requests)), sourceContentHash);
  assert.equal(complete.buildings, aggregate.buildings.length); assert.equal(complete.refusals, aggregate.refusals.length); assert.equal(complete.open_spaces, aggregate.open_spaces.length);
  if (name === 'preflight') { assert.equal(metrics.length, 2); assert(metrics[1].addedNeighbors > 0, 'First two lots must exercise real cross-batch occupation.'); }
  const summary = { version: 'java-full-cli-phase-1', phase: name, complete, requests: total, nativeMsSum: metrics.reduce((n,m) => n + m.native.ms, 0),
    addedNeighborReferences: metrics.reduce((n,m) => n + m.addedNeighbors, 0), batches: metrics, sourceContentHash,
    independentNeighborAuditPassed: true, consumerAliasMutationChecked: name === 'preflight',
    timingScope: 'Sum of native plan_batch milliseconds, separate CLI process per chunk; excludes startup, JSON, bridge, archives and UI. No persistent-server latency claim.' };
  await save(resolve(folder, 'summary.json'), summary);
  if (name !== 'preflight') {
    await writeFile(resolve(OUT, `${name}-plans.json`), JSON.stringify(aggregate), { encoding: 'utf8', flag: 'wx' });
    await writeFile(resolve(OUT, `${name}-enriched-requests.json`), JSON.stringify({ ...header, requests: enriched }), { encoding: 'utf8', flag: 'wx' });
  }
  return summary;
}

const preflight = await run('preflight', 128);
assert(preflight.independentNeighborAuditPassed && preflight.consumerAliasMutationChecked);
console.log('FIRST_TWO_BATCHES_VERIFIED: order, exact prior occupation, nonempty second-lot neighbors, consumer alias isolation.');
const before = await run('before', 1752, true);
const after = await run('after', 1752);
for (const c of Object.values(CLIS)) assert.equal(hash(await readFile(resolve(ROOT, c.path))), c.sha256);
await save(resolve(OUT, 'replay-summary.json'), { version: 'java-full-cli-replay-1', before, after, preflight,
  phaseIsolation: 'Independent streamArchitectureSource invocation and occupation context per phase; first two before outputs reused only after exact input-byte equality.' });
console.log(JSON.stringify({ finished: true, before: before.complete, after: after.complete, nativeMsSum: { before: before.nativeMsSum, after: after.nativeMsSum } }));
