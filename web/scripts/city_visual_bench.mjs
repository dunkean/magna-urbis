/** Manifest-driven CityBench captures. Existing runtime only; no server lifecycle.
 * From web/: node scripts/city_visual_bench.mjs --dry-run --gate all --limit 50
 * Live: --only 03-norse-hamlet --server http://127.0.0.1:8810
 * See _agents_blackboard/CITY_VISUAL_BENCH_50_README.md for gates and limitations.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { tsImport } from 'tsx/esm/api';
import { createArchitectureBenchEvidence, recordDetailHttpFailure } from './architecture_bench_evidence.mjs';
import { settlementIdentity } from './city_bench_identity.mjs';
import { cityVisualCoverage } from './city_visual_coverage.mjs';
import { prepareExactVisualInput } from './city_visual_exact_input.mjs';
import { PROGRAMME_UI_PROOF_SELECTORS, programmeUiEvidence } from './city_programme_ui_evidence.mjs';
import { createCaptureSettlingBarrier, assessCaptureReadiness, parentCaptureReceipt, captureGenerationCompletion,
  classifyCaptureDetail, captureDetailUsage, captureDetailBudget } from './city_capture_readiness.mjs';

const detailEvidenceByCase = new Map();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), has = key => args.includes(`--${key}`);
const option = (key, fallback) => {
  const equal = args.find(arg => arg.startsWith(`--${key}=`));
  if (equal) return equal.slice(key.length + 3);
  const i = args.indexOf(`--${key}`);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing --${key} value`);
  return args[i + 1];
};
if (has('help')) {
  console.log('city_visual_bench.mjs [--manifest path] [--only id,id-or-prefix*] [--limit 1] [--gate p0|specialized|million|all] [--dry-run]\n  [--server URL] [--bench URL] [--out path] [--timeout-ms 180000] [--detail-timeout-ms 30000] [--p0-report path] [--headed]\n  [--architecture-proof parent|legacy] defaults to parent; legacy is explicitly scoped Single evidence.\n  [--detail-member-budget 64] counts physical members (parent Single 1, assembly pair 2), active ceiling 2.\n  [--require-comparison-detail] requires a native cached exterior before any auxiliary comparison.\nDefaults: one P0 case, existing :8810 runtime. Million requires explicit --gate million/all; --p0-report is optional evidence. No server lifecycle.');
  process.exit(0);
}
const positive = (key, fallback) => {
  const n = Number(option(key, String(fallback)));
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--${key} must be a positive integer`);
  return n;
};
const dry = has('dry-run'), requireComparisonDetail = has('require-comparison-detail'), limit = positive('limit', 1), timeoutMs = positive('timeout-ms', 180000), detailTimeoutMs = positive('detail-timeout-ms', 30000);
// Capture policy only: never changes a manifest, raw URL, recipe or camera.
// Old runtimes need explicit qualification; a missing parent marker is no proof.
const architectureProof = option('architecture-proof', 'parent');
if (!['parent', 'legacy'].includes(architectureProof)) throw new Error('--architecture-proof must be parent or legacy');
const detailMemberBudget = positive('detail-member-budget', 64);
const manifestPath = resolve(option('manifest', resolve(root, '_agents_blackboard/CITY_VISUAL_BENCH_50.json')));
const output = resolve(option('out', resolve(root, 'web/out/city-visual-bench')));
const server = option('server', 'http://127.0.0.1:8810').replace(/\/$/, '');
const bench = option('bench', 'http://127.0.0.1:5173/citybench.html');
const serverOrigin = new URL(server).origin, benchOrigin = new URL(bench).origin;
const gateNames = option('gate', 'p0').split(',').map(value => value.trim());
for (const gate of gateNames) if (!['p0', 'specialized', 'million', 'all'].includes(gate)) throw new Error(`Unknown gate ${gate}`);
const gates = new Set(gateNames.includes('all') ? ['p0', 'specialized', 'million'] : gateNames);
const rawManifest = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(rawManifest);
// Version 2 adds regression provenance and declared auxiliary views; primary
// scene/camera semantics remain unchanged. Auxiliary captures use a retained-state
// comparison hook, never the architecture selector that regenerates silhouettes.
if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.cases)) throw new Error('Expected manifest version 1 or 2 and cases[]');
const ids = new Set();
for (const item of manifest.cases) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(item.id) || ids.has(item.id)) throw new Error(`Invalid/duplicate case id: ${item.id}`);
  ids.add(item.id);
  validateAuxiliaryViews(item);
}
function fixedCamera(camera) {
  return camera?.kind === 'fixed' && ['cx', 'cy', 'mpp'].every(key => Number.isFinite(camera[key])) && camera.mpp > 0;
}
function validateAuxiliaryViews(item) {
  if (item.auxiliaryViews === undefined) return;
  if (!Array.isArray(item.auxiliaryViews)) throw new Error(`${item.id}: auxiliaryViews must be an array`);
  const ids = new Set(), groups = new Map();
  for (const view of item.auxiliaryViews) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(view.id) || ids.has(view.id)) throw new Error(`${item.id}: invalid/duplicate auxiliary id`);
    ids.add(view.id);
    if (view.image !== `${item.id}--${view.id}.png` || view.countsTowardPrimary !== false) throw new Error(`${item.id}/${view.id}: invalid auxiliary filename/counting`);
    if (!fixedCamera(view.camera) || !['parcels', 'buildings'].includes(view.renderView) || !['compact', 'silhouette'].includes(view.architecture)) throw new Error(`${item.id}/${view.id}: invalid auxiliary camera/layer`);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(view.comparisonGroup)) throw new Error(`${item.id}/${view.id}: invalid comparisonGroup`);
    if (!groups.has(view.comparisonGroup)) groups.set(view.comparisonGroup, []);
    groups.get(view.comparisonGroup).push(view);
  }
  for (const [group, views] of groups) {
    const layers = views.map(view => `${view.renderView}/${view.architecture}`).sort().join(',');
    if (layers !== 'buildings/compact,buildings/silhouette,parcels/compact') throw new Error(`${item.id}/${group}: expected parcels, silhouettes and compact plans exactly once`);
    if (views.some(view => ['cx', 'cy', 'mpp'].some(key => view.camera[key] !== views[0].camera[key]))) throw new Error(`${item.id}/${group}: auxiliary cameras differ`);
  }
}
function matchesFixedView(camera, actual) {
  return Boolean(actual && Number.isFinite(actual.scale) && actual.scale > 0 && Math.abs(actual.cx - camera.cx) < 1e-6
    && Math.abs(actual.cy - camera.cy) < 1e-6 && Math.abs(actual.scale - 1 / camera.mpp) < 1e-6);
}
function sameComparisonIdentity(expected, actual) {
  return Boolean(expected && actual && ['layouts', 'partitions', 'scene', 'requests'].every(key =>
    ['number', 'string'].includes(typeof expected[key]) && expected[key] !== '' && actual[key] === expected[key]));
}
function checkComparisonState(state, identity, spec, previousFrame) {
  if (!state?.active || !sameComparisonIdentity(identity, state.identity)) throw new Error('Retained comparison identity changed or comparison session ended');
  if (state.renderView !== spec.renderView || state.architecture !== spec.architecture) return false;
  return Number.isFinite(state.frameSerial) && state.frameSerial > previousFrame && state.pending === false;
}
const only = option('only', '').split(',').filter(Boolean);
const matches = (id, token) => token.endsWith('*') ? id.startsWith(token.slice(0, -1)) : id === token;
for (const token of only) if (!manifest.cases.some(item => matches(item.id, token))) throw new Error(`--only matches no case: ${token}`);
const selected = manifest.cases.filter(item => gates.has(item.gate ?? 'p0') && (!only.length || only.some(token => matches(item.id, token)))).slice(0, limit);
if (!selected.length) throw new Error('No cases remain after --only/--gate/--limit');
// Pair visits consecutively: one retained page, no 40-page cache of large cities.
const groups = new Map();
for (const item of selected) { const key = item.pairedWith ?? item.id; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
const ordered = [...groups.values()].flatMap(items => items.sort((a, b) => Number(Boolean(a.pairedWith)) - Number(Boolean(b.pairedWith))));
const catalogue = JSON.parse(await readFile(resolve(root, 'web/decors/index.json'), 'utf8')).decors;
const cultures = JSON.parse(await readFile(resolve(root, 'rust/crates/core/src/urban/catalogue.json'), 'utf8')).cultures;
const coverageAudit = cityVisualCoverage(manifest, cultures, selected);
const decorModule = await tsImport('../src/ui/decor.ts', import.meta.url), { decodeDecor } = decorModule.decodeDecor ? decorModule : decorModule.default;
const configModule = await tsImport('../../rust/bridge/urbanConfig.ts', import.meta.url), configs = configModule.defaultLayoutConfig ? configModule : configModule.default;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function merge(base, patch) {
  const result = object(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`Unsafe config key: ${key}`);
    result[key] = object(value) ? merge(result[key], value) : structuredClone(value);
  }
  return result;
}
const stripRuntime = q => { for (const key of ['profile', 'localServer', 'compute', 'generation', 'neural', 'situation']) q.delete(key); return q; };
const codeFor = (query, item, view) => 'MU1.' + deflateRawSync(Buffer.from(JSON.stringify({ v: 1, q: stripRuntime(new URLSearchParams(query)).toString(), ...(view ? { view } : {}), pins: [], note: `${item.id} · ${item.title}` }))).toString('base64url');
// The URL is debounced by the UI; build replay from the validated inputs and
// explicit final options instead of racing history.replaceState(). MU1 is a
// version-dependent regeneration recipe, not an archive of native geometry.
function replayQuery(input, item, complete) {
  if (input.exactInputIdentity && complete) return new URLSearchParams(input.intendedQuery);
  const query = stripRuntime(new URLSearchParams(input.intendedQuery));
  const urban = JSON.parse(query.get('urban'));
  urban.architecture = item.architecture;
  urban.render = { ...urban.render, view: 'buildings' };
  urban.buildingState = { ...urban.buildingState, generated: Boolean(complete), visible: true };
  query.set('urban', JSON.stringify(urban));
  return query;
}
/** Only inspect small building-site messages. The source path is a few hundred
 * bytes; decoding legacy multi-megabyte geometry would distort the benchmark.
 * Never return source/session/revision values or snapshot contents. */
