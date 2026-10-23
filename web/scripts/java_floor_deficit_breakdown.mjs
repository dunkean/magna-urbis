/** Offline, bounded scalar breakdown of an existing frozen C proof. No native run. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArchitectureBenchEvidence } from './architecture_bench_evidence.mjs';

const proof = resolve(process.argv[2] ?? 'web/out/java-c-nominal-first-roundoff-proof');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(resolve(proof, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const previousBytes = await readFile(resolve(proof, 'structural-floor-programme-evidence.json'));
const previous = JSON.parse(previousBytes).structuralFloorProgramme;
const groups = Object.create(null);
const make = () => ({ sites: 0, knownReference: 0, unknownReference: 0, unknownGeometry: 0,
  admittedFloorM2: 0, comparableAdmittedFloorM2: 0, referenceFloorM2: [0, 0],
  grossDeficitM2: [0, 0], surplusM2: [0, 0], belowLowerReference: 0 });
let total = 0;
for (let batch = 0; total < manifest.count; batch++) {
  const stem = String(batch).padStart(3, '0');
  const requestBytes = await readFile(resolve(proof, 'after', `${stem}-request.json`));
  const planBytes = await readFile(resolve(proof, 'after', `${stem}-plans.json`));
  const evidence = JSON.parse(await readFile(resolve(proof, 'after', `${stem}-evidence.json`)));
  assert.equal(sha(requestBytes), evidence.inputSha256);
  assert.equal(sha(planBytes), evidence.outputSha256);
  assert.equal(evidence.start, total);
  const request = JSON.parse(requestBytes), scene = JSON.parse(planBytes);
  const buildings = new Map(scene.buildings.map(b => [b.id, b]));
  const refusals = new Map(scene.refusals.map(b => [b.id, b]));
  const opens = new Map(scene.open_spaces.map(b => [b.id, b]));
  assert.ok(request.requests.length <= 64);
  for (const site of request.requests) {
    if (!['domestic', 'mixed'].includes(site.function)) continue;
    const building = buildings.get(site.id), refusal = refusals.get(site.id), open = opens.get(site.id);
    assert.equal(Number(!!building) + Number(!!refusal) + Number(!!open), 1);
    const state = building ? 'accepted' : refusal ? 'refused' : 'open';
    // Reuse the existing collector's exact floor/reference semantics, one site
    // at a time; no second geometry formula or changed denominator.
    const collector = createArchitectureBenchEvidence({ witnessLimit: 0 });
    collector.consumeMessage({ id: 1, batch: { requests: [site], delta: {
      generator_version: scene.generator_version, buildings: building ? [building] : [],
      refusals: refusal ? [refusal] : [], open_spaces: open ? [open] : [],
    }, progress: { start: 0, completed: 1, total: 1 } } });
    const metric = collector.snapshot().structuralFloorProgramme;
    const keys = ['all', state, ...(building ? [`recipe:${building.recipe_id}`] : [])];
    for (const key of keys) {
      const group = groups[key] ??= make();
      group.sites++;
      group.knownReference += metric.reference.knownSites;
      group.unknownReference += metric.reference.unknownSites;
      group.unknownGeometry += metric.admittedFloorM2.unknownPlans;
      group.admittedFloorM2 += metric.admittedFloorM2.sum;
      if (!metric.reference.knownSites || metric.admittedFloorM2.unknownPlans) continue;
      const actual = metric.comparable.admittedFloorM2;
      group.comparableAdmittedFloorM2 += actual;
      for (let k = 0; k < 2; k++) {
        const target = metric.comparable.referenceFloorM2[k];
        group.referenceFloorM2[k] += target;
        group.grossDeficitM2[k] += Math.max(0, target - actual);
        // Surplus interval is reversed relative to the target interval.
        group.surplusM2[1-k] += Math.max(0, actual - target);
      }
      if (actual < metric.comparable.referenceFloorM2[0] - 1e-4) group.belowLowerReference++;
    }
  }
  total += request.requests.length;
}
assert.equal(total, manifest.count);
assert.equal(groups.all.sites, previous.sites);
assert.equal(groups.all.knownReference, previous.reference.knownSites);
assert.equal(groups.all.unknownReference, previous.reference.unknownSites);
assert.equal(groups.accepted.sites, previous.accepted);
assert.equal(groups.refused.sites, previous.refused);
assert.ok(Math.abs(groups.all.admittedFloorM2 - previous.admittedFloorM2.sum) < 1e-6);
assert.ok(Math.abs(groups.all.comparableAdmittedFloorM2 - previous.comparable.admittedFloorM2) < 1e-6);
for (const g of Object.values(groups)) g.netDeficitM2 = g.referenceFloorM2.map(v => v - g.comparableAdmittedFloorM2);
const report = { version: 'java-floor-deficit-breakdown-1', provenance: {
  proof, manifestSha256: sha(manifestBytes), collectorEvidenceSha256: sha(previousBytes),
  scriptSha256: sha(await readFile(fileURLToPath(import.meta.url))), nativeExecution: false,
}, groups, semantics: 'Domestic and mixed only. Reference = positive programme footprint target times preferred floor interval. Actual = sum of all real body-level footprints, including mixed uses. Refusals contribute zero. Unknown reference or geometry is excluded from deficit; counts remain explicit. Gross deficits are summed site by site without cancelling surplus elsewhere. Net deficit = reference minus actual. No inhabitants, habitable area or functional capacity inferred.' };
const output = resolve(proof, 'independent-audit/floor-deficit-breakdown.json');
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output, sha256: sha(await readFile(output)), groups }, null, 2));
