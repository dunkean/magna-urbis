/** Pure capture barriers, shared by final assessment and the runner's polling.
 * Native receipt, current exact view and complete coarse overview are different.
 * This module does not import a browser, native API, timer or network client. */
export function observedBuildingCount(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
const nonempty = value => typeof value === 'string' && value.length > 0;
const close = (a, b) => Math.abs(a - b) <= 1e-6 + 1e-10 * Math.max(Math.abs(a), Math.abs(b));
const bounds = value => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) && value[0] <= value[2] && value[1] <= value[3];
const sameBox = (a, b) => bounds(a) && bounds(b) && a.every((n, i) => close(n, b[i]));
const contains = (a, b) => bounds(a) && bounds(b) && a[0] <= b[0] + 1e-6 && a[1] <= b[1] + 1e-6 && a[2] >= b[2] - 1e-6 && a[3] >= b[3] - 1e-6;
function frameBox(ui) {
  if (typeof ui?.viewBox !== 'string') return undefined;
  const [x, y, w, h, extra] = ui.viewBox.trim().split(/\s+/).map(Number);
  return extra === undefined && [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? [x, y, x + w, y + h] : undefined;
}
function worldFrame(e, ui) {
  const matrix = e.worldToCanvas, box = e.drawViewport, canvas = ui.canvas;
  if (!Array.isArray(matrix) || matrix.length !== 6 || !matrix.every(Number.isFinite) || !bounds(box)
    || !(canvas?.width > 0) || !(canvas?.height > 0)) return false;
  const [a, b, c, d, tx, ty] = matrix;
  const point = (x, y) => [a * x + c * y + tx, b * x + d * y + ty];
  const corners = [point(box[0], box[1]), point(box[2], box[1]), point(box[0], box[3]), point(box[2], box[3])];
  return a > 0 && d > 0 && Math.abs(b) < 1e-9 && Math.abs(c) < 1e-9
    && corners.every(([x, y], i) => Math.abs(x - (i % 2 ? canvas.width : 0)) <= 1 && Math.abs(y - (i >= 2 ? canvas.height : 0)) <= 1);
}
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = value => typeof value === 'number' && observedBuildingCount(value) !== null;
/** Public B4 observation: the DOM marker is serialized synchronously AFTER draw.
 * No internal live getter, native graph, source chunk or network request is read. */
export function readParentCaptureEvidence(ui) {
  const raw = ui?.frameData?.parentEvidence;
  if (typeof raw !== 'string' || raw.length > 128 * 1024) return undefined;
  try { const e = JSON.parse(raw); return e && typeof e === 'object' && !Array.isArray(e) ? e : undefined; }
  catch { return undefined; }
}
/** A committed DOM source is an attestation by the actual authenticated parent
 * consumer, not independent revalidation of its chunks by this capture script.
 * Immutable scene/manifest/session/revision replaces an invented UI counter. */
export function parentCaptureReceipt(ui, { previousParentKey, expectedParentKey } = {}) {
  const e = readParentCaptureEvidence(ui);
  const no = reason => ({ ready: false, reason, generationKey: null, counts: null });
  if (!e) return no('Expected parent evidence is absent or malformed; legacy Single receipts cannot certify this capture.');
  if (e.version !== 'parent-city-viewport-evidence-1' || e.phase !== 'committed' || e.active !== true || e.complete !== true
    || e.mode !== 'parent-session' || e.binding !== 'generated') return no('Parent source is not a committed generated native session.');
  if (!nonempty(e.sceneId) || !sha(e.manifestFingerprint) || !sha(e.sourceFingerprint)
    || !nonempty(e.sourceRevision) || !nonempty(e.nativeSession) || !nonempty(e.generator)
    || e.nativeGenerator !== e.generator || e.partition !== 'prefix64-input24MiB-std-v1' || e.capacity !== 'unknown')
    return no('Parent manifest, native session, source revision or generator identity is not established.');
  const c = e.counts;
  if (!c || !['requests', 'admitted_parents', 'single_parents', 'assembly_parents', 'physical_members', 'refusals', 'open_spaces'].every(k => count(c[k]))
    || c.requests !== c.admitted_parents + c.refusals + c.open_spaces || c.admitted_parents !== c.single_parents + c.assembly_parents
    || c.physical_members !== c.single_parents + 2 * c.assembly_parents) return no('Parent/member/request manifest counts disagree.');
  if (c.requests === 0 ? e.nativePrefix !== null : !e.nativePrefix || e.nativePrefix.parents !== c.admitted_parents || e.nativePrefix.members !== c.physical_members)
    return no('Native committed prefix differs from manifest parent/member counts.');
  const commit = e.commit, release = e.nativeRelease;
  if (commit?.state !== 'committed' || commit.sourceValidation !== 'committed-manifest-and-reference'
    || commit.totalRequests !== c.requests || commit.durableRequests !== c.requests || commit.durableFrontiersComplete !== true
    || !count(commit.sourceChunks) || commit.sourceChunks < 1 || !count(commit.logicalBatches) || commit.logicalBatches < 1
    || commit.sourceChunks < commit.logicalBatches || commit.nativeAckedBatches !== (c.requests ? commit.logicalBatches : 0))
    return no('Parent durable chunks/frontiers do not attest the complete committed manifest.');
  if (release?.recordedStatus !== 'completed-and-released' || release.sessionId !== e.nativeSession || release.originBinding !== e.binding
    || release.evidenceScope !== 'recorded-completed-summary-not-live-session-probe')
    return no('Recorded native release does not match the committed generation; no live-session probe is inferred.');
  const generationKey = JSON.stringify([e.sceneId, e.manifestFingerprint, e.sourceFingerprint, e.sourceRevision, e.nativeSession, e.generator, e.partition, e.binding]);
  if (generationKey === previousParentKey) return no('Previous committed parent source cannot stand in for this new generation.');
  if (expectedParentKey !== undefined && generationKey !== expectedParentKey) return no('Parent source/revision/generation changed after completion.');
  return { ready: true, reason: null, generationKey, counts: { ...c }, binding: e.binding, mode: e.mode,
    scope: 'Public committed DOM source attestation; native receipt/chunk verification remains the receiver/store responsibility.' };
}
export function captureGenerationCompletion(ui, intent = {}) {
  const parent = intent.parentExpected === true || ui?.frameData?.parentEvidence !== undefined;
  const quiet = !ui?.busy && ui?.countsData?.planning !== 'true';
  if (parent) { const receipt = parentCaptureReceipt(ui, intent); return { parent, complete: receipt.ready && quiet, receipt }; }
  return { parent: false, complete: Boolean(ui?.probe?.final) && quiet };
}
export function parentCaptureReadiness(ui, architecture, intent = {}) {
  const layer = ui?.renderView ?? intent.renderView;
  const nativeFrame = ['compact', 'detailed'].includes(architecture) && !['parcels', 'roles', 'tissue', 'uses'].includes(layer);
  const required = nativeFrame && (intent.parentExpected === true || ui?.frameData?.parentEvidence !== undefined);
  const no = reason => ({ required, ready: false, reason, mode: 'incomplete', key: null, globalOverviewFrame: false, exactPicking: false });
  if (!required) return { required: false };
  const receipt = parentCaptureReceipt(ui, intent), e = readParentCaptureEvidence(ui);
  if (!receipt.ready) return no(receipt.reason);
  if (nonempty(ui?.renderView) && nonempty(intent.renderView) && ui.renderView !== intent.renderView) return no('Displayed layer differs from this parent capture entry.');
  const d = e.draw;
  if (!d || !count(d.serial) || d.serial < 1 || !['sourceFingerprint', 'manifestFingerprint', 'sceneId', 'nativeSession', 'sourceRevision'].every(k => d[k] === e[k])
    || !sameBox(d.viewport, e.viewport) || !sameBox(d.viewport, frameBox(ui))
    || !worldFrame({ drawViewport: d.viewport, worldToCanvas: d.worldToCanvas }, ui)
    || !Array.isArray(e.worldToCanvas) || !e.worldToCanvas.every((v, i) => v === d.worldToCanvas[i]) || e.worldToCanvas.length !== 6)
    return no('Parent last-draw viewport/transform differs from the displayed camera.');
  if (!ui.appearance || !nonempty(ui.appearance.style) || !nonempty(ui.appearance.diagnostic)
    || d.appearance?.style !== ui.appearance.style || d.appearance?.diagnostic !== ui.appearance.diagnostic
    || typeof d.painted !== 'boolean' || d.detailed !== (architecture === 'detailed')) return no('Parent last-draw style/architecture or native exterior detail completion differs from current controls.');
  if (![e.residentMembers, e.residentContexts].every(count) || e.residentMembers > e.counts.physical_members)
    return no('Parent resident member/context counts are invalid.');
  let mode, exactPicking = false;
  if (e.coverage === 'exact' && e.pending === false) { mode = 'parent-exact-local'; exactPicking = true; }
  else if (e.coverage === 'complete-native-contours') {
    const o = e.overview;
    if (!o || o.status !== 'ready' || o.ready !== true || o.currentStyle !== true || o.sourceFingerprint !== e.sourceFingerprint
      || o.manifestFingerprint !== e.manifestFingerprint || o.appearance?.style !== d.appearance.style || o.appearance?.diagnostic !== d.appearance.diagnostic
      || o.painted !== d.painted || o.background !== 'transparent-native-overlay' || !bounds(o.bounds) || !count(o.pixels) || o.pixels < 1)
      return no('Parent complete overview source, style or ready image is not attested.');
    mode = 'parent-global-overview';
  } else return no('Parent local viewport is pending or partial, with no attested complete overview.');
  let detailVisibleEligible = null;
  if (architecture === 'detailed') {
    const detail = e.detail;
    if (!detail || detail.scope !== 'current-draw' || detail.enabled !== true || detail.sourceFingerprint !== e.sourceFingerprint
      || detail.manifestFingerprint !== e.manifestFingerprint || !sameBox(detail.viewport, d.viewport)
      || detail.coverage !== (exactPicking ? 'exact' : 'native-contours')
      || !['eligible', 'visibleEligible', 'ready', 'pending', 'failed', 'idle'].every(k => count(detail[k]))
      || detail.eligible > 17 || detail.visibleEligible > Math.min(16, detail.eligible)
      || detail.eligible !== detail.ready + detail.pending + detail.failed + detail.idle
      || detail.pending !== 0 || detail.failed !== 0 || detail.idle !== 0)
      return no('Parent native exterior detail completion is not established for this current draw.');
    // Coarse draws are full native-contour LOD, never detailed geometry evidence.
    if (!exactPicking && detail.eligible !== 0) return no('Coarse native contours cannot certify eligible native exterior detail.');
    detailVisibleEligible = detail.visibleEligible;
  }
  const key = JSON.stringify([receipt.generationKey, e.viewport, e.worldToCanvas, e.counts, e.residentMembers, e.residentContexts,
    e.pick, d.appearance, d.painted, d.detailed, detailVisibleEligible, mode, mode === 'parent-global-overview' ? e.overview : null,
    ui.viewBox, ui.appearance, ui.backgroundStyle]);
  // draw.serial is observed but excluded from stability: repainting an identical
  // source/frame must not reset 900 ms merely because its paint counter advances.
  return { required: true, ready: true, reason: null, mode, key, generationKey: receipt.generationKey,
    globalOverviewFrame: !exactPicking, exactPicking, nativeVerified: true, globalTotals: receipt.counts,
    detailVisibleEligible, nativeExteriorDemonstrated: exactPicking && detailVisibleEligible > 0,
    residentMembers: e.residentMembers, residentContexts: e.residentContexts, worldTransformObserved: true };
}
/** A universal hook alone does not imply a cold scene. An expected native
 * building frame blocked before opening is not a legacy-ready frame. */
export function coldCaptureReadiness(ui, architecture, intent = {}) {
  const parent = parentCaptureReadiness(ui, architecture, intent);
  if (parent.required) return parent;
  const e = ui?.coldViewport, marker = ui?.frameData?.coldCoverage;
  const renderView = ui?.renderView ?? intent.renderView;
  const nativeView = ['compact', 'detailed'].includes(architecture) && !['parcels', 'roles', 'tissue', 'uses'].includes(renderView);
  const expectedNativeFrame = intent.nativePlansExpected === true && renderView === 'buildings';
  const required = nativeView && (!!e || nonempty(marker) || ui?.coldViewportHook === true && expectedNativeFrame);
  const no = reason => ({ required, ready: false, mode: 'incomplete', reason, key: null, globalOverviewFrame: false, exactPicking: false });
  if (nonempty(ui?.renderView) && nonempty(intent.renderView) && ui.renderView !== intent.renderView) return no('Displayed layer differs from this capture entry.');
  if (!required) return { required: false, ready: true, mode: 'legacy', reason: null, key: null, globalOverviewFrame: null, exactPicking: null };
  if (!e) return no('Cold viewport evidence unavailable: opening or repair is not complete.');
  if (e.version !== 'cold-city-viewport-evidence-1' || e.active !== true) return no('Cold source is inactive or its evidence version is unknown.');
  if (![e.sceneId, e.parentFingerprint, e.derivedFingerprint].every(nonempty) || !Number.isSafeInteger(e.generation) || e.generation < 0
    || !Number.isFinite(e.offset?.x) || !Number.isFinite(e.offset?.y)
    || !['buildings', 'refusals', 'openSpaces'].every(key => typeof e.totals?.[key] === 'number' && observedBuildingCount(e.totals[key]) !== null)
    || typeof e.residentRecords !== 'number' || observedBuildingCount(e.residentRecords) === null
    || !Array.isArray(e.resident) || e.resident.length !== e.residentRecords) return no('Cold source identity, global totals or resident record count are not established.');
  if (e.requesting !== false || e.pending !== false) return no('Cold viewport is requesting or still has pending/partial ink.');
  if (!sameBox(e.drawViewport, frameBox(ui))) return no('Draw viewport does not match the current displayed world frame.');
  if (marker && marker !== e.coverage) return no('DOM and cold evidence describe different coverage frames.');
  const declaredTotal = ui?.frameData?.coldTotal;
  if (declaredTotal !== undefined && observedBuildingCount(declaredTotal) !== e.totals.buildings) return no('DOM total differs from the committed manifest total.');
  const matrixKnown = Array.isArray(e.worldToCanvas);
  if (matrixKnown && !worldFrame(e, ui)) return no('Observed world-to-canvas transform does not match the draw frame.');
  let mode, exactPicking = false;
  if (e.coverage === 'exact') {
    if (e.truncated !== false || !contains(e.currentViewport, e.drawViewport)) return no('Exact local coverage is truncated, unknown or from another viewport.');
    mode = 'exact-local'; exactPicking = true;
  } else if (e.coverage === 'complete-native-contours') {
    const o = e.overview, appearance = ui.appearance;
    if (e.overviewStatus !== 'ready' || !nonempty(e.overviewFingerprint) || !['hit', 'built', 'built-uncached'].includes(e.cacheStatus)
      || !o || !bounds(o.bounds) || !Number.isSafeInteger(o.pixels) || o.pixels <= 0 || !nonempty(o.painter)
      || !appearance || !nonempty(appearance.style) || !nonempty(appearance.diagnostic)
      || o.appearance?.style !== appearance.style || o.appearance?.diagnostic !== appearance.diagnostic
      || !['render', 'relief', 'parchment'].includes(ui.backgroundStyle) || o.painted !== (ui.backgroundStyle === 'render')
      || !worldFrame(e, ui)) return no('Complete overview is not ready or its identity, style, background or world frame is unverified.');
    mode = 'global-overview'; // A truncated resident prefix is allowed only as coarse-image evidence, never exact picking.
  } else return no('Cold coverage is pending or partial, not a complete final frame.');
  const key = JSON.stringify([e.sceneId, e.parentFingerprint, e.derivedFingerprint, e.offset.x, e.offset.y, e.generation,
    e.currentViewport ?? null, e.drawViewport, e.worldToCanvas ?? null, mode, e.residentRecords, e.truncated,
    ui.view, ui.viewBox, ui.appearance, ui.backgroundStyle, mode === 'global-overview' ? e.overviewFingerprint : null]);
  return { required, ready: true, mode, reason: null, key, globalOverviewFrame: mode === 'global-overview', exactPicking,
    overviewStatus: e.overviewStatus, truncated: e.truncated ?? null, globalTotals: { ...e.totals }, residentRecords: e.residentRecords ?? null,
    worldTransformObserved: matrixKnown };
}

/** Stable readiness across samples prevents a late generation/camera reply from
 * borrowing another frame's settled flag. Local exact frames do not wait for
 * global overview progress, which may continue for a long time in the background. */
export function createCaptureSettlingBarrier({ architecture, nativePlansExpected = false, renderView, parentExpected = false, previousParentKey, expectedParentKey, quietMs = 900 } = {}) {
  let key, since;
  return { observe(ui, activeRequests) {
    const visual = coldCaptureReadiness(ui, architecture, { nativePlansExpected, renderView, parentExpected, previousParentKey, expectedParentKey });
    const transportQuiet = activeRequests === 0 && observedBuildingCount(ui?.frameData?.detailInFlight ?? 0) === 0
      && !ui?.busy && ui?.countsData?.planning !== 'true';
    if (!visual.ready || !transportQuiet || !Number.isFinite(ui?.now)) { key = since = undefined; return { settled: false, ...visual }; }
    if (!visual.required) return { ...visual, settled: Number.isFinite(ui?.probe?.lastChange) && ui.now - ui.probe.lastChange >= quietMs };
    if (key !== visual.key || !Number.isFinite(since) || ui.now < since) { key = visual.key; since = ui.now; }
    return { ...visual, settled: ui.now - since >= quietMs, stableForMs: ui.now - since };
  } };
}
export function assessCaptureReadiness(ui, architecture, proof, intent = {}) {
  const visual = coldCaptureReadiness(ui, architecture, intent);
  const e = readParentCaptureEvidence(ui);
  const paintedInCamera = e && e.coverage !== 'exact' ? null : observedBuildingCount(ui?.frameData?.buildingsPainted);
  const stable = !visual.required || proof?.settled === true && proof.key === visual.key;
  const warnings = [];
  if (paintedInCamera === null) warnings.push('Painted-building count unavailable; it is not zero or the global manifest total.');
  if (!visual.ready) warnings.push(visual.reason);
  else if (!stable) warnings.push('Cold viewport identity, generation or camera is not stable across the final samples.');
  if (visual.mode === 'exact-local') warnings.push('Only this exact local viewport is complete; the global overview may still be rebuilding.');
  if (visual.mode === 'parent-exact-local') warnings.push('Only this parent local viewport is complete; counts are parents/members, not households, city capacity or a global finished overview.');
  if (visual.mode === 'parent-global-overview') warnings.push('Complete native-contour overview LOD only; resident members may be partial. No exact/no-house picking or native exterior detail is certified, and the transparent overlay does not certify the external terrain background.');
  if (visual.required && visual.nativeVerified && architecture === 'detailed' && !visual.nativeExteriorDemonstrated)
    warnings.push('No visible parent eligible for native exterior detail in this draw; detailed architecture is not demonstrated at this scope/scale.');
  if (visual.mode === 'global-overview' && visual.truncated === true) warnings.push('Complete coarse overview with a truncated resident prefix: no exact or no-house picking conclusion.');
  return { visual, paintedInCamera, visualComplete: visual.ready && stable, warnings };
}

/** Network accounting only. Read archive tags/identity/membership without
 * unpacking lossless floats, reconstructing geometry or claiming native validity.
 * Native checksum, canonical payload and realization validation remain native. */
export function classifyCaptureDetail(path, bodyText) {
  if (!['/houses/realize-plan', '/houses/realize-parent'].includes(path)) return { detail: false, valid: true, members: 0 };
  const no = reason => ({ detail: true, valid: false, members: null, reason });
  if (typeof bodyText !== 'string') return no('Exterior realization must explicitly request interiors:false');
  if (path === '/houses/realize-plan') {
    // Preserve the legacy guard exactly; only its unit is named explicitly.
    return /"interiors"\s*:\s*false/.test(bodyText) ? { detail: true, valid: true, members: 1 }
      : no('Exterior realization must explicitly request interiors:false');
  }
  let request; try { request = JSON.parse(bodyText); } catch { return no('Malformed parent realization JSON'); }
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const keys = (v, expected) => object(v) && Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
  if (!keys(request, ['parent', 'interiors']) || request.interiors !== false) return no('Parent exterior realization requires explicit interiors:false and one parent archive');
  const archive = request.parent, payload = archive?.payload;
  if (!keys(archive, ['format', 'sha256', 'payload']) || archive.format !== 'native-parent-archive-1' || !sha(archive.sha256) || !object(payload))
    return no('Unknown or malformed native parent archive');
  const header = (p, parcel) => object(p) && ['id', 'parcel_id', 'recipe_id', 'variant_id'].every(k => nonempty(p[k]))
    && (parcel === undefined || p.parcel_id === parcel) && object(p.resolved) && p.resolved.format === 'compact-plan-1'
    && p.resolved.recipe_id === p.recipe_id && p.resolved.variant_id === p.variant_id
    && ['footprint', 'roof_footprint', 'volumes'].every(k => Array.isArray(p[k]) && p[k].length > 0)
    && ['courtyards', 'structural_features'].every(k => Array.isArray(p[k]))
    && !Object.hasOwn(p, 'members') && !Object.hasOwn(p, 'assembly');
  if (payload.kind === 'single') {
    if (!keys(payload, ['kind', 'programme', 'building']) || payload.programme !== null && !object(payload.programme) || !header(payload.building))
      return no('Malformed Single parent archive membership');
    return { detail: true, valid: true, members: 1 };
  }
  if (payload.kind !== 'assembly') return no('Unknown parent archive kind');
  const a = payload.assembly;
  if (!keys(payload, ['kind', 'assembly']) || !keys(a, ['capability', 'id', 'parcel_id', 'programme', 'members', 'circulation', 'shared_context', 'outcome'])
    || a.capability !== 'native-assembly-pair-1' || !nonempty(a.id) || !nonempty(a.parcel_id) || !object(a.programme) || !object(a.outcome)
    || !object(a.circulation) || !Array.isArray(a.shared_context) || !Array.isArray(a.members) || a.members.length !== 2)
    return no('Malformed or unsupported assembly parent membership');
  const ids = new Set(), memberKeys = new Set();
  for (const member of a.members) {
    if (!keys(member, ['key', 'plan']) || !nonempty(member.key) || memberKeys.has(member.key) || !header(member.plan, a.parcel_id)
      || ids.has(member.plan.id) || ['programme', 'programme_outcome', 'domestic_units', 'useful_area_m2'].some(k => Object.hasOwn(member.plan, k)))
      return no('Malformed, duplicated or foreign assembly member');
    ids.add(member.plan.id); memberKeys.add(member.key);
  }
  return { detail: true, valid: true, members: 2 };
}

/** All accepted detail attempts consume the campaign total, including failures;
 * active attempts additionally consume the unchanged two-member active ceiling. */
export function captureDetailUsage(entries) {
  let members = 0;
  for (const e of entries) {
    if (!e.detail) continue;
    if (e.path === '/houses/realize-plan' ? e.detailMembers !== 1
      : e.path !== '/houses/realize-parent' || ![1, 2].includes(e.detailMembers)) return { valid: false, members: null };
    members += e.detailMembers; if (!Number.isSafeInteger(members)) return { valid: false, members: null };
  }
  return { valid: true, members };
}
export function captureDetailBudget(classification, { activeMembers, usedMembers, maxMembers = 64 } = {}) {
  if (!classification.detail) return { allowed: true, detail: false, members: 0 };
  const no = (status, reason, totalExceeded = false) => ({ allowed: false, detail: true, members: null, status, reason, totalExceeded });
  if (!classification.valid || ![1, 2].includes(classification.members)) return no(409, classification.reason ?? 'Unknown physical detail membership');
  if (![activeMembers, usedMembers, maxMembers].every(count) || maxMembers < 1) return no(409, 'Physical detail member budget is not established');
  if (activeMembers + classification.members > 2) return no(409, 'More than two physical detail members');
  if (usedMembers + classification.members > maxMembers) return no(429, `Benchmark detail member budget ${maxMembers} reached`, true);
  return { allowed: true, detail: true, members: classification.members };
}
