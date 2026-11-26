import { afterEach, describe, expect, it } from 'vitest';
import { forestCorridors, ForestRoom, roadCorridor, streetCorridors } from '../src/render/forestRoom';
import { forestOccupation } from '../src/ui/forestOccupation';
import { buildScene } from '../src/render/scene';
import { CANOPY_LEVELS, canopyRuns, roadCanopyRevision, setRoadCanopy } from '../src/render/roadStyle';
import { roadCanopyRegions } from '../src/render/cartography/roads';
import type { CartographyContext } from '../src/render/cartography/context';
import { fakeWorld } from '../scripts/fakeworld';

const path = (y: number) => [
  { x: 20, y },
  { x: 380, y },
];
afterEach(() => setRoadCanopy(undefined, undefined));

describe('roads beneath forest canopies', () => {
  it('clears narrow country roads while keeping even broad tracks covered in the shared 2D/3D occupation', () => {
    const world = fakeWorld({ mapSize: 400, buildings: 0, streets: 0, landAreas: 0 });
    world.terrain.rivers = [];
    world.roads = [
      { kind: 'minor', path: path(100), width: 3.6 },
      { kind: 'track', path: path(200), width: 8 },
    ];
    world.landuse = {
      areas: [
        {
          kind: 'forest',
          poly: [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 400 },
            { x: 0, y: 400 },
          ],
        },
      ],
      reserve: [],
      farmsteads: [],
    };
    const ways = forestCorridors(world, false);
    expect(ways[0].covered).not.toBe(true);
    expect(ways[1].covered).toBe(true);
    const occupation = forestOccupation(world.landuse, 256, 2, ways)!;
    const sample = (y: number) => {
      const i = Math.floor(((200 - occupation.x) / occupation.width) * occupation.n),
        j = Math.floor(((y - occupation.y) / occupation.width) * occupation.n);
      return occupation.rgba.slice((j * occupation.n + i) * 4, (j * occupation.n + i) * 4 + 4);
    };
    expect(sample(100)[2]).toBe(11);
    expect(sample(100)[0]).toBeGreaterThan(128);
    expect(sample(200)[2]).toBe(12);
    expect(sample(200)[1]).toBeGreaterThan(128);
  });

  it('holds crowns just off a cleared road and lets them close over a track, including across index cells', () => {
    const cleared = new ForestRoom([roadCorridor(path(60), 4, true)], []);
    expect(cleared.keeps(200, 67, 0.5, 6)).toBe(false);
    expect(cleared.keeps(200, 72, 0.5, 6)).toBe(true);
    const covered = new ForestRoom([roadCorridor(path(60), 4, false)], []);
    expect(covered.keeps(200, 60, 0.5, 6)).toBe(false);
    expect(covered.keeps(200, 61.5, 0, 6)).toBe(false);
    expect(covered.keeps(200, 64, 0.5, 6)).toBe(true);
    const river = new ForestRoom([{ path: path(60), half: 4 }], []);
    expect(river.keeps(200, 67, 0.5, 6)).toBe(true);
    expect(streetCorridors([{ path: path(60), widths: [8, 8], role: 'track' }], ['asphalt'])[0].covered).toBe(true);
  });

  it('retains footpath and road widths in the 2D scene, as in the 3D network', () => {
    const world = fakeWorld({ mapSize: 400, buildings: 0, streets: 0, landAreas: 0 });
    world.roads = [
      { kind: 'track', path: path(100), width: 1.2 },
      { kind: 'track', path: path(200), width: 4.5 },
      { kind: 'minor', path: path(300), width: 6.5 },
    ];
    const roads = buildScene(world).lines.filter(line => line.role === 'road');
    for (const road of world.roads) expect(roads.some(line => line.width === road.width && line.lines.some(points => points.some(p => p.y === road.path[0].y)))).toBe(true);
  });

  it('keeps a continuous covered-way trace and leaves an open plot unfaded', () => {
    const rgba = new Uint8Array(4 * 4 * 4),
      occupation = new Uint8Array(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 255;
      occupation.set([140, 140, 12, 255], i);
    }
    const raster = { x: 0, y: 0, width: 400, n: 4 };
    setRoadCanopy({ ...raster, rgba }, { ...raster, rgba: occupation });
    const runs = canopyRuns(path(100));
    expect(runs).toHaveLength(1);
    expect(runs[0].level).toBe(CANOPY_LEVELS - 1);
    expect(runs[0].pts[0]).toEqual(path(100)[0]);
    expect(runs[0].pts.at(-1)).toEqual(path(100).at(-1));
    const open = occupation.slice();
    for (let i = 2; i < open.length; i += 4) open[i] = 1;
    setRoadCanopy({ ...raster, rgba }, { ...raster, rgba: open });
    expect(canopyRuns(path(100))).toEqual([{ level: 0, pts: path(100) }]);
  });

  it('invalidates road paint only near a changed canopy mask that crosses a road', () => {
    const world = fakeWorld({ mapSize: 400, buildings: 0, streets: 0, landAreas: 0 });
    world.roads = [
      { kind: 'track', path: path(100), width: 2 },
      { kind: 'track', path: path(280), width: 2 },
    ];
    const cartography = { scene: buildScene(world), deps: {} } as CartographyContext;
    const grid = { x: 0, y: 0, width: 400, n: 20 },
      bytes = new Uint8Array(20 * 20 * 4),
      field = { ...grid, rgba: new Uint8Array(bytes.length).fill(255) },
      initial = { ...grid, key: 'initial', rgba: bytes };
    // The second track runs through open country.
    field.rgba.fill(0, 12 * grid.n * 4);
    setRoadCanopy(field, initial);
    const first = roadCanopyRevision();
    const patch = (from: typeof initial, x: number, y: number, pixel: number[], key: string) => {
      const rgba = from.rgba.slice();
      rgba.set(pixel, (y * grid.n + x) * 4);
      return { ...grid, rgba, key, dirty: { base: from.key, rects: [{ x, y, width: 1, height: 1 }] } };
    };
    const away = patch(initial, 5, 10, [255, 128, 8, 255], 'away');
    setRoadCanopy(field, away);
    expect(roadCanopyRegions(cartography, first)).toEqual([]);
    const openBefore = roadCanopyRevision(),
      stillOpen = patch(away, 5, 14, [255, 128, 8, 255], 'open');
    setRoadCanopy(field, stillOpen);
    expect(roadCanopyRegions(cartography, openBefore)).toEqual([]);
    const stillCovered = patch(stillOpen, 5, 5, [255, 128, 12, 255], 'covered');
    const regional = roadCanopyRevision();
    setRoadCanopy(field, stillCovered);
    expect(roadCanopyRevision()).toBe(regional);
    setRoadCanopy(field, patch(stillCovered, 5, 5, [255, 128, 8, 255], 'cleared'));
    expect(roadCanopyRegions(cartography, regional)).toEqual([{ minX: 70, minY: 70, maxX: 150, maxY: 150 }]);
  });
});
