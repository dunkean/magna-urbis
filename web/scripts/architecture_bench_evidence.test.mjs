/** Offline only: node --test scripts/architecture_bench_evidence.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createArchitectureBenchEvidence, recordDetailHttpFailure } from './architecture_bench_evidence.mjs';

const rectangle = (width, depth, x = 0) => ({ outer: [{ x, y: 0 }, { x: x + width, y: 0 }, { x: x + width, y: depth }, { x, y: depth }], holes: [] });
const message = (delta, requests = [], start = 0, completed = 1) => ({ id: 7,
  batch: { delta: { generator_version: 'houses-2', buildings: [], refusals: [], open_spaces: [], ...delta },
    requests, progress: { start, completed, total: completed } } });

test('measures native bodies and floors, subtracting holes, without replacing them with lot/target/useful area', () => {
  const factory = runInNewContext(`(${createArchitectureBenchEvidence.toString()})`);
  const evidence = factory(); // Same dependency-free serialization used by both page probes.
  const first = rectangle(4, 5); first.holes = [rectangle(2, 2).outer.reverse()];
  const second = rectangle(6, 5, 10);
  evidence.consumeMessage(message({ buildings: [{ id: 'accepted', recipe_id: 'fixture', function: 'domestic',
    footprint: [first, second], useful_area_m2: 40, domestic_units: 8,
    volumes: [{ footprint: [first], levels: [{ footprint: [first] }, { footprint: [rectangle(2, 4)] }] },
      { footprint: [second], levels: [{ footprint: [second] }] }] }] },
  [{ id: 'accepted', cadastral: [rectangle(25, 40)], programme: { built_area_m2: 700, households: 5 } }]));
  const result = evidence.snapshot();
  assert.equal(result.areas.buildingFootprintM2.sum, 46);
  assert.equal(result.areas.bodyFootprintM2.sum, 46);
  assert.equal(result.areas.bodyFootprintM2.count, 2);
  assert.equal(result.areas.levelFootprintM2.sum, 54);
  assert.equal(result.areas.levelFootprintM2.p50, 16);
  assert.equal(result.areas.buildingFloorFootprintsM2.sum, 54);
  assert.equal(result.areas.nativeUsefulAreaM2.sum, 40);
  assert.equal(result.areas.acceptedCadastralM2.sum, 1000);
  assert.equal(result.capacityPersons, null);
});

test('retains a reason first seen after 40 refusals and bounds witnesses per reason', () => {
  const evidence = createArchitectureBenchEvidence({ witnessLimit: 2 });
  const refusals = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, code: 'plan_refused', message: i < 49 ? 'domain' : 'late reason' }));
  const requests = refusals.map(r => ({ id: r.id, function: 'domestic', config: { recipe: 'requested-only' } }));
  evidence.consumeMessage(message({ refusals }, requests, 0, 50));
  const result = evidence.snapshot();
  assert.equal(result.planRefusals.count, 50);
  const reasons = Object.values(result.planRefusals.byReason);
  assert.equal(reasons.find(r => r.message === 'late reason').count, 1);
  assert.equal(reasons.find(r => r.message === 'domain').witnesses.length, 2);
  assert.equal(result.planRefusals.byRecipe['requested-only'], 50);
  assert.equal(result.planRefusals.byFunction.domestic, 50);
  assert.equal(reasons.reduce((n, r) => n + r.count, 0), 50);
});

test('projected sites never supply lot areas or inferred auto recipes; absent floors stay unknown', () => {
  const evidence = createArchitectureBenchEvidence();
  const data = message({ buildings: [{ id: 'b', footprint: [rectangle(5, 5)], useful_area_m2: 999,
    volumes: [{ footprint: [rectangle(5, 5)] }] }], refusals: [{ id: 'r', code: 'plan_refused', message: 'domain' }] });
  data.batch.sites = ['b', 'r'].map(id => ({ id, function: 'domestic', surface: [rectangle(100, 100)], preview: true }));
  evidence.consumeMessage(data);
  const result = evidence.snapshot();
  assert.equal(result.areas.requestCadastralM2.sum, null);
  assert.equal(result.areas.requestCadastralM2.missing, 2);
  assert.equal(result.areas.buildingFloorFootprintsM2.sum, null);
  assert.equal(result.areas.buildingFloorFootprintsM2.missing, 1);
  assert.equal(result.planRefusals.byRecipe.unknown, 1);
  assert.equal(result.planRefusals.byFunction.domestic, 1);
});

test('counts streamed chunks once and ignores the final full scene and silhouette previews', () => {
  const evidence = createArchitectureBenchEvidence();
  const data = message({ refusals: [{ id: 'r', code: 'plan_refused', message: 'domain' }] });
  evidence.consumeMessage(data); evidence.consumeMessage(data);
  evidence.consumeMessage({ id: 7, scene: data.batch.delta });
  evidence.consumeMessage(message({ generator_version: 'silhouette', buildings: [{ id: 'preview' }] }, [], 1, 2));
  assert.equal(evidence.snapshot().planRefusals.count, 1);
  assert.equal(evidence.snapshot().ignoredDuplicateBatches, 2);
  assert.equal(evidence.snapshot().ignoredPreviewBatches, 1);
});

test('structural floor reference keeps domestic/mixed levels, refused zeros and unknowns separate', () => {
  const evidence = runInNewContext(`(${createArchitectureBenchEvidence.toString()})`)();
  const body = areas => ({ footprint: [rectangle(1, areas[0])], levels: areas.map(area => ({ footprint: [rectangle(1, area)] })) });
  const data = message({ buildings: [
    { id: 'house', function: 'domestic', footprint: [rectangle(4, 5)], volumes: [body([20, 12])], useful_area_m2: 999 },
    { id: 'shop', function: 'mixed', footprint: [rectangle(5, 5)], volumes: [body([25, 25]), body([4])], useful_area_m2: 888 },
    { id: 'no-programme', function: 'domestic', footprint: [rectangle(2, 5)], volumes: [body([10])] },
    { id: 'no-levels', function: 'domestic', footprint: [rectangle(2, 5)], volumes: [{ footprint: [rectangle(2, 5)] }] },
    { id: 'warehouse', function: 'warehouse', footprint: [rectangle(10, 10)], volumes: [body([100, 100])] },
  ], refusals: [{ id: 'refused', code: 'plan_refused', message: 'terrain' }] });
  // The current paged protocol contains these lightweight projections, not cadastral geometry.
  data.batch.sites = [
    { id: 'house', function: 'domestic', programme: { built_area_m2: 20, floors: [1, 2] } },
    { id: 'shop', function: 'mixed', programme: { built_area_m2: 25, floors: [2, 3] } },
    { id: 'refused', function: 'domestic', programme: { built_area_m2: 30, floors: [1, 1] } },
    { id: 'no-programme', function: 'domestic' },
    { id: 'no-levels', function: 'domestic', programme: { built_area_m2: 10, floors: [1, 1] } },
    { id: 'pending', function: 'mixed', programme: { built_area_m2: 5, floors: [2, 2] } },
    { id: 'warehouse', function: 'warehouse', programme: { built_area_m2: 100, floors: [2, 2] } },
  ];
  evidence.consumeMessage(data);
  const result = evidence.snapshot(), floor = result.structuralFloorProgramme;
  assert.equal(floor.sites, 6);
  assert.equal(floor.accepted, 4);
  assert.equal(floor.refused, 1);
  assert.equal(floor.unresolved, 1);
  assert.equal(floor.admittedFloorM2.sum, 96);
  assert.equal(floor.admittedFloorM2.knownPlans, 3);
  assert.equal(floor.admittedFloorM2.unknownPlans, 1);
  assert.equal(floor.reference.knownSites, 5);
  assert.equal(floor.reference.unknownSites, 1);
  assert.deepEqual(Array.from(floor.reference.floorM2), [120, 165]);
  assert.equal(floor.comparable.admittedFloorM2, 86);
  assert.equal(floor.comparable.refused, 1);
  assert.equal(floor.comparable.unresolved, 1);
  assert.equal(floor.comparable.unknownAcceptedGeometry, 1);
  assert.equal(result.areas.buildingFloorFootprintsM2.sum, 296); // Existing all-function metric unchanged.
  assert.equal(result.capacityPersons, null);
  evidence.consumeMessage(data); // Existing deduplication also covers the new metric.
  assert.equal(evidence.snapshot().structuralFloorProgramme.admittedFloorM2.sum, 96);
});

test('invalid or incomplete floor preferences never become a made-up denominator', () => {
  const evidence = createArchitectureBenchEvidence();
  const programmes = [{ built_area_m2: 5 }, { floors: [1, 2] }, { built_area_m2: 0, floors: [1, 2] },
    { built_area_m2: 5, floors: [2, 1] }, { built_area_m2: 5, floors: [1, 1.5] },
    { built_area_m2: Number.MAX_VALUE, floors: [2, 3] }];
  const requests = programmes.map((programme, i) => ({ id: `r${i}`, function: 'domestic', programme }));
  evidence.consumeMessage(message({ refusals: requests.map(({ id }) => ({ id, code: 'plan_refused', message: 'bounds' })) }, requests));
  const result = evidence.snapshot().structuralFloorProgramme;
  assert.equal(result.refused, 6);
  assert.equal(result.admittedFloorM2.sum, 0);
  assert.equal(result.reference.knownSites, 0);
  assert.equal(result.reference.unknownSites, 6);
  assert.equal(result.comparable.sites, 0);
});

test('records detail HTTP errors separately and never reads successful detail geometry', async () => {
  const evidence = createArchitectureBenchEvidence();
  await recordDetailHttpFailure({ status: () => 200, json: () => assert.fail('Successful mesh must not be duplicated') }, evidence);
  await recordDetailHttpFailure({ status: () => 400, statusText: () => 'Bad Request',
    request: () => ({ postDataJSON: () => ({ building: { id: 'b', recipe_id: 'R', function: 'collective', resolved: 'opaque' } }) }),
    json: async () => ({ error: 'Native roof construction refused' }) }, evidence);
  const result = evidence.snapshot();
  assert.equal(result.detailRefusals.count, 1);
  assert.equal(result.detailRefusals.byRecipe.R, 1);
  assert.equal(result.planRefusals.count, 0);
  assert.equal(result.accepted.count, 0);
  assert.ok(!JSON.stringify(result).includes('opaque'));
});

const archive = new URL('../out/javanese-user-10-8791/houses-targeted/', import.meta.url);
const archiveExists = existsSync(new URL('diagnostic-flat-terrain-plans.json', archive));
test('existing six-plan Java diagnostic: split batches preserve measured areas and native useful totals', { skip: !archiveExists }, async () => {
  const scene = JSON.parse(await readFile(new URL('diagnostic-flat-terrain-plans.json', archive), 'utf8'));
  const { requests } = JSON.parse(await readFile(new URL('diagnostic-flat-terrain-requests.json', archive), 'utf8'));
  const evidence = createArchitectureBenchEvidence();
  for (let i = 0; i < scene.buildings.length; i++) {
    const building = scene.buildings[i];
    evidence.consumeMessage(message({ ...scene, buildings: [building] }, requests.filter(r => r.id === building.id), i, i + 1));
  }
  const result = evidence.snapshot();
  assert.equal(result.accepted.count, 6);
  assert.equal(result.areas.bodyFootprintM2.count, 6);
  assert.equal(result.areas.levelFootprintM2.count, 6);
  assert.ok(Math.abs(result.areas.bodyFootprintM2.sum - 2270.7412798267615) < 1e-5);
  assert.ok(Math.abs(result.areas.levelFootprintM2.sum - result.areas.nativeUsefulAreaM2.sum) < 1e-5);
  assert.equal(result.accepted.byFunction.domestic, 3);
  assert.equal(result.accepted.byFunction.collective, 2);
  assert.equal(result.accepted.byFunction.warehouse, 1);
  assert.equal(result.capacityPersons, null);
  // The original historical archive is a diagnostic fixture, not a new city run.
  const report = JSON.parse(await readFile(new URL('../report.json', archive), 'utf8'));
  const original = Object.values(report.terminal.probe.runs).find(run => run.refusalSamples?.length);
  const sampled = createArchitectureBenchEvidence();
  sampled.consumeMessage(message({ refusals: original.refusalSamples }, requests));
  assert.equal(sampled.snapshot().planRefusals.count, 40);
  assert.equal(Object.values(sampled.snapshot().planRefusals.byReason).reduce((n, r) => n + r.count, 0), 40);
  assert.ok(original.refused > sampled.snapshot().planRefusals.count); // The old 1261 cannot be reconstructed from 40 samples.
});
