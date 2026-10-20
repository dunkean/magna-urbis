import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { generate } from '../src/gen/pipeline';
import { makeOptions } from '../src/gen/options';
import { Rng } from '../src/gen/core/rng';
import { buildCompound } from '../src/gen/urban/compounds';
import * as compounds from '../src/gen/urban/compounds';
import * as densityRepair from '../src/gen/urban/densityRepair';
import { registerM4 } from '../src/gen/urban/m4';
import { FROZEN_SHANTY_CELLS } from './fixtures/shanty-cells';
import { area, isSimple, obb } from '../src/gen/geo/poly';
import { polyInside } from '../src/gen/geo/split';
import { burgageHouse } from '../src/gen/urban/houses';
import { MORPHOLOGIES } from '../src/gen/urban/morphology';
import type { Plot } from '../src/gen/urban/plots';
import { coverage } from './coverage';
import { unreachableBuildings } from './accessCheck';

// Regional roads and clustered siting determine the current lots and these seeded counts. Each case also
// checks the actual compound output against the final huts; 53 historical cells preserve the original producer.
const HUT_CASES = [
  { seed: '1', count: 259 }, { seed: '2', count: 113 }, { seed: '3', count: 256 },
  { seed: '4', count: 373 }, { seed: '5', count: 668 }, { seed: '6', count: 834 },
];

const FADE = 0.9, FADE_CHANCE = 0.5 * Math.pow(FADE, 1.4);
class FadeGapRng extends Rng {
  fadeDraws = 0;
  constructor(private readonly skip: boolean) { super('density-health'); }
  chance(p: number): boolean {
    const value = super.chance(p);
    if (this.fadeDraws === 0 && Math.abs(p - FADE_CHANCE) < 1e-12) {
      this.fadeDraws++;
      return this.skip;
    }
    return value;
  }
}

function edgePlot(zone: Plot['zone']): Plot {
  const poly = [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 40 }, { x: 0, y: 40 }];
  return {
    poly, zone, block: 0, front: [poly[0], poly[1]], nrm: { x: 0, y: 1 },
    sideA: { p: poly[0], d: { x: 0, y: 1 } }, sideB: { p: poly[1], d: { x: 0, y: 1 } },
    rank: 2, depth: 40, wide: true, sideFronts: [], run: 0, order: 0, wealth: 0.5, fade: FADE,
  };
}

