import { expect, it, vi } from 'vitest';
import { generate } from '../src/gen/pipeline';
import { makeOptions } from '../src/gen/options';
import type { Polygon } from '../src/gen/core/geom';
import { area, minNeck } from '../src/gen/geo/poly';
import { mpArea, tryDifference, tryIntersection, type MultiPoly } from '../src/gen/geo/bool';
import * as edgeRoofs from '../src/gen/urban/edgeRoofs';
import { blockReach, makeStreetAt } from '../src/gen/urban/access';
import { unreachableBuildings } from './accessCheck';
import native from './fixtures/urban-wing-v11.json';

it('keeps the complete xrv97g outer house while thickening only free open-edge land', () => {
  const options = makeOptions({
    seed: 'xrv97g', size: 'town', relief: 'flat', coast: 'none', river: 'major', walls: 'auto',
    workflow: 'list', settlementMode: 'list', mapSize: 1500, biome: 'desert', culture: 'kraal',
    language: 'sanskrit', heightScale: 120, contours: true, landuse: true,
    settlements: { list: [{ population: 2000, culture: 'european-organic',
      position: { x: 578, y: 430 }, options: { size: 'town', cultureMix: null, plan: null }, name: 'Tanavati' }] },
  });
  const originalFinish = edgeRoofs.finishEdgeRoofs;
  const snapshots: { poly: Polygon; protectedLand: MultiPoly; reached: boolean[] }[] = [];
  const spy = vi.spyOn(edgeRoofs, 'finishEdgeRoofs').mockImplementation(input => {
    // Earlier parcel production changes the contour slightly. Locate the same
    // native house spatially, then measure growth against its real stage input.
    const matches = input.buildings.filter(b => {
      const hit = tryIntersection(native.poly, b.poly);
      return !hit.failed && mpArea(hit.pieces) > 0.9 * area(native.poly);
    });
    expect(matches.length).toBeLessThanOrEqual(1);
    for (const b of matches) {
      expect(b.parcel).toBeDefined();
      expect(input.eligible(b.parcel!)).toBe(true);
      const block = input.parcels[b.parcel!].block;
      const peers = input.buildings.filter(p => p.parcel !== undefined && input.parcels[p.parcel].block === block);
      const streetAt = makeStreetAt(input.streets.list.filter(s => s.ribbon)
        .map(s => ({ path: s.path, widths: s.widths, width: s.widths[0] })),
      input.parcels.filter(p => ['place', 'market', 'quay', 'green'].includes(String(p.use))).map(p => p.poly));
      snapshots.push({ poly: structuredClone(b.poly), protectedLand: structuredClone(input.protectedLand),
        reached: blockReach(input.blocks[block].poly, peers.map(p => p.poly), streetAt) });
    }
    return originalFinish(input);
  });
  let world: ReturnType<typeof generate>;
  try { world = generate(options); } finally { spy.mockRestore(); }
  const urban = world.urban!;
  expect(snapshots).toHaveLength(1);
  const old = snapshots[0].poly;
  expect(minNeck(old)?.w ?? Infinity).toBeLessThan(3.59);
  expect(snapshots[0].reached.length).toBeGreaterThan(0);
  expect(snapshots[0].reached.every(Boolean)).toBe(true);
  // Finalization may reorder or append roofs; retention still uses geometry.
  const b = urban.buildings.find(candidate => {
    const lost = tryDifference(old, candidate.poly);
    return !lost.failed && mpArea(lost.pieces) <= 1e-6;
  });
  expect(b).toBeDefined();
  const added = tryDifference(b!.poly, old), lost = tryDifference(old, b!.poly);
  expect(added.failed || lost.failed).toBe(false);
  expect(mpArea(lost.pieces)).toBeLessThanOrEqual(1e-6);
  expect.soft(mpArea(added.pieces), 'the free outer wing must actually grow').toBeGreaterThan(45);
  expect(mpArea(added.pieces)).toBeLessThanOrEqual(0.1 * area(old) + 1e-6);
  expect.soft(minNeck(b!.poly)?.w ?? 0, 'the retained wing must be habitable').toBeGreaterThanOrEqual(3.59);
  const physical = tryIntersection(added.pieces, snapshots[0].protectedLand);
  expect(physical.failed).toBe(false);
  expect(mpArea(physical.pieces)).toBeLessThanOrEqual(1e-6);
  expect(unreachableBuildings(world).n).toBe(0);
  const parcel = urban.parcels[b!.parcel!];
  expect(mpArea(tryDifference(b!.poly, parcel.poly).pieces)).toBeLessThanOrEqual(1e-6);
  expect(mpArea(tryDifference(added.pieces, urban.blocks[parcel.block]).pieces)).toBeLessThanOrEqual(1e-6);
  for (let i = 0; i < urban.buildings.length; i++) if (urban.buildings[i] !== b) {
    const hit = tryIntersection(added.pieces, urban.buildings[i].poly);
    expect(hit.failed).toBe(false);
    expect(mpArea(hit.pieces)).toBeLessThanOrEqual(1e-6);
  }
  for (let i = 0; i < urban.parcels.length; i++) if (i !== b!.parcel) {
    const hit = tryIntersection(added.pieces, urban.parcels[i].poly);
    expect(hit.failed).toBe(false);
    expect(mpArea(hit.pieces)).toBeLessThanOrEqual(1e-6);
  }
  const qi = urban.blockInfo[parcel.block].quarter;
  for (let i = 0; i < urban.quarters.length; i++) if (i !== qi) {
    const hit = tryIntersection(added.pieces, urban.quarters[i].poly.outer);
    expect(hit.failed).toBe(false);
    expect(mpArea(hit.pieces)).toBeLessThanOrEqual(1e-6);
  }
}, 120000);
