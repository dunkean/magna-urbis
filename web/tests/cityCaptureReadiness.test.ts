import { expect, it } from 'vitest';
import singleParentGuest from './fixtures/native-parent-single-guest-plan.json';
import assemblyParentGuest from './fixtures/native-parent-assembly-guest-plan.json';
// @ts-expect-error Pure JavaScript capture policy, no browser or native dependency.
import { observedBuildingCount, coldCaptureReadiness, createCaptureSettlingBarrier, assessCaptureReadiness, readParentCaptureEvidence, parentCaptureReceipt, parentCaptureReadiness, captureGenerationCompletion, classifyCaptureDetail, captureDetailUsage, captureDetailBudget } from '../scripts/city_capture_readiness.mjs';

/** Scalar evidence fixtures only, never PlacedBuilding or native admission. */
function sample(now = 0) {
  return { now, architecture: 'compact', renderView: 'buildings', busy: false, countsData: { planning: 'false' },
    frameData: { buildingsPainted: '2', detailInFlight: '0', coldCoverage: 'exact', coldTotal: '10000' },
    view: { cx: 150, cy: 225, scale: 10 }, viewBox: '100 200 100 50', canvas: { width: 1000, height: 500 },
    appearance: { style: 'cartographic', diagnostic: 'none' }, backgroundStyle: 'render', probe: { lastChange: now }, coldViewportHook: true,
    coldViewport: { version: 'cold-city-viewport-evidence-1', active: true, sceneId: 'source-1', parentFingerprint: 'native-fingerprint', derivedFingerprint: 'derived-fingerprint',
      totals: { buildings: 10000, refusals: 50, openSpaces: 4 }, offset: { x: 0, y: 0 }, generation: 1,
      currentViewport: [100, 200, 200, 250], drawViewport: [100, 200, 200, 250], worldToCanvas: [10, 0, 0, 10, -1000, -2000],
      requesting: false, pending: false, truncated: false, coverage: 'exact', overviewStatus: 'rebuilding', cacheStatus: 'pending', overviewFingerprint: '',
      residentRecords: 2, resident: [{ id: 'actual-id-1' }, { id: 'actual-id-2' }],
      overview: { bounds: [0, 0, 1000, 1000], pixels: 512, painter: 'native-contours-v1', appearance: { style: 'cartographic', diagnostic: 'none' }, painted: true } } };
}
function coarse(now = 0) {
  const s = sample(now); s.frameData.buildingsPainted = 'unknown'; s.frameData.coldCoverage = 'complete-native-contours';
  Object.assign(s.coldViewport, { coverage: 'complete-native-contours', truncated: true, overviewStatus: 'ready', cacheStatus: 'hit', overviewFingerprint: 'overview-key' }); return s;
}

it('normalizes unknown and malformed counts explicitly, preserving real local zero without inventing a global number', () => {
  for (const value of [undefined, null, 'unknown', '', ' ', NaN, Infinity, '-1', -1, '1e3', '2.5', {}, []]) expect(observedBuildingCount(value)).toBeNull();
  expect(observedBuildingCount('0')).toBe(0); expect(observedBuildingCount('23')).toBe(23);
  const report = assessCaptureReadiness(coarse(), 'compact', undefined);
  expect(report.paintedInCamera).toBeNull(); expect(report.warnings).toContainEqual(expect.stringContaining('not zero or the global manifest total'));
  expect(report.visual.globalTotals.buildings).toBe(10000); expect(report.visual.residentRecords).toBe(2);
});

it('settles an exact local view while global overview progress continues, without borrowing global completeness', () => {
  const gate = createCaptureSettlingBarrier({ architecture: 'compact' });
  expect(gate.observe(sample(0), 0).settled).toBe(false);
  const second = sample(450); second.coldViewport.overviewStatus = 'checking'; expect(gate.observe(second, 0).settled).toBe(false);
  const final = sample(900), proof = gate.observe(final, 0), report = assessCaptureReadiness(final, 'compact', proof);
  expect(proof.settled).toBe(true); expect(report.visualComplete).toBe(true);
  expect(report.visual).toMatchObject({ mode: 'exact-local', globalOverviewFrame: false, exactPicking: true });
  expect(report.warnings).toContainEqual(expect.stringContaining('global overview may still be rebuilding'));
});

it('allows a ready complete coarse frame with a truncated local prefix, never exact picking or a no-house conclusion', () => {
  const gate = createCaptureSettlingBarrier({ architecture: 'compact' }); gate.observe(coarse(), 0);
  const final = coarse(900), report = assessCaptureReadiness(final, 'compact', gate.observe(final, 0));
  expect(report.visualComplete).toBe(true); expect(report.paintedInCamera).toBeNull();
  expect(report.visual).toMatchObject({ mode: 'global-overview', truncated: true, exactPicking: false, globalOverviewFrame: true });
  expect(report.warnings).toContainEqual(expect.stringContaining('no exact or no-house picking conclusion'));
});

