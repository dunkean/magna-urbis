import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Partition } from '../../rust/bridge/urban';
import {
  decodeParcelPack, isWholeParcelPack, materializePartitions, packHeader, packOf, partitionsFromPack, responsePartitions,
} from '../../rust/bridge/urbanParcelPack';
import { writeParcelPack as encode } from './helpers/parcelPackWriter';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Serde key order of the Rust structs, absent optionals omitted.
const pt = (x: number, y: number) => ({ x, y });
const square = { outer: [pt(0.1, 0.2), pt(10.000000000000002, 0), pt(10, 10), pt(-0.5, 10)], holes: [[pt(2, 2), pt(3, 2), pt(3, 3)]] };
const sample = (): any[] => [{
  config: { operator: 'culture', density: 1.0 },
  programme: {
    version: 1, population: 1200, context: { intent: 'settlement', resources: [], decay: null },
    cultures: [], demands: [{ id: 'main/demand/dwelling' }], reservations: [],
    allocations: [
      { parcelId: 'a/p1', demandId: 'main/demand/dwelling', function: 'dwelling', culture: 'european-organic', architecturePack: 'EUR-MED',
        capacity: 3.141592653589793, unit: 'domesticUnits', score: 0.1, reasons: ['Admissible access', 'é ok'], role: 'dwelling', label: 'Maison',
        landmark: false, households: 2.5,
        housingFloorNeed: { version: 'indicative-housing-floor-1', unit: 'useful_floor_m2', scope: 'housing_in_body_levels', requested_m2: 180.25,
          allocated_households: 2.5, basis: 'allocation_households_times_wealth_scaled_floor_allowance',
          model: { family: 'european', profile_provenance: 'catalogue-declared', calibration: 'not-assessed', floor_m2_per_household: 60,
            wealth: 0.4, wealth_factor: 1.02, effective_floor_m2_per_household: 61.2, persons_per_household: 4.5 } },
        districtRole: 'craft:tanners', wealth: 0.4 },
      { parcelId: 'lost/parcel', demandId: 'main/demand/civic', function: 'collective', culture: 'european-organic', architecturePack: 'EUR-MED',
        capacity: 309.169182462103, unit: 'usefulAreaM2', score: 0, reasons: [], role: '', label: '', landmark: true, households: 0,
        districtRole: '', wealth: 0 },
    ],
    adjacency: [{ a: 'a/p1', b: 'a/p2', sharedLength: 23.055473501579076 }, { a: 'a/p2', b: 'gone', sharedLength: 1e-9 }],
    environment: [
      { pressure: 0.38, block: 0, slope: 0.0025, wet: false, waterfront: true, height: 21.4, district: 3, water: 'river', waterHeight: 21.28 },
      { pressure: 0.26, block: 1, slope: 0.0034, wet: true, waterfront: false, height: 21.8, waterHeight: 0 },
    ],
    reconciliationPasses: 2, warnings: ['short'], housingCapacity: 4.5, navigableFrontage: false,
  },
  key: 'main',
  parcels: [
    { pressure: 0.4623577253345571, envelope: square, id: 'a/p1', parentIds: ['a', 'a/p0'], provenance: ['frontage-partition', 'occupied-yard-merge'],
      family: 'frontage', reason: 'admissible-envelope', contacts: [{ a: pt(1, 2), b: pt(3, 4.5), street: 128, rank: 1, length: 8.618524441141698, kind: 'public' }],
      shape: square, block: 0, use: 'plot', front: [pt(0.1, 0.2), pt(10.000000000000002, 0)], axis: pt(0.6, -0.8), rank: 2,
      access: { kind: 'public', street: null, frontLength: 8.5 } },
    { pressure: 0, id: 'a/p2', parentIds: [], provenance: [], family: '', reason: '', contacts: [],
      shape: { outer: [pt(5, 5), pt(6, 5), pt(6, 6)], holes: [] }, block: 1, use: 'garden', front: null, axis: pt(1, 0), rank: 0 },
  ],
  warnings: ['w'],
  diagnostics: { coveredArea: 536896.4433658267, residualArea: 0.02, overlapArea: 0, unservedArea: 2263.29 },
  enclosure: { plot: 0.55, field: 0, material: 'hedge', fieldMaterial: 'hedge', front: 0, side: 0.6, back: 1 },
}, {
  key: 'hamlet',
  parcels: [{ pressure: 0.5, id: 'h/p1', parentIds: ['h'], provenance: ['x'], family: 'f', reason: 'r', contacts: [],
    shape: { outer: [pt(1, 1), pt(2, 1), pt(2, 2)], holes: [] }, block: 0, use: 'plot', front: null, axis: pt(0, 1), rank: 1,
    access: { kind: 'unserved', street: 4, frontLength: 0 } }],
  warnings: [],
}];

