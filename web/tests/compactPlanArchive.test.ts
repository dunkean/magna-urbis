import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archivePlanBatch, clearPlanArchiveCache, isArchivedPlan, PLAN_ARCHIVE_CACHE_BYTES,
  planArchiveCacheStats, registerPlanArchives, resolveArchivedPlan,
  type ArchivedPlanReference,
} from '../../rust/bridge/compactPlanArchive';
import type { PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { gzipPlanBytes } from '../src/io/planArchiveCompression';
import * as compression from '../src/io/planArchiveCompression';

const native = (id: string, payload = '') => ({
  format: 'compact-plan-1', generator_version: 'houses-2', catalogue_version: 'atlas-houses-2',
  recipe_id: 'EUR-MED-B02', variant_id: 'default',
  config: { seed: `city\n${id}/Élévation`, orientation_deg: 27.5, count: 1 },
  parameters: [{ set: { width_m: [5.5600000000000005, 5.5600000000000005], courtyard_ratio: [0.41500000000000004, 0.41500000000000004] }, remove: [] }],
  surfaces: [[{ outer: [{ x: 0, y: 0 }, { x: 8.5, y: 0 }, { x: 8.5, y: 12 }, { x: 0, y: 12 }], holes: [] }]],
  bodies: [{ footprint: 0, levels: [0, 0], parameters: 0 }], payload,
});
const building = (id: string, payload = '') => ({ id, simplification: 'architectural_plan', resolved: native(id, payload) } as unknown as PlacedBuilding);
const batch = (buildings: PlacedBuilding[]): PlacementBatch => ({ schema_version: '1', generator_version: 'architectural-plans-1', buildings, refusals: [], open_spaces: [] });
const ref = (building: PlacedBuilding) => building.resolved as ArchivedPlanReference;

describe('lossless retained-plan scene archives', () => {
  beforeEach(clearPlanArchiveCache);
  afterEach(() => vi.restoreAllMocks());

  it('archives once per 64 plans without changing the input or materializing detail', async () => {
    const input = batch(Array.from({ length: 65 }, (_, index) => building(String(index))));
    const snapshot = structuredClone(input);
    const archived = await archivePlanBatch(input);
    expect(input).toEqual(snapshot);
    expect(Object.keys(archived.plan_archives!)).toHaveLength(2);
    expect(archived.buildings.every(value => isArchivedPlan(value.resolved))).toBe(true);
    expect(ref(archived.buildings[0]).archive_id).toBe(ref(archived.buildings[63]).archive_id);
    expect(ref(archived.buildings[64]).archive_id).not.toBe(ref(archived.buildings[63]).archive_id);
    expect(ref(archived.buildings[63]).index).toBe(63);
    expect(ref(archived.buildings[64]).index).toBe(0);
    expect(planArchiveCacheStats()).toMatchObject({ entries: 0, bytes: 0, misses: 0 });
    expect(await resolveArchivedPlan(archived.buildings[64])).toEqual(snapshot.buildings[64].resolved);
    expect(planArchiveCacheStats()).toMatchObject({ entries: 1, misses: 1 });
  });

  it('restores serialized scenes exactly, including seeds, geometry and IEEE doubles', async () => {
    const input = batch([building('one'), building('two')]);
    const archived = await archivePlanBatch(input);
    const restored: PlacementBatch = JSON.parse(JSON.stringify(archived));
    await expect(resolveArchivedPlan(restored.buildings[0])).rejects.toThrow('register the restored scene');
    registerPlanArchives(restored);
    expect(planArchiveCacheStats().misses).toBe(0);
    for (let index = 0; index < input.buildings.length; index++) {
      expect(await resolveArchivedPlan(restored.buildings[index])).toEqual(input.buildings[index].resolved);
    }
    expect(planArchiveCacheStats()).toMatchObject({ misses: 1, hits: 1 });
  });

  it('uses deterministic gzip and identity and preserves existing archive references', async () => {
    const input = batch([building('deterministic')]);
    const first = await archivePlanBatch(input), second = await archivePlanBatch(input);
    expect(first).toEqual(second);
    expect(await archivePlanBatch(first)).toBe(first);
    expect(Object.keys(first.plan_archives!)).toHaveLength(1);
  });

  it('shares exact visible surfaces per building and authored records per chunk without changing values', async () => {
    const footprint = native('surface').surfaces[0];
    const materials = { frame: 'timber', infill: 'stone', coating: '', cladding: '', base: 'stone', roof_frame: 'timber' };
    const volume = {
      id: 'main', footprint, levels: [{ index: 0, footprint, z_m: 0, height_m: 3, materials }],
      materials, roof_spec: { axis: 'longitudinal', tiers: 1, round_segments: 16 },
      foundation: { footprint, z_min_m: 0, z_max_m: 0 },
    };
    // JSON roundtrip deliberately reproduces independently parsed native fields.
    const input = batch(Array.from({ length: 65 }, (_, index) => JSON.parse(JSON.stringify({
      ...building(String(index)), footprint, roof_footprint: footprint, courtyards: [], circulation: [],
      volumes: [volume], structural_foundations: [volume.foundation],
    }))));
    const before = JSON.stringify(input);
    const archived = await archivePlanBatch(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(input.buildings[0].volumes[0].footprint).not.toBe(input.buildings[0].footprint);
    expect(archived.buildings.map(({ resolved: _resolved, ...visible }) => visible))
      .toEqual(input.buildings.map(({ resolved: _resolved, ...visible }) => visible));
    const first = archived.buildings[0], last = archived.buildings[64];
    expect(first.volumes[0].footprint).toBe(first.footprint);
    expect(first.roof_footprint).toBe(first.footprint);
    expect(first.volumes[0].levels[0].footprint).toBe(first.footprint);
    expect(first.volumes[0].foundation.footprint).toBe(first.footprint);
    expect(first.structural_foundations![0].footprint).toBe(first.footprint);
    expect(first.volumes[0].levels[0].materials).toBe(first.volumes[0].materials);
    expect(archived.buildings[63].volumes[0].materials).toBe(first.volumes[0].materials);
    expect(archived.buildings[63].volumes[0].roof_spec).toBe(first.volumes[0].roof_spec);
    expect(last.volumes[0].materials).not.toBe(first.volumes[0].materials);
    expect(last.volumes[0].roof_spec).not.toBe(first.volumes[0].roof_spec);
    expect(archived.buildings[1].footprint).not.toBe(first.footprint);
    const transferred = structuredClone(archived);
    expect(transferred.buildings[0].volumes[0].levels[0].footprint).toBe(transferred.buildings[0].footprint);
    expect(transferred.buildings[63].volumes[0].materials).toBe(transferred.buildings[0].volumes[0].materials);
    expect(await archivePlanBatch(archived)).toBe(archived);
  });

  it('does not merge signed zero or adjacent floating-point coordinates', async () => {
    const footprint = native('surface').surfaces[0];
    const roof_footprint = structuredClone(footprint);
    roof_footprint[0].outer[0].x = -0;
    const courtyards = structuredClone(footprint);
    courtyards[0].outer[1].x = 8.500000000000002;
    const input = batch([{ ...building('exact'), footprint, roof_footprint, courtyards, circulation: [], volumes: [] }]);
    const archived = await archivePlanBatch(input), result = archived.buildings[0];
    expect(result.roof_footprint).not.toBe(result.footprint);
    expect(Object.is(result.roof_footprint[0].outer[0].x, -0)).toBe(true);
    expect(result.courtyards).not.toBe(result.footprint);
    expect(result.courtyards[0].outer[1].x).toBe(8.500000000000002);
  });

  it('keeps worker-local synchronous gzip byte-identical to asynchronous UI compression', async () => {
    const raw = new TextEncoder().encode(JSON.stringify(native('worker')));
    const asynchronous = await gzipPlanBytes(raw.slice());
    // Exercise only the context discriminator. Plans and compression remain real.
    vi.stubGlobal('WorkerGlobalScope', { prototype: Object.getPrototypeOf(globalThis) });
    try { expect(await gzipPlanBytes(raw.slice())).toEqual(asynchronous); }
    finally { vi.unstubAllGlobals(); }
  });

  it('returns independent selected objects so editing one cannot mutate future replay', async () => {
    const archived = await archivePlanBatch(batch([building('immutable')]));
    const first = await resolveArchivedPlan(archived.buildings[0]) as ReturnType<typeof native>;
    first.config.seed = 'changed'; first.surfaces[0][0].outer[0].x = 999;
    expect(await resolveArchivedPlan(archived.buildings[0])).toEqual(native('immutable'));
    expect(planArchiveCacheStats()).toMatchObject({ entries: 1, hits: 1 });
  });

  it('decodes one cold archive once for two concurrent consumers and parses independent records', async () => {
    const archived = await archivePlanBatch(batch([building('concurrent-one'), building('concurrent-two')]));
    const gunzip = vi.spyOn(compression, 'gunzipPlanBytes'); // Real asynchronous decompression.
    const [first, second] = await Promise.all(archived.buildings.map(value => resolveArchivedPlan(value))) as ReturnType<typeof native>[];
    expect(gunzip).toHaveBeenCalledTimes(1);
    expect(planArchiveCacheStats()).toMatchObject({ entries: 1, misses: 1, hits: 0 });
    expect(first).toEqual(native('concurrent-one'));
    expect(second).toEqual(native('concurrent-two'));
    expect(first.surfaces).not.toBe(second.surfaces);
    first.config.seed = 'caller mutation'; first.surfaces[0][0].outer[0].x = 123;
    expect(second).toEqual(native('concurrent-two'));
    expect(await resolveArchivedPlan(archived.buildings[0])).toEqual(native('concurrent-one'));
    expect(gunzip).toHaveBeenCalledTimes(1);
  });

  it('shares a failed decode only while pending and permits a clean retry', async () => {
    const archived = await archivePlanBatch(batch([building('retry')]));
    const gunzip = vi.spyOn(compression, 'gunzipPlanBytes').mockRejectedValueOnce(new Error('transient decoder failure'));
    const outcomes = await Promise.allSettled([
      resolveArchivedPlan(archived.buildings[0]), resolveArchivedPlan(archived.buildings[0]),
    ]);
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') expect(String(outcome.reason)).toContain('transient decoder failure');
    }
    expect(gunzip).toHaveBeenCalledTimes(1);
    expect(planArchiveCacheStats()).toMatchObject({ entries: 0, bytes: 0, misses: 1 });
    expect(await resolveArchivedPlan(archived.buildings[0])).toEqual(native('retry'));
    expect(gunzip).toHaveBeenCalledTimes(2);
    expect(planArchiveCacheStats()).toMatchObject({ entries: 1, misses: 2 });
  });

  it('does not share different source strings under the same claimed archive identity', async () => {
    const valid = await archivePlanBatch(batch([building('valid-source')]));
    const other = await archivePlanBatch(batch([building('different-source')]));
    const id = ref(valid.buildings[0]).archive_id;
    const forged = { buildings: valid.buildings, plan_archives: { [id]: Object.values(other.plan_archives!)[0] } };
    const gunzip = vi.spyOn(compression, 'gunzipPlanBytes');
    // Try both arrival orders: neither a valid promise nor an invalid one can
    // answer the other source's request or suppress its SHA integrity check.
    for (const validFirst of [true, false]) {
      clearPlanArchiveCache(); gunzip.mockClear();
      const good = () => resolveArchivedPlan(valid.buildings[0], valid);
      const bad = () => resolveArchivedPlan(valid.buildings[0], forged);
      const [first, second] = await Promise.allSettled(validFirst ? [good(), bad()] : [bad(), good()]);
      const accepted = validFirst ? first : second, rejected = validFirst ? second : first;
      expect(accepted).toEqual({ status: 'fulfilled', value: native('valid-source') });
      expect(rejected.status).toBe('rejected');
      if (rejected.status === 'rejected') expect(String(rejected.reason)).toContain('integrity mismatch');
      expect(gunzip).toHaveBeenCalledTimes(1);
      expect(planArchiveCacheStats()).toMatchObject({ entries: 1, misses: 2 });
    }
  });

  it('clears in-flight ownership without cancelling consumers or overwriting the new cache epoch', async () => {
    const archived = await archivePlanBatch(batch([building('cache-epoch')]));
    const realGunzip = compression.gunzipPlanBytes;
    const gates = Array.from({ length: 2 }, () => {
      let release!: () => void;
      const promise = new Promise<void>(resolve => { release = resolve; });
      return { promise, release };
    });
    let calls = 0;
    const gunzip = vi.spyOn(compression, 'gunzipPlanBytes').mockImplementation(async bytes => {
      const gate = gates[calls++];
      const raw = await realGunzip(bytes);
      if (gate) await gate.promise;
      return raw;
    });
    const old = resolveArchivedPlan(archived.buildings[0]);
    await vi.waitFor(() => expect(gunzip).toHaveBeenCalledTimes(1));
    clearPlanArchiveCache();
    const current = resolveArchivedPlan(archived.buildings[0]);
    await vi.waitFor(() => expect(gunzip).toHaveBeenCalledTimes(2));
    gates[0].release();
    expect(await old).toEqual(native('cache-epoch'));
    // The old consumer finishes normally, but may not refill the cleared cache
    // or remove the current generation's pending identity.
    expect(planArchiveCacheStats()).toMatchObject({ entries: 0, bytes: 0, misses: 1, hits: 0 });
    const joined = resolveArchivedPlan(archived.buildings[0]);
    expect(planArchiveCacheStats().misses).toBe(1);
    gates[1].release();
    const [a, b] = await Promise.all([current, joined]);
    expect(a).toEqual(native('cache-epoch')); expect(b).toEqual(a); expect(b).not.toBe(a);
    expect(gunzip).toHaveBeenCalledTimes(2);
    expect(planArchiveCacheStats()).toMatchObject({ entries: 1, misses: 1, hits: 0 });
  });

  it('evicts the least recently used archive after two decoded chunks', async () => {
    const scenes = [];
    for (const id of ['a', 'b', 'c']) scenes.push(await archivePlanBatch(batch([building(id)])));
    await resolveArchivedPlan(scenes[0].buildings[0]);
    await resolveArchivedPlan(scenes[1].buildings[0]);
    await resolveArchivedPlan(scenes[0].buildings[0]);
    await resolveArchivedPlan(scenes[2].buildings[0]);
    expect(planArchiveCacheStats()).toMatchObject({ entries: 2, misses: 3, hits: 1, evictions: 1 });
    expect(planArchiveCacheStats().ids).toEqual([ref(scenes[0].buildings[0]).archive_id, ref(scenes[2].buildings[0]).archive_id]);
    await resolveArchivedPlan(scenes[1].buildings[0]);
    expect(planArchiveCacheStats()).toMatchObject({ entries: 2, misses: 4, evictions: 2 });
  });

  it('enforces the 8 MiB payload cache budget even with only two archives', async () => {
    const first = await archivePlanBatch(batch([building('large-one', 'x'.repeat(5 * 1024 * 1024))]));
    const second = await archivePlanBatch(batch([building('large-two', 'y'.repeat(5 * 1024 * 1024))]));
    await resolveArchivedPlan(first.buildings[0]);
    expect(planArchiveCacheStats().bytes).toBeGreaterThan(5 * 1024 * 1024);
    await resolveArchivedPlan(second.buildings[0]);
    expect(planArchiveCacheStats()).toMatchObject({ entries: 1, evictions: 1 });
    expect(planArchiveCacheStats().bytes).toBeLessThanOrEqual(PLAN_ARCHIVE_CACHE_BYTES);
  });

  it('can restore an archive larger than the cache without retaining it', async () => {
    const archived = await archivePlanBatch(batch([building('uncached', 'z'.repeat(9 * 1024 * 1024))]));
    const restored = await resolveArchivedPlan(archived.buildings[0]) as ReturnType<typeof native>;
    expect(restored.payload.length).toBe(9 * 1024 * 1024);
    expect(planArchiveCacheStats()).toMatchObject({ entries: 0, bytes: 0, misses: 1 });
  });

  it('rejects missing archives, altered bytes and bad references instead of regenerating', async () => {
    const archived = await archivePlanBatch(batch([building('corrupt')]));
    const parsed: PlacementBatch = JSON.parse(JSON.stringify(archived));
    expect(() => registerPlanArchives({ buildings: parsed.buildings })).toThrow('Missing retained-plan archive');
    const id = ref(parsed.buildings[0]).archive_id, source = parsed.plan_archives![id];
    const middle = Math.floor(source.length / 2);
    parsed.plan_archives![id] = source.slice(0, middle) + (source[middle] === 'A' ? 'B' : 'A') + source.slice(middle + 1);
    await expect(resolveArchivedPlan(parsed.buildings[0], parsed)).rejects.toThrow('integrity mismatch');
    const invalid = { ...archived.buildings[0], resolved: { ...ref(archived.buildings[0]), index: -1 } };
    await expect(resolveArchivedPlan(invalid, archived)).rejects.toThrow('Invalid retained-plan archive reference');
    const absent = { ...archived.buildings[0], resolved: { ...ref(archived.buildings[0]), index: 2 } };
    await expect(resolveArchivedPlan(absent, archived)).rejects.toThrow('record index');
  });

  it('passes legacy native plans through without compression or mutation', async () => {
    const detailed = { ...building('legacy'), simplification: 'recipe_volumes' as const, resolved: { schema_version: '2', seed: 'existing' } };
    const input = batch([detailed]);
    expect(await archivePlanBatch(input)).toBe(input);
    expect(await resolveArchivedPlan(detailed)).toBe(detailed.resolved);
    expect(planArchiveCacheStats()).toMatchObject({ entries: 0, misses: 0 });
  });
});