it('rejects requesting, partial, pending, truncated or inactive local evidence even with no HTTP activity', () => {
  for (const change of [{ requesting: true }, { pending: true }, { coverage: 'partial-native-contours' }, { coverage: 'pending' }, { truncated: true }, { active: false }]) {
    const s = sample(2000); Object.assign(s.coldViewport, change); s.frameData.coldCoverage = s.coldViewport.coverage;
    const gate = createCaptureSettlingBarrier({ architecture: 'compact' }); expect(gate.observe(s, 0).settled).toBe(false);
    expect(assessCaptureReadiness(s, 'compact', { settled: true }).visualComplete).toBe(false);
  }
});

it('requires overview readiness, fingerprint, cache, matching style/background and an actually observed world frame', () => {
  const changes = [
    (s: ReturnType<typeof coarse>) => { s.coldViewport.overviewStatus = 'rebuilding'; },
    (s: ReturnType<typeof coarse>) => { s.coldViewport.overviewFingerprint = ''; },
    (s: ReturnType<typeof coarse>) => { s.coldViewport.cacheStatus = 'pending'; },
    (s: ReturnType<typeof coarse>) => { s.coldViewport.overview.appearance.style = 'silhouette'; },
    (s: ReturnType<typeof coarse>) => { s.coldViewport.overview.painted = false; },
    (s: ReturnType<typeof coarse>) => { s.coldViewport.worldToCanvas = []; },
    (s: ReturnType<typeof coarse>) => { s.coldViewport.worldToCanvas[4] += 20; },
    (s: ReturnType<typeof coarse>) => { s.coldViewport.drawViewport = [200, 200, 300, 250]; },
  ];
  for (const mutate of changes) { const s = coarse(); mutate(s); expect(coldCaptureReadiness(s, 'compact').ready).toBe(false); }
});

it('refuses stale camera bounds while accepting a complete exact query larger than the current draw rectangle', () => {
  const s = sample(); s.coldViewport.currentViewport = [0, 0, 10, 10]; expect(coldCaptureReadiness(s, 'compact').ready).toBe(false);
  s.coldViewport.currentViewport = [50, 150, 250, 300]; expect(coldCaptureReadiness(s, 'compact').ready).toBe(true);
  s.viewBox = '200 200 100 50'; expect(coldCaptureReadiness(s, 'compact').ready).toBe(false);
});

it('restarts the quiet interval on generation, source identity or camera changes, and rejects a stale settled proof', () => {
  for (const field of ['generation', 'sceneId', 'parentFingerprint', 'derivedFingerprint'] as const) {
    const gate = createCaptureSettlingBarrier({ architecture: 'compact' }); gate.observe(sample(), 0);
    const changed = sample(450); Object.assign(changed.coldViewport, { [field]: field === 'generation' ? 2 : `new-${field}` });
    expect(gate.observe(changed, 0).settled).toBe(false); changed.now = 900; expect(gate.observe(changed, 0).settled).toBe(false);
    changed.now = 1350; const proof = gate.observe(changed, 0); expect(proof.settled).toBe(true);
    const stale = structuredClone(changed); stale.coldViewport.generation++;
    expect(assessCaptureReadiness(stale, 'compact', proof).visualComplete).toBe(false);
  }
});

it('resets a cold candidate when HTTP, native detail, busy or native receipt work resumes', () => {
  for (const mode of ['http', 'detail', 'busy', 'receipt'] as const) {
    const gate = createCaptureSettlingBarrier({ architecture: 'detailed' }); gate.observe(sample(), 0);
    const work = sample(900); if (mode === 'detail') work.frameData.detailInFlight = '1'; if (mode === 'busy') work.busy = true;
    if (mode === 'receipt') work.countsData.planning = 'true';
    expect(gate.observe(work, mode === 'http' ? 1 : 0).settled).toBe(false);
    expect(gate.observe(sample(1000), 0).settled).toBe(false); expect(gate.observe(sample(1900), 0).settled).toBe(true);
  }
});

it('keeps a blocked B4 opening or repair without a viewport explicitly incomplete instead of falling back to legacy', () => {
  const s = { ...sample(5000), coldViewport: undefined }; s.probe.lastChange = 0;
  expect(coldCaptureReadiness(s, 'compact')).toMatchObject({ required: true, ready: false, reason: expect.stringContaining('repair') });
  expect(createCaptureSettlingBarrier({ architecture: 'compact' }).observe(s, 0).settled).toBe(false);
  expect(coldCaptureReadiness({ ...s, coldViewportHook: false }, 'silhouette').mode).toBe('legacy');
});

