import { describe, expect, it, vi } from 'vitest';
import type { Polygon } from '../src/gen/core/geom';
import type { UrbanCtx } from '../src/gen/urban/context';
import type { EdgeRoofPartition } from '../src/gen/urban/edgeRoofs';
import type { DensityRepairPartition } from '../src/gen/urban/densityRepair';
import * as densityFunctions from '../src/gen/urban/densityRepair';
import { Streets } from '../src/gen/urban/streets';
import { MORPHOLOGIES } from '../src/gen/urban/morphology';
import { streetStrips } from '../src/gen/urban/openfringe';
import { blockReach, makeStreetAt } from '../src/gen/urban/access';
import { area, bboxOf, obb } from '../src/gen/geo/poly';
import { tryDifference, tryIntersection, mpArea } from '../src/gen/geo/bool';
import * as booleanFunctions from '../src/gen/geo/bool';
import * as plotFunctions from '../src/gen/urban/plots';
import { generate } from '../src/gen/pipeline';
import { makeOptions } from '../src/gen/options';
import { coverage, isRect } from './coverage';
import { unreachableBuildings } from './accessCheck';
import { checkWorld } from './urbanCheck';

const box = (x0: number, y0: number, x1: number, y1: number): Polygon => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const outside = (a: Polygon, b: Polygon) => {
  const proof = tryDifference(a, b); expect(proof.failed).toBe(false); return mpArea(proof.pieces);
};
function fixture(): DensityRepairPartition {
  const poly = box(100, 103, 112, 113), roof = box(100, 103, 110, 110), streets = new Streets();
  streets.add([{ x: 90, y: 100 }, { x: 130, y: 100 }], 6, 1, 'radial', 2);
  return {
    ctx: { mapSize: 1000, isWater: () => false, slopeAt: () => 0.02 } as unknown as UrbanCtx,
    blocks: [{ poly, phase: 2, zone: 'middle', quarter: 0, kind: 'block', age: 0.5 }],
    parcels: [{ poly, block: 0, use: 'plot', zone: 'middle', front: [poly[0], poly[1]] }],
    buildings: [{ poly: roof, parcel: 0, kind: 'house', roof: 'gable', arch: 'gabled-row-house' }],
    gardens: [box(100, 110, 112, 113), box(110, 103, 112, 110)], streets,
    protectedLand: streetStrips(streets.list[0].path, 6), eligible: () => true,
    morphology: () => MORPHOLOGIES['european-organic'],
  };
}
function assertAddedLandClear(before: Polygon[], input: DensityRepairPartition): void {
  input.buildings.forEach((b, i) => {
    const added = before[i] ? tryDifference(b.poly, before[i]) : { pieces: [{ outer: b.poly, holes: [] }], failed: false };
    expect(added.failed).toBe(false);
    const A = bboxOf(b.poly);
    for (const reserve of input.protectedLand) {
      const B = bboxOf(reserve.outer);
      if (A.x0 >= B.x1 || B.x0 >= A.x1 || A.y0 >= B.y1 || B.y0 >= A.y1) continue;
      const hit = tryIntersection(added.pieces, [reserve]);
      expect(hit.failed, 'actual barrier clearance is proved locally').toBe(false);
      expect(mpArea(hit.pieces), 'density cannot reclaim real water, paving or masonry').toBeLessThanOrEqual(1e-6);
    }
  });
}