describe('density producer contracts survive late styling and edge fading', () => {
  it('preserves all 53 formerly narrow huts on their exact original cells regardless of later regional-road changes', () => {
    registerM4();
    expect(FROZEN_SHANTY_CELLS.reduce((n, f) => n + f.cells.length, 0)).toBe(53);
    for (const fixture of FROZEN_SHANTY_CELLS) {
      const out = buildCompound('m4-shanty', fixture.poly, { rng: new Rng(fixture.rngKey), angle: 0, pop: 10000, center: fixture.center });
      for (const cell of fixture.cells) {
        expect(out.parcels[cell.index].poly, `seed ${fixture.seed} original block ${fixture.block} cell ${cell.index}`).toEqual(cell.poly);
        const huts = out.buildings.filter((b) => b.kind === 'hut' && b.parcel === cell.index);
        expect(huts, 'styling preserves the original dwelling').toHaveLength(1);
        const h = huts[0], o = obb(h.poly);
        expect({ poly: h.poly, arch: h.arch }, 'approved producer footprint and architecture on the historical centre').toEqual(cell.hut);
        expect(isSimple(h.poly)).toBe(true);
        expect(polyInside(cell.poly, h.poly)).toBe(true);
        expect(2 * o.hv).toBeGreaterThanOrEqual(4.5 - 1e-6);
        expect(o.hu / o.hv).toBeLessThanOrEqual(3 + 1e-6);
        expect(area(h.poly)).toBeGreaterThanOrEqual(15 - 1e-6);
        expect(area(h.poly)).toBeLessThanOrEqual(40.5);
      }
    }
  });

  for (const fixture of HUT_CASES) it(`city seed ${fixture.seed} retains its huts with usable final footprints`, () => {
    const original = compounds.buildCompound;
    const produced: { lot: Parameters<typeof original>[1]; out: ReturnType<typeof original> }[] = [];
    let mainSettlement = true;
    const spy = vi.spyOn(compounds, 'buildCompound').mockImplementation((kind, lot, context) => {
      const out = original(kind, lot, context);
      if (mainSettlement && kind === 'm4-shanty') produced.push(structuredClone({ lot, out }));
      return out;
    });
    let world: ReturnType<typeof generate>;
    try {
      world = generate(makeOptions({ size: 'city', seed: fixture.seed }), (stage) => {
        if (stage === 'settlements') mainSettlement = false;
      });
    }
    finally { spy.mockRestore(); }
    const u = world.urban!;
    const huts = u.buildings.filter((b) => b.kind === 'hut');
    expect(huts, 'fix styling without deleting dwellings').toHaveLength(fixture.count);
    expect(produced.length).toBeGreaterThan(0);
    expect(produced).toHaveLength(u.blockInfo.filter((b) => b.kind === 'shanty').length);
    for (const { lot, out } of produced) {
      const block = u.blocks.findIndex((b) => JSON.stringify(b) === JSON.stringify(lot));
      expect(block, 'the producer lot survives as a complete shanty block').toBeGreaterThanOrEqual(0);
      expect(u.blockInfo[block].kind).toBe('shanty');
      const parcels = u.parcels.map((p, i) => ({ p, i })).filter(({ p }) => p.block === block);
      expect(parcels.map(({ p }) => ({ poly: p.poly, use: p.use }))).toEqual(out.parcels);
      const localParcel = new Map(parcels.map(({ i }, local) => [i, local]));
      const shape = (b: typeof huts[number]) => ({ poly: b.poly, arch: b.arch, roof: b.roof, material: b.material, storeys: b.storeys });
      const before = out.buildings.filter((b) => b.kind === 'hut').map((b) => ({ parcel: b.parcel, ...shape(b) }));
      const after = huts.filter((h) => u.parcels[h.parcel!].block === block).map((h) => ({ parcel: localParcel.get(h.parcel!), ...shape(h) }));
      expect(after, 'every produced dwelling keeps its footprint, architecture and owning cell').toEqual(before);
    }
    for (const h of huts) {
      expect(h.parcel).toBeDefined();
      const pc = u.parcels[h.parcel!], o = obb(h.poly);
      expect(pc.use).toBe('hut-lot');
      expect(isSimple(h.poly), `hut ${h.parcel} is simple`).toBe(true);
      expect(polyInside(pc.poly, h.poly), `hut ${h.parcel} stays in its own cell`).toBe(true);
      expect(2 * o.hv, `hut ${h.parcel} minimum width`).toBeGreaterThanOrEqual(4.5 - 1e-6);
      expect(o.hu / o.hv, `hut ${h.parcel} maximum aspect`).toBeLessThanOrEqual(3 + 1e-6);
      expect(area(h.poly)).toBeGreaterThanOrEqual(15 - 1e-6);
      expect(area(h.poly)).toBeLessThanOrEqual(40.5);
    }
    for (let i = 0; i < u.blocks.length; i++) if (u.blockInfo[i].kind === 'shanty') {
      const built = huts.filter((h) => u.parcels[h.parcel!].block === i).reduce((sum, h) => sum + area(h.poly), 0);
      expect(built / area(u.blocks[i]), `shanty block ${i} coverage`).toBeGreaterThanOrEqual(0.5);
      expect(built / area(u.blocks[i]), `shanty block ${i} coverage`).toBeLessThanOrEqual(0.7);
    }
  });

  for (const zone of ['core', 'middle'] as const) it(`${zone} edge keeps a dwelling and its existing random sequence`, () => {
    const rngA = new FadeGapRng(true), rngB = new FadeGapRng(false);
    const a = burgageHouse(edgePlot(zone), 0.6, MORPHOLOGIES['european-organic'], rngA);
    const b = burgageHouse(edgePlot(zone), 0.6, MORPHOLOGIES['european-organic'], rngB);
    expect(rngA.fadeDraws).toBe(1);
    expect(rngB.fadeDraws).toBe(1);
    expect(a).toEqual(b);
    expect(a.some((building) => building.kind === 'house')).toBe(true);
    expect(a.some((building) => building.kind === 'garden')).toBe(true);
    for (const building of a) expect(polyInside(edgePlot(zone).poly, building.poly)).toBe(true);
  });

  it('retains whole-plot garden gaps in the actual faubourg transition', () => {
    const rng = new FadeGapRng(true), pl = edgePlot('faubourg');
    const buildings = burgageHouse(pl, 0.6, MORPHOLOGIES['european-organic'], rng);
    expect(rng.fadeDraws).toBe(1);
    expect(buildings).toHaveLength(1);
    expect(buildings[0].kind).toBe('garden');
    expect(area(buildings[0].poly)).toBeCloseTo(area(pl.poly), 6);
  });

  it('town seed 3 reaches the original middle density target without reclaiming access or changing its plots', () => {
    const original = densityRepair.repairResidentialDensity;
    let owners: { before: string; after: string } | undefined;
    let mainSettlement = true;
    const spy = vi.spyOn(densityRepair, 'repairResidentialDensity').mockImplementation((input) => {
      const before = JSON.stringify([input.blocks, input.parcels]);
      const result = original(input);
      // Later footprint finalization may alter ownership. Capture this stage's own contract at its return.
      if (mainSettlement) owners = { before, after: JSON.stringify([input.blocks, input.parcels]) };
      return result;
    });
    let w: ReturnType<typeof generate>;
    try {
      w = generate(makeOptions({ seed: '3', size: 'town' }), (stage) => {
        if (stage === 'settlements') mainSettlement = false;
      });
    }
    finally { spy.mockRestore(); }
    const u = w.urban!;
    expect(owners).toBeDefined();
    expect(owners!.after, 'density repair preserves its complete incoming block and plot ownership').toBe(owners!.before);
    expect(createHash('sha256').update(JSON.stringify(u)).digest('hex'))
      .toBe('ee56c57829fb44b15a02bdaa4c4215ce2e6419a8280591efc747fabcac4eb58f');
    const middle = coverage(w).byPhase.get(2)!;
    expect(middle.zone).toBe('middle');
    // The current road and port programme defines this final denominator and its 166 residential plots.
    expect(middle.area, 'current programme and final roof ownership').toBeCloseTo(64080.190392793855, 6);
    const middlePlots = u.parcels.filter((p) => u.blockInfo[p.block].phase === 2 && u.blockInfo[p.block].kind === 'block');
    expect(middlePlots).toHaveLength(166);
    expect(middlePlots.every((p) => p.use === 'plot')).toBe(true);
    expect(middle.built / middle.area).toBeGreaterThanOrEqual(0.7);
    expect(middle.built / middle.area).toBeLessThanOrEqual(0.85);
    expect(unreachableBuildings(w).n, 'density gain keeps real street and courtyard access').toBe(0);
    // Automatic roadside extensions are optional; seed3 has none. Forced some/many have separate access tests.
    expect(Number(w.stats['urban.openFringe.quarters'] ?? 0)).toBe(0);
  });
});