it('preserves genuine legacy and silhouette settling without inventing B4 proof on old pages', () => {
  const s = { now: 1000, probe: { lastChange: 0 }, frameData: { detailInFlight: '0', buildingsPainted: '0' }, countsData: { planning: 'false' }, coldViewportHook: false };
  expect(createCaptureSettlingBarrier({ architecture: 'compact' }).observe(s, 0).settled).toBe(true);
  expect(coldCaptureReadiness({ ...s, coldViewportHook: true }, 'silhouette').mode).toBe('legacy');
  expect(assessCaptureReadiness(s, 'compact', undefined).paintedInCamera).toBe(0);
});

it('never turns missing or inconsistent typed B4 fields into zero/default-certified evidence', () => {
  for (const change of [{ version: 'future' }, { generation: -1 }, { totals: undefined }, { parentFingerprint: '' }, { residentRecords: 3 }]) {
    const s = sample(); Object.assign(s.coldViewport, change); expect(coldCaptureReadiness(s, 'compact').ready).toBe(false);
  }
  const s = sample(); s.frameData.coldTotal = '2'; expect(coldCaptureReadiness(s, 'compact').ready).toBe(false);
});

it('does not require a viewport merely because the universal hook exists on non-cold or parcel/role pages', () => {
  const s = { now: 2000, probe: { lastChange: 0 }, frameData: { detailInFlight: '0' }, countsData: { planning: 'false' },
    coldViewportHook: true, renderView: 'parcels' };
  for (const renderView of ['parcels', 'roles', 'tissue', 'uses']) {
    const ui = { ...s, renderView };
    expect(coldCaptureReadiness(ui, 'compact', { nativePlansExpected: true, renderView }).mode).toBe('legacy');
    expect(createCaptureSettlingBarrier({ architecture: 'compact', nativePlansExpected: true, renderView }).observe(ui, 0).settled).toBe(true);
  }
  // Native architecture selector alone does not prove a native plan was requested.
  expect(coldCaptureReadiness({ ...s, renderView: 'buildings' }, 'compact').mode).toBe('legacy');
  expect(coldCaptureReadiness({ ...s, renderView: 'buildings' }, 'silhouette', { nativePlansExpected: false }).mode).toBe('legacy');
  expect(coldCaptureReadiness({ ...s, renderView: 'roles' }, 'compact', { nativePlansExpected: true, renderView: 'buildings' }).ready).toBe(false);
});

it('rejects a missing viewport on an expected native-building frame even without a previous cold DOM marker', () => {
  const s = { now: 2000, probe: { lastChange: 0 }, frameData: { detailInFlight: '0' }, countsData: { planning: 'false' },
    coldViewportHook: true, renderView: 'buildings' };
  const intent = { nativePlansExpected: true, renderView: 'buildings' };
  expect(coldCaptureReadiness(s, 'compact', intent)).toMatchObject({ required: true, ready: false, reason: expect.stringContaining('repair') });
  expect(createCaptureSettlingBarrier({ architecture: 'compact', ...intent }).observe(s, 0).settled).toBe(false);
  expect(assessCaptureReadiness(s, 'compact', { settled: true }, intent).visualComplete).toBe(false);
});

