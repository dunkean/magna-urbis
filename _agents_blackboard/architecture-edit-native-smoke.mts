// One focused integration check against an ALREADY RUNNING isolated native server.
// From web/: node --import tsx ../_agents_blackboard/architecture-edit-native-smoke.mts
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { editArchitectureScene } from '../rust/bridge/architectureEdits';
import { archivePlanBatch, resolveArchivedPlan } from '../rust/bridge/compactPlanArchive';
import type { PlacementBatch, PlacementBatchRequest, PlacementRequest } from '../rust/bridge/urbanArchitecture';
import type { HouseConfig } from '../rust/bridge/housesContract';

const base = 'http://127.0.0.1:8794';
const calls: unknown[] = [];
function config(recipe: string, variant = 'default'): HouseConfig {
  return { schema_version: '2', seed: 'native-edit-smoke', pack: 'EUR-MED', recipe,
    mode: 'historical_inspired', era: 'any', allow_late: false, count: 1, size: 1,
    variation: 0, wealth: 0.5, orientation_deg: 0,
    overrides: { variant, footprint: null, roof: null, frame: null, infill: null,
      coating: null, cladding: null, floors: null, bodies: null, courtyard_ratio: null,
      overhang_m: null, roof_pitch_deg: null, site_slope_deg: null } };
}
function request(index: number): PlacementRequest {
  const x = 100 + index * 80, y = 160;
  const site = [{ outer: [{ x, y }, { x: x + 48, y }, { x: x + 48, y: y + 55 }, { x, y: y + 55 }], holes: [] }];
  return { id: `native-edit-${index}`, parcel_id: `native-edit-parcel-${index}`, seed: `native-edit:${index}`,
    cadastral: site, buildable: site, roof_domain: site, reserves: [],
    accesses: [{ id: 'front', segment: [{ x, y: y + 55 }, { x: x + 48, y: y + 55 }], kind: 'public', width_m: 2 }],
    party_boundaries: [], neighbors: [],
    culture: { culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null },
    function: 'domestic', terrain: { origin: { x, y }, ground_z_m: 10, gradient: [0, 0], water_z_m: null, max_foundation_step_m: 1 },
    config: config('EUR-MED-B01'), parcel_fit: true };
}
async function generate(input: PlacementBatchRequest): Promise<PlacementBatch> {
  const started = performance.now();
  const response = await fetch(`${base}/houses/plans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(30_000) });
  const result = await response.json();
  assert(response.ok && result.ok, JSON.stringify(result.error ?? result));
  const batch = result.data as PlacementBatch;
  calls.push({ requestIds: input.requests.map(request => request.id), accepted: batch.buildings.length,
    refusals: batch.refusals, elapsedMs: performance.now() - started });
  return archivePlanBatch(batch);
}

const requests = [request(0), request(1)], originalSites = structuredClone(requests);
const previous = await generate({ schema_version: '1', requests });
assert.equal(previous.buildings.length, 2, JSON.stringify(previous.refusals));
const before = JSON.stringify(previous), outside = previous.buildings[1];
const restyle = { ...requests[0], config: config('EUR-MED-B02') };
const result = await editArchitectureScene(previous, [restyle], generate);
assert(result.applied, JSON.stringify(result.refusals));
assert.equal(result.scene.buildings[0].recipe_id, 'EUR-MED-B02');
assert.equal(result.scene.buildings[0].id, requests[0].id);
assert.equal(result.scene.buildings[0].parcel_id, requests[0].parcel_id);
assert.equal(result.scene.buildings[1], outside);
assert.deepEqual(result.changedIds, [requests[0].id]);
assert.equal(JSON.stringify(previous), before);
assert.deepEqual(requests, originalSites);
const decoded = await resolveArchivedPlan(result.scene.buildings[0]) as { recipe_id: string };
assert.equal(decoded.recipe_id, 'EUR-MED-B02');

// Same authoritative site, deliberately unavailable explicit style variant:
// the native resolver must refuse, and the selected scene must stay intact.
const badStyle = { ...requests[0], config: config('EUR-MED-B02', 'missing-native-edit-smoke-variant') };
const restyledBeforeFailure = JSON.stringify(result.scene);
const refused = await editArchitectureScene(result.scene, [badStyle], generate);
assert.equal(refused.applied, false);
assert.equal(refused.scene, result.scene);
assert.deepEqual(refused.changedIds, []);
assert(refused.refusals.length > 0, 'Expected an actual native style refusal.');
assert.equal(JSON.stringify(result.scene), restyledBeforeFailure);
const report = {
  ok: true, endpoint: base, timestamp: new Date().toISOString(),
  initialBuildings: previous.buildings.length, beforeRecipe: previous.buildings[0].recipe_id,
  afterRecipe: result.scene.buildings[0].recipe_id, stableIds: true, authoritativeSitesUnchanged: true,
  outsideIdentityPreserved: true, previousSceneUnchanged: true, selectedArchiveReplays: true,
  refusalSceneSameObject: true, refusedStyle: badStyle.config.overrides.variant, refusal: refused.refusals,
  nativeCalls: calls, serviceStartedOrStopped: false,
};
await writeFile(new URL('./ARCHITECTURE_EDIT_NATIVE_SMOKE.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
