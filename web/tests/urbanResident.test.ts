import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Layout, Partition } from '../../rust/bridge/urban';
import type { SettlementRaster } from '../../rust/bridge/settlements';

// A package with the resident API (rust/crates/wasm/src/resident.rs): stages
// must pass ids, never re-send layouts/partitions JSON the instance holds.
const calls = vi.hoisted(() => ({ list: [] as string[], retained: [] as string[] }));
vi.mock('../../rust/pkg/wasm/magna_urbis_wasm.js', () => {
  class SettlementTerrain {
    private next = 0; private layouts = 0; private partitions = 0;
    free(): void {}
    set_urban_geometry(): void {}
    urban_quarters_resident(): string { calls.list.push('quarters'); this.layouts = ++this.next; this.partitions = 0; return JSON.stringify([{ key: 'town', culture: 'c', center: { x: 0, y: 0 }, quarters: [], streets: [], blocks: [], warnings: [] }]); }
    retain_layouts_json(json: string): number { calls.retained.push('layouts:' + json); this.layouts = ++this.next; this.partitions = 0; return this.layouts; }
    retain_partitions_json(json: string): number { calls.retained.push('partitions:' + json); return this.partitions = ++this.next; }
    resident_layouts_id(): number { return this.layouts; }
    resident_partitions_id(): number { return this.partitions; }
    resident_layouts_len(): number { return 1; }
    urban_parcels_resident(_seed: string, id: number): string {
      if (id !== this.layouts) throw new Error('[urban_resident_stale]');
      calls.list.push('parcels:' + id); this.partitions = ++this.next; return JSON.stringify([{ key: 'town', parcels: [], warnings: [] }]);
    }
    urban_programme_resident(l: number, p: number): string {
      if (l !== this.layouts || p !== this.partitions) throw new Error('[urban_resident_stale]');
      calls.list.push(`programme:${l}:${p}`); this.partitions = ++this.next; return JSON.stringify([{ key: 'town', parcels: [], warnings: ['p'] }]);
    }
    urban_building_sites_resident(_seed: string, l: number, p: number): string {
      if (l !== this.layouts || p !== this.partitions) throw new Error('[urban_resident_stale]');
      calls.list.push(`sites:${l}:${p}`); return '[{"id":"a"}]';
    }
    urban_building_sites_total_resident(): number { return 1; }
  }
  return { default: vi.fn(), SettlementTerrain };
});
import { createUrbanEngine } from '../../rust/bridge/urban';

const raster = (): SettlementRaster => ({ width: 100, n: 2, height: new Float32Array(4), water: new Uint8Array(4),
  waterLevel: new Float32Array(4), riverWidth: new Float32Array(4), riverIds: new Int32Array(4) });
afterEach(() => { vi.unstubAllGlobals(); calls.list.length = 0; calls.retained.length = 0; });

describe('resident urban products', () => {
  it('chains quarters, parcels, programme and building sites by ids without re-sending geometry', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0) }));
    const engine = await createUrbanEngine();
    const quarters = await engine.run({ id: 1, kind: 'quarters', seed: '42', raster: raster() });
    expect(quarters.error).toBeUndefined();
    const parcels = await engine.run({ id: 2, kind: 'parcels', seed: '42', layoutsId: 1 });
    expect(parcels.partitions).toHaveLength(1);
    // Same JS objects as the previous responses: ids only.
    const programme = await engine.run({ id: 3, kind: 'programme', seed: '42', layouts: quarters.layouts, partitions: parcels.partitions });
    expect(programme.partitions?.[0].warnings).toEqual(['p']);
    const sites = await engine.run({ id: 4, kind: 'buildingSites', seed: '42', layouts: quarters.layouts, partitions: programme.partitions });
    expect(sites.placementRequests).toEqual([{ id: 'a' }]);
    expect(calls.retained).toEqual([]);
    expect(calls.list).toEqual(['quarters', 'parcels:1', 'programme:1:2', 'sites:1:3']);
  });

  it('uploads explicit products once when they are not the resident ones', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0) }));
    const engine = await createUrbanEngine();
    await engine.run({ id: 1, kind: 'quarters', seed: '42', raster: raster() });
    const imported: Layout[] = [{ key: 'imported', culture: 'c', center: { x: 1.5, y: 0 }, quarters: [], streets: [], blocks: [], warnings: [] }];
    const partitions: Partition[] = [{ key: 'imported', parcels: [], warnings: [] } as unknown as Partition];
    const first = await engine.run({ id: 2, kind: 'buildingSites', seed: '42', layouts: imported, partitions });
    expect(first.error).toBeUndefined();
    expect(calls.retained).toEqual([`layouts:${JSON.stringify(imported)}`, `partitions:${JSON.stringify(partitions)}`]);
    await engine.run({ id: 3, kind: 'buildingSites', seed: '43', layouts: imported, partitions });
    expect(calls.retained).toHaveLength(2);
    expect(calls.list.slice(-2)).toEqual(['sites:2:3', 'sites:2:3']);
  });
});