/** B4 DOM scalar sentinels only, NOT native geometry/admission or a UI recipe. */
function parentSample(now = 0) {
  const e = { version: 'parent-city-viewport-evidence-1', phase: 'committed', active: true, mode: 'parent-session', binding: 'generated',
    sceneId: 'parent-scene-1', sourceFingerprint: 'a'.repeat(64), manifestFingerprint: 'b'.repeat(64), sourceRevision: 'revision-1',
    nativeSession: 'incarnation-1/run-1', generator: 'actual-generator', nativeGenerator: 'actual-generator', partition: 'prefix64-input24MiB-std-v1',
    complete: true, counts: { requests: 4, admitted_parents: 2, single_parents: 1, assembly_parents: 1, physical_members: 3, refusals: 1, open_spaces: 1 },
    nativePrefix: { parents: 2, members: 3 }, viewport: [100, 200, 200, 250], worldToCanvas: [10, 0, 0, 10, -1000, -2000],
    pending: false, coverage: 'exact', residentMembers: 2, residentContexts: 1, capacity: 'unknown', pick: null,
    commit: { state: 'committed', sourceValidation: 'committed-manifest-and-reference', totalRequests: 4, durableRequests: 4,
      sourceChunks: 1, logicalBatches: 1, nativeAckedBatches: 1, durableFrontiersComplete: true },
    nativeRelease: { recordedStatus: 'completed-and-released', sessionId: 'incarnation-1/run-1', originBinding: 'generated', evidenceScope: 'recorded-completed-summary-not-live-session-probe' },
    draw: { serial: 1, sceneId: 'parent-scene-1', sourceFingerprint: 'a'.repeat(64), manifestFingerprint: 'b'.repeat(64), sourceRevision: 'revision-1',
      nativeSession: 'incarnation-1/run-1', viewport: [100, 200, 200, 250], worldToCanvas: [10, 0, 0, 10, -1000, -2000],
      appearance: { style: 'cartographic', diagnostic: 'none' }, painted: false, detailed: false },
    overview: { status: 'rebuilding', ready: false, currentStyle: false, sourceFingerprint: null, manifestFingerprint: null,
      appearance: null, painted: null, background: 'transparent-native-overlay', bounds: null, pixels: null } };
  return { now, architecture: 'compact', renderView: 'buildings', busy: false, countsData: { planning: 'false' },
    frameData: { parentEvidence: JSON.stringify(e), detailInFlight: '0', detailCached: '64', buildingsPainted: '2' },
    viewBox: '100 200 100 50', canvas: { width: 1000, height: 500 }, probe: { final: null as unknown, lastChange: 0, accepted: 99999 },
    appearance: { style: 'cartographic', diagnostic: 'none' }, backgroundStyle: 'render' };
}
type ParentSample = ReturnType<typeof parentSample>;
function changeParent(s: ParentSample, change: Record<string, unknown>) {
  s.frameData.parentEvidence = JSON.stringify({ ...readParentCaptureEvidence(s), ...change }); return s;
}
const parentIntent = { parentExpected: true, renderView: 'buildings' };

it('never certifies an expected parent from absent/malformed DOM or old Single completion and cache evidence', () => {
  for (const marker of [undefined, '', '{', 'null', '[]', 'x'.repeat(128 * 1024 + 1)]) {
    const s = parentSample(5000); s.frameData.parentEvidence = marker as string; s.probe.final = { oldSingle: true };
    expect(captureGenerationCompletion(s, parentIntent).complete).toBe(false);
    expect(coldCaptureReadiness(s, 'compact', parentIntent).ready).toBe(false);
  }
});

it('accepts committed parent metadata on fallback without an HTTP or legacy Worker final, with distinct parent/member counts', () => {
  const s = parentSample(), completion = captureGenerationCompletion(s, parentIntent);
  expect(completion.complete).toBe(true); expect(completion.receipt.counts.admitted_parents).toBe(2);
  expect(completion.receipt.counts.physical_members).toBe(3); expect(completion.receipt.counts.requests).toBe(4);
  expect(completion.receipt.counts.capacityPersons).toBeUndefined(); expect(s.probe.accepted).toBe(99999);
});

it('keeps staging/loading/incomplete/imported/unknown parent state separate from a new committed native generation', () => {
  for (const change of [{ phase: 'staging' }, { phase: 'loading' }, { complete: false }, { binding: 'imported' },
    { mode: 'parent-archives' }, { capacity: 'certified' }, { sourceRevision: '' }, { nativeSession: '' }, { nativeGenerator: 'other' }, { partition: 'other' }]) {
    const s = changeParent(parentSample(), change); s.probe.final = true;
    expect(captureGenerationCompletion(s, parentIntent).complete).toBe(false);
  }
});

it('rejects bad parent/member accounting and native prefix instead of borrowing Single/visible counts', () => {
  const original = readParentCaptureEvidence(parentSample());
  for (const counts of [{ ...original.counts, requests: 5 }, { ...original.counts, admitted_parents: 3 },
    { ...original.counts, physical_members: 2 }, { ...original.counts, refusals: '1' }, { ...original.counts, single_parents: -1 }]) {
    expect(parentCaptureReceipt(changeParent(parentSample(), { counts })).ready).toBe(false);
  }
  expect(parentCaptureReceipt(changeParent(parentSample(), { nativePrefix: { parents: 2, members: 99999 } })).ready).toBe(false);
});

