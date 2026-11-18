import { describe, expect, it, vi } from 'vitest';
import type { World } from '../src/gen/types';
import type { Partition } from '../../rust/bridge/urban';

// A stand-in for the engine's parcel pack with the bridge's contract: materialisation memoised per buffer,
// and a registry from each materialised array back to its pack.
const fake = vi.hoisted(() => {
  const memo = new WeakMap<ArrayBuffer, unknown[]>(),
    packs = new WeakMap<object, ArrayBuffer>();
  return {
    partitionsFromPack(buffer: ArrayBuffer): unknown[] {
      let partitions = memo.get(buffer);
      if (!partitions) {
        partitions = JSON.parse(new TextDecoder().decode(buffer)) as unknown[];
        memo.set(buffer, partitions);
        packs.set(partitions, buffer);
      }
      return partitions;
    },
    packOf: (partitions: object): ArrayBuffer | undefined => packs.get(partitions),
  };
});
vi.mock('../../rust/bridge/urbanParcelPack', () => ({ partitionsFromPack: fake.partitionsFromPack, packOf: fake.packOf }));
import { packOf, partitionsFromPack } from '../../rust/bridge/urbanParcelPack';
import { packWorldPartitions, unpackWorldPartitions } from '../src/v2/urbanPack';

const partition = (key: string, n: number): Partition =>
  ({
    key,
    parcels: Array.from({ length: n }, (_, i) => ({
      id: `${key}-${i}`,
      use: 'house',
      shape: {
        outer: [
          { x: i, y: 0 },
          { x: i + 1, y: 0 },
          { x: i + 1, y: 1 },
        ],
        holes: [],
      },
    })),
    warnings: [],
  }) as unknown as Partition;
const engineReply = (partitions: Partition[]): ArrayBuffer => new TextEncoder().encode(JSON.stringify(partitions)).buffer as ArrayBuffer;
type Cities = Record<string, { partitions?: Partition[]; cadastralPartitions?: Partition[]; programmePartitions?: Partition[] }>;
const citiesOf = (world: World) => world.debug!.v2RustCities as Cities;

function world(): { world: World; programme: Partition[]; cadastre: Partition[]; merged: Partition[]; marker: Partition[] } {
  const programme = partitionsFromPack(engineReply([partition('a', 3)])) as Partition[];
  const cadastre = partitionsFromPack(engineReply([partition('a', 2)])) as Partition[];
  const merged = [partition('b', 1)],
    marker: Partition[] = [];
  const cities: Cities = { a: { partitions: programme, cadastralPartitions: cadastre, programmePartitions: programme }, b: { partitions: merged, cadastralPartitions: marker } };
  return { world: { seed: 's', debug: { v2RustCities: cities, other: 1 } } as unknown as World, programme, cadastre, merged, marker };
}

describe('town partitions across postMessage', () => {
  it('transfers one pack copy per shared array and restores content and sharing', () => {
    const { world: source, programme, cadastre, merged } = world(),
      before = JSON.stringify(source);
    const packed = packWorldPartitions(source);
    expect(packed.transfer).toHaveLength(2);
    expect(JSON.stringify(source)).toBe(before);
    expect(citiesOf(source).a.partitions).toBe(programme);
    const sentA = citiesOf(packed.world).a;
    expect(sentA.partitions).toBe(sentA.programmePartitions);
    expect(sentA.partitions).not.toBe(programme);
    expect(citiesOf(packed.world).b).toBe(citiesOf(source).b);

    const received = unpackWorldPartitions(structuredClone(packed.world, { transfer: packed.transfer }));
    // The sender keeps its own pack: only the copies were transferred.
    expect(packed.transfer.every(buffer => buffer.byteLength === 0)).toBe(true);
    expect(packOf(programme)!.byteLength).toBeGreaterThan(0);
    const a = citiesOf(received).a,
      b = citiesOf(received).b;
    expect(a.partitions).toBe(a.programmePartitions);
    expect(a.partitions).toEqual(programme);
    expect(a.cadastralPartitions).toEqual(cadastre);
    expect(b.partitions).toEqual(merged);
    expect(b.cadastralPartitions).toEqual([]);
    expect(received.debug!.other).toBe(1);
    // A resend from the receiver packs the materialised arrays again.
    expect(packOf(a.partitions!)).toBeDefined();
    expect(packWorldPartitions(received).transfer).toHaveLength(2);
  });
  it('leaves a world without registered partitions as it is', () => {
    const plain = { seed: 's', debug: { v2RustCities: { b: { partitions: [partition('b', 1)] } } } } as unknown as World;
    expect(packWorldPartitions(plain)).toEqual({ world: plain, transfer: [] });
    expect(packWorldPartitions(plain).world).toBe(plain);
    const bare = { seed: 's' } as unknown as World;
    expect(packWorldPartitions(bare).world).toBe(bare);
    expect(unpackWorldPartitions(bare)).toBe(bare);
    expect(packWorldPartitions(undefined)).toEqual({ world: undefined, transfer: [] });
  });
});
