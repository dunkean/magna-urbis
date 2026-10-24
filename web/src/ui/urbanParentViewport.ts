/** Applied real parent consumer: child-only bounded view, async serial overview,
 * typed exact picks and authoritative whole-parent native detail. */
import type { Point } from '../../../rust/bridge/housesContract';
import type { ParentBounds } from '../../../rust/bridge/nativeParentOccupation';
import type { NativeParentApi } from '../../../rust/bridge/nativeParentContract';
import { UrbanBuildingLodRenderer, type BuildingDrawOptions } from '../render/urbanBuildingLod';
import { openParentColdWindow, pickParentSnapshot, PARENT_WINDOW_LIMITS, type ParentMapSelection, type ParentMapPick, type ParentWindowSnapshot } from './urbanParentColdWindow';
import type { ParentMemberVisual } from './urbanParentVisual';
import { createParentNativeReader } from './urbanParentNativeRead';
import { createParentDetailController, detailForCurrentMember } from './urbanParentDetail';
import { buildParentOverview, type ParentOverview } from './urbanParentOverview';
import { paintParentContexts } from './urbanParentPaint';
import type { ParentChunkBackend } from './urbanParentChunkStore';
import { copyParentBuildingState, type UrbanParentBuildingState } from './urbanParentState';
import { currentParentDetailEvidence } from './urbanParentDrawEvidence';
import { repairParentVisualChunk } from './urbanParentVisualRepair';
export async function openParentViewport(backend: ParentChunkBackend, input: UrbanParentBuildingState, api: NativeParentApi,
  options: { signal?: AbortSignal; changed?(): void; yieldControl?(): Promise<void> } = {}) {
  const state = copyParentBuildingState(input), life = new AbortController(); let disposed = false;
  const aborted = () => life.abort(options.signal?.reason); if (options.signal?.aborted) aborted(); else options.signal?.addEventListener('abort', aborted, { once: true });
  life.signal.throwIfAborted();
  const source = await openParentColdWindow(backend, state.store.sceneId, { offset: state.offset, signal: life.signal });
  const m = source.manifest;
  if (m.fingerprint !== state.store.fingerprint || m.sourceFingerprint !== state.store.sourceFingerprint || m.format !== state.store.format
    || Object.entries(m.counts).some(([k, v]) => state.counts[k as keyof typeof m.counts] !== v)
    || m.generator_version !== state.counts.generator_version || JSON.stringify(m.generation) !== JSON.stringify(state.generation)) {
    source.dispose(); options.signal?.removeEventListener('abort', aborted); throw new Error('Applied parent reference no longer matches its committed source.');
  }
  // Validator and exact applied-reference match above finished before a view exists.
  // These are source-store/receipt facts, not a new physical certification.
  const commitEvidence = { state: 'committed', sourceValidation: 'committed-manifest-and-reference', totalRequests: m.totalRequests,
    durableRequests: m.chunks.reduce((n, d) => n + d.counts.requests, 0), sourceChunks: m.chunks.length, logicalBatches: m.boundaries.length,
    nativeAckedBatches: m.generation && m.totalRequests ? m.boundaries.length : 0, durableFrontiersComplete: true };
  let paintSerial = 0, lastPaintEvidence: Record<string, unknown> | undefined;
  const native = createParentNativeReader(backend, m, api), renderer = new UrbanBuildingLodRenderer<ParentMemberVisual>({ buildings: [] }, { raster: false });
  let image: ImageBitmap | undefined, overview: ParentOverview | undefined, overviewEpoch = 0, overviewKey = '', overviewStatus = 'pending';
  let overviewAbort: AbortController | undefined, error = '', pending = false, boxKey = '', queryEpoch = 0, repairRunning = false;
  let displaySnapshot: ParentWindowSnapshot | undefined;
  let currentMembers: ParentMemberVisual[] = [];
  let selected: ParentMapSelection | undefined, latestViewport: ParentBounds | undefined, worldToCanvas: number[] | undefined;
  const notify = () => { if (!disposed) options.changed?.(); };
  const details = createParentDetailController(api, id => native.read(id, life.signal), { offset: state.offset,
    members: () => currentMembers, changed: notify,
    install: entry => { if (disposed) return; for (const member of currentMembers) {
      const visual = detailForCurrentMember(entry, member); if (visual) renderer.setDetail(member.id, visual);
    } }, remove: entry => { for (const member of entry.members) renderer.setDetail(member.id, undefined); } });
  function applySnapshot() {
    const snapshot = source.snapshot; if (!snapshot) return; displaySnapshot = snapshot; currentMembers = snapshot.members;
    renderer.replaceScene({ buildings: snapshot.members, materials: snapshot.materials });
    for (const member of snapshot.members) { const cached = details.get(member.parent_id); if (cached) { const detail = detailForCurrentMember(cached, member); if (detail) renderer.setDetail(member.id, detail); } }
  }
  function ensureViewport(bounds: ParentBounds) {
    if (disposed) return; const key = JSON.stringify(bounds); if (key === boxKey) return; boxKey = key; latestViewport = [...bounds];
    const own = ++queryEpoch; pending = true; error = '';
    void source.query(bounds).then(() => { if (!disposed && own === queryEpoch) { pending = false; applySnapshot(); notify(); } }, e => {
      if (!disposed && own === queryEpoch) { pending = false; error = String(e); notify(); }
    });
  }
  function ensureOverview(appearance: BuildingDrawOptions['appearance'], painted: boolean) {
    const key = JSON.stringify({ appearance, painted }); if (disposed || key === overviewKey) return;
    overviewKey = key; const own = ++overviewEpoch; overviewAbort?.abort(); const abort = new AbortController(); overviewAbort = abort; overviewStatus = 'rebuilding';
    void buildParentOverview(backend, m, { signal: abort.signal, appearance, painted,
      yieldControl: options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0))) }).then(async built => {
      if (disposed || own !== overviewEpoch) return;
      if (typeof createImageBitmap === 'undefined') throw new Error('Parent overview image decoder unavailable.');
      const buffer = new ArrayBuffer(built.png.byteLength); new Uint8Array(buffer).set(built.png);
      const decoded = await createImageBitmap(new Blob([buffer], { type: 'image/png' }));
      if (disposed || own !== overviewEpoch) { decoded.close(); return; }
      image?.close(); image = decoded; overview = built; overviewStatus = 'ready'; notify();
    }).catch(e => { if (!disposed && own === overviewEpoch) { overviewStatus = 'failed'; error = String(e); notify(); } });
  }
  function draw(ctx: CanvasRenderingContext2D, opts: BuildingDrawOptions, detailed: boolean) {
    if (detailed) details.resume(); else details.suspend();
    const painted = !!opts.painted; ensureOverview(opts.appearance, painted);
    const snapshot = displaySnapshot, bounds: ParentBounds = [opts.viewport.minX, opts.viewport.minY, opts.viewport.maxX, opts.viewport.maxY]; ensureViewport(bounds);
    const exact = !pending && snapshot?.complete && JSON.stringify(snapshot.viewport) === JSON.stringify(bounds);
    const transform = ctx.getTransform?.(); if (transform) worldToCanvas = [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f];
    const eligible = new Set<string>(), visibleEligible = new Set<string>();
    let visibleMembers: number | null = null, contextsDrawn = 0, mode: 'exact' | 'native-contours' | 'partial' | 'pending' = 'pending';
    if (!exact && image && overview) {
      const [x0, y0, x1, y1] = overview.bounds, dx = state.offset?.x ?? 0, dy = state.offset?.y ?? 0;
      ctx.drawImage(image, x0 + dx, y0 + dy, x1 - x0, y1 - y0); mode = 'native-contours';
    } else if (snapshot) {
      paintParentContexts(ctx, snapshot.contexts, snapshot.materials); contextsDrawn = snapshot.contexts.length;
      const metrics = renderer.draw(ctx, { ...opts, selectedId: selected?.kind === 'member' ? selected.member_id : undefined, useDetails: detailed });
      visibleMembers = metrics.visibleBuildings; mode = exact ? 'exact' : 'partial';
      if (detailed) { const ids = eligible;
        for (const member of snapshot.members) {
          if (ids.size >= 16) break;
          const b = renderer.getBuilding(member.id); if (!b) continue;
          // Only close-up visible children request true detail, never the city.
          let min = Infinity, max = -Infinity; for (const p of b.footprint) for (const q of p.outer) { min = Math.min(min, q.x); max = Math.max(max, q.x); } const span = max - min;
          if (span / opts.metresPerPixel >= 72) { ids.add(member.parent_id); visibleEligible.add(member.parent_id); }
        }
        if (selected) ids.add(selected.parent_id); for (const id of ids) details.request(id);
      }
    }
    const overviewCurrent = !!image && !!overview && overviewStatus === 'ready'
      && overview.sourceFingerprint === m.sourceFingerprint && overview.manifestFingerprint === m.fingerprint
      && JSON.stringify({ appearance: overview.appearance, painted: overview.painted }) === JSON.stringify({ appearance: opts.appearance, painted });
    // Captured AFTER actual Canvas draw. Async queries/details cannot upgrade this
    // snapshot until another real draw occurs; no prepaint getter attestation.
    lastPaintEvidence = { version: 'parent-city-viewport-evidence-1', phase: 'committed', active: !disposed,
      mode: m.generation ? 'parent-session' : 'parent-archives', binding: state.binding ?? 'unknown', cityKey: state.cityKey ?? null,
      sourceFingerprint: m.sourceFingerprint, manifestFingerprint: m.fingerprint, sceneId: m.sceneId,
      nativeSession: m.generation?.begin.session_id ?? null, sourceRevision: m.generation?.begin.source.revision ?? null,
      generator: m.generator_version, nativeGenerator: m.generation?.begin.generator_version ?? null, partition: m.generation?.begin.partition ?? null,
      complete: m.totalRequests === m.counts.requests, counts: { ...m.counts }, nativePrefix: m.generation?.final_prefix ?? null,
      commit: commitEvidence, nativeRelease: { recordedStatus: m.generation?.status ?? null, sessionId: m.generation?.begin.session_id ?? null,
        originBinding: state.binding ?? 'unknown', evidenceScope: 'recorded-completed-summary-not-live-session-probe' },
      draw: { serial: ++paintSerial, sourceFingerprint: m.sourceFingerprint, manifestFingerprint: m.fingerprint, sceneId: m.sceneId,
        nativeSession: m.generation?.begin.session_id ?? null, sourceRevision: m.generation?.begin.source.revision ?? null,
        viewport: [...bounds], worldToCanvas: worldToCanvas?.slice() ?? null, appearance: { ...opts.appearance }, painted, detailed },
      overview: { status: overviewStatus, ready: overviewCurrent, currentStyle: overviewCurrent,
        sourceFingerprint: overview?.sourceFingerprint ?? null, manifestFingerprint: overview?.manifestFingerprint ?? null,
        appearance: overview ? { ...overview.appearance } : null, painted: overview?.painted ?? null,
        background: 'transparent-native-overlay', bounds: overview?.bounds.slice() ?? null, pixels: overview?.pixels ?? null },
      detail: currentParentDetailEvidence({ enabled: detailed, eligibleIds: [...eligible], visibleIds: visibleEligible, status: id => details.status(id),
        sourceFingerprint: m.sourceFingerprint, manifestFingerprint: m.fingerprint, viewport: bounds, coverage: mode }),
      queryReport: m.generation?.query_report ?? null, viewport: [...bounds], worldToCanvas: worldToCanvas?.slice() ?? null,
      pending, coverage: mode === 'native-contours' && overviewCurrent ? 'complete-native-contours' : mode === 'exact' ? 'exact' : 'partial',
      residentMembers: snapshot?.members.length ?? 0, residentContexts: snapshot?.contexts.length ?? 0,
      limits: PARENT_WINDOW_LIMITS, pick: selected ? { ...selected } : null, capacity: 'unknown' };
    return { coverage: mode, visibleMembers, contextsDrawn, pending: pending || overviewStatus === 'rebuilding', totals: m.counts };
  }
  return { state, manifest: m, renderer, details,
    ensureViewport, draw,
    select(value?: ParentMapSelection) { selected = value; notify(); },
    pick(point: Point): ParentMapPick { return pickParentSnapshot(displaySnapshot, point); },
    async pickAt(point: Point) { const found = await source.pickAt(point);
      // A point lookup must never replace the displayed whole-window snapshot
      // or claim that its degenerate rectangle covers the camera.
      boxKey = ''; if (latestViewport) ensureViewport(latestViewport); notify(); return found; },
    read(id: string) { return native.read(id, life.signal); },
    get stats() { return { pending, error, overviewStatus, residentMembers: displaySnapshot?.members.length ?? 0,
      residentParents: displaySnapshot?.parents.length ?? 0, residentContexts: displaySnapshot?.contexts.length ?? 0,
      encodedBytes: displaySnapshot?.encodedBytes ?? 0, vertices: displaySnapshot?.vertices ?? 0,
      sourceRead: native.stats, detail: details.stats }; },
    evidence() { return structuredClone(lastPaintEvidence ?? { version: 'parent-city-viewport-evidence-1', phase: 'not-painted', active: false, complete: false }); },
    async repair(signal?: AbortSignal) {
      if (repairRunning) throw new Error('Parent child repair already running.'); repairRunning = true;
      try { for (const d of m.chunks) { signal?.throwIfAborted(); life.signal.throwIfAborted(); await repairParentVisualChunk(backend, m, d.index, api, { signal: life.signal }); await options.yieldControl?.(); }
        boxKey = ''; overviewKey = ''; if (latestViewport) ensureViewport(latestViewport);
      } finally { repairRunning = false; notify(); }
    },
    dispose() { disposed = true; lastPaintEvidence = undefined; queryEpoch++; overviewEpoch++; overviewAbort?.abort(); life.abort(); source.dispose(); native.dispose(); details.dispose();
      currentMembers = []; displaySnapshot = undefined; renderer.replaceScene({ buildings: [] }); image?.close(); image = undefined; overview = undefined; options.signal?.removeEventListener('abort', aborted); },
  };
}
export type ParentViewport = Awaited<ReturnType<typeof openParentViewport>>;