function sourcePayloadEvidence(body) {
  if (!body || body.length > 64 * 1024) return { inspection: body ? 'over_64k_not_parsed' : 'body_unavailable', sourcePresent: null, geometryOmitted: null };
  try {
    const value = JSON.parse(body.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Not an object');
    const sourcePresent = Object.hasOwn(value, 'source'), source = value.source;
    const sourceShapeValid = Boolean(source && source.version === 1 && ['session', 'terrainRevision', 'layoutsRevision', 'partitionsRevision'].every(key => typeof source[key] === 'string' && source[key].length > 0));
    const geometryFields = Object.fromEntries(['layouts', 'partitions', 'raster'].map(key => [key, Object.hasOwn(value, key)]));
    return { inspection: 'bounded_json', sourcePresent, sourceShapeValid, geometryFields,
      geometryOmitted: !Object.values(geometryFields).some(Boolean), keysCount: Array.isArray(value.keys) ? value.keys.length : null,
      ...(value.kind === 'buildingSitesPage' ? { offset: value.offset, limit: value.limit, maxBytes: value.maxBytes } : {}) };
  } catch { return { inspection: 'invalid_json', sourcePresent: null, geometryOmitted: null }; }
}
function networkEvidence(report) {
  const totals = entries => ({ count: entries.length,
    completed: entries.filter(entry => entry.finishedMs !== undefined).length,
    successful: entries.filter(entry => entry.status >= 200 && entry.status < 300 && entry.finishedMs !== undefined).length,
    requestBytesKnown: entries.reduce((sum, entry) => sum + (Number.isFinite(entry.requestBytes) ? entry.requestBytes : 0), 0),
    requestBytesUnknownCount: entries.filter(entry => !Number.isFinite(entry.requestBytes)).length,
    responseBytesKnown: entries.reduce((sum, entry) => sum + (Number.isFinite(entry.responseBytes) ? entry.responseBytes : 0), 0),
    responseBytesUnknownCount: entries.filter(entry => !Number.isFinite(entry.responseBytes)).length });
  const sites = report.requests.filter(entry => entry.path === '/urban' && ['buildingSites', 'buildingSitesBegin', 'buildingSitesPage'].includes(entry.kind));
  const pages = sites.filter(entry => entry.kind === 'buildingSitesPage');
  const uploads = report.requests.filter(entry => entry.path === '/raster' || entry.path === '/raster/upload');
  return { observationScope: 'requests made during this case; paired scenes do not duplicate inherited requests', inheritedSceneFrom: report.reusedFrom ?? null,
    buildingSites: { all: totals(sites), legacy: totals(sites.filter(entry => entry.kind === 'buildingSites')),
      begin: totals(sites.filter(entry => entry.kind === 'buildingSitesBegin')), pages: totals(pages),
      largestPageResponseBytes: pages.reduce((max, entry) => Math.max(max, entry.responseBytes ?? 0), 0),
      withSource: totals(sites.filter(entry => entry.sourcePayload?.sourcePresent === true)),
      sourceWithoutGeometry: totals(sites.filter(entry => entry.sourcePayload?.sourcePresent === true && entry.sourcePayload.sourceShapeValid && entry.sourcePayload.geometryOmitted)),
      sourceWithGeometry: totals(sites.filter(entry => entry.sourcePayload?.sourcePresent === true && entry.sourcePayload.geometryOmitted === false)),
      withoutSource: totals(sites.filter(entry => entry.sourcePayload?.sourcePresent === false)),
      uninspected: totals(sites.filter(entry => entry.sourcePayload?.sourcePresent == null)) },
    rasterUploads: { ...totals(uploads), paths: { '/raster': uploads.filter(entry => entry.path === '/raster').length,
      '/raster/upload': uploads.filter(entry => entry.path === '/raster/upload').length },
      afterArchitectureClick: totals(uploads.filter(entry => report.generationClickMs !== null && report.generationClickMs !== undefined && entry.startMs >= report.generationClickMs)) },
    privacy: 'Only shape/presence/count/byte metadata for buildingSites; source tokens, revisions and snapshots are not recorded.' };
}
function assessCapture(report) {
  const probe = report.ui?.probe, actual = report.ui?.view, requested = report.camera;
  const viewKnown = Boolean(actual && ['cx', 'cy', 'scale'].every(key => Number.isFinite(actual[key])) && actual.scale > 0);
  const cameraMatches = viewKnown && (requested.kind === 'overview' || Math.abs(actual.cx - requested.cx) < 1e-6
    && Math.abs(actual.cy - requested.cy) < 1e-6 && Math.abs(actual.scale - 1 / requested.mpp) < 1e-6);
  const nativeRequired = report.architecture !== 'silhouette';
  const parent = report.parentExpected || report.parentObserved;
  const parentReceipt = parent ? parentCaptureReceipt(report.ui, { previousParentKey: report.previousParentKey, expectedParentKey: report.parentGenerationKey }) : undefined;
  const accepted = parent ? parentReceipt?.counts?.admitted_parents ?? null : probe?.accepted ?? null;
  const refused = parent ? parentReceipt?.counts?.refusals ?? null : probe?.refused ?? null;
  const readiness = assessCaptureReadiness(report.ui, report.architecture, report.visualSettling,
    { nativePlansExpected: report.expectsNativePlans === true && report.complete === true, renderView: report.renderView,
      parentExpected: !!parent, previousParentKey: report.previousParentKey, expectedParentKey: report.parentGenerationKey });
  const visible = readiness.paintedInCamera;
  const captureOk = Boolean(report.complete && report.image && report.settled && readiness.visualComplete && !report.errors.length && !probe?.errors?.length);
  const technicalOk = captureOk && cameraMatches && report.ui?.architecture === report.architecture && (!nativeRequired || report.nativeEvidence?.verified === true);
  const warnings = [...readiness.warnings];
  if (parent) warnings.push('Parent evidence is the authenticated consumer/store attestation; this runner does not independently reread native archives, receipts or all chunks. Legacy worker/material counters are not parent counts.');
  else if (nativeRequired) warnings.push('Explicit legacy capture qualification; no native parent-session proof is claimed.');
  if (report.exactInputIdentity) warnings.push('Frozen exact user options are requested; observed parcel_fit/settings and coordinated runtime binary SHA still require explicit attestation. Technical completion alone does not certify exact regression identity.');
  if (refused > 0) warnings.push(`${refused} native plan refusals; inspect their reasons and scenario expectations.`);
  if (accepted === 0) warnings.push('No building accepted: this capture cannot demonstrate residential architecture.');
  if (visible === 0) warnings.push('No building reported painted in this camera; the scene may be outside the viewport.');
  if (report.architecture === 'detailed' && (parent ? readiness.visual.nativeExteriorDemonstrated !== true : !(Number(report.ui?.frameData.detailCached) > 0))) warnings.push('No visible native exterior detail demonstrated in this current draw; coarse LOD or zero eligible parents do not demonstrate detailed architecture.');
  if (report.auxiliaryViews?.count && report.auxiliaryViews.technicalOk !== true) warnings.push('Auxiliary comparisons have their own reports and are not yet all technically verified; primary counts exclude them.');
  const status = !report.complete || !report.settled ? 'incomplete' : !report.image ? 'capture_failed'
    : !readiness.visualComplete ? 'captured_visual_incomplete'
    : !captureOk ? 'captured_with_errors' : !cameraMatches ? 'captured_camera_mismatch'
    : report.ui?.architecture !== report.architecture ? 'captured_mode_mismatch'
    : nativeRequired && !report.nativeEvidence?.verified ? 'captured_native_unverified'
    : accepted === 0 ? 'captured_no_accepted_buildings' : visible === 0 ? 'captured_no_visible_buildings'
    : refused > 0 ? 'captured_with_refusals' : nativeRequired ? 'captured_review_required' : 'captured_preview';
  return { captureOk, technicalOk, ok: technicalOk, status, warnings,
    cameraApplied: viewKnown ? { cx: actual.cx, cy: actual.cy, mpp: 1 / actual.scale } : null, cameraMatches,
    completion: { plansComplete: report.complete, accepted, refused, openSpaces: parent ? parentReceipt?.counts?.open_spaces ?? null : probe?.openSpaces ?? null, paintedInCamera: visible,
      countScope: parent ? 'native admitted parents; physical members separate; capacity unknown' : 'legacy Single plans',
      paintedCountScope: parent ? 'physical native members in this camera, never parents or households' : 'legacy buildings in this camera',
      physicalMembers: parentReceipt?.counts?.physical_members ?? null, parentSource: parentReceipt ?? null,
      viewport: readiness.visual,
      nativePlansVerified: report.nativeEvidence?.verified === true, nativeExteriorCached: parent ? null : Number(report.ui?.frameData.detailCached ?? 0),
      parentNativeExterior: parent ? { visibleEligible: readiness.visual.detailVisibleEligible ?? null, demonstrated: readiness.visual.nativeExteriorDemonstrated === true, scope: 'current draw only, not a global cache count' } : null },
    materials: { catalogueMaterialCount: parent ? null : Object.keys(probe?.catalogueMaterials ?? {}).length,
      usedMaterialIds: !parent && probe?.materialUsage?.buildingsWithRefs > 0 ? Object.keys(probe.usedMaterials ?? {}).sort() : null,
      usage: parent ? { scope: 'Parent material usage unobserved; legacy Single material counters cannot substitute.' }
        : { ...probe?.materialUsage, scope: 'explicit references in retained base-plan volumes, levels, roof meshes and structural features; not pixel coverage or on-demand detail' } } };
}
const preparations = new Map(), metas = new Map();
for (const item of ordered) {
  const entry = catalogue.find(entry => entry.id === item.artifact);
  if (!entry || !cultures[item.culture]) throw new Error(`${item.id}: unknown artifact/culture`);
  if (!Number.isSafeInteger(item.population) || item.population < 1 || !item.seed) throw new Error(`${item.id}: invalid population/seed`);
  if (!['silhouette', 'compact', 'detailed'].includes(item.architecture)) throw new Error(`${item.id}: invalid architecture`);
  if (item.camera?.kind !== 'overview' && !(item.camera?.kind === 'fixed' && ['cx', 'cy', 'mpp'].every(k => Number.isFinite(item.camera[k])) && item.camera.mpp > 0)) throw new Error(`${item.id}: invalid camera`);
  if (!metas.has(entry.id)) {
    const path = resolve(root, 'web/decors', entry.file), bytes = await readFile(path), decor = decodeDecor(new Uint8Array(bytes));
    metas.set(entry.id, { meta: decor.meta, width: decor.raster.width, bytes: bytes.length, modified: (await stat(path)).mtime.toISOString(), sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const source = metas.get(entry.id);
  let exact;
  if (item.exactInput) {
    const raw = await readFile(resolve(root, item.exactInput.path), 'utf8');
    if (createHash('sha256').update(raw).digest('hex') !== item.exactInput.sha256) throw new Error(`${item.id}: frozen URL hash changed`);
    exact = prepareExactVisualInput(item, raw);
  }
  const query = exact ? new URLSearchParams(exact.query) : stripRuntime(new URLSearchParams(source.meta.query));
  const saved = key => { const value = query.get(key); return value ? JSON.parse(value) : {}; };
  let settlements, urban;
  if (exact) ({ settlements, urban } = exact.settings);
  else {
    // Original 50-case preparation stays in the legacy branch, unchanged.
    settlements = saved('settlements');
    if (!object(settlements.config)) throw new Error(`${item.id}: decor has no recorded settlement configuration`);
    const oldSpec = settlements.config.list?.[0] ?? settlements.config.main ?? {};
    const sceneTitle = manifest.cases.find(base => base.id === item.pairedWith)?.title ?? item.title;
    const spec = merge(oldSpec, { ...item.settlement, key: 'city', name: sceneTitle, population: item.population, culture: item.culture });
    if (!Object.hasOwn(item.settlement ?? {}, 'position')) delete spec.position;
    settlements.config = merge(settlements.config, { mode: 'list', list: [spec], main: { ...spec, key: 'main' }, counts: { city: 0, town: 0, village: 0, hamlet: 0, farmstead: 0 } });
    settlements.enabled = true; settlements.showPoints = true;
    urban = merge({ layoutConfig: configs.defaultLayoutConfig(), parcelConfig: configs.defaultParcelConfig() }, saved('urban'));
    Object.assign(urban, merge(urban, item.urban));
    Object.assign(urban, { enabled: true, parcelEnabled: true, target: 'city', architecture: item.architecture === 'silhouette' ? 'silhouette' : 'compact' });
    urban.render = merge(urban.render, { view: 'parcels' });
    urban.buildingState = merge(urban.buildingState, { visible: true, generated: false, appearance: { style: 'cartographic', diagnostic: 'none' } });
    delete urban.buildingState.scene; delete urban.buildingState.selected; delete urban.edits;
    query.set('artifact', item.artifact); query.set('settlements', JSON.stringify(settlements)); query.set('urban', JSON.stringify(urban)); query.set('standalone', '1');
  }
  // A retained urban snapshot would overwrite the query inside restoreDecor().
  if (source.meta.pipeline?.urban?.layouts?.length) throw new Error(`${item.id}: decor carries an applied urban snapshot; use an unmodified terrain catalogue decor`);
  const fingerprint = createHash('sha256').update(query.toString()).digest('hex');
  const intended = exact ? new URLSearchParams(exact.intendedQuery) : new URLSearchParams(query);
  if (!exact) intended.set('urban', JSON.stringify({ ...urban, architecture: item.architecture, render: { ...urban.render, view: 'buildings' } }));
  const view = item.camera.kind === 'fixed' ? { cx: item.camera.cx, cy: item.camera.cy, scale: 1 / item.camera.mpp } : undefined;
  preparations.set(item.id, { id: item.id, artifact: item.artifact, culture: item.culture, population: item.population, gate: item.gate ?? 'p0', camera: item.camera,
    query: query.toString(), intendedQuery: intended.toString(), situation: codeFor(intended, item, view), fingerprint, settings: { settlements, urban },
    exactInputIdentity: exact?.identity ?? null,
    exactInputPreparation: exact?.proof ?? null,
    source: { width: source.width, seed: source.meta.seed, file: entry.file, bytes: source.bytes, modified: source.modified, sha256: source.sha256 },
    limitations: item.limitations, regressionReference: item.regressionReference,
    auxiliaryViews: { count: item.auxiliaryViews?.length ?? 0, supported: true, requiresHook: 'magnaBenchContext.comparison',
      status: 'prepared', captured: 0, views: item.auxiliaryViews ?? [] },
    declaredCapacityExceeded: item.population > Number(entry.tags?.maxPopulation ?? Infinity) });
}
for (const item of ordered) if (item.pairedWith && preparations.has(item.pairedWith) && preparations.get(item.id).fingerprint !== preparations.get(item.pairedWith).fingerprint) throw new Error(`${item.id}: pairedWith changes generation inputs`);
await mkdir(output, { recursive: true });
const prepared = { version: 1, dryRun: dry, nativeRequests: 0, manifest: manifestPath, manifestSha256: createHash('sha256').update(rawManifest).digest('hex'),
  coverageAudit,
  selectedIds: selected.map(item => item.id), executionOrder: ordered.map(item => item.id), gates: [...gates], timeoutMs, detailTimeoutMs,
  detailMemberBudget, activeDetailMemberLimit: 2,
  cases: ordered.map(item => preparations.get(item.id)) };
await writeFile(resolve(output, 'prepared.json'), JSON.stringify(prepared, null, 2));
if (dry) { console.log(JSON.stringify({ dryRun: true, nativeRequests: 0, browserStarted: false, cases: ordered.length, executionOrder: prepared.executionOrder, output: resolve(output, 'prepared.json') }, null, 2)); process.exit(0); }

let p0Evidence;
if (option('p0-report', '')) {
  const proofPath = option('p0-report', '');
  const proof = JSON.parse(await readFile(resolve(proofPath), 'utf8')), reports = proof.cases ?? [proof];
  p0Evidence = { path: resolve(proofPath), completed100k: reports.some(r => r.population >= 100000 && r.population < 1000000 && r.ok && r.complete && !r.errors?.length) };
}
const started = performance.now(), elapsed = () => Math.round(performance.now() - started), pause = ms => new Promise(done => setTimeout(done, ms));
const sourceHead = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } })();
const statusResponse = await fetch(`${server}/status`, { signal: AbortSignal.timeout(5000) });
const nativeStatus = await statusResponse.json();
if (!statusResponse.ok || !nativeStatus.capabilities?.includes('houses.compact-plans')) throw new Error('Existing runtime must report houses.compact-plans');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: !has('headed'), channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined), args: ['--disable-gpu'] });
const suite = { version: 1, measurementSchema: 2, architectureProof, detailMemberBudget, activeDetailMemberLimit: 2, started: new Date().toISOString(), manifest: manifestPath, manifestSha256: prepared.manifestSha256, server, bench, nativeStatus, p0Evidence,
  coverageAudit,
  sourceHead, browser: browser.version(), machine: { platform: process.platform, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemory: os.totalmem(), freeMemoryBefore: os.freemem(), loadAverage: os.loadavg() },
  measurementCaveats: ['Shared development machine; no isolation guarantee.', 'Worker observation aggregates metadata only; observed first visible means the application published a painted-building count, not independently classified pixels.', 'Full JSON parse/transfer duration, parcel geometry distributions, raster pending count and detail queued count are not exposed by current UI; reported null, not invented.', 'Captures await quiet UI/native work; this cannot prove pixel-perfect raster completion without a published pending metric.'],
  executionOrder: prepared.executionOrder, cases: [], auxiliaryCaptures: [] };
