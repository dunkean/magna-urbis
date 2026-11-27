import { describe, expect, it } from 'vitest';
import type { MoatCrossing, MoatReach, MoatRun, MoatSpec } from '../../rust/bridge/urban';
import { moatPlan, reachSupply } from '../src/render/moatLine';
import { moatDetailDrawn } from '../src/render/cityWalls';
import { MOAT_FILLS, MOAT_PARTS, moatBankRise, moatCut, moatFill, moatForm, moatFormOf, moatFreeboard, moatInk, moatPlanInk, moatWaterColour, type MoatPart } from '../src/render/moatModel';

const state = (zone: 'temperate' | 'desert' | 'nordic', season: number, snow = 0) => ({ zone, season, paint: { herb: [1, 1, 1] as const, leaf: 1, evergreen: 1, snow, spring: 0, autumn: 0, seaIce: 0, winter: 0 } });
const force = (value?: object): void => void ((globalThis as { __muMoat?: object }).__muMoat = value);

/** A straight run of `n` stations 6 m apart, its inner lip on y = 0 (the curtain to the north), its outer lip on y = 12. */
const straight = (n: number, reaches: MoatReach[] = [{ from: 0, to: n - 1, supply: 'fed', level: 8 }]): MoatRun => {
  const xs = Array.from({ length: n }, (_, i) => 6 * i);
  return { inner: xs.map(x => ({ x, y: 0 })), outer: xs.map(x => ({ x, y: 12 })), rim: xs.map(() => 10), bed: xs.map(() => 7), ends: ['water', 'work'], reaches };
};
/** A ring of `n` stations between radii 300 and 312 (about 1.9 km round), one dry reach. */
const ring = (n: number, reaches: MoatReach[] = [{ from: 0, to: 0, supply: 'dry' }]): MoatRun => {
  const at = (r: number, k: number) => ({ x: r * Math.cos((2 * Math.PI * k) / n), y: r * Math.sin((2 * Math.PI * k) / n) }),
    ks = Array.from({ length: n }, (_, k) => k);
  return { closed: true, inner: ks.map(k => at(300, k)), outer: ks.map(k => at(312, k)), rim: ks.map(() => 10), bed: ks.map(() => 7), ends: ['closed', 'closed'], reaches };
};
const spec = (runs: MoatRun[], crossings: MoatCrossing[] = []): MoatSpec => ({ form: 'earth', runs, crossings });
const earth = moatFormOf('earth');
const parts = (s: MoatSpec, level: 'far' | 'mid' | 'detail', form = earth): MoatPart[] => moatPlan(s, form, level).map(p => p.part);
const DETAIL: readonly MoatPart[] = ['fringe', 'reed', 'patch', 'lily', 'plotA', 'plotB', 'hatch', 'hatchFine'];

