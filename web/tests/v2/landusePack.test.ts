import { describe, expect, it } from 'vitest';
import { packWorldLanduse, unpackWorldLanduse } from '../../src/v2/landusePack';
import type { World } from '../../src/gen/types';

const ring = (k: number, n: number) => Array.from({ length: n }, (_, i) => ({ x: k + i * 0.1 + 1e-9, y: -k - i / 3 }));

describe('packed land-use transport', () => {
  it('rebuilds the same areas, values and key order after a structured clone', () => {
    const areas = Array.from({ length: 80 }, (_, k) => ({
      kind: k % 2 ? 'field' : 'meadow', poly: ring(k, 3 + (k % 5)),
      ...(k % 3 === 0 ? { holes: [ring(k + 100, 4)] } : {}), ...(k % 7 === 0 ? { holes: undefined } : {}),
      ...(k % 4 === 0 ? { stripAngle: k / 10, strips: [ring(k + 200, 4), ring(k + 300, 5)] } : {}),
      ...(k % 9 === 0 ? { fieldLayout: 'parcel' } : {}),
    }));
    const world = { mapSize: 100, landuse: { areas, farmsteads: [], reserve: [] } } as unknown as World;
    const before = JSON.stringify(world);
    const { world: packed, transfer } = packWorldLanduse(world);
    expect(transfer.length).toBe(3);
    expect(JSON.stringify(world)).toBe(before);
    const received = unpackWorldLanduse(structuredClone(packed, { transfer }));
    expect(JSON.stringify(received)).toBe(before);
    expect(received.landuse!.areas.map(a => Object.keys(a))).toEqual(areas.map(a => Object.keys(a)));
    expect(unpackWorldLanduse(world)).toBe(world);
  });
});
