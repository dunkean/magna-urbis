import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { Enclosure, Layout, Street } from '../../rust/bridge/urban';
import { city3dStructures } from '../src/render/city3d/display';
import { GroundShape } from '../src/render/world/groundShape';
import { TerrainHeights } from '../src/render/world/heights';
import type { YardBoundary } from '../src/render/cityLotEnclosures';
import { city3dWorldHeight, SeatedMeshes } from '../src/render/city3d/seatedMeshes';
import { city3dLotEnclosures } from '../src/render/city3d/yards';
import { mapSeasonKey, mapSeasonState, setMapClimateZone, setMapSeason } from '../src/render/seasonPalette';
import { buildingBounds } from '../src/render/world/buildingsMesh';

const point = (x: number, y = 0) => ({ x, y });
const yard = (lo: number, hi: number, material: YardBoundary['material'] = 'fence'): YardBoundary => ({ path: [point(lo), point(hi)], side: 'front', material, culture: 'italian', ...(material === 'fence' ? { fenceStyle: 'plank' as const } : {}) });
const yardAt = (x: number, y: number) => x / 31 + y / 7;

describe('retained 3D town boundaries', () => {
  it('follows gate jambs across batch boundaries and samples changed ground on both sides of the gate', () => {
    const cache = new SeatedMeshes(),
      far = yard(900, 921);
    // The gate at 127..129 is emitted in cell 0. The second jamb and the adjoining fence are in cell 1.
    const source = [yard(92, 127), yard(129, 155), far];
    let changedX = -1;
    const ground = (x: number, y: number) => yardAt(x, y) + (x === changedX ? 3 : 0);
    const make = (yards: YardBoundary[], palette: 'terrain' | 'parchment' = 'terrain') => {
      const made = city3dLotEnclosures(yards, ground, palette, cache),
        cold = city3dLotEnclosures(yards, ground, palette);
      expect(isDeepStrictEqual(made, cold)).toBe(true);
      expect(made.map(b => buildingBounds(b, true))).toEqual(cold.map(b => buildingBounds(b, true)));
      return made;
    };
    const original = make(source);
    const roof = make(structuredClone(source));
    expect(roof.every((b, i) => b === original[i])).toBe(true);
    changedX = 129;
    const seated = make(source);
    expect(seated[0]).not.toBe(original[0]);
    expect(seated[1]).not.toBe(original[1]);
    expect(seated[2]).toBe(original[2]);
    changedX = -1;
    const moved = make([far, yard(92, 127), yard(340, 368)]);
    expect(moved[0]).toBe(original[2]);
    expect(moved[1]).not.toBe(seated[0]);
    expect(moved.some(b => b.id === original[1].id)).toBe(false);
    expect(make([], 'parchment')).toEqual([]);
    const high = make([{ ...yard(92, 127, 'wall'), height: 4 }, far]);
    const low = make([{ ...yard(92, 127, 'wall'), height: 1 }, far]);
    expect(low[0]).not.toBe(high[0]);
    expect(low[1]).toBe(high[1]);
    const ink = make([{ ...yard(92, 127, 'wall'), height: 1 }, far], 'parchment');
    expect(isDeepStrictEqual(ink, low)).toBe(false);
  });

  it('reuses only meshes on equivalent published terrain tiles, including the second jamb across the cell edge', () => {
    const cache = new SeatedMeshes(),
      list = [yard(210, 255), yard(257, 288), yard(900, 930)];
    const heights = new TerrainHeights(new Float32Array([3, 9, 13, 21]), 2, 1024, -Infinity, 1.75);
    const make = (h: TerrainHeights) => {
      const at = city3dWorldHeight(h);
      const made = city3dLotEnclosures(list, at, 'terrain', cache);
      expect(
        isDeepStrictEqual(
          made,
          city3dLotEnclosures(list, (x, y) => h.groundAt(x, y) * (1 / 1.75)),
        ),
      ).toBe(true);
      return made;
    };
    heights.shape = new GroundShape(1024);
    heights.shape.level(129, 0, 4);
    const initial = make(heights);
    heights.shape = GroundShape.from(heights.shape);
    // Drawn (dug) nodes change, while the copied levelled-ground nodes still match bit for bit.
    heights.shape.dig(129, 0, 2);
    expect(make(heights).every((b, i) => b === initial[i])).toBe(true);
    heights.shape = GroundShape.from(heights.shape);
    heights.shape.level(129, 0, 9);
    const raised = make(heights);
    expect(raised[0]).not.toBe(initial[0]);
    expect(raised[1]).not.toBe(initial[1]);
    expect(raised[2]).toBe(initial[2]);
    // A relief replacement also invalidates a site in an unshaped tile.
    const swapped = make(new TerrainHeights(new Float32Array([9, 21, 17, 32]), 2, 1024, -Infinity, 1.75));
    expect(swapped.every((b, i) => b !== raised[i])).toBe(true);
  });

  it('compares the ordered runs inside a cell and retains only the last completed composition', () => {
    const cache = new SeatedMeshes(),
      a = yard(12, 20),
      b = yard(42, 56),
      c = yard(600, 620);
    const make = (list: YardBoundary[]) => city3dLotEnclosures(list, yardAt, 'terrain', cache);
    const original = make([a, b, c]),
      reordered = make([b, a, c]);
    expect(isDeepStrictEqual(reordered, city3dLotEnclosures([b, a, c], yardAt))).toBe(true);
    expect(reordered[0]).not.toBe(original[0]);
    expect(reordered[1]).toBe(original[1]);
    // The first group finishes, then the next sampler throws before the groups can be published.
    expect(() =>
      city3dLotEnclosures(
        [yard(30, 45), c],
        (x, y) => {
          if (x >= 600) throw new Error('interrupted');
          return yardAt(x, y);
        },
        'terrain',
        cache,
      ),
    ).toThrow('interrupted');
    expect(make([b, a, c]).every((mesh, i) => mesh === reordered[i])).toBe(true);
  });

  it('keeps display order across towns and refreshes relief, regional crossings, culture and moat overrides', () => {
    const cache = new SeatedMeshes();
    const circuit = (x: number): Enclosure => ({
      path: [point(x, 0), point(x + 65, 0), point(x + 65, 46), point(x, 46)],
      gates: [],
      kind: 'wall',
      height_m: 4,
      curtain_width_m: 2,
      ditch: [{ kind: 'wet', height_m: 2, shape: { outer: [point(x, -14), point(x + 60, -14), point(x + 60, -5), point(x, -5)], holes: [] } }],
    });
    const layout = (e: Enclosure, culture: string) => ({ culture, enclosures: [e], streets: [], blocks: [], quarters: [] }) as unknown as Layout;
    const west = layout(circuit(100), 'roman-core'),
      east = layout(circuit(700), 'norse');
    const bridge = { path: [point(1400), point(1440)], widths: [4, 4], role: 'bridge', rank: 2 } as Street;
    let remote = 0;
    const at = (x: number, y: number) => yardAt(x, y) + (x > 650 ? remote : 0);
    const make = (layouts: Layout[], regional: Street[] = [], engraved = false, water = '#708898') => {
      const ground = { height: at, quayHeight: at };
      const next = city3dStructures(layouts, regional, ground, water, false, engraved, cache);
      const cold = city3dStructures(layouts, regional, ground, water, false, engraved);
      expect(isDeepStrictEqual(next, cold)).toBe(true);
      return next;
    };
    const initial = make([west, east]);
    const local = make([{ ...west, streets: [] }, east], [bridge]);
    expect(local.walls.every((b, i) => b === initial.walls[i])).toBe(true);
    expect(local.bridges.length).toBeGreaterThan(initial.bridges.length);
    remote = 6;
    const raised = make([west, east]);
    const far = initial.walls.findIndex(b => b.id.startsWith('city3d-wall:1:'));
    expect(far).toBeGreaterThan(0);
    expect(raised.walls[0]).toBe(initial.walls[0]);
    expect(raised.walls[far]).not.toBe(initial.walls[far]);
    const styled = make([east, { ...west, culture: 'italian' }], [], true, '#242d30');
    expect(styled.walls[0].culture.culture).toBe(east.culture);
    // The western ditch changes from full to stagnant across summer's threshold, within one rounded season key.
    const previousSeason = mapSeasonState();
    try {
      setMapSeason(0.369, 'mediterranean');
      const spring = make([west]),
        key = mapSeasonKey();
      setMapSeason(0.371, 'mediterranean');
      const summer = make([west]);
      expect(mapSeasonKey()).toBe(key);
      expect(isDeepStrictEqual(spring.walls, summer.walls)).toBe(false);
    } finally {
      setMapSeason(previousSeason.season, previousSeason.zone);
      if (!previousSeason.zone) setMapClimateZone(undefined);
    }
    const controls = globalThis as { __muMoat?: { fill?: string; form?: string } };
    const before = controls.__muMoat;
    try {
      controls.__muMoat = { fill: 'bare' };
      const dry = make([east]);
      expect(dry.walls.some(b => b.id.includes(':ditch:'))).toBe(false);
      controls.__muMoat = { fill: 'full', form: 'ceremonial' };
      const full = make([east]);
      expect(full.walls.some(b => b.id.includes(':ditch:'))).toBe(true);
      const higher = make([layout({ ...east.enclosures![0], height_m: 9 }, 'norse')]);
      expect(isDeepStrictEqual(higher.walls, full.walls)).toBe(false);
      expect(make([]).walls).toHaveLength(0);
      expect(make([west]).walls[0].culture.culture).toBe(west.culture);
    } finally {
      controls.__muMoat = before;
    }
  });
});
