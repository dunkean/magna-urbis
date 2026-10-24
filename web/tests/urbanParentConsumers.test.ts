import { expect, it, vi } from 'vitest';
import guest from './fixtures/native-parent-assembly-guest-plan.json';
import unpacked from './fixtures/native-parent-assembly-guest-unpack.json';
import exterior from './fixtures/native-parent-assembly-guest-exterior.json';
import singleGuest from './fixtures/native-parent-single-guest-plan.json';
import type { NativeParentBatch, NativeParentPlan, NativeParentApi, RealizedParent, NativeParentArchive } from '../../rust/bridge/nativeParentContract';
import { parentCounts, parentIdentity } from '../../rust/bridge/nativeParentContract';
import { parentDigest } from '../../rust/bridge/nativeParentStream';
import { parentWire } from '../../rust/bridge/nativeParentBudget';
import { projectParentRecords } from '../src/ui/urbanParentVisual';
import { decodeParentVisual, type ParentVisualChunk } from '../src/ui/urbanParentVisualCache';
import { beginUrbanParentStage, type ParentSourceIndex, type ParentMemberIndex, type StoredParentChunk } from '../src/ui/urbanParentChunkStore';
import { openParentColdWindow } from '../src/ui/urbanParentColdWindow';
import { createParentNativeReader } from '../src/ui/urbanParentNativeRead';
import { parentDetailEntry } from '../src/ui/urbanParentDetail';
import { repairParentVisualChunk } from '../src/ui/urbanParentVisualRepair';
import { exportUrbanParentChunks, importUrbanParentChunks } from '../src/ui/urbanParentChunkTransport';
import { parentStateFromManifest } from '../src/ui/urbanParentState';
import { createUrbanBuildingPanelState } from '../src/ui/urbanBuildingsPanel';
import { nativeParentInspectionRows } from '../src/ui/urbanParentInspector';
import { MemoryParents } from './support/urbanParentSessionProtocol';
// Real native guest-Wasm SYNTHETIC SITE output, preserved byte-exact in fixture.
// Native API calls below are explicitly transport mocks; no new admission claim.
const batch: NativeParentBatch = JSON.parse(guest.data.batch_json);
const nativePlan: NativeParentPlan = JSON.parse(JSON.stringify(unpacked.data.plans[0]));
const detail: RealizedParent = JSON.parse(JSON.stringify(exterior.data));
class VisualMemory extends MemoryParents {
  visuals = new Map<string, ParentVisualChunk>();
  override async append(id: string, c: StoredParentChunk, p: ParentSourceIndex[], m: ParentMemberIndex[], visual?: ParentVisualChunk) {
    await super.append(id, c, p, m); if (visual) this.visuals.set(`${id}/${c.index}`, visual);
  }
  async visualChunk(id: string, index: number) { return this.visuals.get(`${id}/${index}`); }
  async putVisual(id: string, c: ParentVisualChunk) { this.visuals.set(`${id}/${c.index}`, c); }
  async parentTile(id: string, tile: string, limit: number) { const rows = [...this.stages.get(id)!.parents.values()].filter(p => p.tiles.includes(tile));
    return { entries: rows.slice(0, limit), truncated: rows.length > limit }; }
}
function api(): NativeParentApi {
  return { require: vi.fn(async () => {}), plan: vi.fn(async () => { throw new Error('No generation permitted in archive consumers'); }),
    unpack: vi.fn(async (a: NativeParentArchive) => { expect(a).toEqual(batch.parents[0].archive); return nativePlan; }),
    unpackBatch: vi.fn(async (archives: NativeParentArchive[]) => { expect(archives).toEqual([batch.parents[0].archive]); return { schema_version: 'native-parent-batch-1' as const, plans: [nativePlan], counts: parentCounts([nativePlan]) }; }),
    realize: vi.fn(async (a: NativeParentArchive) => { expect(a).toEqual(batch.parents[0].archive); return detail; }) };
}
async function saved() {
  const backend = new VisualMemory(), boundary = { start: 0, completed: 1, inputBytes: 1, floatSlots: 1, rewrittenBytes: 1, inputSha256: 'b'.repeat(64) };
  const stage = await beginUrbanParentStage(backend, { sceneId: 'actual-native-parent', sourceFingerprint: 'a'.repeat(64), totalRequests: 1 });
  const identity = parentIdentity(nativePlan);
  await stage.append(batch, { start: 0, completed: 1, total: 1 }, boundary, [{ id: identity.id, parcel_id: identity.parcel_id }]);
  const manifest = await stage.commit({ schema_version: 'native-parent-batch-1', generator_version: batch.generator_version, counts: batch.counts, boundaries: [boundary] });
  return { backend, manifest };
}
it('real guest batch UTF8 checksum remains exact and source/member inventory never becomes a fake Single', async () => {
  expect(await parentDigest(guest.data.batch_json)).toBe(guest.data.receipt.batch_sha256);
  const projected = projectParentRecords(batch.parents, batch.materials);
  expect(projected.parents).toHaveLength(1); expect(projected.members).toHaveLength(2); expect(projected.parents[0].programme).toEqual(nativePlan.kind === 'assembly' ? nativePlan.assembly.programme : null);
  for (const member of projected.members) for (const field of ['programme', 'resolved', 'useful_area_m2', 'domestic_units', 'programme_outcome']) expect(member).not.toHaveProperty(field);
  const single: NativeParentBatch = JSON.parse(singleGuest.data.batch_json); expect(projectParentRecords(single.parents).parents[0].native_kind).toBe('single');
});
it('durable cache HIT -> bounded actual member/context pick, no source archive read, and empty means empty', async () => {
  const { backend, manifest } = await saved(), source = vi.spyOn(backend, 'chunk'), cacheRead = vi.spyOn(backend, 'visualChunk');
  const view = await openParentColdWindow(backend, manifest.sceneId), snapshot = await view.query([120, 120, 180, 180]);
  expect(snapshot.complete).toBe(true); expect(snapshot.members).toHaveLength(2); expect(cacheRead).toHaveBeenCalledOnce(); expect(source).not.toHaveBeenCalled();
  const member = snapshot.members[0], ring = member.footprint[0].outer;
  const p = { x: ring.reduce((n, p) => n + p.x, 0) / ring.length, y: ring.reduce((n, p) => n + p.y, 0) / ring.length };
  expect(view.pick(p)).toMatchObject({ status: 'exact', selection: { kind: 'member', parent_id: member.parent_id, member_id: member.member_id } });
  expect(view.pick({ x: 130, y: 130 })).toEqual({ status: 'exact' });
  expect(view.pick({ x: 20, y: 20 }).status).toBe('pending'); view.dispose();
});
it('cache MISS explicit, one archive chunk native repair, then HIT; source bits and counts unchanged', async () => {
  const { backend, manifest } = await saved(), before = backend.stages.get(manifest.sceneId)!.chunks[0].json;
  backend.visuals.clear(); const read = vi.spyOn(backend, 'chunk'), native = api(), view = await openParentColdWindow(backend, manifest.sceneId);
  await expect(view.query([120, 120, 180, 180])).rejects.toThrow('repair'); expect(read).not.toHaveBeenCalled();
  await repairParentVisualChunk(backend, manifest, 0, native);
  expect(native.unpackBatch).toHaveBeenCalledOnce(); expect(native.plan).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledOnce();
  expect(backend.stages.get(manifest.sceneId)!.chunks[0].json).toBe(before);
  expect((await view.query([120, 120, 180, 180])).members).toHaveLength(2); view.dispose();
});
it('actual archive -> selected read -> real guest exterior prepares BOTH members atomically; altered child refuses', async () => {
  const { backend, manifest } = await saved(), native = api(), reader = createParentNativeReader(backend, manifest, native);
  const loaded = await reader.read(parentIdentity(nativePlan).id), projected = projectParentRecords(batch.parents, batch.materials);
  const entry = parentDetailEntry(loaded, detail, projected.members); expect(entry.members).toHaveLength(2); expect(entry.vertices).toBeGreaterThan(0);
  const broken = structuredClone(projected.members); broken[1].footprint[0].outer[0].x += 1;
  expect(() => parentDetailEntry(loaded, detail, broken)).toThrow('geometry');
  expect(native.plan).not.toHaveBeenCalled(); expect(native.unpack).toHaveBeenCalledOnce(); reader.dispose();
  expect(nativeParentInspectionRows(loaded).find(([k]) => k === 'Capacité résidentielle / utile réel')?.[1]).toBe('Inconnus');
});
it('export/import keeps the native archive as authority; rebuild child cache/indexes without generation', async () => {
  const { backend, manifest } = await saved(), pieces: Uint8Array[] = [];
  for await (const p of exportUrbanParentChunks(backend, manifest.sceneId)) pieces.push(p);
  const next = new VisualMemory(), native = api(); async function* bytes() { yield* pieces; }
  const imported = await importUrbanParentChunks(next, bytes(), native, { sceneId: 'imported' });
  expect(imported.counts).toEqual(manifest.counts); expect(native.plan).not.toHaveBeenCalled();
  const chunk = next.stages.get('imported')!.chunks[0]; expect(chunk.json).toBe(backend.stages.get(manifest.sceneId)!.chunks[0].json);
  expect((await decodeParentVisual(next.visuals.get('imported/0')!, chunk.sha256)).members).toHaveLength(2);
});
it('selected panel retains parent once; no legacy house export/transfer, real exporter called', async () => {
  const { backend, manifest } = await saved(), native = api(), reader = createParentNativeReader(backend, manifest, native), exporter = vi.fn(async () => {});
  const parent = parentStateFromManifest(manifest), member = projectParentRecords(batch.parents).members[0];
  const panel = createUrbanBuildingPanelState({ seed: '', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' }, parent },
    { readParentBuilding: (_s, id) => reader.read(id), exportParent: exporter });
  panel.selectParent({ kind: 'member', parent_id: member.parent_id, member_id: member.member_id, member_key: member.member_key });
  await panel.whenSelectionIdle(); expect(panel.selection.status).toBe('parent_ready'); expect(panel.state.scene).toBeUndefined();
  await expect(panel.openSelected(vi.fn())).rejects.toThrow('pas encore'); await panel.exportCurrent(); expect(exporter).toHaveBeenCalledOnce(); reader.dispose();
});

it('incompatible repair engine refuses BEFORE any source chunk, cache write, unpack or generation', async () => {
  const { backend, manifest } = await saved(), native = api();
  const source = vi.spyOn(backend, 'chunk'), cacheWrite = vi.spyOn(backend, 'putVisual');
  vi.mocked(native.require).mockRejectedValue(new Error('Native parent capability is missing'));
  await expect(repairParentVisualChunk(backend, manifest, 0, native)).rejects.toThrow('capability');
  expect(source).not.toHaveBeenCalled(); expect(cacheWrite).not.toHaveBeenCalled();
  expect(native.unpackBatch).not.toHaveBeenCalled(); expect(native.plan).not.toHaveBeenCalled();
});

// Geometry sink only: exercises the REAL viewport/renderer and captured metadata;
// it is intentionally not a browser or pixel-quality proof.
class ParentCanvasSink {
  fillStyle = ''; strokeStyle = ''; lineWidth = 1; globalAlpha = 1; lineJoin = 'round'; lineCap = 'round';
  save() {} restore() {} beginPath() {} moveTo(_x: number, _y: number) {} lineTo(_x: number, _y: number) {} closePath() {}
  fill() {} stroke() {} rect() {} arc() {} clip() {} setLineDash() {} drawImage() {} fillRect() {} clearRect() {}
  getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
  context() { return this as unknown as CanvasRenderingContext2D; }
}
it('REAL cold viewport only attests an actual draw; query completion cannot upgrade an old paint', async () => {
  const { openParentViewport } = await import('../src/ui/urbanParentViewport');
  const { backend, manifest } = await saved(), native = api(), view = await openParentViewport(backend, parentStateFromManifest(manifest), native);
  expect(view.evidence()).toMatchObject({ phase: 'not-painted', active: false });
  view.ensureViewport([120, 120, 180, 180]); await vi.waitFor(() => expect(view.stats.residentMembers).toBe(2));
  const ctx = new ParentCanvasSink().context(), appearance = { style: 'cartographic', diagnostic: 'none' } as const;
  view.draw(ctx, { viewport: { minX: 120, minY: 120, maxX: 180, maxY: 180 }, metresPerPixel: 1, appearance }, false);
  const first = view.evidence(); expect(first).toMatchObject({ phase: 'committed', active: true, coverage: 'exact',
    commit: { state: 'committed', sourceValidation: 'committed-manifest-and-reference', totalRequests: 1, durableRequests: 1, sourceChunks: 1, logicalBatches: 1 },
    nativeRelease: { recordedStatus: null }, draw: { serial: 1, viewport: [120, 120, 180, 180] } });
  view.ensureViewport([125, 125, 175, 175]); await vi.waitFor(() => expect(view.stats.pending).toBe(false));
  expect(view.evidence()).toEqual(first); // async query alone is NOT a new paint
  view.draw(ctx, { viewport: { minX: 125, minY: 125, maxX: 175, maxY: 175 }, metresPerPixel: 1, appearance }, false);
  expect(view.evidence()).toMatchObject({ draw: { serial: 2, viewport: [125, 125, 175, 175] } });
  view.dispose(); expect(view.evidence()).toMatchObject({ phase: 'not-painted', active: false });
});
it('REAL visible scheduler/detail uses the archived parent and current draw evidence, not global cache totals', async () => {
  const { openParentViewport } = await import('../src/ui/urbanParentViewport');
  const { backend, manifest } = await saved(), native = api(), view = await openParentViewport(backend, parentStateFromManifest(manifest), native);
  view.ensureViewport([120, 120, 180, 180]); await vi.waitFor(() => expect(view.stats.residentMembers).toBe(2));
  const ctx = new ParentCanvasSink().context(), options = { viewport: { minX: 120, minY: 120, maxX: 180, maxY: 180 }, metresPerPixel: .1,
    appearance: { style: 'cartographic', diagnostic: 'none' } as const };
  view.draw(ctx, options, true); expect(view.evidence()).toMatchObject({ detail: { scope: 'current-draw', enabled: true, eligible: 1, visibleEligible: 1, pending: 1 } });
  await vi.waitFor(() => expect(view.details.stats.cachedParents).toBe(1));
  view.draw(ctx, options, true); expect(view.evidence()).toMatchObject({ detail: { eligible: 1, ready: 1, pending: 0, failed: 0 } });
  expect(native.realize).toHaveBeenCalledOnce(); expect(native.plan).not.toHaveBeenCalled(); view.dispose();
});