describe('contained mature residential density repair', () => {
  it('fills a mature garden pocket with served whole rooms without changing the original owners', () => {
    const input = fixture(), block = box(100, 103, 125, 128);
    input.blocks[0].poly = block; input.parcels[0].poly = block;
    input.buildings[0].poly = box(100, 103, 108, 111);
    input.gardens = [box(108, 103, 125, 128), box(100, 111, 108, 128)];
    input.allowInfill = true;
    const before = structuredClone(input.buildings.map((b) => b.poly));
    const owners = JSON.stringify([input.blocks, input.parcels]);
    const result = densityFunctions.repairResidentialDensity(input);
    expect(result.addedRooms).toBeGreaterThan(0);
    expect(JSON.stringify([input.blocks, input.parcels])).toBe(owners);
    expect(area(input.buildings[0].poly)).toBeLessThanOrEqual(1.3 * area(before[0]) + 1e-6);
    const streetAt = makeStreetAt(input.streets.list.map((s) => ({ path: s.path, width: s.widths[0] })), []);
    expect(blockReach(block, input.buildings.map((b) => b.poly), streetAt).every(Boolean)).toBe(true);
    for (const b of input.buildings.slice(1)) {
      expect(b.kind).toBe('back');
      expect(area(b.poly)).toBeGreaterThanOrEqual(12);
      expect(area(b.poly)).toBeLessThanOrEqual(50);
      expect(outside(b.poly, block)).toBeLessThanOrEqual(1e-6);
    }
    assertAddedLandClear(before, input);
    for (let i = 0; i < input.buildings.length; i++) for (let j = i + 1; j < input.buildings.length; j++) {
      const hit = tryIntersection(input.buildings[i].poly, input.buildings[j].poly);
      expect(hit.failed).toBe(false); expect(mpArea(hit.pieces)).toBeLessThanOrEqual(1e-6);
    }
  });
  it('uses its own open garden to reach the block floor without changing a dwelling, plot or block', () => {
    const input = fixture(), before = structuredClone(input.buildings), owners = JSON.stringify([input.blocks, input.parcels]);
    const result = densityFunctions.repairResidentialDensity(input), roof = input.buildings[0].poly;
    expect(result.enlarged).toBe(1);
    expect(result.groups[0].before / result.groups[0].area).toBeLessThan(0.7);
    expect(result.groups[0].after / result.groups[0].area).toBeGreaterThanOrEqual(0.7);
    expect(result.groups[0].shortfall).toBe(0);
    expect(input.buildings).toHaveLength(1);
    expect({ ...input.buildings[0], poly: before[0].poly }).toEqual(before[0]);
    expect(JSON.stringify([input.blocks, input.parcels])).toBe(owners);
    expect(isRect(roof)).toBe(true);
    expect(outside(before[0].poly, roof)).toBeLessThanOrEqual(1e-6);
    expect(outside(roof, input.parcels[0].poly)).toBeLessThanOrEqual(1e-6);
    expect(input.gardens.reduce((sum, p) => sum + area(p), 0) + area(roof)).toBeCloseTo(area(input.blocks[0].poly), 6);
    assertAddedLandClear(before.map((b) => b.poly), input);
  });

  it('enlarges a rotated tall roof in its own plot using a perpendicular local frame after the OBB axis swap', () => {
    const input = fixture(), rotate = (p: Polygon): Polygon => p.map(({ x, y }) => ({ x: 300 + 0.8 * x + 0.6 * y, y: 300 - 0.6 * x + 0.8 * y }));
    const poly = rotate(box(0, 0, 9, 10)), roof = rotate(box(0, 0, 5, 10));
    input.blocks[0].poly = poly; input.parcels[0].poly = poly; input.parcels[0].front = [poly[0], poly[1]];
    input.buildings[0].poly = roof; input.gardens = [rotate(box(5, 0, 9, 10))]; input.streets = new Streets();
    input.streets.add(rotate([{ x: -10, y: -3 }, { x: 20, y: -3 }]), 6, 1, 'radial', 2);
    input.protectedLand = streetStrips(input.streets.list[0].path, 6);
    const before = structuredClone(input.buildings[0]), owners = JSON.stringify([input.blocks, input.parcels]), originalFrame = obb(roof);
    // These integer roof vertices select the short first hull edge, exercising the existing swapped-axis case.
    expect(originalFrame.hu).toBeGreaterThan(originalFrame.hv);
    expect(Math.abs(originalFrame.u.x * originalFrame.v.x + originalFrame.u.y * originalFrame.v.y)).toBeGreaterThan(0.1);
    const result = densityFunctions.repairResidentialDensity(input), after = input.buildings[0].poly;
    expect(result.enlarged).toBe(1); expect(result.groups[0].shortfall).toBe(0);
    expect(result.groups[0].after / result.groups[0].area).toBeGreaterThanOrEqual(0.7);
    expect(result.groups[0].after / result.groups[0].area).toBeLessThanOrEqual(0.85);
    expect(input.buildings).toHaveLength(1); expect({ ...input.buildings[0], poly: before.poly }).toEqual(before);
    expect(JSON.stringify([input.blocks, input.parcels])).toBe(owners);
    expect(isRect(after), 'the actual rotated footprint has four whole right-angled corners').toBe(true);
    expect(outside(before.poly, after)).toBeLessThanOrEqual(1e-6);
    expect(outside(after, poly)).toBeLessThanOrEqual(1e-6);
    expect(area(after)).toBeGreaterThan(area(before.poly));
    expect(area(after)).toBeLessThanOrEqual(1.3 * area(before.poly) + 1e-6);
    const o = obb(after); expect(2 * o.hv).toBeGreaterThanOrEqual(4.5 - 1e-6); expect(o.hu / o.hv).toBeLessThanOrEqual(3 + 1e-6);
    const streetAt = makeStreetAt([{ path: input.streets.list[0].path, width: 6 }], []);
    expect(blockReach(poly, [after], streetAt)).toEqual([true]);
    expect(input.gardens.reduce((sum, p) => sum + area(p), 0) + area(after)).toBeCloseTo(area(poly), 6);
    assertAddedLandClear([before.poly], input);
  });

  it('reports genuine insufficient capacity instead of occupying physical reserves or inventing houses', () => {
    const input = fixture(), before = structuredClone(input.buildings);
    input.protectedLand.push(...tryDifference(input.parcels[0].poly, before[0].poly).pieces);
    const result = densityFunctions.repairResidentialDensity(input);
    expect(result.enlarged).toBe(0);
    expect(input.buildings).toEqual(before);
    expect(result.groups[0].shortfall).toBeCloseTo(0.7 * area(input.blocks[0].poly) - area(before[0].poly), 6);
    assertAddedLandClear(before.map((b) => b.poly), input);
  });

  it('retains the original per-roof growth cap across a bounded revisit with insufficient resident capacity', () => {
    const input = fixture(), poly = box(100, 103, 112, 123), before = structuredClone(input.buildings[0]);
    input.blocks[0].poly = poly; input.parcels[0].poly = poly;
    input.gardens = [box(100, 110, 112, 123), box(110, 103, 112, 110)];
    const result = densityFunctions.repairResidentialDensity(input);
    expect(result.enlarged).toBe(1); expect(input.buildings).toHaveLength(1);
    expect(area(input.buildings[0].poly), 'a second sweep cannot compound the first 30% allowance').toBeCloseTo(1.3 * area(before.poly), 6);
    expect(result.groups[0].shortfall).toBeCloseTo(0.7 * area(poly) - 1.3 * area(before.poly), 6);
    expect({ ...input.buildings[0], poly: before.poly }).toEqual(before);
    expect(outside(input.buildings[0].poly, poly)).toBeLessThanOrEqual(1e-6);
    assertAddedLandClear([before.poly], input);
  });

  it('uses the remaining narrow garden after canonical proposals while retaining the original roof cap and all access', () => {
    const input = fixture(), block = box(100, 103, 120, 103 + 150 / 0.7 / 20), plot = box(100, 103, 112, 112);
    input.blocks[0].poly = block; input.parcels[0].poly = plot;
    input.parcels.push({ poly: box(114, 103, 120, 111), block: 0, use: 'plot', zone: 'middle', front: [{ x: 114, y: 103 }, { x: 120, y: 103 }] });
    input.buildings = [
      { poly: box(100.1, 103.25, 110.1, 111.25), parcel: 0, kind: 'house', roof: 'gable' },
      { poly: box(114, 103, 120, 111), parcel: 1, kind: 'house', roof: 'gable' },
    ];
    input.eligible = (pi) => pi === 0;
    input.gardens = [box(100, 103, 112, 103.25), box(100, 111.25, 112, 112),
      box(100, 103.25, 100.1, 111.25), box(110.1, 103.25, 112, 111.25)];
    const before = structuredClone(input.buildings), owners = JSON.stringify([input.blocks, input.parcels]);
    const streetAt = makeStreetAt([{ path: input.streets.list[0].path, width: 6 }], []);
    expect(blockReach(block, before.map((b) => b.poly), streetAt).every(Boolean)).toBe(true);
    const result = densityFunctions.repairResidentialDensity(input), roof = input.buildings[0].poly;
    expect(result.groups[0].shortfall).toBeLessThanOrEqual(1e-6);
    expect(result.groups[0].after / result.groups[0].area).toBeGreaterThanOrEqual(0.7);
    expect(result.groups[0].after / result.groups[0].area).toBeLessThanOrEqual(0.85);
    expect(input.buildings).toHaveLength(2); expect(input.buildings[1]).toEqual(before[1]);
    expect({ ...input.buildings[0], poly: before[0].poly }).toEqual(before[0]);
    expect(JSON.stringify([input.blocks, input.parcels])).toBe(owners);
    expect(isRect(roof)).toBe(true); expect(area(roof)).toBeLessThanOrEqual(1.3 * area(before[0].poly) + 1e-6);
    expect(outside(before[0].poly, roof)).toBeLessThanOrEqual(1e-6);
    expect(outside(roof, plot)).toBeLessThanOrEqual(1e-6);
    expect(input.gardens.reduce((sum, p) => sum + area(p), 0) + area(roof)).toBeCloseTo(area(plot), 6);
    expect(blockReach(block, input.buildings.map((b) => b.poly), streetAt).every(Boolean)).toBe(true);
    assertAddedLandClear(before.map((b) => b.poly), input);
  });

  it('shares the original reserve tolerance across successive enlargements of the same roof', () => {
    const input = fixture(), block = box(100, 103, 120, 103 + 150 / 0.7 / 20), plot = box(100, 103, 112, 112);
    input.blocks[0].poly = block; input.parcels[0].poly = plot;
    input.parcels.push({ poly: box(114, 103, 120, 111), block: 0, use: 'plot', zone: 'middle', front: [{ x: 114, y: 103 }, { x: 120, y: 103 }] });
    input.buildings = [
      { poly: box(100.1, 103.25, 110.1, 111.25), parcel: 0, kind: 'house', roof: 'gable' },
      { poly: box(114, 103, 120, 111), parcel: 1, kind: 'house', roof: 'gable' },
    ];
    input.eligible = (pi) => pi === 0;
    input.gardens = [box(100, 103, 112, 103.25), box(100, 111.25, 112, 112),
      box(100, 103.25, 100.1, 111.25), box(110.1, 103.25, 112, 111.25)];
    // One thin L-shaped reserve touches the original roof. Successive proposals
    // extend into its two arms; they must share the same 1e-6 added-land allowance.
    const reserve: Polygon = [{ x: 100.1, y: 103.25 }, { x: 112, y: 103.25 },
      { x: 112, y: 103.25 + 4e-7 }, { x: 100.1 + 1.4e-6, y: 103.25 + 4e-7 },
      { x: 100.1 + 1.4e-6, y: 112 }, { x: 100.1, y: 112 }];
    input.protectedLand.push({ outer: reserve, holes: [] });
    const before = structuredClone(input.buildings), owners = JSON.stringify([input.blocks, input.parcels]);
    const reserves = JSON.stringify(input.protectedLand), commits: Polygon[] = [];
    let current = input.buildings[0].poly;
    // enlarged counts unique roofs, so observe actual committed proposals too.
    Object.defineProperty(input.buildings[0], 'poly', { enumerable: true,
      get: () => current, set: (poly: Polygon) => { current = poly; commits.push(structuredClone(poly)); },
    });
    const result = densityFunctions.repairResidentialDensity(input), roof = input.buildings[0].poly;
    expect(result.enlarged).toBe(1);
    expect(commits.length, 'the same roof must grow in more than one accepted proposal').toBeGreaterThan(1);
    const cumulative = commits.map((poly) => {
      const added = tryDifference(poly, before[0].poly); expect(added.failed).toBe(false);
      const hit = tryIntersection(added.pieces, reserve); expect(hit.failed).toBe(false);
      return mpArea(hit.pieces);
    });
    expect(cumulative[0], 'the reserve is actually contacted by the first enlargement').toBeGreaterThan(0);
    expect(cumulative.at(-1)!, 'a later enlargement must consume more of the same reserve allowance').toBeGreaterThan(cumulative[0]);
    for (const hit of cumulative) expect(hit, 'cumulative reserve allowance is measured from the original roof').toBeLessThanOrEqual(1e-6);
    expect(result.groups[0].after).toBeGreaterThan(result.groups[0].before);
    expect(result.groups[0].shortfall, 'physical clearance can prevent reaching the floor').toBeGreaterThan(0);
    expect(input.buildings).toHaveLength(2); expect(input.buildings[1]).toEqual(before[1]);
    expect({ ...input.buildings[0], poly: before[0].poly }).toEqual(before[0]);
    expect(JSON.stringify([input.blocks, input.parcels])).toBe(owners);
    expect(JSON.stringify(input.protectedLand)).toBe(reserves);
    expect(isRect(roof)).toBe(true); expect(area(roof)).toBeLessThanOrEqual(1.3 * area(before[0].poly) + 1e-6);
    expect(outside(before[0].poly, roof)).toBeLessThanOrEqual(1e-6);
    expect(outside(roof, plot)).toBeLessThanOrEqual(1e-6);
    expect(input.gardens.reduce((sum, p) => sum + area(p), 0) + area(roof)).toBeCloseTo(area(plot), 6);
    const streetAt = makeStreetAt([{ path: input.streets.list[0].path, width: 6 }], []);
    expect(blockReach(block, before.map((b) => b.poly), streetAt)).toEqual([true, true]);
    expect(blockReach(block, input.buildings.map((b) => b.poly), streetAt)).toEqual([true, true]);
    assertAddedLandClear(before.map((b) => b.poly), input);
  });

  it('keeps roofs and every garden when the remaining garden decomposition cannot be proved', () => {
    const input = fixture(), before = structuredClone([input.buildings, input.gardens]);
    const spy = vi.spyOn(plotFunctions, 'openHoles').mockReturnValue([]);
    try {
      const result = densityFunctions.repairResidentialDensity(input);
      expect(result.enlarged).toBe(0); expect(result.groups[0].shortfall).toBeGreaterThan(0);
      expect([input.buildings, input.gardens]).toEqual(before);
    } finally { spy.mockRestore(); }
  });

  it('refuses an unprovable physical clearance even when a boolean failure returns no pieces', () => {
    const input = fixture(), before = structuredClone(input.buildings);
    input.protectedLand.push(...tryDifference(input.parcels[0].poly, before[0].poly).pieces);
    const spy = vi.spyOn(booleanFunctions, 'tryIntersection').mockReturnValue({ pieces: [], failed: true });
    try {
      const result = densityFunctions.repairResidentialDensity(input);
      expect(result.enlarged).toBe(0); expect(input.buildings).toEqual(before);
      expect(result.groups[0].shortfall).toBeGreaterThan(0);
    } finally { spy.mockRestore(); }
  });

  it('leaves an already filled mature group byte-equivalent', () => {
    const input = fixture(); input.buildings[0].poly = box(100, 103, 110, 112);
    input.gardens = [box(110, 103, 112, 113), box(100, 112, 110, 113)];
    const before = JSON.stringify([input.blocks, input.parcels, input.buildings, input.gardens]);
    const result = densityFunctions.repairResidentialDensity(input);
    expect(result.enlarged).toBe(0); expect(result.groups[0].shortfall).toBe(0);
    expect(JSON.stringify([input.blocks, input.parcels, input.buildings, input.gardens])).toBe(before);
  });

  it('preserves the only narrow yard connection to a rear dwelling when the other vacant land is reserved', () => {
    const input = fixture(), poly = box(100, 103, 120, 133);
    input.blocks[0].poly = poly; input.parcels[0].poly = poly;
    input.buildings = [
      { poly: box(100, 103, 108, 108), parcel: 0, kind: 'house', roof: 'gable' },
      { poly: box(100, 113, 108, 118), parcel: 0, kind: 'back', roof: 'gable' },
      { poly: box(110, 103, 120, 133), parcel: 0, kind: 'barn', roof: 'gable' },
    ];
    input.gardens = [];
    input.protectedLand.push(...[box(100, 108, 108, 113), box(100, 118, 108, 133)].map((outer) => ({ outer, holes: [] })));
    const before = structuredClone(input.buildings.map((b) => b.poly)), streetAt = makeStreetAt([{ path: input.streets.list[0].path, width: 6 }], []);
    expect(blockReach(poly, before, streetAt).every(Boolean)).toBe(true);
    const result = densityFunctions.repairResidentialDensity(input);
    expect(input.buildings).toHaveLength(3);
    expect(blockReach(poly, input.buildings.map((b) => b.poly), streetAt).every(Boolean)).toBe(true);
    expect(result.groups[0].shortfall).toBeGreaterThan(0);
    assertAddedLandClear(before, input);
  });

  it('retains actual sparse culture targets, young garden gaps, specialised roof forms and internal courts', () => {
    for (const mode of ['sparse', 'edge', 'faubourg', 'village', 'special', 'court'] as const) {
      const input = fixture(), before = structuredClone(input.buildings);
      if (mode === 'sparse') input.morphology = () => ({ ...MORPHOLOGIES['european-organic'], coverage: { ...MORPHOLOGIES['european-organic'].coverage, middle: [0.3, 0.4] } });
      if (mode === 'edge' || mode === 'faubourg' || mode === 'village') input.blocks[0].zone = mode;
      if (mode === 'special') input.buildings[0].roof = 'pagoda';
      if (mode === 'court') input.buildings[0].courtyards = [box(103, 105, 106, 108)];
      const original = structuredClone(input.buildings), result = densityFunctions.repairResidentialDensity(input);
      expect(result.enlarged, mode).toBe(0); expect(input.buildings, mode).toEqual(original);
      if (mode === 'sparse') expect(result.groups[0].floor).toBe(0.3);
      expect(input.buildings.map((b) => b.poly)).toEqual(before.map((b) => b.poly));
    }
  });

  it('preserves already-dense town seed 3 and repairs a controlled deficit on its cloned partition', () => {
    const original = densityFunctions.repairResidentialDensity;
    let proof: { ownersBefore: string; ownersAfter: string; before: Polygon[]; metadata: string; input: DensityRepairPartition; result: ReturnType<typeof original> } | undefined;
    let controlled: DensityRepairPartition | undefined;
    const snapshot = (input: DensityRepairPartition): DensityRepairPartition => {
      const { ctx, eligible, morphology, streets, ...geometry } = input;
      const copy = { ...structuredClone(geometry), ctx, eligible, morphology, streets: new Streets() };
      copy.streets.list = structuredClone(streets.list); return copy;
    };
    const metadata = (input: DensityRepairPartition) => JSON.stringify(input.buildings.map(({ poly: _poly, ...detail }) => detail));
    const owners = (input: DensityRepairPartition) => {
      const partition = input as DensityRepairPartition & Pick<EdgeRoofPartition, 'quarters' | 'phases' | 'streetSpace' | 'footprint'>;
      return JSON.stringify([partition.blocks, partition.parcels, partition.quarters, partition.phases, partition.streetSpace, partition.footprint]);
    };
    const spy = vi.spyOn(densityFunctions, 'repairResidentialDensity').mockImplementation((input) => {
      controlled = { ...snapshot(input), allowInfill: false };
      const ownersBefore = owners(input), before = structuredClone(input.buildings.map((b) => b.poly)), beforeMetadata = metadata(input), result = original(input);
      // Later footprint finishing can split a roof. Snapshot this stage's output
      // while its dwelling indices still refer to the input being tested.
      proof = { ownersBefore, ownersAfter: owners(input), before, metadata: beforeMetadata, input: snapshot(input), result }; return result;
    });
    try {
      const world = generate(makeOptions({ seed: '3', size: 'town' })), u = world.urban!, middle = coverage(world).byPhase.get(2)!;
      expect(proof).toBeDefined();
      const group = proof!.result.groups.find((g) => g.phase === 2 && g.zone === 'middle')!;
      expect(group).toBeDefined(); expect(group.floor).toBe(0.7);
      expect(group.before / group.area, 'the current real programme already meets the mature density floor').toBeGreaterThanOrEqual(0.7);
      expect(group.after).toBe(group.before);
      expect(group.after / group.area).toBeGreaterThanOrEqual(0.7);
      expect(group.shortfall).toBeLessThanOrEqual(1e-6);
      expect(proof!.ownersAfter, 'plots, blocks, quarters, street gaps and phase frames stay byte-equivalent').toBe(proof!.ownersBefore);
      expect(proof!.input.buildings.length).toBeGreaterThanOrEqual(proof!.before.length);
      expect(metadata({ ...proof!.input, buildings: proof!.input.buildings.slice(0, proof!.before.length) }),
        'existing dwellings retain their producer architecture and parcel ownership').toBe(proof!.metadata);
      for (const b of proof!.input.buildings.slice(proof!.before.length)) {
        expect(b.kind).toBe('back');
        expect(area(b.poly)).toBeGreaterThanOrEqual(12);
        expect(area(b.poly)).toBeLessThanOrEqual(50);
        expect(outside(b.poly, proof!.input.parcels[b.parcel!].poly)).toBeLessThanOrEqual(1e-6);
      }
      expect(middle.area).toBeCloseTo(group.area, 6);
      expect(middle.built / middle.area).toBeGreaterThanOrEqual(0.7);
      expect(middle.built / middle.area).toBeLessThanOrEqual(0.85);
      for (const [i, b] of proof!.input.buildings.entries()) if (i < proof!.before.length && JSON.stringify(b.poly) !== JSON.stringify(proof!.before[i])) {
        expect(isRect(b.poly), `roof ${i} remains whole`).toBe(true);
        expect(outside(proof!.before[i], b.poly)).toBeLessThanOrEqual(1e-6);
        expect(area(b.poly)).toBeLessThanOrEqual(1.3 * area(proof!.before[i]) + 1e-6);
        expect(outside(b.poly, proof!.input.parcels[b.parcel!].poly)).toBeLessThanOrEqual(1e-6);
        const o = obb(b.poly); expect(2 * o.hv).toBeGreaterThanOrEqual(4.5 - 1e-6); expect(o.hu / o.hv).toBeLessThanOrEqual(3 + 1e-6);
      }
      // Final display masses must cover every finished roof, including any roof
      // split by the subsequent footprint pass; do not rely on density growth here.
      expect(u.buildings.length).toBeGreaterThan(0);
      for (const b of u.buildings) {
        const bb = bboxOf(b.poly), localMasses = u.masses.filter((m) => {
          const mb = bboxOf(m.outer); return bb.x0 < mb.x1 && mb.x0 < bb.x1 && bb.y0 < mb.y1 && mb.y0 < bb.y1;
        });
        const missingMass = tryDifference(b.poly, localMasses);
        expect(missingMass.failed).toBe(false); expect(mpArea(missingMass.pieces), 'render masses include every finished roof').toBeLessThanOrEqual(0.05);
      }
      assertAddedLandClear(proof!.before, proof!.input);
      expect(unreachableBuildings(world).n).toBe(0);
      const checks = checkWorld(world);
      expect(checks.overlapsBlocks + checks.overlapsPlots + checks.overlapsBuildings + checks.blockOutside + checks.bldgOutside).toBe(0);

      // The former deficit and roof-number regression no longer occurs in seed 3.
      // Create a separate, valid vacancy programme from the current input: remove
      // ordinary eligible dwellings until this same mature group first falls below
      // its unchanged floor, returning their footprints to open garden land.
      const input = controlled!, retainedWorld = JSON.stringify(world.urban);
      const ownersBefore = owners(input), roadsBefore = JSON.stringify(input.streets.list), reservesBefore = JSON.stringify(input.protectedLand);
      const isMiddle = (b: typeof input.buildings[number]) => {
        const block = b.parcel === undefined ? undefined : input.blocks[input.parcels[b.parcel].block];
        return block?.phase === 2 && block.zone === 'middle';
      };
      const candidates = input.buildings.map((b, i) => ({ b, i })).filter(({ b }) => isMiddle(b)
        && input.eligible(b.parcel!) && b.kind === 'house' && !b.courtyards?.length)
        .sort((a, b) => area(a.b.poly) - area(b.b.poly) || a.i - b.i);
      const removed = new Set<number>(); let built = group.before;
      for (const { b, i } of candidates) {
        if (built < group.floor * group.area) break;
        removed.add(i); built -= area(b.poly); input.gardens.push(b.poly);
      }
      expect(removed.size).toBeGreaterThan(0); expect(built / group.area).toBeLessThan(0.7);
      input.buildings = input.buildings.filter((_, i) => !removed.has(i));
      const fixtureWorld = { ...world, urban: { ...u, blocks: input.blocks.map((b) => b.poly), parcels: input.parcels, buildings: input.buildings } };
      const assertPartition = () => {
        const check = checkWorld(fixtureWorld);
        expect(check.overlapsBlocks + check.overlapsPlots + check.overlapsBuildings + check.blockOutside + check.bldgOutside).toBe(0);
        expect(check.blockAreaErr).toBeLessThanOrEqual(0.005);
        expect(unreachableBuildings(fixtureWorld).n).toBe(0);
      };
      assertPartition();
      const before = structuredClone(input.buildings), beforeMetadata = metadata(input), result = original(input);
      const repaired = result.groups.find((g) => g.phase === 2 && g.zone === 'middle')!;
      expect(repaired.before).toBeCloseTo(built, 6);
      expect(result.enlarged, 'the controlled fixture must actually exercise growth').toBeGreaterThan(0);
      expect(repaired.after).toBeGreaterThan(repaired.before);
      expect(repaired.shortfall).toBeCloseTo(Math.max(0, 0.7 * repaired.area - repaired.after), 6);
      expect(input.buildings).toHaveLength(before.length); expect(metadata(input)).toBe(beforeMetadata);
      expect(owners(input)).toBe(ownersBefore); expect(JSON.stringify(input.streets.list)).toBe(roadsBefore);
      expect(JSON.stringify(input.protectedLand)).toBe(reservesBefore);
      for (const [i, b] of input.buildings.entries()) if (JSON.stringify(b.poly) !== JSON.stringify(before[i].poly)) {
        expect(isRect(b.poly), `controlled roof ${i} remains whole`).toBe(true);
        expect(outside(before[i].poly, b.poly)).toBeLessThanOrEqual(1e-6);
        expect(area(b.poly)).toBeLessThanOrEqual(1.3 * area(before[i].poly) + 1e-6);
        expect(outside(b.poly, input.parcels[b.parcel!].poly)).toBeLessThanOrEqual(1e-6);
        const o = obb(b.poly); expect(2 * o.hv).toBeGreaterThanOrEqual(4.5 - 1e-6); expect(o.hu / o.hv).toBeLessThanOrEqual(3 + 1e-6);
      }
      // All sweeps share the clearance tolerance measured from each entry roof.
      assertAddedLandClear(before.map((b) => b.poly), input);
      assertPartition();
      expect(JSON.stringify(world.urban), 'the controlled repair cannot mutate the generated world').toBe(retainedWorld);
    } finally { spy.mockRestore(); }
  });
});
