import { afterEach, expect, it, vi } from 'vitest';
import type { PlacedBuilding, PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch, clearPlanArchiveCache, isArchivedPlan, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';

const navigation = vi.hoisted(() => ({ openBench: vi.fn() }));
vi.mock('../src/ui/benchHistory', () => ({ openBench: navigation.openBench }));
import { openUrbanHouseCase, readUrbanHouseCase } from '../src/ui/urbanHouseTransfer';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); clearPlanArchiveCache(); });

it('commits only the selected resolved archive record before opening Maisons, and preserves legacy transfers', async () => {
  // A narrow asynchronous IDB mock: writes become visible at transaction commit,
  // and reads/writes cross a structured-clone boundary like real IndexedDB.
  const records = new Map<string, PlacedBuilding>(), events: string[] = [];
  const db = {
    createObjectStore: vi.fn(),
    transaction(_name: string, mode: IDBTransactionMode) {
      const tx = { oncomplete: undefined as (() => void) | undefined,
        objectStore: () => ({
          put(value: PlacedBuilding, key: string) {
            expect(mode).toBe('readwrite');
            const copied = structuredClone(value), result = { result: key };
            queueMicrotask(() => { records.set(key, copied); events.push(`commit:${key}`); tx.oncomplete?.(); });
            return result;
          },
          get(key: string) {
            expect(mode).toBe('readonly');
            const result = { result: undefined as PlacedBuilding | undefined };
            queueMicrotask(() => { result.result = structuredClone(records.get(key)); tx.oncomplete?.(); });
            return result;
          },
        }),
      };
      return tx;
    },
  };
  const open = vi.fn(() => {
    const request = { result: db, onupgradeneeded: undefined as (() => void) | undefined, onsuccess: undefined as (() => void) | undefined };
    queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
    return request;
  });
  vi.stubGlobal('indexedDB', { open });
  const windowStub: { parent?: unknown } = {}; windowStub.parent = windowStub;
  vi.stubGlobal('window', windowStub);
  navigation.openBench.mockImplementation((bench: string, query: URLSearchParams) => {
    expect(bench).toBe('houses');
    const key = query.get('placement')!;
    expect(records.has(key)).toBe(true);
    expect(events.at(-1)).toBe(`commit:${key}`);
    events.push(`open:${key}`);
  });

  const selectedPlan = { format: 'compact-plan-1', recipe_id: 'EUR-MED-B02', variant_id: 'default',
    config: { seed: 'selected-plan' }, bodies: [{ width_m: 5.5600000000000005 }] };
  const input: PlacementBatch = { schema_version: '1', generator_version: 'architectural-plans-1', refusals: [], open_spaces: [], buildings: [
    { id: 'selected', simplification: 'architectural_plan', resolved: selectedPlan } as unknown as PlacedBuilding,
    { id: 'unselected', simplification: 'architectural_plan', resolved: { format: 'compact-plan-1', config: { seed: 'DO-NOT-TRANSFER-NEIGHBOUR' } } } as unknown as PlacedBuilding,
  ] };
  // JSON restoration deliberately drops the registry associations. Passing the
  // optional scene must resolve this record without pre-registering the city.
  const scene: PlacementBatch = JSON.parse(JSON.stringify(await archivePlanBatch(input)));
  expect(isArchivedPlan(scene.buildings[0].resolved)).toBe(true);
  const before = JSON.stringify(scene), parse = vi.spyOn(JSON, 'parse');
  await openUrbanHouseCase(scene.buildings[0], scene);
  const parsedPlans = parse.mock.calls.filter(([text]) => typeof text === 'string' && text.includes('"format":"compact-plan-1"'));
  expect(parsedPlans).toHaveLength(1);
  expect(parsedPlans[0][0]).toContain('selected-plan');
  expect(parsedPlans[0][0]).not.toContain('DO-NOT-TRANSFER-NEIGHBOUR');
  parse.mockRestore();
  expect(JSON.stringify(scene)).toBe(before);
  expect(records.size).toBe(1);
  const key = navigation.openBench.mock.calls[0][1].get('placement') as string;
  expect(key).toMatch(/^placement-/);
  const persisted = await readUrbanHouseCase(key);
  expect(persisted).toEqual({ ...scene.buildings[0], resolved: selectedPlan });
  expect(isArchivedPlan(persisted.resolved)).toBe(false);
  expect(persisted).not.toHaveProperty('plan_archives');
  expect(JSON.stringify(persisted)).not.toContain('DO-NOT-TRANSFER-NEIGHBOUR');
  // A cold receiving page can consume the saved record with no scene/archive.
  clearPlanArchiveCache();
  expect(await resolveArchivedPlan(persisted)).toEqual(selectedPlan);
  expect(persisted.resolved).not.toBe(selectedPlan);

  const legacy = { id: 'legacy', simplification: 'detailed', resolved: { config: { seed: 'legacy-native' }, plan: { bodies: [] } } } as unknown as PlacedBuilding;
  const legacyBefore = structuredClone(legacy);
  await openUrbanHouseCase(legacy);
  const legacyKey = navigation.openBench.mock.calls[1][1].get('placement') as string;
  expect(await readUrbanHouseCase(legacyKey)).toEqual(legacyBefore);
  expect(legacy).toEqual(legacyBefore);
  expect(records.size).toBe(2);
  expect(navigation.openBench).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenCalledWith('magna-urban-house-cases', 1);
});
