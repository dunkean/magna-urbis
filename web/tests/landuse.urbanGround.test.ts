import { describe, expect, it } from 'vitest';
import { urbanNaturalGround } from '../src/gen/landuse/urbanGround';
import type { UrbanLayer, World, Polygon, PolyH } from '../src/gen/types';
import { polygonContains, bbox } from '../src/gen/core/geom';
import { differenceS, intersectionS, mpArea, tryDifference } from '../src/gen/geo/bool';
import { area, inscribed } from '../src/gen/geo/poly';
import { generate } from '../src/gen/pipeline';
import { makeOptions } from '../src/gen/options';
import '../src/gen/urban/cultures';

const box = (x0: number, y0: number, x1: number, y1: number): Polygon => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const contains = (ground: PolyH[], x: number, y: number) => ground.some((p) =>
  polygonContains(p.outer, { x, y }) && !p.holes.some((hole) => polygonContains(hole, { x, y })));
function fixture(): World {
  const plot = box(0, 0, 400, 400);
  const urban = {
    archetype: 'town', population: 3000, morphology: 'organic', footprint: [plot], footprintH: [{ outer: plot, holes: [] }],
    phases: [], parcels: [{ poly: plot, use: 'plot', block: 0, zone: 'middle' }], buildings: [], masses: [], backLand: [],
    landmarks: [], squares: [], streets: [], quarters: [], blocks: [plot], blockInfo: [],
  } as unknown as UrbanLayer;
  return { urban, roads: [], settlements: [] } as unknown as World;
}