it('treats administrative zero as zero requests and no invented native parent or prefix', () => {
  const counts = { requests: 0, admitted_parents: 0, single_parents: 0, assembly_parents: 0, physical_members: 0, refusals: 0, open_spaces: 0 };
  const s = changeParent(parentSample(), { counts, nativePrefix: null, residentMembers: 0, residentContexts: 0,
    commit: { state: 'committed', sourceValidation: 'committed-manifest-and-reference', totalRequests: 0, durableRequests: 0,
      sourceChunks: 1, logicalBatches: 1, nativeAckedBatches: 0, durableFrontiersComplete: true } });
  expect(parentCaptureReceipt(s).ready).toBe(true); expect(parentCaptureReadiness(s, 'compact', parentIntent).ready).toBe(true);
  expect(parentCaptureReceipt(changeParent(s, { nativePrefix: { parents: 0, members: 0 } })).ready).toBe(false);
});

it('binds completion to a new immutable generation tuple and rejects late source/revision/manifest/session callbacks', () => {
  const key = parentCaptureReceipt(parentSample()).generationKey;
  expect(parentCaptureReceipt(parentSample(), { previousParentKey: key }).ready).toBe(false);
  for (const change of [{ sceneId: 'other' }, { sourceFingerprint: 'c'.repeat(64) }, { manifestFingerprint: 'd'.repeat(64) },
    { sourceRevision: 'revision-2' }, { nativeSession: 'incarnation-2/run-2' }]) {
    expect(parentCaptureReceipt(changeParent(parentSample(), change), { expectedParentKey: key }).ready).toBe(false);
  }
});

it('requires exact local last-draw viewport and matrix, never coarse/partial/requesting source evidence', () => {
  const s = parentSample(); expect(parentCaptureReadiness(s, 'compact', parentIntent).ready).toBe(true);
  for (const change of [{ pending: true }, { coverage: 'partial' }, { coverage: 'complete-native-contours' },
    { viewport: [0, 0, 10, 10] }, { worldToCanvas: undefined }, { worldToCanvas: [10, 0, 0, 10, -998, -2000] }, { residentMembers: 99 }]) {
    expect(parentCaptureReadiness(changeParent(parentSample(), change), 'compact', parentIntent).ready).toBe(false);
  }
  // Actual one-pixel matrix tolerance: move further than the host rounding bound.
  expect(parentCaptureReadiness(changeParent(parentSample(), { worldToCanvas: [10, 0, 0, 10, -990, -2000] }), 'compact', parentIntent).ready).toBe(false);
});

it('settles parent exact frames independently of global work, but restarts on a source change and refuses a stale proof', () => {
  const gate = createCaptureSettlingBarrier({ architecture: 'compact', ...parentIntent });
  expect(gate.observe(parentSample(), 0).settled).toBe(false);
  const final = parentSample(900), proof = gate.observe(final, 0);
  expect(proof.settled).toBe(true); expect(assessCaptureReadiness(final, 'compact', proof, parentIntent).visualComplete).toBe(true);
  const next = changeParent(parentSample(1000), { nativeSession: 'new-incarnation' });
  expect(gate.observe(next, 0).settled).toBe(false);
  expect(assessCaptureReadiness(next, 'compact', proof, parentIntent).visualComplete).toBe(false);
});

it('does not certify parent native exterior detail through old Single cache counters', () => {
  const s = parentSample();
  expect(parentCaptureReadiness(s, 'detailed', parentIntent)).toMatchObject({ ready: false, reason: expect.stringContaining('detail completion') });
  const coarse = changeParent(s, { coverage: 'complete-native-contours' }); coarse.frameData.buildingsPainted = '0';
  expect(assessCaptureReadiness(coarse, 'compact', undefined, parentIntent).paintedInCamera).toBeNull();
});

it('preserves explicitly qualified legacy completion while a parent marker cannot downgrade via the legacy final', () => {
  const legacy = { now: 5000, renderView: 'buildings', frameData: {}, countsData: { planning: 'false' }, probe: { final: true, lastChange: 0 } };
  expect(captureGenerationCompletion(legacy).complete).toBe(true);
  expect(captureGenerationCompletion(legacy, parentIntent).complete).toBe(false);
  const staging = changeParent(parentSample(), { phase: 'staging' }); staging.probe.final = true;
  expect(captureGenerationCompletion(staging).complete).toBe(false);
  for (const renderView of ['parcels', 'roles', 'tissue', 'uses']) {
    expect(parentCaptureReadiness({ ...legacy, renderView }, 'compact', { ...parentIntent, renderView }).required).toBe(false);
  }
});

