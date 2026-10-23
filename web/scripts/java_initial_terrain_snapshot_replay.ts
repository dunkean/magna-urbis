/** Replay the frozen intermediate urban C snapshot, through the real streaming bridge.
 * No server, city generation, detail realization, or whole-scene accumulator. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { streamArchitectureSource } from '../../rust/bridge/architectureBatch';
import type { ArchitectureNeighbor, PlacementBatch, PlacementRequest, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../rust/bridge/housesContract';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'web/out/java-r5-initial-terrain-proof');
const BASELINE = 'web/out/java-r5-capacity-houses-proof';
const SOURCE = 'web/out/capacity-sweep/java100k/after/requests.json';
const SOURCE_SHA = '1d3fc52454e46a080d186aaa75a3fa99cde9b5291ef85b483860a0a04c39df53';
const CLI = 'web/out/initial-terrain-v2-isolated-proof/plan_replay.exe';
const CLI_SHA = '9f11cd2f66f27141f40e9755f628573202468d00c1c60bc9e63896cb43ed3791';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const save = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
type Box = [number, number, number, number];
const bbox = (s: Surface): Box => {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const shape of s) for (const p of shape.outer) {
    b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y); b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y);
  }
  return b;
};
const overlaps = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
type Occupant = { box: Box; neighbor: ArchitectureNeighbor };
function occupations(building: PlacedBuilding): Occupant[] {
  const height = Math.max(0, ...building.volumes.map(v => v.z_m + v.wall_height_m + v.roof_height_m - building.ground_z_m));
  return [building.footprint, building.courtyards, building.circulation, ...building.structural_features.map(f => f.surface)]
    .map((surface, i) => ({ box: bbox(surface), neighbor: { id: `${building.id}/occupation/${i}`, footprint: surface, height_m: height } }))
    .filter(v => v.neighbor.footprint.length > 0);
}
function cli(input: string, output: string): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((yes, no) => {
    const child = spawn(resolve(ROOT, CLI), [input, output], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); no(new Error('CLI batch exceeded 120 seconds.')); }, 120_000);
    child.stdout.on('data', b => stdout.push(b)); child.stderr.on('data', b => stderr.push(b));
    child.on('error', e => { clearTimeout(timer); no(e); });
    child.on('close', code => { clearTimeout(timer); const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      if (code !== 0) no(new Error(`CLI exited ${code}: ${result.stderr.toString('utf8')}`)); else yes(result); });
  });
}

assert.equal(hash(await readFile(resolve(ROOT, CLI))), CLI_SHA);
const raw = await readFile(resolve(ROOT, SOURCE)); assert.equal(hash(raw), SOURCE_SHA);
const requests = JSON.parse(raw.toString('utf8')) as PlacementRequest[];
assert.equal(requests.length, 7921); assert.equal(new Set(requests.map(r => r.id)).size, requests.length);
assert(requests.every(r => r.neighbors.length === 0 && r.terrain?.grid && r.seed && r.config?.seed && r.parcel_fit === undefined));
const contentHash = hash(JSON.stringify(requests));
const bridgeSha = hash(await readFile(resolve(ROOT, 'rust/bridge/architectureBatch.ts')));
const baselineManifestBytes = await readFile(resolve(ROOT, BASELINE, 'manifest.json'));
const priorManifest = JSON.parse(baselineManifestBytes.toString('utf8'));
assert.equal(priorManifest.source.sha256, SOURCE_SHA);
assert.equal(priorManifest.cli.sha256, 'c786a95f5e995a0e3ce2529f0733e0dbbe9566b2de9737b1e51b3da6e554268e');
assert.equal(bridgeSha, priorManifest.bridgeSha256, 'Bridge changed since the validated complete Java replay.');
await mkdir(OUT); await mkdir(resolve(OUT, 'after'));
// Preserve the producer's absence of settings. The explicit original per-site
// seeds/configuration remain untouched. Native parcel_fit defaults are not UI settings.
const header = { schema_version: '1' as const };
await writeFile(resolve(OUT, 'source-requests.json'), raw, { flag: 'wx' });
await writeFile(resolve(OUT, 'catalogue-snapshot.json'), await readFile(resolve(ROOT, 'web/out/java-r5-capacity-houses-proof/catalogue-snapshot.json')), { flag: 'wx' });
await save(resolve(OUT, 'manifest.json'), {
  version: 'intermediate-java-initial-terrain-replay-1', count: requests.length,
  baseline: { path: BASELINE, manifestSha256: hash(baselineManifestBytes), cliSha256: priorManifest.cli.sha256 },
  source: { path: SOURCE, sha256: SOURCE_SHA, bytes: raw.length, coreProducerSha256: null,
    provenance: 'Intermediate Opus C urban_case_replay snapshot, not final merged R5 or user UI replay.',
    producer: 'rust/crates/core/examples/urban_case_replay.rs', producerSourceSha256: hash(await readFile(resolve(ROOT, 'rust/crates/core/examples/urban_case_replay.rs'))),
    producerSourceIsBuildIdentity: false },
  cli: { path: CLI, sha256: CLI_SHA }, header, settings: null,
  seedPolicy: 'Original request.seed and config.seed preserved exactly; no batch seed or settings supplied.',
  bridgeSha256: bridgeSha, runnerSha256: hash(await readFile(import.meta.filename)), sourceContentHash: contentHash,
  scope: 'One independent current-house evaluation of 7,921 archived sites, real streaming bridge and cumulative occupation; no population capacity, no interiors, baseline C7921 retained separately with its own occupation; no comparison with a different urban corpus.'
});
let offset = 0, batchNumber = 0, accepted = 0, refused = 0, open = 0;
const prior: Occupant[] = [], metrics: any[] = [];
const complete = await streamArchitectureSource(header, {
  total: requests.length,
  read: async (start, limit) => requests.slice(start, start + limit),
}, async input => {
  const start = offset, count = input.requests.length, index = batchNumber++;
  assert(count > 0 && count <= 64);
  const neighbors: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const actual = input.requests[i], original = requests[start + i]; assert.equal(actual.id, original.id);
    assert.deepEqual({ ...actual, neighbors: original.neighbors }, original);
    const box = bbox(original.cadastral);
    const expected = prior.filter(p => overlaps(box, p.box)).map(p => p.neighbor);
    assert.deepEqual([...actual.neighbors].sort((a,b) => a.id.localeCompare(b.id)), [...expected].sort((a,b) => a.id.localeCompare(b.id)));
    assert.equal(new Set(actual.neighbors.map(n => n.id)).size, actual.neighbors.length);
    neighbors.push({ id: actual.id, added: actual.neighbors.map(n => ({ id: n.id, sha256: hash(JSON.stringify(n)) })) });
  }
  const stem = String(index).padStart(3, '0'), folder = resolve(OUT, 'after'), payload = JSON.stringify(input);
  const inputPath = resolve(folder, `${stem}-request.json`), outputPath = resolve(folder, `${stem}-plans.json`);
  await writeFile(inputPath, payload, { encoding: 'utf8', flag: 'wx' });
  const { stdout, stderr } = await cli(inputPath, outputPath);
  await writeFile(resolve(folder, `${stem}-stdout.log`), stdout, { flag: 'wx' });
  await writeFile(resolve(folder, `${stem}-stderr.log`), stderr, { flag: 'wx' });
  const bytes = await readFile(outputPath); assert(bytes.length <= 64 * 1024 * 1024);
  const output = JSON.parse(bytes.toString('utf8')) as PlacementBatch;
  const native = JSON.parse(stdout.toString('utf8').trim().split(/\r?\n/).at(-1)!);
  const returned = [...output.buildings, ...output.refusals, ...output.open_spaces].map(x => x.id);
  assert.equal(returned.length, count); assert.equal(new Set(returned).size, count);
  assert.deepEqual([...returned].sort(), input.requests.map(r => r.id).sort());
  // Only occupation is retained for independent neighbor auditing, never full plans.
  prior.push(...output.buildings.flatMap(b => structuredClone(occupations(b))));
  accepted += output.buildings.length; refused += output.refusals.length; open += output.open_spaces.length; offset += count;
  const record = { index, start, completed: offset, count, inputBytes: Buffer.byteLength(payload), inputSha256: hash(payload),
    outputBytes: bytes.length, outputSha256: hash(bytes), native,
    addedNeighbors: input.requests.reduce((sum, r) => sum + r.neighbors.length, 0) };
  metrics.push(record); await save(resolve(folder, `${stem}-evidence.json`), { ...record, neighbors });
  if (index % 8 === 0 || offset === requests.length) console.log(JSON.stringify({ completed: offset, total: requests.length, accepted, refused, open }));
  return output;
}, { onBatch: (delta, progress) => {
  assert.equal(progress.completed, offset);
  if (progress.start === 0 && delta.buildings.length) {
    // Verify that a consumer's mutation cannot contaminate later neighbors.
    delta.buildings[0].footprint[0].outer[0].x += 100000;
    delta.buildings[0].id = 'consumer-mutation-must-not-escape';
  }
} });
assert.equal(offset, requests.length); assert.equal(hash(JSON.stringify(requests)), contentHash);
assert.equal(complete.buildings, accepted); assert.equal(complete.refusals, refused); assert.equal(complete.open_spaces, open);
assert.equal(hash(await readFile(resolve(ROOT, CLI))), CLI_SHA); assert.equal(hash(await readFile(resolve(ROOT, SOURCE))), SOURCE_SHA);
const summary = { version: 'intermediate-java-initial-terrain-phase-1', complete, requests: requests.length,
  nativeMsSum: metrics.reduce((n,m) => n + m.native.ms, 0), batches: metrics,
  addedNeighborReferences: metrics.reduce((n,m) => n + m.addedNeighbors, 0), independentNeighborAuditPassed: true,
  sourceUnchanged: true, consumerAliasMutationChecked: true,
  timingScope: 'Sum of one run of native plan_batch milliseconds in separate CLI processes; excludes startup, JSON, bridge, archives and UI. No isolated benchmark or persistent-server claim.' };
await save(resolve(OUT, 'after/summary.json'), summary);
await save(resolve(OUT, 'replay-summary.json'), { ...summary, phase: 'intermediate-C-with-initial-terrain-v2' });
console.log(JSON.stringify({ finished: true, ...complete, nativeMsSum: summary.nativeMsSum }));
