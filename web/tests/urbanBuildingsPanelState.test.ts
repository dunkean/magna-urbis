import { beforeAll, expect, it, vi } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import type { UrbanProgramme } from '../../rust/bridge/urban';
import { archivePlanBatch, isArchivedPlan, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import { beginUrbanBuildingStage, type BuildingChunkRead } from '../src/ui/urbanBuildingChunkStore';
import { ColdTestBackend, deferred } from './helpers/urbanBuildingColdTestBackend';
// DOM-only help/history edges are not exercised by the production state helper.
vi.mock('../src/ui/methodNotes', () => ({ openMethodNote: vi.fn() }));
vi.mock('../src/ui/benchHistory', () => ({ openBench: vi.fn() }));
import { createUrbanBuildingPanelState, urbanBuildingPanelCapacity, urbanBuildingPanelEvidence, urbanBuildingPanelSummary, urbanBuildingPanelRefusalsHtml,
  type UrbanBuildingGenerateResult, type UrbanBuildingState, type UrbanColdBuildingState } from '../src/ui/urbanBuildingsPanel';

const raw = fixture.chunks.map(chunk => chunk.delta as unknown as PlacementBatch);
let chunks: PlacementBatch[], cold: UrbanColdBuildingState;
const initial = (): UrbanBuildingState => ({ seed: 'initial', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' } });
beforeAll(async () => {
  chunks = await Promise.all(raw.map(archivePlanBatch));
  const backend = new ColdTestBackend(), stage = await beginUrbanBuildingStage(backend, { sceneId: 'cold-A', sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  for (let i = 0; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress);
  const manifest = await stage.commit();
  cold = { store: { format: manifest.format, sceneId: manifest.sceneId, fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint },
    counts: { schema_version: manifest.schema_version, generator_version: manifest.generator_version, buildings: manifest.buildings, refusals: manifest.refusals, open_spaces: manifest.openSpaces } };
});
function read(chunk: number, record = 0): BuildingChunkRead {
  const source = chunks[chunk], building = source.buildings[record];
  if (!isArchivedPlan(building.resolved)) throw new Error('Fixture must be archived');
  return { building, chunkIndex: chunk, scene: { schema_version: source.schema_version, generator_version: source.generator_version,
    buildings: [building], materials: source.materials, plan_archives: { [building.resolved.archive_id]: source.plan_archives![building.resolved.archive_id] } } };
}
function noNativeParent(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'buildings') expect(typeof child).toBe('number');
    else expect(['scene', 'resolved', 'plan_archives', 'volumes', 'parent'].includes(key)).toBe(false);
    noNativeParent(child);
  }
}

it('shows actual cold refusal messages once available, distinguishes archive-only metadata, and escapes markup', () => {
  const state = { ...initial(), cold }, refusals = raw.flatMap(chunk => chunk.refusals).map(({ id, parcel_id, code, message }) => ({ id, parcel_id, code, message }));
  expect(urbanBuildingPanelRefusalsHtml(state)).toContain('3 refus conservés dans l’archive');
  const detailed = urbanBuildingPanelRefusalsHtml(state, refusals);
  expect(detailed).not.toContain('indisponible'); expect((detailed.match(/data-refusal=/g) ?? []).length).toBe(3);
  for (const refusal of refusals) expect(detailed).toContain(refusal.parcel_id);
  expect(urbanBuildingPanelRefusalsHtml(state, [])).toBe(''); // a provided list differs from absent metadata
  expect(urbanBuildingPanelSummary(state)).toContain('3 refus'); // manifest counts do not depend on loaded rows
  expect(urbanBuildingPanelRefusalsHtml(state, [{ id: 'x', parcel_id: '"<parcel>', code: 'denied', message: '<script>&' }]))
    .toBe('<li data-refusal="&quot;&lt;parcel&gt;">&quot;&lt;parcel&gt; : &lt;script&gt;&amp;</li>');
  expect(urbanBuildingPanelRefusalsHtml({ ...initial(), scene: raw[0] })).toBe(urbanBuildingPanelRefusalsHtml(state, refusals.slice(0, 1)));
});

it('keeps legacy scene selection/open/export and rejects an absent legacy ID without a cold read', async () => {
  const readColdBuilding = vi.fn(), exportScene = vi.fn(), open = vi.fn().mockResolvedValue(undefined);
  const model = createUrbanBuildingPanelState({ ...initial(), scene: chunks[0] }, { readColdBuilding, exportScene });
  expect(urbanBuildingPanelSummary(model.state)).toBe('2 bâtiments · 1 refus · 0 espaces libres voulus');
  expect(model.select('absent')).toBe(false); expect(model.state.selected).toBeUndefined();
  expect(model.select(chunks[0].buildings[0].id)).toBe(true); await model.openSelected(open);
  expect(open).toHaveBeenCalledWith(chunks[0].buildings[0]); expect(readColdBuilding).not.toHaveBeenCalled();
  await model.exportCurrent(); expect(exportScene).toHaveBeenCalledWith(chunks[0]); expect(model.canExport).toBe(true);
});

it('reports cold global counts and unknown capacity without collecting native plans or reusing old programme capacity', () => {
  const readColdBuilding = vi.fn(), model = createUrbanBuildingPanelState(initial(), { readColdBuilding });
  const runtimeExtra = { ...cold, parent: chunks, store: { ...cold.store, parent: chunks[0] }, counts: { ...cold.counts, parent: chunks[1] } };
  model.replaceCold(runtimeExtra); expect(model.state.scene).toBeUndefined(); noNativeParent(model.state.cold);
  expect(urbanBuildingPanelSummary(model.state)).toBe('6 plans de bâtiments · 3 refus · 0 espaces libres voulus · capacité non évaluée');
  expect(urbanBuildingPanelCapacity(model.state, chunks[0].buildings[0])).toBe('capacité non évaluée');
  const programme = { demands: [{ builtCapacity: 1000, openCapacity: 100 }] } as unknown as UrbanProgramme;
  expect(urbanBuildingPanelEvidence(model.state)(programme)).toBe('not_calculated'); expect(readColdBuilding).not.toHaveBeenCalled();
});

it('applies both generation result types exclusively and preserves presentation/settings across source transitions', () => {
  const model = createUrbanBuildingPanelState({ ...initial(), visible: false, projection: true, appearance: { style: 'cartographic', diagnostic: 'height' } }, {});
  model.applyGenerated({ cold }, 'cold-seed', { floors: 2, parcel_fit: false });
  expect(model.state).toMatchObject({ seed: 'cold-seed', generated: true, visible: false, projection: true, appearance: { diagnostic: 'height' }, settings: { floors: 2, parcel_fit: false } });
  expect(model.state.scene).toBeUndefined(); expect(model.state.cold).toEqual(cold);
  model.applyGenerated({ scene: chunks[1] }, 'legacy-seed', {}); expect(model.state.scene).toBe(chunks[1]); expect(model.state.cold).toBeUndefined();
  model.replaceCold(cold); expect(model.state.scene).toBeUndefined(); model.replaceScene(chunks[0]); expect(model.state.cold).toBeUndefined();
  const before = model.state;
  expect(() => model.applyGenerated({ scene: chunks[0], cold } as unknown as UrbanBuildingGenerateResult, '', {})).toThrow('seule représentation');
  expect(() => model.restore({ ...initial(), scene: chunks[0], cold })).toThrow('à la fois'); expect(model.state).toBe(before);
  model.restore({ ...initial(), cold, settings: { floors: 3 } }); expect(model.state.scene).toBeUndefined();
  model.resetAppliedSettings(); expect(model.state.settings).toBeUndefined(); expect(model.state.cold).toEqual(cold);
  model.replaceCold(); expect(model.state.cold).toBeUndefined(); expect(model.state.scene).toBeUndefined();
});

it('serializes and coalesces selection reads, publishing only the latest real building with minimal archive context', async () => {
  const blocked = deferred(), started = deferred(); let active = 0, max = 0;
  const first = read(0), middle = read(1), latest = read(2), open = vi.fn().mockResolvedValue(undefined);
  const loader = vi.fn(async (_cold: UrbanColdBuildingState, id: string) => {
    active++; max = Math.max(max, active);
    try { if (id === first.building.id) { started.resolve(); await blocked.promise; return first; } return id === latest.building.id ? latest : middle; }
    finally { active--; }
  });
  const model = createUrbanBuildingPanelState({ ...initial(), cold }, { readColdBuilding: loader });
  model.select(first.building.id); await started.promise;
  expect(model.selection.status).toBe('pending'); await expect(model.openSelected(open)).rejects.toThrow('pas chargé');
  model.select(middle.building.id); model.select(latest.building.id); blocked.resolve(); await model.whenSelectionIdle();
  expect(loader.mock.calls.map(([, id]) => id)).toEqual([first.building.id, latest.building.id]); expect(max).toBe(1);
  expect(model.selection).toMatchObject({ status: 'ready', id: latest.building.id });
  await model.openSelected(open); expect(open).toHaveBeenCalledWith(latest.building, latest.scene);
  expect(latest.scene.buildings).toHaveLength(1); expect(await resolveArchivedPlan(latest.building, latest.scene)).toEqual(raw[2].buildings[0].resolved);
  model.select(latest.building.id); await model.whenSelectionIdle(); expect(loader).toHaveBeenCalledTimes(2);
});

it('guards source identity/generation and epoch even for the same selected ID after replacement or restore', async () => {
  const first = read(0), fresh = structuredClone(first), blocked = deferred(), started = deferred(), accepted: BuildingChunkRead[] = [];
  let calls = 0;
  const model = createUrbanBuildingPanelState({ ...initial(), cold }, { readColdBuilding: async () => {
    if (++calls === 1) { started.resolve(); await blocked.promise; return first; } return fresh;
  }, onUpdate: () => { if (model.selection.status === 'ready') accepted.push(model.selection.value); } });
  model.select(first.building.id); await started.promise;
  model.replaceCold({ ...cold, store: { ...cold.store, sceneId: 'cold-B' } });
  model.restore({ ...model.state, cold: { ...cold, store: { ...cold.store, sceneId: 'cold-B' } } });
  expect(model.selection.status).toBe('pending'); blocked.resolve(); await model.whenSelectionIdle();
  expect(calls).toBe(2); expect(accepted).toHaveLength(1); expect(accepted[0].building).toBe(fresh.building);
  expect(model.state.cold?.store.sceneId).toBe('cold-B');
});

it('normalizes finite display offsets without changing cold storage and rejects a selection reply for an old offset', async () => {
  const first = read(0), translatedRead = structuredClone(first), blocked = deferred(), started = deferred(), accepted: BuildingChunkRead[] = [];
  const calls: UrbanColdBuildingState[] = [];
  const model = createUrbanBuildingPanelState({ ...initial(), cold: { ...cold, offset: { x: 0, y: -0 } } }, { readColdBuilding: async value => {
    calls.push(value); if (calls.length === 1) { started.resolve(); await blocked.promise; return first; } return translatedRead;
  }, onUpdate: () => { if (model.selection.status === 'ready') accepted.push(model.selection.value); } });
  expect(model.state.cold?.offset).toBeUndefined();
  model.select(first.building.id); await started.promise;
  const offset = { x: 20, y: -30 }; model.replaceCold({ ...cold, offset }); offset.x = 999;
  expect(model.state.cold?.offset).toEqual({ x: 20, y: -30 }); expect(model.state.cold?.store).toEqual(cold.store);
  const before = model.state;
  for (const invalid of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }])
    expect(() => model.replaceCold({ ...cold, offset: invalid })).toThrow('coordonnées finies');
  expect(model.state).toBe(before); blocked.resolve(); await model.whenSelectionIdle();
  expect(calls).toHaveLength(2); expect(calls[1].offset).toEqual({ x: 20, y: -30 });
  expect(accepted).toHaveLength(1); expect(accepted[0].building).toBe(translatedRead.building);
});

it('copies and validates city ownership and discards a selected reply after only its city label changes', async () => {
  const first = read(0), fresh = structuredClone(first), blocked = deferred(), started = deferred(), seen: string[] = [], accepted: BuildingChunkRead[] = [];
  const model = createUrbanBuildingPanelState({ ...initial(), cold: { ...cold, cityKey: 'city-A' } }, { readColdBuilding: async value => {
    seen.push(value.cityKey!); if (seen.length === 1) { started.resolve(); await blocked.promise; return first; } return fresh;
  }, onUpdate: () => { if (model.selection.status === 'ready') accepted.push(model.selection.value); } });
  model.select(first.building.id); await started.promise; model.replaceCold({ ...cold, cityKey: 'city-B' });
  expect(model.state.cold?.cityKey).toBe('city-B'); const before = model.state;
  for (const key of ['', null, 22]) expect(() => model.replaceCold({ ...cold, cityKey: key as unknown as string })).toThrow('chaîne non vide');
  expect(model.state).toBe(before); blocked.resolve(); await model.whenSelectionIdle();
  expect(seen).toEqual(['city-A', 'city-B']); expect(accepted).toHaveLength(1); expect(accepted[0].building).toBe(fresh.building);
});

it('clears previous native context for missing/error selections and rejects wrong-building/archive contexts', async () => {
  const value = read(0), other = read(1), open = vi.fn().mockResolvedValue(undefined);
  const loader = vi.fn(async (_cold: UrbanColdBuildingState, id: string): Promise<BuildingChunkRead | undefined> => {
    if (id === 'missing') return undefined; if (id === 'error') throw new Error('site read failed');
    if (id === 'wrong') return other; return value;
  });
  const model = createUrbanBuildingPanelState({ ...initial(), cold }, { readColdBuilding: loader });
  model.select(value.building.id); await model.whenSelectionIdle(); expect(model.selection.status).toBe('ready');
  model.select('missing'); expect(model.selection.status).toBe('pending'); await model.whenSelectionIdle();
  expect(model.selection).toEqual({ status: 'missing', id: 'missing' }); await expect(model.openSelected(open)).rejects.toThrow('pas chargé');
  model.select('error'); await model.whenSelectionIdle(); expect(model.selection).toMatchObject({ status: 'error', message: 'site read failed' });
  model.select('wrong'); await model.whenSelectionIdle(); expect(model.selection).toMatchObject({ status: 'error' }); expect(open).not.toHaveBeenCalled();
  const invalid = createUrbanBuildingPanelState({ ...initial(), cold }, { readColdBuilding: async () => ({ ...value, scene: { ...value.scene, buildings: [structuredClone(value.building)] } }) });
  invalid.select(value.building.id); await invalid.whenSelectionIdle(); expect(invalid.selection.status).toBe('error');
  const unavailable = createUrbanBuildingPanelState({ ...initial(), cold }, {}); unavailable.select(value.building.id);
  expect(unavailable.selection).toMatchObject({ status: 'error', message: 'La lecture du bâtiment sélectionné est indisponible.' });
});

it('drops stale loads and their failures on invalidation or a return to the legacy scene', async () => {
  for (const transition of ['invalidate', 'legacy'] as const) {
    const gate = deferred(), started = deferred(), native = read(0);
    const model = createUrbanBuildingPanelState({ ...initial(), cold }, { readColdBuilding: async () => {
      started.resolve(); await gate.promise; throw new Error('obsolete read error');
    } });
    model.select(native.building.id); await started.promise;
    if (transition === 'invalidate') model.invalidate(); else model.replaceScene(chunks[0]);
    expect(model.selection.status).toBe('none'); expect(model.state.cold).toBeUndefined(); gate.resolve(); await model.whenSelectionIdle();
    expect(model.selection.status).toBe('none');
    if (transition === 'invalidate') { expect(model.state.scene).toBeUndefined(); expect(model.state.selected).toBeUndefined(); }
    else { const open = vi.fn().mockResolvedValue(undefined); await model.openSelected(open); expect(open).toHaveBeenCalledWith(native.building); }
  }
});

it('routes cold exports only to the full-stream callback, never legacy JSON, and exposes pending/failure/unavailable states', async () => {
  const exportScene = vi.fn(), unavailable = createUrbanBuildingPanelState({ ...initial(), cold }, { exportScene });
  expect(unavailable.canExport).toBe(false); await expect(unavailable.exportCurrent()).rejects.toThrow('export complet'); expect(exportScene).not.toHaveBeenCalled();
  const gate = deferred(), exportCold = vi.fn(async value => { noNativeParent(value); await gate.promise; });
  const model = createUrbanBuildingPanelState({ ...initial(), cold }, { exportScene, exportCold });
  expect(model.canExport).toBe(true); const exporting = model.exportCurrent(); expect(model.exporting).toBe(true); expect(model.canExport).toBe(false);
  await expect(model.exportCurrent()).rejects.toThrow('déjà en cours'); model.replaceScene(chunks[0]); gate.resolve(); await exporting;
  expect(exportCold).toHaveBeenCalledTimes(1); expect(exportCold.mock.calls[0][0]).toEqual(cold); expect(exportScene).not.toHaveBeenCalled();
  await model.exportCurrent(); expect(exportScene).toHaveBeenCalledWith(chunks[0]);
  const failing = createUrbanBuildingPanelState({ ...initial(), cold }, { exportCold: async () => { throw new Error('stream write failed'); } });
  await expect(failing.exportCurrent()).rejects.toThrow('stream write failed'); expect(failing.exporting).toBe(false); expect(failing.canExport).toBe(true);
});