const reads = new Set(), track = promise => { reads.add(promise); void promise.finally(() => reads.delete(promise)).catch(() => {}); };
let context, page, current, retained, stopFuture = false, fatalDrain = false, comparisonGuard = false, auxiliaryCurrent;
let comparisonAttempts = [];
const active = new Map();
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
async function saveReports() {
  suite.elapsedMs = elapsed(); suite.freeMemoryAfter = os.freemem();
  for (const report of suite.cases) report.networkEvidence = networkEvidence(report);
  suite.primaryCounts = { attempted: suite.cases.length, captured: suite.cases.filter(r => r.image).length, technicalOk: suite.cases.filter(r => r.technicalOk).length };
  suite.auxiliaryCounts = { attempted: suite.auxiliaryCaptures.length, captured: suite.auxiliaryCaptures.filter(r => r.image).length,
    technicalOk: suite.auxiliaryCaptures.filter(r => r.technicalOk).length, countsTowardPrimary: false };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(suite, null, 2));
  const cards = suite.cases.map(r => `<article><h2>${escape(r.id)} · ${escape(r.title)}</h2>${r.image ? `<a href="${escape(r.image)}"><img loading="lazy" src="${escape(r.image)}"></a>` : '<p>Aucune capture disponible.</p>'}<p>${escape(r.status)} · ${r.population.toLocaleString()} habitants demandés · ${escape(r.architecture)}</p><p>Chaîne technique : ${r.technicalOk ? 'terminée' : 'non validée'} · ${r.completion?.accepted ?? '?'} acceptés · ${r.completion?.refused ?? '?'} refus.</p><p>${escape([...r.errors, ...(r.warnings ?? [])].join(' · '))}</p><p>Verdict visuel : ${escape(r.visualVerdict)}.</p><a href="${escape(r.id)}.json">Rapport</a> · <a href="${escape(r.id)}.situation.txt">MU1</a></article>`).join('');
  const auxiliaryCards = suite.auxiliaryCaptures.map(r => `<article><h2>${escape(r.parentId)} · ${escape(r.comparisonGroup)} · ${escape(r.renderView)}/${escape(r.architecture)}</h2>${r.image ? `<a href="${escape(r.image)}"><img loading="lazy" src="${escape(r.image)}"></a>` : '<p>Aucune capture auxiliaire disponible.</p>'}<p>${escape(r.status)} · même scène vérifiée : ${r.sameRetainedScene === true ? 'oui' : 'non'} · caméra : ${r.cameraMatches === true ? 'identique' : 'non vérifiée'}</p><p>${escape(r.purpose)}</p><p>${escape(r.errors.join(' · '))}</p><p>Verdict visuel : ${escape(r.visualVerdict)}.</p><a href="${escape(r.report)}">Rapport auxiliaire</a> · <a href="${escape(r.parentId)}.situation.txt">Situation principale</a></article>`).join('');
  await writeFile(resolve(output, 'gallery.html'), `<!doctype html><html lang="fr"><meta charset="utf-8"><title>CityBench · captures</title><style>body{font:16px system-ui;margin:24px;background:#eee9dc;color:#292c29}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:20px}article{background:white;padding:16px}img{width:100%;height:auto}h2{font-size:18px}</style><h1>CityBench · ${suite.primaryCounts.captured} images principales, ${suite.primaryCounts.attempted} cas documentés</h1><p>Contrôle technique et acceptation visuelle sont distincts ; aucun verdict visuel automatique. ${escape(suite.measurementCaveats[0])}</p><main>${cards}</main>${auxiliaryCards ? `<h1>Comparaisons auxiliaires · ${suite.auxiliaryCounts.captured} images hors décompte des 50 principales</h1><main>${auxiliaryCards}</main>` : ''}</html>`);
}
function probeInstall(createEvidence) {
  const evidence = window.__cityVisualBenchEvidence = createEvidence();
  const probe = window.__cityVisualBench = { documentOrigin: performance.timeOrigin, started: performance.now(), generationStarted: null, firstBatch: null, firstVisible: null, final: null, batches: 0, accepted: 0, refused: 0, openSpaces: 0,
    recipes: {}, variants: {}, catalogueMaterials: {}, usedMaterials: {}, materialUsage: { buildingsWithRefs: 0, buildingsWithoutRefs: 0 }, generatorVersions: {}, refusalCodes: {}, stages: {}, lastChange: performance.now(), longTasks: 0, longTaskMs: 0, maxFrameGapMs: 0, peakHeapBytes: 0, errors: [] };
  const add = (map, key) => { if (key) map[key] = (map[key] ?? 0) + 1; };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); this.addEventListener('message', event => {
      const data = event.data;
      if (data?.layouts) probe.stages.quarters = { atMs: performance.now(), layouts: data.layouts.length, blocks: data.layouts.reduce((n, l) => n + l.blocks.length, 0) };
      if (data?.partitions) probe.stages.parcels = { atMs: performance.now(), parcels: data.partitions.reduce((n, p) => n + p.parcels.length, 0), diagnostics: data.partitions.map(p => p.diagnostics) };
      if (data?.settlements) probe.stages.settlements = { atMs: performance.now(), entries: data.settlements.settlements?.map(s => ({ key: s.key, center: s.center, population: s.population, culture: s.culture })), warnings: data.settlements.warnings };
      if (data?.roads) probe.stages.roads = { atMs: performance.now(), segments: data.roads.segments?.length, ms: data.roads.ms };
      if (data?.error && probe.errors.length < 30) probe.errors.push(String(data.error));
      if (probe.generationStarted === null) return;
      evidence.consumeMessage(data);
      const delta = data?.batch?.delta, scene = delta ?? data?.scene;
      if (scene) {
        probe.lastChange = performance.now();
        if (delta) { probe.batches++; probe.firstBatch ??= { atMs: performance.now(), ...data.batch.progress, buildings: scene.buildings?.length ?? 0 }; }
        add(probe.generatorVersions, scene.generator_version);
        for (const b of scene.buildings ?? []) {
          add(probe.recipes, b.recipe_id); add(probe.variants, `${b.recipe_id}::${b.variant_id}`);
          let references = 0;
          const material = id => { if (typeof id === 'string' && id) { probe.usedMaterials[id] = true; references++; } };
          const slots = materials => { for (const key of ['frame', 'infill', 'coating', 'cladding', 'base', 'roof_frame']) material(materials?.[key]); };
          for (const volume of b.volumes ?? []) {
            slots(volume.materials);
            for (const level of volume.levels ?? []) slots(level.materials);
            material(volume.roof_spec?.corbel?.material); material(volume.roof_spec?.shell?.material);
            for (const face of volume.roof_mesh?.faces ?? []) material(face.material);
          }
          for (const feature of b.structural_features ?? []) { material(feature.material); material(feature.roof?.material); material(feature.roof?.frame_material); }
          probe.materialUsage[references ? 'buildingsWithRefs' : 'buildingsWithoutRefs']++;
        }
        for (const m of scene.materials ?? []) probe.catalogueMaterials[m.id] = true;
        for (const r of scene.refusals ?? []) add(probe.refusalCodes, r.code);
        probe.accepted += scene.buildings?.length ?? 0; probe.refused += scene.refusals?.length ?? 0; probe.openSpaces += scene.open_spaces?.length ?? 0;
      }
      if (data?.complete || (data?.scene && !delta)) probe.final = { atMs: performance.now(), counts: data.complete ?? null, timing: data.timing ?? null };
    }); }
  };
  try { new PerformanceObserver(list => { for (const task of list.getEntries()) { probe.longTasks++; probe.longTaskMs += task.duration; } }).observe({ type: 'longtask' }); } catch { /* Optional API. */ }
  let previous = 0, sampled = 0, lastSignature = '';
  function tick(now) {
    if (previous) probe.maxFrameGapMs = Math.max(probe.maxFrameGapMs, now - previous); previous = now;
    if (now - sampled > 100) {
      sampled = now;
      const frame = document.querySelector('[data-city-frame]'), counts = document.querySelector('[data-city-building-counts]');
      const signature = `${frame?.textContent}|${counts?.textContent}|${document.querySelector('[data-buildings-status]')?.textContent}`;
      if (signature !== lastSignature) { probe.lastChange = now; lastSignature = signature; }
      const visible = Number(frame?.dataset.buildingsPainted ?? 0);
      if (probe.generationStarted !== null && visible > 0) probe.firstVisible ??= { atMs: now, visible, planning: counts?.dataset.planning, completed: counts?.dataset.completed, total: counts?.dataset.total };
      probe.peakHeapBytes = Math.max(probe.peakHeapBytes, performance.memory?.usedJSHeapSize ?? 0);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
async function snapshot() {
  const observed = await page.evaluate(selectors => {
    const frame = document.querySelector('[data-city-frame]'), counts = document.querySelector('[data-city-building-counts]'), canvas = document.querySelector('[data-city-canvas] canvas');
    const intent = document.querySelector(selectors.intent), custom = document.querySelector(selectors.custom), fieldset = document.querySelector(selectors.fieldset), draft = document.querySelector(selectors.draft);
    const values = selector => Array.from(document.querySelectorAll(selector)).slice(0, 24).map(node => node.textContent);
    const hook = window.magnaBenchContext?.coldViewport;
    let coldViewport, coldViewportError;
    try { if (typeof hook === 'function') coldViewport = hook.call(window.magnaBenchContext); }
    catch (error) { coldViewportError = String(error); }
    const comparison = window.magnaBenchContext?.comparison?.snapshot?.();
    return { architecture: document.querySelector('[data-city-architecture]')?.value, busy: document.querySelector('[data-buildings-generate]')?.getAttribute('aria-busy') === 'true',
      status: document.querySelector('[data-buildings-status]')?.textContent, frame: frame?.textContent, frameData: { ...frame?.dataset }, counts: counts?.textContent, countsData: { ...counts?.dataset },
      view: window.magnaBenchContext?.capture()?.view, viewBox: document.querySelector('#map')?.getAttribute('viewBox'), now: performance.now(),
      coldViewportHook: typeof hook === 'function', coldViewport, coldViewportError,
      renderView: comparison?.active ? comparison.renderView : document.querySelector('[data-urban-view][aria-pressed="true"]')?.dataset.urbanView,
      appearance: { style: document.querySelector('[data-building-style]')?.value, diagnostic: document.querySelector('[data-building-diagnostic]')?.value },
      backgroundStyle: window.magnaCityBackground?.style?.() ?? document.documentElement.dataset.cityBackground,
      probe: { ...window.__cityVisualBench, architectureEvidence: window.__cityVisualBenchEvidence.snapshot() },
      canvas: canvas && { width: canvas.width, height: canvas.height }, svgBuildingNodes: document.querySelectorAll('[data-urban-building]').length,
      stageStatus: Object.fromEntries(['urbanQuarterStage', 'urbanParcelStage', 'roadStage'].map(id => [id, document.querySelector(`#${id} [data-status]`)?.textContent])),
      programmeFunctions: { controlsPresent: !!intent && !!custom && !!fieldset, intent: intent?.value, custom: custom?.checked,
        fieldsetDisabled: fieldset?.disabled, fieldsetHidden: fieldset?.hidden,
        weights: Array.from(document.querySelectorAll(selectors.weights)).slice(0, 24).map(node => ({ key: node.getAttribute('data-programme-function'), value: node.value, disabled: node.matches(':disabled') })),
        draftVisible: draft ? !draft.hidden : undefined, draftMessage: draft?.textContent,
        note: document.querySelector(selectors.note)?.textContent, effects: values(selectors.effects), applied: values(selectors.applied), warnings: values(selectors.warnings) },
      renderMetrics: { rasterPending: null, detailQueued: null, parseMs: null, transferMs: null } };
  }, PROGRAMME_UI_PROOF_SELECTORS);
  return { ...observed, programmeFunctions: programmeUiEvidence(observed.programmeFunctions) };
}
async function until(check, label, deadline) {
  while (performance.now() < deadline) { if (current?.errors.some(e => e.startsWith('BLOCKED'))) throw new Error(current.errors.at(-1)); if (await check()) return; await pause(150); }
  throw new Error(`Timed out: ${label}`);
}
async function drain() {
  if (fatalDrain) return { drained: active.size === 0, physicalRemaining: active.size, ms: 0, previousDeadlineExceeded: true };
  stopFuture = true; const start = performance.now();
  while (active.size && performance.now() - start < 60000) await pause(100);
  await Promise.allSettled([...reads]);
  if (active.size) fatalDrain = true;
  return { drained: active.size === 0, physicalRemaining: active.size, ms: Math.round(performance.now() - start) };
}
async function openPage() {
  context = await browser.newContext({ viewport: manifest.defaults?.viewport ?? { width: 1500, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.grantPermissions(['local-network-access'], { origin: benchOrigin });
  await context.addInitScript({ content: `(${probeInstall.toString()})(${createArchitectureBenchEvidence.toString()});` });
  // Preserve the loaded version during concurrent edits, recording every suppressed update.
  await context.routeWebSocket(url => url.host === new URL(bench).host, socket => { const upstream = socket.connectToServer(); upstream.onMessage(message => {
    let data; try { data = JSON.parse(String(message)); } catch { /* Pass through. */ }
    if (data?.type === 'update' || data?.type === 'full-reload') { current?.ignoredHmr.push({ atMs: elapsed(), type: data.type }); return; } socket.send(message);
  }); });
  await context.route(url => url.origin === serverOrigin || ['/urban', '/raster', '/raster/upload', '/houses/plans', '/houses/realize-plan', '/houses/realize-parent', '/houses/placement', '/houses/generate', '/houses/enrich'].includes(url.pathname), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() !== 'POST') return route.continue();
    if (comparisonGuard) {
      const attempt = { path, atMs: elapsed(), auxiliaryId: auxiliaryCurrent?.id ?? null };
      comparisonAttempts.push(attempt);
      auxiliaryCurrent?.errors.push(`Comparison attempted native work: ${path}`);
      return route.fulfill({ status: 409, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Auxiliary views must reuse retained geometry; new native work blocked."}' });
    }
    const reject = async reason => { current?.errors.push(`BLOCKED ${reason}`); await route.fulfill({ status: 409, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: reason }) }); };
    if (stopFuture) return route.fulfill({ status: 409, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Benchmark budget finished; new work stopped."}' });
    if (url.origin !== serverOrigin) return reject(`Native request escaped selected runtime: ${url.origin}`);
    if (['/houses/placement', '/houses/generate', '/houses/enrich'].includes(path)) return reject(`Legacy eager route ${path}`);
    const inspectBody = path === '/urban' || path === '/houses/realize-plan' || path === '/houses/realize-parent';
    const body = inspectBody ? request.postDataBuffer() : null;
    // Never decode binary rasters or stringify the whole partition merely to read its kind.
    const text = body?.subarray(0, 4096).toString('utf8') ?? '';
    const classification = classifyCaptureDetail(path, body?.toString('utf8')), detail = classification.detail;
    const activeUsage = detail ? captureDetailUsage([...active.values()]) : undefined;
    const usedUsage = detail ? captureDetailUsage(current.requests) : undefined;
    const decision = captureDetailBudget(classification, { activeMembers: activeUsage?.members, usedMembers: usedUsage?.members, maxMembers: detailMemberBudget });
    if (!decision.allowed) {
      if (!decision.totalExceeded) return reject(decision.reason);
      current.detailBudgetReached = true;
      return route.fulfill({ status: 429, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: decision.reason }) });
    }
    const declaredRequestBytes = Number(request.headers()['content-length']);
    const entry = { path, kind: path === '/urban' ? /"kind"\s*:\s*"([^"]+)"/.exec(text)?.[1] : undefined, detail, detailMembers: decision.members,
      startMs: elapsed(), requestBytes: body?.length ?? (declaredRequestBytes > 0 ? declaredRequestBytes : null) };
    if (['buildingSites', 'buildingSitesBegin', 'buildingSitesPage'].includes(entry.kind)) entry.sourcePayload = sourcePayloadEvidence(body);
    current.requests.push(entry); active.set(request, entry);
    current.detailPeakPhysical = Math.max(current.detailPeakPhysical, [...active.values()].filter(e => e.detail).length);
    if (detail) { current.detailMembersAttempted = usedUsage.members + decision.members;
      current.detailPeakActiveMembers = Math.max(current.detailPeakActiveMembers, activeUsage.members + decision.members); }
    if (entry.kind === 'quarters' && body) {
      // Preserve the authorized replay fixture, omitting only the runtime token.
      const fixture = JSON.parse(body.toString('utf8')); delete fixture.session;
      track(writeFile(resolve(output, `${current.id}-quarters-request.json`), JSON.stringify(fixture)));
    }
    return route.continue();
  });
  context.on('response', response => {
    const request = response.request(), entry = active.get(request); if (!entry) return;
    entry.status = response.status(); entry.headersMs = elapsed();
    if (entry.detail && entry.status >= 400) {
      const evidence = detailEvidenceByCase.get(current.id) ?? createArchitectureBenchEvidence();
      detailEvidenceByCase.set(current.id, evidence);
      track(recordDetailHttpFailure(response, evidence));
    }
    if (entry.path === '/raster') {
      // The uploader intentionally leaves its ACK body unread; Chromium may omit
      // requestfinished for this worker fetch. Native raster_upload stores the
      // terrain BEFORE serializing its finite JSON ACK (local/src/main.rs).
      // This proves upload work ended; it says nothing about detail HTTP calls.
      entry.finishedMs = entry.headersMs; entry.completionEvidence = 'raster ACK headers after native storage';
      const declared = Number(response.headers()['content-length']);
      entry.declaredResponseBytes = Number.isFinite(declared) ? declared : null;
      active.delete(request);
    }
  });
  context.on('requestfinished', request => {
    const entry = active.get(request); if (!entry) return;
    entry.finishedMs = elapsed(); active.delete(request);
    track((async () => { try { const sizes = await request.sizes(); entry.responseBytes = sizes.responseBodySize; entry.wireRequestBytes = sizes.requestBodySize; entry.requestBytes ??= sizes.requestBodySize; } catch { entry.responseBytes = null; } })());
  });
  context.on('requestfailed', request => {
    const entry = active.get(request); if (entry) entry.physicalCompletionUnknown = true;
    const path = new URL(request.url()).pathname, error = request.failure()?.errorText;
    const supersededBackground = !entry && error === 'net::ERR_ABORTED' && /\/decors\/.*\.png$/.test(path);
    current?.requestFailures.push({ path, method: request.method(), resourceType: request.resourceType(), error, trackedNative: Boolean(entry), backgroundAbortNotFatal: supersededBackground });
    if (!supersededBackground) (auxiliaryCurrent ?? current)?.errors.push(`${entry ? 'Native' : 'Browser'} request failed: ${path}: ${error}`);
    // A transport failure does not mean Rust stopped; keep the physical slot.
  });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => (auxiliaryCurrent ?? current)?.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && current?.consoleErrors.length < 30) current.consoleErrors.push(message.text()); });
}
async function applyCamera(item) {
  if (item.camera.kind === 'overview') await page.locator('#focusCity').click();
  else await page.evaluate(camera => window.magnaBenchContext.restore({ view: { cx: camera.cx, cy: camera.cy, scale: 1 / camera.mpp } }), item.camera);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}
