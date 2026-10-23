import { describe, expect, it, vi } from 'vitest';
import { placeArchitectureBatches, placeArchitectureSource, streamArchitectureBatches, streamArchitectureSource } from '../../rust/bridge/architectureBatch';
import type { PlacementBatch, PlacementBatchRequest, PlacementRequest, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch, planArchiveCacheStats } from '../../rust/bridge/compactPlanArchive';

const surface = (x: number) => [{ outer: [{ x, y: 0 }, { x: x + 10, y: 0 }, { x: x + 10, y: 10 }, { x, y: 10 }], holes: [] }];
const request = (id: number): PlacementRequest => ({ id: String(id), parcel_id: String(id), seed: `seed/${id}`, cadastral: surface(id * 10), neighbors: [] } as unknown as PlacementRequest);
const empty = (): PlacementBatch => ({ schema_version: '1', generator_version: 'test', buildings: [], refusals: [], open_spaces: [] });

describe('native architecture transport', () => {
  it('streams only a summary with the same archived chunks, retries and cross-page neighbours as collection, waiting for ACK', async () => {
    const requests = Array.from({ length: 65 }, (_, id) => request(id));
    requests[32] = { ...requests[32], cadastral: surface(310) };
    requests[48] = { ...requests[48], cadastral: surface(470) };
    const collectedCalls: PlacementBatchRequest[] = [], streamedCalls: PlacementBatchRequest[] = [];
    const collectedChunks: PlacementBatch[] = [], streamedChunks: PlacementBatch[] = [];
    const cacheBefore = planArchiveCacheStats();
    const place = (calls: PlacementBatchRequest[]) => async (batch: PlacementBatchRequest): Promise<PlacementBatch> => {
      calls.push(structuredClone(batch));
      if (batch.requests.length > 32) throw new Error('[output_budget]');
      const last = batch.requests.at(-1)!;
      const building = { id: last.id, footprint: surface(Number(last.id) * 10), courtyards: surface(Number(last.id) * 10 + 2),
        circulation: surface(Number(last.id) * 10 + 1), structural_features: [{ surface: surface(Number(last.id) * 10 + 3) }],
        volumes: [], ground_z_m: 0, simplification: 'architectural_plan', resolved: { format: 'compact-plan-1', seed: last.seed } } as unknown as PlacedBuilding;
      return archivePlanBatch({ ...empty(), buildings: [building],
        refusals: batch.requests.length > 1 ? [{ id: batch.requests[0].id, parcel_id: batch.requests[0].parcel_id, code: 'no-fit', message: 'fixture refusal', attempts: 1 }] : [],
        open_spaces: batch.requests.slice(1, -1).map(r => ({ id: r.id, parcel_id: r.parcel_id, surface: r.cadastral })),
      });
    };
    const collected = await placeArchitectureBatches({ schema_version: '1', requests }, place(collectedCalls), {
      onBatch: delta => { collectedChunks.push(structuredClone(delta)); },
    });
    let acknowledge!: () => void;
    const ack = new Promise<void>(resolve => { acknowledge = resolve; });
    let pages = 0;
    const streamed = streamArchitectureSource({ schema_version: '1' }, { total: requests.length,
      read: async (offset, limit) => { pages++; return requests.slice(offset, offset + Math.min(7, limit)); },
    }, place(streamedCalls), { onBatch: async (delta, progress, originals) => {
      expect(originals).toEqual(requests.slice(progress.start, progress.completed));
      streamedChunks.push(structuredClone(delta));
      if (progress.start === 0) {
        // Consumer mutation must not corrupt the only persistent worker data:
        // exact occupation surfaces used as neighbours after this ACK.
        delta.buildings[0].footprint[0].outer[0].x = -99999;
        await ack;
      }
    } });
    try {
      await vi.waitFor(() => expect(streamedChunks).toHaveLength(1));
      const pausedPages = pages;
      expect(streamedCalls).toHaveLength(2); // Failed 64, successful 32, awaiting ACK.
      await Promise.resolve();
      expect(pages).toBe(pausedPages); expect(streamedCalls).toHaveLength(2);
    } finally { acknowledge(); }
    const summary = await streamed;
    expect(summary).toEqual({ schema_version: collected.schema_version, generator_version: collected.generator_version,
      buildings: collected.buildings.length, refusals: collected.refusals.length, open_spaces: collected.open_spaces.length });
    expect(summary).toMatchObject({ buildings: 3, refusals: 3, open_spaces: 59 });
    expect(summary).not.toHaveProperty('plan_archives'); expect(summary).not.toHaveProperty('materials'); expect(summary).not.toHaveProperty('scene');
    expect(streamedCalls).toEqual(collectedCalls); expect(streamedChunks).toEqual(collectedChunks);
    expect(streamedCalls.find(batch => batch.requests[0].id === '32')!.requests[0].neighbors.map(n => n.id))
      .toEqual(['31/occupation/0', '31/occupation/1', '31/occupation/2', '31/occupation/3']);
    expect(planArchiveCacheStats()).toEqual(cacheBefore); // Registration/transfer never decodes an archive.
    let emptyChunks = 0;
    expect(await streamArchitectureBatches({ schema_version: '1', requests: [] }, async () => empty(), {
      onBatch: (_delta, progress, originals) => { emptyChunks++; expect(progress).toEqual({ start: 0, completed: 0, total: 0 }); expect(originals).toEqual([]); },
    })).toEqual({ schema_version: '1', generator_version: 'test', buildings: 0, refusals: 0, open_spaces: 0 });
    expect(emptyChunks).toBe(1);
  });
  it('bounds fetched short pages by the remaining bytes while preserving array chunk boundaries and ACK order', async () => {
    // Virtual byte weights exercise the real 24 MiB guard without allocating
    // tens of MiB of repetitive fixture strings or changing production limits.
    const budget = 24 * 1024 * 1024, siteBytes = 5 * 1024 * 1024;
    const encode = TextEncoder.prototype.encode;
    const meter = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (this: TextEncoder, text) {
      let value: { id?: string; seed?: string; requests?: PlacementRequest[] };
      try { value = JSON.parse(text ?? ''); } catch { return encode.call(this, text); }
      const size = value.requests ? value.requests.length * siteBytes + 64
        : value.seed?.startsWith('seed/') ? siteBytes : undefined;
      return size === undefined ? encode.call(this, text) : { byteLength: size } as ReturnType<TextEncoder['encode']>;
    });
    try {
      const requests = Array.from({ length: 9 }, (_, id) => request(id));
      const chunks: string[][] = [], arrayChunks: string[][] = [], reads: { offset: number; maxBytes: number }[] = [];
      let readUntil = 0, acknowledged = 0, peakRetainedBytes = 0;
      await placeArchitectureSource({ schema_version: '1' }, { total: requests.length,
        async read(offset, limit, maxBytes = budget) {
          expect(offset).toBe(readUntil);
          reads.push({ offset, maxBytes });
          const page = requests.slice(offset, offset + Math.min(limit, 2, Math.floor(maxBytes / siteBytes)));
          readUntil += page.length;
          peakRetainedBytes = Math.max(peakRetainedBytes, (readUntil - acknowledged) * siteBytes);
          expect(peakRetainedBytes).toBeLessThanOrEqual(budget);
          return page;
        },
      }, async batch => {
        chunks.push(batch.requests.map(r => `${r.id}:${r.seed}`));
        return empty();
      }, { onBatch: async (_delta, progress, originals) => {
        expect(originals).toEqual(requests.slice(progress.start, progress.completed));
        expect(readUntil).toBe(progress.completed);
        const beforeYield = reads.length;
        await Promise.resolve();
        expect(reads).toHaveLength(beforeYield); // No prefetch before consumer ACK.
        acknowledged = progress.completed;
      } });
      expect(reads.slice(0, 3)).toEqual([
        { offset: 0, maxBytes: budget },
        { offset: 2, maxBytes: budget - 2 * siteBytes },
        { offset: 4, maxBytes: budget - 4 * siteBytes },
      ]);
      expect(peakRetainedBytes).toBe(4 * siteBytes);
      expect(chunks.map(chunk => chunk.length)).toEqual([4, 4, 1]);
      await placeArchitectureBatches({ schema_version: '1', requests }, async batch => {
        arrayChunks.push(batch.requests.map(r => `${r.id}:${r.seed}`));
        return empty();
      });
      expect(chunks).toEqual(arrayChunks);
    } finally { meter.mockRestore(); }
  });
  it('keeps order, original sites and cross-page neighbours when the source returns short pages', async () => {
    const requests = Array.from({ length: 130 }, (_, id) => request(id));
    requests[64] = { ...requests[64], cadastral: surface(630) };
    const before = structuredClone(requests), received: string[] = [], published: string[] = [];
    let readUntil = 0, acknowledged = 0, calls = 0;
    const result = await placeArchitectureSource({ schema_version: '1' }, {
      total: requests.length,
      async read(offset, limit) {
        expect(offset).toBe(readUntil);
        expect(limit).toBeLessThanOrEqual(64);
        expect(offset - acknowledged).toBeLessThan(64);
        const page = requests.slice(offset, offset + Math.min(7, limit));
        readUntil += page.length; return page;
      },
    }, async batch => {
      received.push(...batch.requests.map(r => r.id));
      if (++calls === 1) return { ...empty(), buildings: [{ id: 'accepted', footprint: surface(630), courtyards: [],
        circulation: surface(631), structural_features: [], volumes: [], ground_z_m: 0 } as unknown as PlacedBuilding] };
      if (calls === 2) expect(batch.requests[0].neighbors.map(n => n.footprint)).toEqual([surface(630), surface(631)]);
      return empty();
    }, { onBatch: async (_delta, progress, originals) => {
      expect(originals).toEqual(before.slice(progress.start, progress.completed));
      published.push(...originals.map(r => r.id));
      acknowledged = progress.completed;
    } });
    expect(calls).toBe(3); expect(result.buildings).toHaveLength(1);
    expect(received).toEqual(requests.map(r => r.id)); expect(published).toEqual(received);
    expect(requests).toEqual(before);

    await expect(placeArchitectureSource({ schema_version: '1' }, { total: 1, read: async () => [] }, async () => empty()))
      .rejects.toThrow('empty architecture source page');
    await expect(placeArchitectureSource({ schema_version: '1' }, { total: 2, read: async () => [request(0), request(0)] }, async () => empty()))
      .rejects.toThrow('Duplicate architecture request');
  });
  it('transports only imposed footprints belonging to the current chunk, including retries', async () => {
    const requests = Array.from({ length: 65 }, (_, id) => request(id));
    const footprints = Object.fromEntries(requests.map(r => [r.id, r.cadastral]));
    const received: string[] = [];
    const result = await placeArchitectureBatches({ schema_version: '1', requests, footprints }, async batch => {
      const chunk = batch as typeof batch & { footprints: typeof footprints };
      expect(Object.keys(chunk.footprints)).toEqual(chunk.requests.map(r => r.id));
      if (batch.requests.length > 32) throw new Error('[output_budget]');
      received.push(...batch.requests.map(r => r.id));
      return { ...empty(), plan_archives: { [batch.requests[0].id]: 'archive' } };
    });
    expect(received).toEqual(requests.map(r => r.id));
    expect(Object.keys(result.plan_archives!)).toEqual(['0', '32', '48']);
  });
  it('crosses the old 10,000-request limit in bounded calls without changing seeds or order', async () => {
    const requests = Array.from({ length: 10001 }, (_, id) => request(id)), received: string[] = [];
    const result = await placeArchitectureBatches({ schema_version: '1', requests }, async batch => {
      expect(batch.requests.length).toBeLessThanOrEqual(64);
      received.push(...batch.requests.map(r => `${r.id}:${r.seed}`));
      return { ...empty(), open_spaces: batch.requests.map(r => ({ id: r.id, parcel_id: r.parcel_id, surface: r.cadastral })) };
    });
    expect(received).toEqual(requests.map(r => `${r.id}:${r.seed}`));
    expect(result.open_spaces).toHaveLength(10001);
  });

  it('supplies previous-batch bodies and circulation as exact local neighbours', async () => {
    const requests = Array.from({ length: 65 }, (_, id) => request(id));
    requests[64] = { ...requests[64], cadastral: surface(630) };
    const original = structuredClone(requests);
    let calls = 0;
    await placeArchitectureBatches({ schema_version: '1', requests }, async batch => {
      calls++;
      if (calls === 1) return { ...empty(), buildings: [{ id: 'accepted', footprint: surface(630), courtyards: [], circulation: surface(631), structural_features: [], volumes: [], ground_z_m: 0 } as unknown as PlacedBuilding] };
      expect(batch.requests[0].neighbors.map(n => n.footprint)).toEqual([surface(630), surface(631)]);
      return empty();
    });
    expect(calls).toBe(2);
    expect(requests).toEqual(original);
  });

  it('stops superseded work between native calls', async () => {
    let cancelled = false, calls = 0;
    await expect(placeArchitectureBatches({ schema_version: '1', requests: Array.from({ length: 65 }, (_, id) => request(id)) }, async () => {
      calls++; cancelled = true; return empty();
    }, { cancelled: () => cancelled })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
  });
  it('retries oversized native output in smaller unchanged prefixes', async () => {
    const requests = Array.from({ length: 65 }, (_, id) => request(id)), accepted: string[] = [];
    const result = await placeArchitectureBatches({ schema_version: '1', requests }, async batch => {
      if (batch.requests.length > 7) throw new Error('[output_budget] Response exceeds native budget.');
      accepted.push(...batch.requests.map(r => r.id));
      return { ...empty(), open_spaces: batch.requests.map(r => ({ id: r.id, parcel_id: r.parcel_id, surface: r.cadastral })) };
    });
    expect(accepted).toEqual(requests.map(r => r.id));
    expect(result.open_spaces).toHaveLength(65);
  });
  it('queries extremely wide cadastral bounds without allocating every grid cell', async () => {
    const requests = Array.from({ length: 65 }, (_, id) => request(id));
    requests[64] = { ...requests[64], cadastral: [{ outer: [{ x: -1e12, y: -1e12 }, { x: 1e12, y: -1e12 }, { x: 1e12, y: 1e12 }, { x: -1e12, y: 1e12 }], holes: [] }] };
    let calls = 0;
    await placeArchitectureBatches({ schema_version: '1', requests }, async batch => {
      if (++calls === 1) return { ...empty(), buildings: [{ id: 'accepted', footprint: surface(0), courtyards: [], circulation: [], structural_features: [], volumes: [], ground_z_m: 0 } as unknown as PlacedBuilding] };
      expect(batch.requests[0].neighbors).toHaveLength(1); return empty();
    });
    expect(calls).toBe(2);
  });
});
