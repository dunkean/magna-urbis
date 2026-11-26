import { describe, expect, it } from 'vitest';
import type { Enclosure, Point } from '../../../rust/bridge/urban';
import type { World } from '../../src/gen/types';
import { uvttDocument, uvttFrame } from '../../src/v2/uvtt';

const ring = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

function townWorld(enclosure: Enclosure, footprint = ring(40, 40, 20, 10)): World {
  const town = { layouts: [{ key: 'main', enclosures: [enclosure] }], scene: { buildings: [{ footprint: [{ outer: footprint, holes: [] }] }] } };
  return { stats: {}, debug: { v2RustCities: { main: town } } } as unknown as World;
}

const enclosure: Enclosure = { path: ring(10, 20, 90, 55), kind: 'wall', style: 'curtain', curtain_width_m: 4, gates: [{ x: 50, y: 20 }] };

describe('Universal VTT export', () => {
  it('uses one physical projection for a rectangular image, walls and an interactive gate', () => {
    const frame = uvttFrame({ x: 10, y: 15, width: 150, height: 80 }, 1500, 5);
    const map = uvttDocument(townWorld(enclosure), frame, 'embedded PNG', true);
    expect(frame.width).toBe(1500);
    expect(frame.height).toBe(800);
    expect(frame.metresPerGrid).toBe(5);
    expect(map.format).toBe(0.3);
    expect(map.resolution).toEqual({ map_origin: { x: 0, y: 0 }, map_size: { x: 30, y: 16 }, pixels_per_grid: 50 });
    expect(map.image).toBe('embedded PNG');
    expect(map.portals).toHaveLength(1);
    const gate = map.portals[0];
    expect(gate.closed).toBe(true);
    expect(gate.freestanding).toBe(false);
    expect(gate.position.x).toBeCloseTo(8);
    expect(gate.position.y).toBeCloseTo(0.9);
    const startsAndEnds = map.line_of_sight.flatMap(line => [line[0], line.at(-1)]);
    for (const endpoint of gate.bounds) expect(startsAndEnds).toContainEqual(endpoint);
    expect(map.line_of_sight).toContainEqual([
      { x: 6, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 7 },
      { x: 6, y: 7 },
      { x: 6, y: 5 },
    ]);
    expect(uvttDocument(townWorld(enclosure), frame, '', false).line_of_sight).toHaveLength(map.line_of_sight.length - 1);
    expect(uvttDocument(townWorld(enclosure), frame, '', true, false)).toMatchObject({ line_of_sight: [], portals: [] });
  });

  it('clips to the image without joining lines through a cropped corner or surfacing incomplete doors', () => {
    const frame = uvttFrame({ x: 50, y: 15, width: 30, height: 38 }, 760, 5);
    const map = uvttDocument(townWorld(enclosure), frame, '', true);
    expect(map.portals).toEqual([]);
    expect(map.line_of_sight).toHaveLength(2);
    for (const point of map.line_of_sight.flat()) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(6);
      expect(point.y).toBeLessThanOrEqual(7.6);
    }
    // A clipped building remains an open polyline at the edge of the image.
    const house = map.line_of_sight.find(line => line.length > 2)!;
    expect(house[0].x).toBe(0);
    expect(house.at(-1)!.x).toBe(0);
    expect(house[0].y).not.toBe(house.at(-1)!.y);
  });

  it('chooses an importer-friendly grid at city and regional scales', () => {
    for (const extent of [13, 750, 15000, 400000]) {
      const frame = uvttFrame({ x: 0, y: 0, width: extent, height: extent }, 1600);
      expect(frame.pixelsPerGrid).toBeGreaterThanOrEqual(50);
      expect(Number.isInteger(frame.pixelsPerGrid)).toBe(true);
      expect(frame.metresPerGrid * frame.view.scale).toBeCloseTo(frame.pixelsPerGrid);
    }
  });

  it('leaves a shore break open and keeps open water arches free of vision barriers', () => {
    const shore: Enclosure = {
      ...enclosure,
      gates: [],
      gatehouses: [
        {
          gate: 0,
          kind: 'shore',
          shape: { outer: [], holes: [] },
          passage: [
            { x: 30, y: 20 },
            { x: 60, y: 20 },
          ],
          passage_width_m: 30,
          height_m: 1,
        },
      ],
    };
    const frame = uvttFrame({ x: 0, y: 0, width: 110, height: 100 }, 1100, 5);
    const shoreline = uvttDocument(townWorld(shore), frame, '', false);
    const water = uvttDocument(townWorld({ ...shore, gatehouses: [{ ...shore.gatehouses![0], kind: 'water' }] }), frame, '', false);
    expect(shoreline.portals).toEqual([]);
    expect(water.portals).toEqual([]);
    expect(shoreline.line_of_sight).toEqual(water.line_of_sight);
    expect(water.line_of_sight).toHaveLength(1);
    expect(water.line_of_sight[0][0]).not.toEqual(water.line_of_sight[0].at(-1));
  });
});