/** Actual B5 field names; pure evidence sentinels, not native fixtures. */
function parentDetailSample(now = 0) {
  const s = parentSample(now), e = readParentCaptureEvidence(s);
  return changeParent(s, { draw: { ...e.draw, detailed: true }, detail: { scope: 'current-draw', enabled: true,
    eligible: 2, visibleEligible: 2, ready: 2, pending: 0, failed: 0, idle: 0, sourceFingerprint: e.sourceFingerprint,
    manifestFingerprint: e.manifestFingerprint, viewport: e.viewport, coverage: 'exact' } });
}
function parentOverviewSample(now = 0) {
  const s = parentSample(now), e = readParentCaptureEvidence(s);
  return changeParent(s, { coverage: 'complete-native-contours', pending: true,
    overview: { status: 'ready', ready: true, currentStyle: true, sourceFingerprint: e.sourceFingerprint, manifestFingerprint: e.manifestFingerprint,
      appearance: e.draw.appearance, painted: e.draw.painted, background: 'transparent-native-overlay', bounds: [0, 0, 1000, 1000], pixels: 2048 } });
}

it('B5 rejects inactive/prepaint/disposed sources and missing durable frontiers or recorded native release', () => {
  const e = readParentCaptureEvidence(parentSample());
  for (const change of [{ active: false }, { phase: 'not-painted' }, { commit: undefined },
    { commit: { ...e.commit, durableRequests: 3 } }, { commit: { ...e.commit, durableFrontiersComplete: false } },
    { commit: { ...e.commit, nativeAckedBatches: 0 } }, { commit: { ...e.commit, sourceChunks: 0 } },
    { nativeRelease: null }, { nativeRelease: { ...e.nativeRelease, recordedStatus: 'draining' } },
    { nativeRelease: { ...e.nativeRelease, sessionId: 'old' } }, { nativeRelease: { ...e.nativeRelease, originBinding: 'imported' } }]) {
    expect(parentCaptureReceipt(changeParent(parentSample(), change)).ready).toBe(false);
  }
});

it('B5 requires last actual draw source/frame/style and resets on selected identity, while identical repaint serials can settle', () => {
  const e = readParentCaptureEvidence(parentSample());
  for (const change of [{ serial: 0 }, { sourceRevision: 'old' }, { manifestFingerprint: 'c'.repeat(64) },
    { viewport: [1, 2, 3, 4] }, { appearance: { style: 'silhouette', diagnostic: 'none' } }]) {
    expect(parentCaptureReadiness(changeParent(parentSample(), { draw: { ...e.draw, ...change } }), 'compact', parentIntent).ready).toBe(false);
  }
  const gate = createCaptureSettlingBarrier({ architecture: 'compact', ...parentIntent }); gate.observe(parentSample(), 0);
  const next = changeParent(parentSample(900), { draw: { ...e.draw, serial: 44 } }), proof = gate.observe(next, 0);
  expect(proof.settled).toBe(true);
  const selected = changeParent(parentSample(1000), { pick: { kind: 'context', parent_id: 'p1', context_key: 'branch:0', context_kind: 'branch' } });
  expect(assessCaptureReadiness(selected, 'compact', proof, parentIntent).visualComplete).toBe(false);
});

it('B5 accepts complete source/style-bound transparent overview LOD while local IO is pending, with no exact/detail claim', () => {
  const s = parentOverviewSample(), gate = createCaptureSettlingBarrier({ architecture: 'compact', ...parentIntent });
  expect(gate.observe(s, 0).settled).toBe(false);
  const final = parentOverviewSample(900), proof = gate.observe(final, 0), report = assessCaptureReadiness(final, 'compact', proof, parentIntent);
  expect(report.visualComplete).toBe(true); expect(report.paintedInCamera).toBeNull();
  expect(report.visual).toMatchObject({ mode: 'parent-global-overview', exactPicking: false, globalOverviewFrame: true, nativeExteriorDemonstrated: false });
  expect(report.warnings).toContainEqual(expect.stringContaining('external terrain background'));
  // The raster is transparent: external terrain style is not a baked raster identity.
  expect(parentCaptureReadiness({ ...s, backgroundStyle: 'parchment' }, 'compact', parentIntent).ready).toBe(true);
});

it('B5 refuses rebuilding/stale-style/stale-source/unsupported-background overview, instead of certifying a local prefix', () => {
  const e = readParentCaptureEvidence(parentOverviewSample());
  for (const change of [{ ready: false }, { status: 'rebuilding' }, { currentStyle: false }, { sourceFingerprint: 'c'.repeat(64) },
    { manifestFingerprint: 'd'.repeat(64) }, { painted: !e.draw.painted }, { appearance: { style: 'painted', diagnostic: 'none' } },
    { background: 'terrain-baked' }, { bounds: null }, { pixels: 0 }]) {
    expect(parentCaptureReadiness(changeParent(parentOverviewSample(), { overview: { ...e.overview, ...change } }), 'compact', parentIntent).ready).toBe(false);
  }
});