describe('shared natural ground permission', () => {
  it('admits deep empty residential space while staying wholly inside its plot', () => {
    const world = fixture(), before = JSON.stringify(world), mask = urbanNaturalGround(world);
    expect(contains(mask, 200, 200)).toBe(true); // 200 m from the urban border, beyond the decorative fringe.
    expect(contains(mask, 3, 200)).toBe(false);
    expect(mpArea(differenceS(mask, world.urban!.footprintH))).toBeLessThan(1e-6);
    expect(JSON.stringify(world)).toBe(before);
    expect(urbanNaturalGround(world)).toEqual(mask);
  });

  it('keeps ordinary narrow rear yards urban instead of exposing isolated terrain rectangles', () => {
    const world = fixture(), u = world.urban!, plot = box(0, 0, 40, 75);
    u.parcels[0].poly = plot; u.footprintH = [{ outer: plot, holes: [] }]; u.footprint = [plot];
    u.buildings = [{ poly: box(0, 0, 40, 60) } as UrbanLayer['buildings'][number]];
    expect(urbanNaturalGround(world)).toEqual([]);
    expect(contains(urbanNaturalGround(fixture()), 200, 200)).toBe(true);
  });

  it('protects roofs with clearance, thin dedicated lots, back land, public space and roads', () => {
    const world = fixture(), u = world.urban!;
    u.buildings.push({ poly: box(32, 32, 60, 60) } as UrbanLayer['buildings'][number]);
    const protectedPolys = [box(96, 0, 97, 400), box(160, 96, 192, 160), box(224, 96, 256, 160), box(288, 96, 320, 160)];
    u.parcels.push({ poly: protectedPolys[0], use: 'place' } as UrbanLayer['parcels'][number]);
    u.backLand.push({ outer: protectedPolys[1], holes: [] });
    u.squares.push(protectedPolys[2]); u.landmarks.push({ poly: protectedPolys[3], kind: 'market' });
    world.roads!.push({ path: [{ x: 0, y: 240 }, { x: 400, y: 240 }], width: 8 } as NonNullable<World['roads']>[number]);
    u.streets.push({ path: [{ x: 200, y: 0 }, { x: 200, y: 400 }], width: 4 } as UrbanLayer['streets'][number]);
    const mask = urbanNaturalGround(world);
    expect(mpArea(mask)).toBeGreaterThan(20000);
    for (const poly of [...protectedPolys, box(29, 29, 63, 63), box(0, 234, 400, 246), box(196, 0, 204, 400)]) {
      expect(mpArea(intersectionS(mask, poly))).toBeLessThan(1e-6);
    }
  });

  it('protects neighbouring settlements and walls; avoids closed, paved-ground and stilt cultures', () => {
    for (const mode of ['wall', 'phase', 'hedge', 'palisade', 'openGround', 'stilts']) {
      const world = fixture(), u = world.urban!;
      if (mode === 'wall') u.walls = [{ role: 'town' } as NonNullable<UrbanLayer['walls']>[number]];
      else if (mode === 'phase') u.phases = [{ walled: true } as UrbanLayer['phases'][number]];
      else if (mode === 'hedge' || mode === 'palisade') u.lines = [{ closed: true, kind: mode } as NonNullable<UrbanLayer['lines']>[number]];
      else u.renderHints = { towerShape: 'round', [mode]: true };
      expect(urbanNaturalGround(world)).toEqual([]);
    }
    const world = fixture(), neighbour = fixture().urban!;
    neighbour.footprintH = [{ outer: box(80, 80, 240, 240), holes: [] }];
    neighbour.parcels = []; neighbour.renderHints = { towerShape: 'square', openGround: true };
    world.settlements = [{ main: false, urban: neighbour } as NonNullable<World['settlements']>[number]];
    expect(mpArea(intersectionS(urbanNaturalGround(world), neighbour.footprintH))).toBeLessThan(1e-6);
  });

  it('invalidates in-place edits and fails closed for corrupt protection geometry', () => {
    const world = fixture(), first = urbanNaturalGround(world);
    expect(contains(first, 200, 200)).toBe(true);
    world.urban!.buildings.push({ poly: box(180, 180, 220, 220) } as UrbanLayer['buildings'][number]);
    expect(contains(urbanNaturalGround(world), 200, 200)).toBe(false);
    world.urban!.buildings[0].poly[0].x = NaN;
    expect(urbanNaturalGround(world)).toEqual([]);
  });

  it('protects vector lakes and sea while retaining dry island interiors', () => {
    const world = fixture();
    world.terrain = { coastline: [box(-100, -100, 500, 500)], islands: [box(80, 80, 320, 320)],
      lakes: [box(190, 190, 192, 250)], rivers: [] } as unknown as World['terrain'];
    const mask = urbanNaturalGround(world);
    expect(contains(mask, 150, 150)).toBe(true);
    expect(contains(mask, 40, 200)).toBe(false);
    expect(mpArea(intersectionS(mask, world.terrain.lakes[0]))).toBeLessThan(1e-6);
    world.terrain.lakes.push(box(120, 120, 180, 180));
    expect(contains(urbanNaturalGround(world), 150, 150)).toBe(false);
  });

  it('ignores far-away protection boxes without corrupting adjacent grid rows', () => {
    const world = fixture();
    world.urban!.buildings.push({ poly: box(-200, 100, -100, 200) } as UrbanLayer['buildings'][number]);
    expect(urbanNaturalGround(world)).toEqual(urbanNaturalGround(fixture()));
  });

  it('covers an actual Indian cadastral vacancy naturally while preserving the historical forest and excluding agriculture', () => {
    let owner: UrbanLayer['parcels'][number] | undefined;
    const world = generate(makeOptions({ seed: 'g5fo4o', size: 'city', river: 'major', walls: 'none', culture: 'indian-temple',
      center: { x: 1549, y: 2492 } }), (stage, current) => {
      if (stage !== 'fields & woods' || !current?.urban) return;
      const u = current.urban;
      // The corrected cadastral frame's deep residential plot has a 17.47 m
      // inscribed radius and 2,950 m² of owner land, clear of protected sites.
      const selected = { p: u.parcels[943], i: 943 };
      expect(selected.p.use).toBe('plot');
      expect(inscribed(selected.p.poly, [], 0.5).r).toBeGreaterThan(17);
      expect(selected).toBeDefined(); owner = selected.p;
      // Density repairs can legitimately occupy the former vacant pin. Keep
      // the real cadastral frame and create one explicit vacancy before rural
      // cover is produced, without changing any other building or owner.
      u.buildings = u.buildings.filter((b) => b.parcel !== selected.i);
      const trim = (pieces: PolyH[]) => pieces.flatMap((p) => {
        const left = tryDifference([p], selected.p.poly);
        expect(left.failed).toBe(false); return left.pieces;
      });
      u.masses = trim(u.masses); u.backLand = trim(u.backLand);
    });
    const historicalPin = { x: 1144.3, y: 2033.8 }, permission = urbanNaturalGround(world);
    const mask = intersectionS(permission, owner!.poly);
    expect(owner).toBeDefined(); expect(mask.length).toBeGreaterThan(0);
    const largest = mask.reduce((a, b) => mpArea([a]) >= mpArea([b]) ? a : b);
    const pin = inscribed(largest.outer, largest.holes, 0.1).c;
    expect(world.landuse!.naturalGround).toEqual(permission);
    // The former pin is now outside the cadastral partition. Its forest remains
    // rural; the current natural permission covers a real vacant part of a plot.
    expect(world.urban!.parcels.some((p) => polygonContains(p.poly, historicalPin))).toBe(false);
    expect(contains(mask, historicalPin.x, historicalPin.y)).toBe(false);
    expect(polygonContains(owner!.poly, pin)).toBe(true);
    expect(contains(mask, pin.x, pin.y)).toBe(true);
    expect(mpArea(mask)).toBeGreaterThanOrEqual(1200);
    expect(mpArea(differenceS(mask, owner!.poly))).toBeLessThan(0.01);
    const areas = world.landuse!.areas;
    const atHistoricalPin = areas.filter((a) => polygonContains(a.poly, historicalPin)
      && !(a.holes ?? []).some((hole) => polygonContains(hole, historicalPin)));
    expect(atHistoricalPin.some((a) => a.kind === 'forest')).toBe(true);
    const atPin = areas.filter((a) => polygonContains(a.poly, pin) && !(a.holes ?? []).some((hole) => polygonContains(hole, pin)));
    // The rural generator extends neighbouring natural cover, including open
    // pasture. This is distinct from enclosed agricultural pasture or fields.
    expect(atPin.some((a) => ['forest', 'meadow', 'pasture', 'marsh', 'commons'].includes(a.kind)
      && !('enclosed' in a && a.enclosed === true))).toBe(true);
    const boxes = mask.map((piece) => ({ piece, box: bbox(piece.outer) }));
    const nearby = (poly: Polygon) => {
      const b = bbox(poly);
      return boxes.filter(({ box: a }) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY).map(({ piece }) => piece);
    };
    const agricultural = areas.filter((a) => ['field', 'orchard', 'garden'].includes(a.kind));
    for (const a of agricultural) expect(mpArea(intersectionS([{ outer: a.poly, holes: a.holes ?? [] }], nearby(a.poly)))).toBeLessThan(0.01);
    for (const building of world.urban!.buildings) expect(mpArea(intersectionS(nearby(building.poly), building.poly))).toBeLessThan(0.01);
  }, 120000);
});
