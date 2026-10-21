import { describe, expect, it } from 'vitest';
import { placeArchitectureBatches } from '../../rust/bridge/architectureBatch';
import type { PlacementBatch, PlacementRequest, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';

const surface = (x: number) => [{ outer: [{ x, y: 0 }, { x: x + 10, y: 0 }, { x: x + 10, y: 10 }, { x, y: 10 }], holes: [] }];
const request = (id: number): PlacementRequest => ({ id: String(id), parcel_id: String(id), seed: `seed/${id}`, cadastral: surface(id * 10), neighbors: [] } as unknown as PlacementRequest);
const empty = (): PlacementBatch => ({ schema_version: '1', generator_version: 'test', buildings: [], refusals: [], open_spaces: [] });

describe('native architecture transport', () => {
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
