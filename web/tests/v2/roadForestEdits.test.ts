import { describe, expect, it } from 'vitest';
import { v2ForestOccupation } from '../../src/v2/displayForest';
import { forestOccupation } from '../../src/ui/forestOccupation';
import { setRoadPath } from '../../src/v2/networkEdits';
import { editableRoadGeometry } from '../../src/v2/roadControlModel';
import type { World } from '../../src/gen/types';

function sample(t: NonNullable<ReturnType<typeof forestOccupation>>, x: number, y: number) {
  const i = Math.floor(((x - t.x) / t.width) * t.n),
    j = Math.floor(((y - t.y) / t.width) * t.n);
  if (i < 0 || j < 0 || i >= t.n || j >= t.n) return [0, 0, 0, 0];
  return [...t.rgba.slice((j * t.n + i) * 4, (j * t.n + i) * 4 + 4)];
}
const path = [
  { x: 100, y: 300 },
  { x: 900, y: 300 },
];
function world(): World {
  return { seed: 'road-forest', mapSize: 1000, options: {}, stats: {}, roads: [{ path, kind: 'major', width: 6 }], bridges: [], terrain: { height: { w: 2, h: 2, cell: 500, data: new Float32Array(4).fill(20) }, water: new Uint8Array(4), rivers: [] } } as unknown as World;
}

describe('forest clearings follow edited roads', () => {
  it('clears a road on terrain without any rural land-use layer', () => {
    const w = world(),
      t = v2ForestOccupation(w)!;
    expect(t).toBeDefined();
    expect(sample(t, 500, 300)[0]).toBeGreaterThan(128);
    expect(sample(t, 500, 300)[2]).toBe(11);
    expect(t.ways?.[0].path).toBe(path);
  });
  it('moves the clearing beyond all fields, restores the former corridor and keeps the natural terrain', () => {
    const w = world();
    w.landuse = {
      areas: [
        {
          kind: 'field',
          poly: [
            { x: 50, y: 50 },
            { x: 100, y: 50 },
            { x: 100, y: 100 },
            { x: 50, y: 100 },
          ],
        },
      ],
      reserve: [],
      farmsteads: [],
    };
    const before = v2ForestOccupation(w)!;
    const next = setRoadPath(w, 0, [
        { x: 100, y: 700 },
        { x: 900, y: 700 },
      ]).world,
      after = v2ForestOccupation(next)!;
    expect(sample(before, 500, 300)[2]).toBe(11);
    expect(sample(after, 500, 700)[2]).toBe(11);
    expect(sample(after, 500, 300)[0]).toBeLessThan(128);
    expect(after.key).not.toBe(before.key);
    expect(next.terrain).toBe(w.terrain);
    expect(v2ForestOccupation(w)).toBe(before);
  });
  it('does not turn every computed mountain bend into a mandatory waypoint', () => {
    const road = { kind: 'major' as const, width: 5, path: Array.from({ length: 201 }, (_, i) => ({ x: 100 + i * 4, y: 500 + Math.sin(i * 0.4) * 80 })) };
    const original = structuredClone(road.path),
      g = editableRoadGeometry(road, 1000);
    expect(g.controls).toHaveLength(3);
    expect(g.path.length).toBeGreaterThanOrEqual(original.length);
    expect(road.path).toEqual(original);
    expect(g.controlIndices.map(i => g.path[i])).toEqual(g.controls);
  });
});