async function expose(selector) { await page.locator(selector).evaluate(element => { for (let p = element.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; }); }
async function captureAuxiliaries(item, deadline) {
  const views = item.auxiliaryViews ?? [];
  if (!views.length) return;
  const summary = current.auxiliaryViews, auxiliaryStart = performance.now();
  const records = views.map(spec => ({ id: `${item.id}--${spec.id}`, parentId: item.id, auxiliaryId: spec.id, comparisonGroup: spec.comparisonGroup,
    renderView: spec.renderView, architecture: spec.architecture, camera: spec.camera, purpose: spec.purpose, fixtureFeatures: spec.fixtureFeatures ?? [],
    fixtureWitnessVerification: 'Baseline identifiers only; presence after regeneration is not automatically verified.',
    regressionReference: item.regressionReference, countsTowardPrimary: false, plannedImage: spec.image, image: null,
    report: `${item.id}--${spec.id}.json`, status: 'pending', captureOk: false, technicalOk: false, ok: false, visualVerdict: 'not_reviewed', errors: [],
    reuseContract: 'Same retained layouts, partitions, native compact scene and original building-site requests; no new native request.',
    sourcePrimary: `${item.id}.json`, sourceSituation: `${item.id}.situation.txt` }));
  suite.auxiliaryCaptures.push(...records);
  summary.reports = records.map(record => record.report);
  const save = async () => {
    summary.captured = records.filter(record => record.image).length;
    summary.technicalOk = records.every(record => record.technicalOk);
    summary.status = summary.technicalOk ? 'captured_review_required' : 'auxiliary_incomplete';
    summary.elapsedMs = Math.round(performance.now() - auxiliaryStart);
    for (const record of records) await writeFile(resolve(output, record.report), JSON.stringify(record, null, 2));
  };
  if (!current.technicalOk || !current.nativeEvidence?.verified || active.size) {
    for (const record of records) { record.status = 'skipped_primary_unverified'; record.errors.push('Primary native scene did not finish and verify; comparison was not attempted.'); }
    await save(); return;
  }
  if (current.parentExpected || current.parentObserved) {
    for (const record of records) { record.status = 'parent_comparison_unsupported'; record.errors.push('Applied native parent comparison is unsupported by this UI contract; no legacy comparison or regeneration attempted.'); }
    await save(); return;
  }
  const available = await page.evaluate(() => {
    const hook = window.magnaBenchContext?.comparison;
    return Boolean(hook && ['begin', 'show', 'snapshot', 'end'].every(key => typeof hook[key] === 'function'));
  }).catch(error => { summary.preflightError = String(error); return false; });
  summary.hookAvailable = available;
  if (!available) {
    for (const record of records) { record.status = 'comparison_hook_unavailable'; record.errors.push('magnaBenchContext.comparison unavailable; changing the architecture selector would regenerate the scene.'); }
    await save(); return;
  }
  let opened = false, identity, blocked = false;
  const originalView = current.ui.view, originalDocument = current.ui.probe.documentOrigin;
  const cacheState = ui => ({ count: Number(ui.frameData.detailCached ?? 0), bytes: Number(ui.frameData.detailCacheBytes ?? 0) });
  summary.detailCacheBefore = cacheState(current.ui);
  if (requireComparisonDetail && summary.detailCacheBefore.count < 1) {
    for (const record of records) { record.status = 'skipped_no_native_detail'; record.errors.push('Required native detail was not cached before comparison; smoke is inconclusive.'); }
    await save(); return;
  }
  comparisonAttempts = []; comparisonGuard = true;
  try {
    const initial = await page.evaluate(() => window.magnaBenchContext.comparison.begin()); opened = true;
    identity = initial?.identity;
    if (!initial?.active || !sameComparisonIdentity(identity, identity)) throw new Error('Comparison hook did not expose a valid active retained identity');
    summary.retainedIdentity = identity;
    for (let i = 0; i < views.length; i++) {
      const spec = views[i], record = records[i], started = performance.now();
      auxiliaryCurrent = record;
      if (blocked) { record.status = 'skipped_after_comparison_failure'; record.errors.push('A previous auxiliary failed; no retry or scene regeneration.'); continue; }
      try {
        if (performance.now() >= deadline) throw new Error('Case time budget exhausted before auxiliary capture');
        await applyCamera(spec);
        const before = await page.evaluate(() => window.magnaBenchContext.comparison.snapshot());
        if (!sameComparisonIdentity(identity, before?.identity)) throw new Error('Retained identity changed before auxiliary layer switch');
        record.identityBefore = before.identity;
        await page.evaluate(spec => window.magnaBenchContext.comparison.show({ renderView: spec.renderView, architecture: spec.architecture }), spec);
        await until(async () => {
          if (comparisonAttempts.length || record.errors.length) throw new Error('Auxiliary comparison attempted native work or reported an error');
          const observed = await page.evaluate(() => ({ comparison: window.magnaBenchContext.comparison.snapshot(),
            view: window.magnaBenchContext.capture()?.view, documentOrigin: window.__cityVisualBench.documentOrigin }));
          if (observed.documentOrigin !== originalDocument) throw new Error('Document changed during auxiliary comparison');
          if (!matchesFixedView(spec.camera, observed.view)) throw new Error('Auxiliary camera was clamped or changed; no silent recentering');
          return checkComparisonState(observed.comparison, identity, spec, before.frameSerial) && active.size === 0;
        }, `auxiliary ${spec.id} paint`, Math.min(deadline, performance.now() + detailTimeoutMs));
        record.ui = await snapshot();
        record.comparison = await page.evaluate(() => window.magnaBenchContext.comparison.snapshot());
        if (!checkComparisonState(record.comparison, identity, spec, before.frameSerial)) throw new Error('Comparison was no longer settled before screenshot');
        await page.locator('#viewport').screenshot({ path: resolve(output, spec.image), timeout: Math.min(15000, Math.max(1, deadline - performance.now())) });
        record.image = spec.image;
        const after = await page.evaluate(() => ({ comparison: window.magnaBenchContext.comparison.snapshot(), view: window.magnaBenchContext.capture()?.view,
          documentOrigin: window.__cityVisualBench.documentOrigin }));
        record.identityAfter = after.comparison?.identity;
        record.sameRetainedScene = sameComparisonIdentity(identity, record.identityAfter);
        record.cameraMatches = matchesFixedView(spec.camera, after.view);
        record.cameraApplied = after.view ? { cx: after.view.cx, cy: after.view.cy, mpp: 1 / after.view.scale } : null;
        if (!record.sameRetainedScene || !record.cameraMatches || after.documentOrigin !== originalDocument || comparisonAttempts.length
          || !checkComparisonState(after.comparison, identity, spec, before.frameSerial)) throw new Error('Comparison changed while the screenshot was captured');
        record.captureOk = true; record.technicalOk = true; record.ok = true; record.status = 'captured_auxiliary_review_required';
      } catch (error) {
        record.errors.push(String(error)); record.status = 'comparison_failed'; blocked = true;
      } finally { record.elapsedMs = Math.round(performance.now() - started); }
    }
  } catch (error) {
    for (const record of records.filter(record => record.status === 'pending')) { record.status = 'comparison_failed'; record.errors.push(String(error)); }
  } finally {
    auxiliaryCurrent = undefined;
    try {
      if (opened) {
        // Move back while the temporary comparison still disables detail demand.
        await page.evaluate(view => window.magnaBenchContext.restore({ view }), originalView);
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        const beforeEnd = await page.evaluate(() => window.magnaBenchContext.comparison.snapshot());
        if (!sameComparisonIdentity(identity, beforeEnd?.identity)) throw new Error('Retained scene changed before comparison cleanup');
        summary.detailCacheBeforeEnd = cacheState(await snapshot());
        if (requireComparisonDetail && JSON.stringify(summary.detailCacheBeforeEnd) !== JSON.stringify(summary.detailCacheBefore)) throw new Error('Native detail cache changed during comparison');
      }
    } catch (error) { summary.restoreError = String(error); }
    try { if (opened) await page.evaluate(() => window.magnaBenchContext.comparison.end()); }
    catch (error) { summary.restoreError = [summary.restoreError, String(error)].filter(Boolean).join('; '); }
    comparisonGuard = false;
    if (opened) {
      const detailCalls = current.requests.filter(r => r.detail).length;
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      summary.detailCacheAfterEnd = cacheState(await snapshot());
      summary.detailResumeNativeCalls = current.requests.filter(r => r.detail).length - detailCalls;
      summary.detailCachePreserved = JSON.stringify(summary.detailCacheAfterEnd) === JSON.stringify(summary.detailCacheBefore);
    }
    summary.nativeAttemptsBlocked = [...comparisonAttempts];
    if (summary.restoreError || comparisonAttempts.length) {
      for (const record of records) { record.technicalOk = record.ok = false; record.status = 'comparison_failed';
        record.errors.push(summary.restoreError ?? 'Native work attempted during the retained comparison session.'); }
      retained = undefined;
    }
    await save();
  }
}
try {
  for (const item of ordered) {
    const input = preparations.get(item.id), begin = performance.now();
    current = { id: item.id, title: item.title, population: item.population, culture: item.culture, artifact: item.artifact, architecture: item.architecture,
      renderView: JSON.parse(new URLSearchParams(input.intendedQuery).get('urban')).render?.view,
      expectsNativePlans: item.architecture !== 'silhouette' && JSON.parse(new URLSearchParams(input.intendedQuery).get('urban')).render?.view === 'buildings',
      architectureProof,
      parentExpected: architectureProof === 'parent' && item.architecture !== 'silhouette' && JSON.parse(new URLSearchParams(input.intendedQuery).get('urban')).render?.view === 'buildings',
      gate: item.gate ?? 'p0', camera: item.camera, expectations: item.expectations, limitations: item.limitations, declaredCapacityExceeded: input.declaredCapacityExceeded,
      auxiliaryViews: { ...input.auxiliaryViews }, regressionReference: item.regressionReference,
      exactInputIdentity: input.exactInputIdentity,
      exactInputPreparation: input.exactInputPreparation,
      measurementSchema: 2, status: 'running', ok: false, technicalOk: false, captureOk: false,
      complete: false, settled: false, visualVerdict: 'not_reviewed', requests: [], requestFailures: [], detailPeakPhysical: 0, detailPeakActiveMembers: 0, detailMembersAttempted: 0,
      errors: [], consoleErrors: [], ignoredHmr: [], startedMs: elapsed() };
    suite.cases.push(current); stopFuture = false;
    const reusable = page && retained?.fingerprint === input.fingerprint && retained?.complete;
    try {
      if (!reusable) {
        if (context) { const cleanup = await drain(); if (!cleanup.drained) throw new Error('Previous native work did not drain; stopping suite'); await context.close(); context = undefined; page = undefined; stopFuture = false; }
        await openPage(); const url = new URL(bench); url.search = input.query; url.searchParams.set('profile', 'local'); url.searchParams.set('localServer', server);
        current.navigationUrl = url.href; await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 120000) });
        const deadline = begin + timeoutMs;
        await until(() => page.evaluate(() => Boolean(window.magnaBenchContext?.ready())), 'terrain ready', deadline);
        current.terrainReadyMs = elapsed();
        await page.locator('[data-city-architecture]').waitFor({ state: 'attached' }); await expose('[data-city-architecture]');
        current.documentOrigin = await page.evaluate(() => window.__cityVisualBench.documentOrigin);
        await until(() => page.evaluate(expected => window.__cityVisualBench.stages.settlements?.entries?.some(s => s.key === 'city'
          && s.population === expected.population && s.culture === expected.culture), { population: item.population, culture: item.culture }), 'applied settlement response', deadline);
        current.settlementIdentity = settlementIdentity(input.settings.settlements.config.list[0],
          await page.evaluate(() => window.__cityVisualBench.stages.settlements?.entries));
        if (!current.settlementIdentity.matches) throw new Error(current.settlementIdentity.issues.join(' '));
        // Initial urban output can finish before roads; the road callback then invalidates it.
        // Wait for the actual native road completion and its scheduled final urban chain.
        await until(() => page.evaluate(() => document.querySelector('#roadStage')?.getAttribute('aria-busy') !== 'true'
          && /^Rust\s*·/.test(document.querySelector('#roadStatus')?.textContent ?? '')), 'native roads ready', deadline);
        current.roadsReadyMs = elapsed();
        await pause(500);
        for (const [kind, stage] of [['quarters', 'urbanQuarterStage'], ['parcels', 'urbanParcelStage']]) {
          const hasStage = async () => Boolean(await page.evaluate(kind => {
            const stages = window.__cityVisualBench.stages, after = kind === 'quarters' ? stages.roads?.atMs ?? 0 : stages.quarters?.atMs ?? 0;
            return stages[kind]?.atMs >= after;
          }, kind));
          const button = page.locator(`#${stage} [data-apply]`);
          if (!await hasStage() && await button.getAttribute('aria-busy') !== 'true') { await expose(`#${stage} [data-apply]`); await button.click(); }
          await until(async () => await hasStage() && await button.getAttribute('aria-busy') !== 'true', `${kind} completion`, deadline);
        }
        current.parcelsReadyMs = elapsed();
        await page.locator('#focusCity').click();
        // Initial camera always overview while compact planning starts. Close detail follows completion.
        await page.locator('[data-city-architecture]').selectOption(item.camera.kind === 'overview' ? item.architecture : item.architecture === 'silhouette' ? 'silhouette' : 'compact');
        await page.evaluate(() => { window.__cityVisualBench.generationStarted = performance.now(); });
        const beforeGeneration = parentCaptureReceipt(await snapshot());
        current.previousParentKey = beforeGeneration.ready ? beforeGeneration.generationKey : undefined;
        current.generationClickMs = elapsed(); await expose('[data-buildings-generate]'); await page.locator('[data-buildings-generate]').click();
        // Labels may say "plans de bâtiments" or "silhouettes": completion is
        // protocol/data-attribute based, never parsed from translated UI text.
        await until(async () => {
          const s = await snapshot(); current.parentObserved ||= s.frameData.parentEvidence !== undefined;
          const completion = captureGenerationCompletion(s, { parentExpected: current.parentExpected || current.parentObserved, previousParentKey: current.previousParentKey });
          if (completion.parent) { current.parentIncompleteReason = completion.receipt.reason;
            if (completion.complete) current.parentGenerationKey = completion.receipt.generationKey; }
          return completion.complete;
        }, 'complete building plan with requested source contract', deadline);
        current.complete = true; current.plansCompleteMs = elapsed(); retained = { fingerprint: input.fingerprint, complete: true, id: item.id, documentOrigin: current.documentOrigin, settlementIdentity: current.settlementIdentity };
      } else { current.complete = true; current.reusedFrom = retained.id; current.documentOrigin = retained.documentOrigin; current.generationClickMs = null; current.settlementIdentity = structuredClone(retained.settlementIdentity);
        current.parentGenerationKey = retained.parentGenerationKey; current.parentObserved = retained.parentObserved; }
      await applyCamera(item);
      await page.locator('[data-city-architecture]').selectOption(item.architecture);
      const quietDeadline = Math.min(begin + timeoutMs, performance.now() + detailTimeoutMs);
      const visualBarrier = createCaptureSettlingBarrier({ architecture: item.architecture,
        nativePlansExpected: current.expectsNativePlans && current.complete, renderView: current.renderView,
        parentExpected: current.parentExpected || current.parentObserved, previousParentKey: current.previousParentKey, expectedParentKey: current.parentGenerationKey });
      await until(async () => {
        const s = await snapshot();
        if (Number(s.frameData.detailCached ?? 0) > 64 || Number(s.frameData.detailCacheBytes ?? 0) > 16 * 1024 * 1024) throw new Error('Detail cache exceeded documented bounds');
        current.visualSettling = visualBarrier.observe(s, active.size);
        return current.visualSettling.settled;
      }, 'visible detail/render settling', quietDeadline);
      current.ui = await snapshot();
      current.visualSettling = visualBarrier.observe(current.ui, active.size);
      if (!current.visualSettling.settled) throw new Error(`Final render changed after settling: ${current.visualSettling.reason ?? 'identity, generation, viewport or active work changed'}`);
      if (current.documentOrigin !== undefined && current.documentOrigin !== current.ui.probe.documentOrigin) throw new Error('Page reloaded during the measured generation');
      current.settled = true;
      if (current.ui.probe.errors.length) current.errors.push(...current.ui.probe.errors);
    } catch (error) { stopFuture = true; current.errors.push(error.stack ?? String(error)); current.status = 'incomplete'; current.ok = false; retained = undefined; }
    // Exactly one primary image, including incomplete states, when a page exists.
    if (page) {
      try {
        current.ui ??= await snapshot(); current.image = `${item.id}.png`;
        await page.locator('#viewport').screenshot({ path: resolve(output, current.image), timeout: 15000 });
        if (current.settled && current.visualSettling?.required) {
          const after = await snapshot(), readiness = assessCaptureReadiness(after, item.architecture, current.visualSettling,
            { nativePlansExpected: current.expectsNativePlans && current.complete, renderView: current.renderView,
              parentExpected: current.parentExpected || current.parentObserved, previousParentKey: current.previousParentKey, expectedParentKey: current.parentGenerationKey });
          current.viewportAfterCapture = readiness.visual;
          if (!readiness.visualComplete || active.size !== 0 || Number(after.frameData.detailInFlight ?? 0) !== 0) {
            current.settled = false; current.errors.push('Cold source, generation, camera or active work changed during the single primary screenshot.'); retained = undefined;
          }
        }
      }
      catch (error) { current.errors.push(`Capture: ${String(error)}`); current.image = null; current.ok = false; }
    }
    current.nativeEvidence = current.parentExpected || current.parentObserved
      ? { ...parentCaptureReceipt(current.ui, { previousParentKey: current.previousParentKey, expectedParentKey: current.parentGenerationKey }),
        verified: current.complete && parentCaptureReceipt(current.ui, { previousParentKey: current.previousParentKey, expectedParentKey: current.parentGenerationKey }).ready,
        source: 'committed parent DOM consumer attestation; no legacy /houses/plans receipt substitution' }
      : current.reusedFrom ? { ...retained?.nativeEvidence, inheritedFrom: current.reusedFrom }
      : { verified: current.requests.some(r => r.path === '/houses/plans' && r.status >= 200 && r.status < 300 && r.finishedMs !== undefined && r.startMs >= current.generationClickMs),
        source: 'completed /houses/plans HTTP response during this generation', generatorVersions: Object.keys(current.ui?.probe?.generatorVersions ?? {}) };
    if (current.nativeEvidence.generatorVersions?.includes('silhouette')) current.nativeEvidence.verified = false;
    if (retained && !current.reusedFrom) { retained.nativeEvidence = current.nativeEvidence;
      retained.parentGenerationKey = current.parentGenerationKey; retained.parentObserved = current.parentObserved; }
    const query = replayQuery(input, item, current.complete);
    const situation = codeFor(query, item, current.ui?.view);
    current.replay = { configSource: 'validated manifest/decor inputs with explicit final architecture and generated flag', querySha256: createHash('sha256').update(query.toString()).digest('hex'),
      cameraSource: current.ui?.view ? 'actual captured UI view' : 'unavailable', nativeGeometryArchived: false,
      intendedArchitecture: item.architecture, observedArchitecture: current.ui?.architecture ?? null,
      note: 'MU1 regenerates from the same seeds and artifact; exact geometry requires the same generator version and compatible UI.' };
    current.situation = `${item.id}.situation.txt`; current.elapsedMs = Math.round(performance.now() - begin);
    const probe = current.ui?.probe;
    current.timings = {
      firstBatchFromGenerationMs: probe?.firstBatch && probe.generationStarted !== null ? probe.firstBatch.atMs - probe.generationStarted : null,
      firstPaintFromGenerationMs: probe?.firstVisible && probe.generationStarted !== null ? probe.firstVisible.atMs - probe.generationStarted : null,
      completeFromGenerationMs: probe?.final && probe.generationStarted !== null ? probe.final.atMs - probe.generationStarted : null,
      inheritedFromPairedScene: Boolean(current.reusedFrom),
    };
    current.capacity = { certifiedOccupied: null, note: 'Compact plans and displayed programme values do not certify actual occupancy.' };
    await writeFile(resolve(output, current.situation), `${situation}\n`);
    current.cleanup = current.complete && current.settled && !current.errors.length ? { retainedForPair: true } : await drain();
    await Promise.allSettled([...reads]);
    current.detailRefusals = { ...(detailEvidenceByCase.get(current.id) ?? createArchitectureBenchEvidence()).snapshot().detailRefusals,
      scope: 'HTTP failures of existing exterior requests during this case; separate from plan refusals. Successful meshes are not read again; client validation failures are not classified here.' };
    if (current.requests.some(r => r.status >= 400)) current.errors.push('Native HTTP failure; inspect per-route records.');
    if (current.detailBudgetReached) current.errors.push('Detail request budget exhausted; requested detail completion is unverified.');
    if (current.cleanup.drained === false) current.errors.push('Native work did not drain; physical completion remains unknown.');
    Object.assign(current, assessCapture(current));
    await captureAuxiliaries(item, begin + timeoutMs);
    if (current.cleanup.retainedForPair && !retained) current.cleanup = { retainedForPair: false, reason: 'Auxiliary comparison could not preserve the retained scene.' };
    Object.assign(current, assessCapture(current));
    current.networkEvidence = networkEvidence(current);
    await writeFile(resolve(output, `${item.id}.json`), JSON.stringify(current, null, 2));
    await saveReports(); console.log(JSON.stringify({ id: item.id, status: current.status, complete: current.complete, reusedFrom: current.reusedFrom, ms: current.elapsedMs, requests: current.requests.length, image: current.image }));
    if (fatalDrain) break;
  }
} finally {
  const cleanup = await drain(); suite.cleanup = cleanup;
  if (!cleanup.drained && current) {
    current.errors.push('Final native drain failed; physical completion remains unknown.');
    Object.assign(current, assessCapture(current));
    await writeFile(resolve(output, `${current.id}.json`), JSON.stringify(current, null, 2));
  }
  await context?.close(); await browser.close(); suite.finished = new Date().toISOString();
  await saveReports();
}
if (fatalDrain || suite.cases.some(item => !item.ok) || suite.auxiliaryCaptures.some(item => !item.ok)) process.exitCode = 1;