describe('moat model', () => {
  it('takes the form of the engine, else of the wall style', () => {
    expect(moatForm({ moat: { form: 'ceremonial' }, style: 'palisade' }).revetment).toBe('stone');
    expect(moatForm({ style: 'palisade' }).profile).toBe('v');
    expect(moatForm({}).profile).toBe('u');
  });
  it('cuts each form to its depth: a V to the middle, a revetted face at once, a double ditch with a middle ridge', () => {
    expect(moatCut(moatFormOf('fossa'), 3, 3, 6, 3)).toBeCloseTo(1.5);
    expect(moatCut(moatFormOf('fossa'), 3, 3, 6, 6)).toBeCloseTo(3);
    expect(moatCut(moatFormOf('revetted'), 3, 0.9, 6, 0.9)).toBeCloseTo(3);
    expect(moatCut(moatFormOf('double'), 3, 3, 6, 3)).toBeCloseTo(3);
    expect(moatCut(moatFormOf('double'), 3, 3, 6, 6)).toBeCloseTo(1.35);
    // The cunette of a bastioned ditch: a drain along the middle.
    expect(moatCut(moatFormOf('bastioned'), 6, 1.8, 12, 12)).toBeCloseTo(6.6);
  });
  it('fills a ditch by supply, climate, season and the state of the town', () => {
    expect(moatFill('wet', 0, earth, state('nordic', 0, 0.8))).toBe('ice');
    expect(moatFill('wet', 0, earth, state('desert', 0.5))).toBe('low');
    expect(moatFill('dry', 0, earth, state('desert', 0.5))).toBe('bare');
    expect(moatFill('tidal', 0, earth, state('temperate', 0.5))).toBe('tidal');
    // Nobody scours the moat of an abandoned town.
    expect([0, 1, 2].map(b => moatFill('wet', b, earth, state('temperate', 0.25), 'abandoned')).every(f => f === 'stagnant' || f === 'marsh')).toBe(true);
    // Low water leaves the banks bare; a dry ditch holds no sheet.
    expect(moatFreeboard('low', 3)!).toBeGreaterThan(moatFreeboard('full', 3)!);
    expect(moatFreeboard('grass', 3)).toBeUndefined();
  });
  it('gives a fed chain one fill, and lets dry reaches vary', () => {
    const fill = (supply: string, i: number): string => {
      const { kind, bucket } = reachSupply({ from: 0, to: 1, supply }, i);
      return moatFill(kind, bucket, earth, state('temperate', 0.5));
    };
    expect(new Set([0, 1, 2, 3].map(i => fill('fed', i))).size).toBe(1);
    expect(new Set([0, 1, 2, 3].map(i => fill('pool', i))).size).toBe(1);
    expect(new Set([0, 1, 2].map(i => fill('dry', i))).size).toBeGreaterThan(1);
  });
  it('draws nothing for a circuit without runs', () => {
    for (const level of ['far', 'mid', 'detail'] as const) {
      expect(moatPlan(undefined, earth, level)).toEqual([]);
      expect(moatPlan({ form: 'earth' }, earth, level)).toEqual([]);
      expect(moatPlan(spec([], [{ run: 0, path: [{ x: 0, y: -2 }, { x: 0, y: 15 }], half_width_m: 3, kind: 'causeway' }]), earth, level)).toEqual([]);
    }
  });
  it('draws the far level as one tinted bed polygon per reach, and nothing else', () => {
    const run = straight(40, [
      { from: 0, to: 12, supply: 'fed', level: 8 },
      { from: 12, to: 25, supply: 'fed', level: 7 },
      { from: 25, to: 39, supply: 'dry' },
    ]);
    const far = moatPlan(spec([run, ring(120)]), earth, 'far');
    expect(far.map(p => p.part)).toEqual(['wash', 'wash', 'wash', 'wash']);
    expect(far.map(p => p.kind)).toEqual(['wet', 'wet', 'dry', 'dry']);
    // The one reach of a ring is the whole ring, with the inner lips as its hole.
    expect(far[3].shape.holes).toHaveLength(1);
    expect(far[3].shape.outer).toHaveLength(120);
  });
  it('adds scarp strips lit and shaded by the plan light at the mid level, and no detail', () => {
    const mid = moatPlan(spec([straight(40)]), earth, 'mid');
    expect(mid.filter(p => p.part === 'bed')).toHaveLength(1);
    expect(mid.some(p => DETAIL.includes(p.part) || p.part === 'wash')).toBe(false);
    // Light from the north-west: the north bank (the inner lip, y = 0) is in shade, the south one lit; each at most 30 % of the width.
    const shade = mid.filter(p => p.part === 'shade'),
      lit = mid.filter(p => p.part === 'lit');
    expect(shade).toHaveLength(1);
    expect(lit).toHaveLength(1);
    expect(shade[0].shape.outer.every(q => q.y <= 3.6 + 1e-9)).toBe(true);
    expect(lit[0].shape.outer.every(q => q.y >= 12 - 3.6 - 1e-9)).toBe(true);
    // In draw order.
    const order = mid.map(p => MOAT_PARTS.indexOf(p.part));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('keeps the mid level to a few dozen polygons on a long winding run', () => {
    const mid = moatPlan(
      spec([
        ring(300, [
          { from: 0, to: 100, supply: 'fed', level: 8 },
          { from: 100, to: 200, supply: 'fed', level: 7 },
          { from: 200, to: 0, supply: 'dry' },
        ]),
      ]),
      moatFormOf('fossa'),
      'mid',
    );
    expect(mid.length).toBeLessThan(60);
    expect(mid.filter(p => p.part === 'bed')).toHaveLength(3);
    // The outer bank of a fossa.
    expect(mid.some(p => p.part === 'ridgeLit') && mid.some(p => p.part === 'ridgeShade')).toBe(true);
  });
  it('adds restrained detail close up: lilies in wet reaches, plots in dry ones, fringe and reeds only where the fill has them', () => {
    const run = straight(40, [
        { from: 0, to: 19, supply: 'fed', level: 8 },
        { from: 19, to: 39, supply: 'dry' },
      ]),
      detail = moatPlan(spec([run]), earth, 'detail');
    expect(detail.every(p => DETAIL.includes(p.part))).toBe(true);
    expect(detail.filter(p => p.part === 'fringe')).toHaveLength(4);
    expect(detail.some(p => p.part === 'reed')).toBe(true);
    expect(detail.filter(p => p.part === 'lily').every(p => p.kind === 'wet')).toBe(true);
    expect(detail.filter(p => p.part === 'plotA' || p.part === 'plotB').every(p => p.kind === 'dry')).toBe(true);
    expect(detail.some(p => p.part === 'plotA')).toBe(true);
    const alpha = (fill: string, part: MoatPart): number => {
      force({ fill });
      const k = moatInk(part, 'wet', 0, earth, '#3f8fc0').alpha;
      force(undefined);
      return k;
    };
    expect(alpha('garden', 'reed')).toBe(0);
    expect(alpha('garden', 'fringe')).toBe(0);
    expect(alpha('ice', 'fringe')).toBeGreaterThan(0);
    expect(alpha('marsh', 'reed')).toBeGreaterThan(0);
    expect(alpha('marsh', 'patch')).toBeGreaterThan(0);
    expect(alpha('full', 'patch')).toBe(0);
    expect(alpha('full', 'lily')).toBeGreaterThan(0);
    expect(alpha('low', 'channel')).toBeGreaterThan(0);
    expect(alpha('full', 'channel')).toBe(0);
  });
  it('keeps each hachure thin and on its own scarp: a clear bed parts the two sides of a narrow ditch', () => {
    const base = straight(20),
      run: MoatRun = { ...base, outer: base.inner.map(p => ({ x: p.x, y: 8 })) },
      hatches = moatPlan(spec([run]), earth, 'detail').filter(p => p.part === 'hatch' || p.part === 'hatchFine');
    expect(hatches.some(p => p.part === 'hatch') && hatches.some(p => p.part === 'hatchFine')).toBe(true);
    for (const h of hatches) {
      const xs = h.shape.outer.map(q => q.x),
        ys = h.shape.outer.map(q => q.y);
      // At most 30 % of the 8 m width from its lip: y <= 2.4 under the curtain (y = 0), y >= 5.6 from the counterscarp (y = 8).
      expect(Math.max(...ys) <= 2.4 + 1e-9 || Math.min(...ys) >= 5.6 - 1e-9).toBe(true);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(h.part === 'hatch' ? 0.35 : 0.25);
    }
  });
  it('draws no near-view detail, hence no hachure, on a plan draped over a ground that digs the moats', () => {
    expect(moatDetailDrawn('near') && moatDetailDrawn('close')).toBe(true);
    expect(moatDetailDrawn('near', true) || moatDetailDrawn('close', true)).toBe(false);
    // The hachures belong to the detail level alone.
    for (const level of ['far', 'mid'] as const) expect(parts(spec([straight(40)]), level).some(p => p.startsWith('hatch'))).toBe(false);
  });
  it('fills a causeway across the ditch over its bed and banks; a bridge needs nothing', () => {
    const path = [
        { x: 120, y: -1 },
        { x: 120, y: 15 },
      ],
      causeway = moatPlan(spec([straight(40)], [{ run: 0, path, half_width_m: 3, kind: 'causeway', gate: 0 }]), earth, 'mid'),
      bridge = moatPlan(spec([straight(40)], [{ run: 0, path, half_width_m: 3, kind: 'bridge', gate: 0 }]), earth, 'mid');
    expect(causeway.at(-1)!.part).toBe('causeway');
    const xs = causeway.at(-1)!.shape.outer.map(q => q.x);
    expect(Math.min(...xs)).toBeCloseTo(117);
    expect(Math.max(...xs)).toBeCloseTo(123);
    expect(bridge.some(p => p.part === 'causeway')).toBe(false);
    expect(parts(spec([straight(40)], [{ run: 0, path, half_width_m: 3, kind: 'causeway' }]), 'far')).toEqual(['wash', 'causeway']);
  });
  it('gives each fill its own bed, and no fill the blue of the map water', () => {
    const water = '#3f8fc0',
      beds = MOAT_FILLS.map(f => {
        force({ fill: f });
        return moatInk('bed', 'wet', 0, earth, water).fill;
      });
    force(undefined);
    expect(new Set(beds).size).toBe(MOAT_FILLS.length);
    expect(beds).not.toContain(water);
    expect(moatWaterColour('full', water)).not.toBe(water);
  });
  it('inks the mid level of an engraved plan with the bed wash and the shaded scarp only', () => {
    const mid = new Set(parts(spec([straight(40), ring(120)]), 'mid', moatFormOf('fossa')));
    for (const fill of MOAT_FILLS) {
      force({ fill });
      const inked = [...mid].filter(p => moatPlanInk(p, 'wet', 0, moatFormOf('fossa'), '#bccbc8', '#d8c79a', '#3b2c1c').alpha > 0);
      expect(inked.sort()).toEqual(['bed', 'shade']);
    }
    force(undefined);
  });
  it('raises an outer bank only where the form throws one up', () => {
    expect(moatBankRise(moatFormOf('fossa'), 1.5)).toBeCloseTo(0.9);
    expect(moatBankRise(moatFormOf('fossa'), 3.5)).toBe(0);
    expect(moatBankRise(moatFormOf('revetted'), 1.5)).toBe(0);
  });
});