describe('parcel pack', () => {
  it('transports planned residents separately from household counts', () => {
    const input = sample(); input[0].programme.allocations[0].residents = 2;
    const result = materializePartitions(decodeParcelPack(encode(input)));
    expect(result[0].programme!.allocations[0].residents).toBe(2);
    expect(result[0].programme!.allocations[0].households).toBe(2.5);
    expect(result[0].programme!.allocations[1].residents).toBeUndefined();
  });
  it('materialises the engine JSON exactly: keys, key order, absent optionals, numbers', () => {
    const expected = sample();
    const pack = decodeParcelPack(encode(expected, { id: 7, ms: 12.5, urbanSource: { version: 1, session: 's' } }));
    const partitions = materializePartitions(pack);
    expect(JSON.stringify(partitions)).toBe(JSON.stringify(expected));
    const [main, hamlet] = partitions;
    expect('envelope' in main.parcels[1]).toBe(false);
    expect('access' in main.parcels[1]).toBe(false);
    expect('housingFloorNeed' in main.programme!.allocations[1]).toBe(false);
    expect('district' in main.programme!.environment[1] || 'water' in main.programme!.environment[1]).toBe(false);
    expect('programme' in hamlet || 'config' in hamlet || 'diagnostics' in hamlet || 'enclosure' in hamlet).toBe(false);
    expect(main.parcels[0].shape.outer[1].x).toBe(10.000000000000002);
    expect(main.programme!.allocations[1].parcelId).toBe('lost/parcel');
    expect(main.programme!.adjacency[1].b).toBe('gone');
    expect(packHeader(pack.buffer)).toMatchObject({ id: 7, ms: 12.5, urbanSource: { session: 's' } });
  });

  it('views share the buffer and the memo returns the same array', () => {
    const buf = encode(sample());
    const pack = decodeParcelPack(buf);
    expect(pack.sections['parcels.coords'].buffer).toBe(buf);
    expect(pack.sections['parcels.coords']).toBeInstanceOf(Float64Array);
    const first = partitionsFromPack(buf);
    expect(partitionsFromPack(buf)).toBe(first);
    expect(responsePartitions({ partitionsPack: buf })).toBe(first);
    expect(packOf(first)).toBe(buf);
    expect(isWholeParcelPack(buf)).toBe(true);
  });

  it('refuses unknown formats, misaligned and truncated sections', () => {
    const buf = encode(sample());
    const header = packHeader(buf);
    const rewrite = (change: (h: any) => void): ArrayBuffer => {
      const h = structuredClone(header); change(h);
      const json = new TextEncoder().encode(JSON.stringify(h));
      let length = Math.max(json.length, new DataView(buf).getUint32(0, true));
      length += (8 - (4 + length) % 8) % 8;
      const out = new ArrayBuffer(buf.byteLength + length), bytes = new Uint8Array(out).fill(32, 4, 4 + length);
      bytes.set(json, 4); new DataView(out).setUint32(0, length, true);
      return out;
    };
    expect(() => decodeParcelPack(rewrite(h => { h.version = 2; }))).toThrow(/format/);
    expect(() => decodeParcelPack(rewrite(h => { h.sections['parcels.coords'].offset += 4; }))).toThrow(/misaligned/);
    expect(() => decodeParcelPack(rewrite(h => { h.sections['parcels.coords'].length += 1e6; }))).toThrow(/truncated/);
  });

  it('completes a partial pack (built capacity) with the base parcels', () => {
    const base = sample() as Partition[];
    const changed = sample();
    changed[0].programme.allocations[0].households = 3;
    const buf = encode(changed, {}, ['core', 'allocations', 'floorNeed', 'adjacency', 'environment']);
    expect(isWholeParcelPack(buf)).toBe(false);
    const partitions = partitionsFromPack(buf, base);
    expect(partitions[0].parcels).toBe(base[0].parcels);
    expect(JSON.stringify(partitions)).toBe(JSON.stringify(changed));
    expect(packOf(partitions)).toBeUndefined();
  });

  const fixture = new URL('./fixtures/parcel-pack', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  it.skipIf(!existsSync(`${fixture}.bin`) || !existsSync(`${fixture}.json`))('decodes the Rust fixture to its serde JSON', () => {
    const bin = readFileSync(`${fixture}.bin`);
    const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
    const json = JSON.parse(readFileSync(`${fixture}.json`, 'utf8'));
    const expected = Array.isArray(json) ? json : json.partitions;
    expect(JSON.stringify(materializePartitions(decodeParcelPack(buf)))).toBe(JSON.stringify(expected));
  });
});
