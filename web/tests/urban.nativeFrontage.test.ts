import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { generate } from '../src/gen/pipeline';
import { makeOptions } from '../src/gen/options';
import { area, distToRing, obb } from '../src/gen/geo/poly';
import { polyInside } from '../src/gen/geo/split';
import type { Polygon } from '../src/gen/core/geom';
import * as bops from '../src/gen/urban/bops';
import { blockReach, carvePassage, makeStreetAt } from '../src/gen/urban/access';
import { refreshPlotFrame, type Plot } from '../src/gen/urban/plots';
import { unreachableBuildings } from './accessCheck';
import { checkWorld } from './urbanCheck';
import historical from './fixtures/native-frontage-v11.json';

describe('native longhouses on merged street frontages', () => {
  it('retains every current seeded longhouse from its producer through access and finishing', () => {
    const original = bops.buildOn;
    const produced: { owner: Polygon; houses: ReturnType<typeof original> }[] = [];
    let mainSettlement = true;
    const spy = vi.spyOn(bops, 'buildOn').mockImplementation((...args) => {
      const out = original(...args), houses = out.filter(b => b.arch === 'longhouse');
      if (mainSettlement && houses.length) produced.push(structuredClone({ owner: args[0].poly, houses }));
      return out;
    });
    let w: ReturnType<typeof generate>;
    try {
      w = generate(makeOptions({ seed: '2', size: 'town', culture: 'native-iroquoian' }), stage => {
        if (stage === 'settlements') mainSettlement = false;
      });
    } finally { spy.mockRestore(); }
    const u = w.urban!;
    const houses = u.buildings.filter(b => b.arch === 'longhouse');
    expect(houses).toHaveLength(604);
    expect(produced.flatMap(p => p.houses)).toHaveLength(houses.length);
    const owners = new Map(u.parcels.map((p, i) => [JSON.stringify(p.poly), i]));
    const shape = (b: typeof houses[number]) => ({ poly: b.poly, arch: b.arch, roof: b.roof,
      material: b.material, storeys: b.storeys, orientation: b.orientation });
    for (const producer of produced) {
      const parcel = owners.get(JSON.stringify(producer.owner));
      expect(parcel).toBeDefined();
      expect(houses.filter(b => b.parcel === parcel).map(shape)).toEqual(producer.houses.map(shape));
    }
    for (const house of houses) {
      expect(house.poly).toHaveLength(12);
      expect(house.parcel).toBeDefined();
      expect(polyInside(u.parcels[house.parcel!].poly, house.poly)).toBe(true);
    }
    expect(unreachableBuildings(w).n).toBe(0);
    const report = checkWorld(w);
    expect(report.overlapsPlots + report.overlapsBuildings + report.bldgOutside + report.noFrontage).toBe(0);
    expect(createHash('sha256').update(JSON.stringify(u)).digest('hex'))
      .toBe('32983d4c9f91fe7d156e9d5d4b45d1daac900be5d07ea3578d2694ee2da07e7d');
  });

  it('keeps both rounded ends when a renewed frontage runs across several boundary edges', () => {
    // Exact plot before refresh and producer roof from commit 8d1df55, seed 2,
    // native-iroquoian town, former parcel 824. The current town has different lots.
    const plot = structuredClone(historical.plot) as unknown as Plot;
    const before = structuredClone(plot.poly), [a, b] = plot.front;
    const start = plot.poly.findIndex(p => p.x === a.x && p.y === a.y);
    const end = plot.poly.findIndex(p => p.x === b.x && p.y === b.y);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThanOrEqual(0);
    expect((end - start + plot.poly.length) % plot.poly.length).toBeGreaterThan(1);
    expect(distToRing(plot.poly, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).toBeGreaterThan(0.25);
    refreshPlotFrame(plot);
    expect(plot.poly).toEqual(before);
    expect(plot.front).toEqual(historical.refreshed.front);
    expect(plot.sideA).toEqual(historical.refreshed.sideA);
    expect(plot.sideB).toEqual(historical.refreshed.sideB);
    for (const side of [plot.sideA, plot.sideB]) {
      expect(side.d.x * plot.nrm.x + side.d.y * plot.nrm.y).toBeGreaterThan(0.05);
    }
    // With the former tangent side planes this same access cut shortened the
    // house to 55.975 m2 / 10.824 m, removing one of its two rounded ends.
    const kept = carvePassage(plot, [structuredClone(historical.house)], 'A', 1.6);
    expect(kept).toHaveLength(1);
    const house = kept[0];
    expect(house.poly).toEqual(historical.house.poly);
    expect(house.poly).toHaveLength(12);
    expect(area(house.poly)).toBeCloseTo(60.9220479692, 6);
    expect(2 * obb(house.poly).hu).toBeCloseTo(12.2298069990, 6);
    expect(polyInside(plot.poly, house.poly)).toBe(true);
    const streetAt = makeStreetAt(historical.streets, []);
    const reached = blockReach(historical.block, historical.peers.map(p => p.poly), streetAt);
    expect(reached).toHaveLength(8);
    expect(reached.every(Boolean)).toBe(true);
    const target = historical.peers.findIndex(p => p.parcel === 824 && p.arch === 'longhouse');
    expect(target).toBeGreaterThanOrEqual(0);
    expect(blockReach(historical.block, historical.peers.map((p, i) => i === target ? house.poly : p.poly), streetAt))
      .toEqual(reached);
  });
});
