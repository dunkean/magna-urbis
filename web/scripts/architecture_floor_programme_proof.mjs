/** Offline evidence only. Reads one frozen batch at a time; no native execution.
 * node scripts/architecture_floor_programme_proof.mjs [proof-dir] [output-json] */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArchitectureBenchEvidence } from './architecture_bench_evidence.mjs';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..'), root = resolve(web, '..');
const proof = resolve(process.argv[2] ?? resolve(web, 'out/java-full-setback-proof'));
const output = resolve(process.argv[3] ?? resolve(proof, 'structural-floor-programme-evidence.json'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(resolve(proof, 'manifest.json')), manifest = JSON.parse(manifestBytes);
const evidence = createArchitectureBenchEvidence(), batches = [];
let completed = 0;
for (let index = 0; completed < manifest.count; index++) {
  const stem = String(index).padStart(3, '0'), folder = resolve(proof, 'after');
  const requestPath = resolve(folder, `${stem}-request.json`), plansPath = resolve(folder, `${stem}-plans.json`);
  const [requestBytes, plansBytes, provenanceBytes] = await Promise.all([
    readFile(requestPath), readFile(plansPath), readFile(resolve(folder, `${stem}-evidence.json`)),
  ]);
  const input = JSON.parse(requestBytes), scene = JSON.parse(plansBytes), provenance = JSON.parse(provenanceBytes);
  assert.equal(sha(requestBytes), provenance.inputSha256);
  assert.equal(sha(plansBytes), provenance.outputSha256);
  assert.equal(provenance.start, completed);
  assert.equal(provenance.count, input.requests.length);
  assert.ok(input.requests.length > 0 && input.requests.length <= 64);
  assert.equal(scene.buildings.length + scene.refusals.length + scene.open_spaces.length, input.requests.length);
  completed += input.requests.length;
  assert.equal(provenance.completed, completed);
  evidence.consumeMessage({ id: 1, batch: { requests: input.requests, delta: scene,
    progress: { start: provenance.start, completed, total: manifest.count } } });
  batches.push({ index, start: provenance.start, completed, count: input.requests.length,
    requestPath, requestSha256: sha(requestBytes), plansPath, plansSha256: sha(plansBytes) });
}
assert.equal(completed, manifest.count);
const snapshot = evidence.snapshot();
const report = { version: 'structural-floor-programme-offline-1',
  provenance: { proof, manifestSha256: sha(manifestBytes), nativeExecution: false,
    collector: 'web/scripts/architecture_bench_evidence.mjs', collectorSha256: sha(await readFile(resolve(web, 'scripts/architecture_bench_evidence.mjs'))),
    runner: 'web/scripts/architecture_floor_programme_proof.mjs', runnerSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    sourceRoot: root, batches },
  allFunctions: { requests: completed, batches: snapshot.batches, accepted: snapshot.accepted.count,
    refused: snapshot.planRefusals.count, open: snapshot.openSpaces },
  structuralFloorProgramme: snapshot.structuralFloorProgramme,
  semantics: snapshot.semantics.structuralFloorProgramme, capacityPersons: snapshot.capacityPersons };
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output, sha256: sha(await readFile(output)), allFunctions: report.allFunctions,
  structuralFloorProgramme: report.structuralFloorProgramme }, null, 2));
