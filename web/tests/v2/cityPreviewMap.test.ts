import { expect, it } from 'vitest';
import { packMinimalFeatures, unpackMinimalFeatures } from '../../src/v2/cityPreviewMap';
import type { MinimalFeature } from '../../src/render/minimalMap';

it('transfers exact shared-painter paths, retaining feature order, open streets and courtyard holes', () => {
  const ring = [{ x: -1.000001, y: 9 }, { x: 5, y: 13 }, { x: 11.25, y: 2.5 }];
  const source: MinimalFeature[] = [
    { layer: 'streetMinor', points: ring, closed: false, holes: undefined },
    { layer: 'building', points: ring, closed: true, holes: [ring.slice().reverse(), ring] },
    { layer: 'streetMinor', points: [], closed: false, holes: undefined },
  ];
  const packed = packMinimalFeatures(source);
  const received = structuredClone(packed, { transfer: [packed.coords.buffer, packed.rings.buffer] });
  expect(packed.coords.byteLength).toBe(0);
  expect([...unpackMinimalFeatures(received)]).toEqual(source);
  expect([...unpackMinimalFeatures(packMinimalFeatures([]))]).toEqual([]);
});