it('B5 certifies real current-draw eligible exterior readiness and rejects pending/failure/idle or another viewport cache', () => {
  const s = parentDetailSample(), e = readParentCaptureEvidence(s);
  expect(parentCaptureReadiness(s, 'detailed', parentIntent)).toMatchObject({ ready: true, nativeExteriorDemonstrated: true, detailVisibleEligible: 2 });
  for (const change of [{ enabled: false }, { scope: 'global-cache' }, { ready: 1, pending: 1 }, { ready: 1, failed: 1 },
    { ready: 1, idle: 1 }, { sourceFingerprint: 'c'.repeat(64) }, { viewport: [0, 0, 10, 10] }, { visibleEligible: 17 }, { ready: 99999 }]) {
    const changed = changeParent(parentDetailSample(), { detail: { ...e.detail, ...change } });
    expect(parentCaptureReadiness(changed, 'detailed', parentIntent).ready).toBe(false);
  }
});

it('B5 permits zero-eligible or coarse Detailed mode only as scale-qualified LOD, never a visible native exterior claim', () => {
  const s = parentDetailSample(), e = readParentCaptureEvidence(s);
  const empty = { ...e.detail, eligible: 0, visibleEligible: 0, ready: 0 };
  expect(parentCaptureReadiness(changeParent(s, { detail: empty }), 'detailed', parentIntent)).toMatchObject({ ready: true, nativeExteriorDemonstrated: false });
  const coarse = parentOverviewSample(), c = readParentCaptureEvidence(coarse);
  changeParent(coarse, { draw: { ...c.draw, detailed: true }, detail: { ...empty, coverage: 'native-contours' } });
  expect(parentCaptureReadiness(coarse, 'detailed', parentIntent)).toMatchObject({ ready: true, mode: 'parent-global-overview', nativeExteriorDemonstrated: false });
  const bad = changeParent(parentOverviewSample(), { draw: { ...c.draw, detailed: true }, detail: { ...e.detail, coverage: 'native-contours' } });
  expect(parentCaptureReadiness(bad, 'detailed', parentIntent).ready).toBe(false);
});

/** Root-produced guest native archives on an explicitly synthetic site.
 * These checks classify transport budgets only; they execute no native API. */
const parentDetailPath = '/houses/realize-parent', legacyDetailPath = '/houses/realize-plan';
function guestParentRequest(kind: 'single' | 'assembly') {
  const fixture = kind === 'single' ? singleParentGuest : assemblyParentGuest;
  return { parent: JSON.parse(fixture.data.batch_json).parents[0].archive, interiors: false };
}
const classifiedGuest = (kind: 'single' | 'assembly') => classifyCaptureDetail(parentDetailPath, JSON.stringify(guestParentRequest(kind)));

it('V3 classifies actual parent Single as one physical member and native assembly pair as two, without unpack or geometry decoding', () => {
  expect(classifiedGuest('single')).toMatchObject({ detail: true, valid: true, members: 1 });
  expect(classifiedGuest('assembly')).toMatchObject({ detail: true, valid: true, members: 2 });
  expect(Object.keys(classifiedGuest('assembly')).sort()).toEqual(['detail', 'members', 'valid']);
});

it('V3 applies configured cumulative detail budget in physical members and keeps the active ceiling at two', () => {
  const pair = classifiedGuest('assembly'), single = classifiedGuest('single');
  expect(captureDetailBudget(pair, { activeMembers: 0, usedMembers: 62, maxMembers: 64 }).allowed).toBe(true);
  expect(captureDetailBudget(pair, { activeMembers: 0, usedMembers: 63, maxMembers: 64 })).toMatchObject({ allowed: false, status: 429, totalExceeded: true });
  expect(captureDetailBudget(pair, { activeMembers: 0, usedMembers: 2, maxMembers: 3 }).allowed).toBe(false);
  expect(captureDetailBudget(pair, { activeMembers: 0, usedMembers: 2, maxMembers: 4 }).allowed).toBe(true);
  expect(captureDetailBudget(pair, { activeMembers: 1, usedMembers: 1, maxMembers: 64 })).toMatchObject({ allowed: false, status: 409 });
  expect(captureDetailBudget(single, { activeMembers: 2, usedMembers: 2, maxMembers: 64 }).allowed).toBe(false);
  for (const maxMembers of [0, -1, 1.5, NaN, undefined]) {
    // Undefined uses the documented default64; malformed explicit limits reject.
    if (maxMembers !== undefined) expect(captureDetailBudget(single, { activeMembers: 0, usedMembers: 0, maxMembers }).allowed).toBe(false);
  }
});

it('V3 requires parent interiors:false at the actual top level, never nested, truthy, absent or malformed JSON', () => {
  const valid = guestParentRequest('assembly');
  for (const body of [undefined, '{', 'null', '[]', JSON.stringify({ ...valid, interiors: true }), JSON.stringify({ ...valid, interiors: 'false' }),
    JSON.stringify({ parent: valid.parent }), JSON.stringify({ parent: valid.parent, extra: { interiors: false } })]) {
    const classification = classifyCaptureDetail(parentDetailPath, body);
    expect(classification).toMatchObject({ detail: true, valid: false, members: null });
    expect(captureDetailBudget(classification, { activeMembers: 0, usedMembers: 0 }).allowed).toBe(false);
  }
});

it('V3 refuses unknown format/kind and malformed Single membership instead of assigning an unknown archive one member', () => {
  const source = guestParentRequest('single');
  for (const change of [
    (r: typeof source) => { r.parent.format = 'future-parent-format'; },
    (r: typeof source) => { r.parent.sha256 = 'bad'; },
    (r: typeof source) => { r.parent.payload.kind = 'future'; },
    (r: typeof source) => { r.parent.payload.building = {}; },
    (r: typeof source) => { delete r.parent.payload.building.resolved; },
    (r: typeof source) => { r.parent.payload.building.members = []; },
    (r: typeof source) => { r.parent.payload.assembly = {}; },
  ]) {
    const request = structuredClone(source); change(request);
    expect(classifyCaptureDetail(parentDetailPath, JSON.stringify(request))).toMatchObject({ valid: false, members: null });
  }
});

it('V3 refuses unsupported, missing, duplicate or foreign assembly membership rather than trusting array length alone', () => {
  const source = guestParentRequest('assembly');
  for (const change of [
    (r: typeof source) => { r.parent.payload.assembly.capability = 'future'; },
    (r: typeof source) => { r.parent.payload.assembly.members.pop(); },
    (r: typeof source) => { r.parent.payload.assembly.members.push(r.parent.payload.assembly.members[0]); },
    (r: typeof source) => { r.parent.payload.assembly.members[1].key = r.parent.payload.assembly.members[0].key; },
    (r: typeof source) => { r.parent.payload.assembly.members[1].plan.id = r.parent.payload.assembly.members[0].plan.id; },
    (r: typeof source) => { r.parent.payload.assembly.members[1].plan.parcel_id = 'foreign-parcel'; },
    (r: typeof source) => { r.parent.payload.assembly.members[0].plan.programme = {}; },
    (r: typeof source) => { delete r.parent.payload.assembly.members[0].plan.resolved; },
  ]) {
    const request = structuredClone(source); change(request);
    expect(classifyCaptureDetail(parentDetailPath, JSON.stringify(request))).toMatchObject({ valid: false, members: null });
  }
});

it('V3 preserves legacy realize-plan unit and default64/two-active behavior, sharing total accounting with parent physical members', () => {
  const legacy = classifyCaptureDetail(legacyDetailPath, '{"building":{"legacy":true},"interiors":false}');
  expect(legacy).toMatchObject({ detail: true, valid: true, members: 1 });
  expect(classifyCaptureDetail(legacyDetailPath, '{"interiors":true}')).toMatchObject({ valid: false, members: null });
  expect(captureDetailBudget(legacy, { activeMembers: 1, usedMembers: 63 }).allowed).toBe(true);
  expect(captureDetailBudget(legacy, { activeMembers: 2, usedMembers: 63 }).allowed).toBe(false);
  expect(captureDetailBudget(legacy, { activeMembers: 0, usedMembers: 64 })).toMatchObject({ allowed: false, status: 429 });
  expect(captureDetailUsage([{ path: legacyDetailPath, detail: true, detailMembers: 1 }, { path: parentDetailPath, detail: true, detailMembers: 2 },
    { path: '/houses/unpack-parent', detail: false, detailMembers: 0 }])).toEqual({ valid: true, members: 3 });
  expect(captureDetailUsage([{ path: parentDetailPath, detail: true }])).toEqual({ valid: false, members: null });
  expect(captureDetailBudget(classifiedGuest('single'), { activeMembers: null, usedMembers: 0 }).allowed).toBe(false);
});

it('V3 never classifies unpack-parent, unpack-parent-batch or parent session ACK as detail realization', () => {
  for (const path of ['/houses/unpack-parent', '/houses/unpack-parent-batch', '/houses/ack-parent-session']) {
    const classified = classifyCaptureDetail(path, JSON.stringify(guestParentRequest('assembly')));
    expect(classified).toEqual({ detail: false, valid: true, members: 0 });
    expect(captureDetailBudget(classified, { activeMembers: 2, usedMembers: 64 })).toEqual({ allowed: true, detail: false, members: 0 });
  }
});
