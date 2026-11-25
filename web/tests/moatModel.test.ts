import { describe, expect, it } from 'vitest';
import { MOAT_FILLS, moatBankRise, moatCut, moatFill, moatForm, moatFormOf, moatFreeboard, moatInk, moatOuterEdges, moatParts, moatWaterColour, moatWidth } from '../src/render/moatModel';

const band = {
  kind: 'wet',
  height_m: 3,
  shape: {
    outer: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 12 },
      { x: 0, y: 12 },
    ],
    holes: [],
  },
};
const state = (zone: 'temperate' | 'desert' | 'nordic', season: number, snow = 0) => ({ zone, season, paint: { herb: [1, 1, 1] as const, leaf: 1, evergreen: 1, snow, spring: 0, autumn: 0, seaIce: 0, winter: 0 } });
const force = (value?: object): void => void ((globalThis as { __muMoat?: object }).__muMoat = value);

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
    const form = moatFormOf('earth');
    expect(moatFill('wet', 0, form, state('nordic', 0, 0.8))).toBe('ice');
    expect(moatFill('wet', 0, form, state('desert', 0.5))).toBe('low');
    expect(moatFill('dry', 0, form, state('desert', 0.5))).toBe('bare');
    expect(moatFill('tidal', 0, form, state('temperate', 0.5))).toBe('tidal');
    expect(new Set([0, 1, 2].map(b => moatFill('wet', b, form, state('temperate', 0.5)))).size).toBe(3);
    // Nobody scours the moat of an abandoned town.
    expect([0, 1, 2].map(b => moatFill('wet', b, form, state('temperate', 0.25), 'abandoned')).every(f => f === 'stagnant' || f === 'marsh')).toBe(true);
    // Low water leaves the banks bare; a dry ditch holds no sheet.
    expect(moatFreeboard('low', 3)!).toBeGreaterThan(moatFreeboard('full', 3)!);
    expect(moatFreeboard('grass', 3)).toBeUndefined();
  });
  it('builds a bed, a lit and a shaded scarp for a piece, and no bank on an edge two pieces share', () => {
    const parts = moatParts([band], moatFormOf('earth'));
    expect(parts[0]).toMatchObject({ part: 'bed', kind: 'wet' });
    // Light from the north-west: the north bank (y = 0) is in shade, the south one lit.
    expect(parts.filter(p => p.part === 'shade').some(p => p.shape.outer.every(q => q.y < 6))).toBe(true);
    expect(parts.filter(p => p.part === 'lit').some(p => p.shape.outer.every(q => q.y > 6))).toBe(true);
    // Everything of a piece stays within its mean width of it (plots, shoals, channel, hachures).
    expect(parts.every(p => p.shape.outer.every(q => q.x > -3 && q.x < 83 && q.y > -3 && q.y < 15))).toBe(true);
    const next = {
      ...band,
      shape: {
        outer: [
          { x: 80, y: 0 },
          { x: 160, y: 0 },
          { x: 160, y: 12 },
          { x: 80, y: 12 },
        ],
        holes: [],
      },
    };
    const scarps = moatParts([band, next], moatFormOf('earth')).filter(p => p.part === 'bank' || p.part === 'lit' || p.part === 'shade');
    expect(scarps.some(p => p.shape.outer.length === 4 && p.shape.outer.filter(q => q.x === 80).length >= 2 && p.shape.outer.every(q => q.x >= 76 && q.x <= 84))).toBe(false);
  });
  it('gives each fill its own bed, and no fill the blue of the map water', () => {
    const water = '#3f8fc0',
      beds = MOAT_FILLS.map(f => {
        force({ fill: f });
        return moatInk('bed', 'wet', 0, moatFormOf('earth'), water).fill;
      });
    force(undefined);
    expect(new Set(beds).size).toBe(MOAT_FILLS.length);
    expect(beds).not.toContain(water);
    expect(moatWaterColour('full', water)).not.toBe(water);
  });
  it('measures a ditch between its banks, whatever juts into it', () => {
    // A 12 m band along a curtain at y = -3, with a tower 6 m square jutting in: the outline is longer, the ditch as broad.
    const jutted = {
        ...band,
        shape: {
          outer: [
            { x: 0, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 6 },
            { x: 36, y: 6 },
            { x: 36, y: 0 },
            { x: 80, y: 0 },
            { x: 80, y: 12 },
            { x: 60, y: 12 },
            { x: 40, y: 12 },
            { x: 20, y: 12 },
            { x: 0, y: 12 },
          ],
          holes: [],
        },
      },
      curtain = [
        { x: -10, y: -3 },
        { x: 90, y: -3 },
      ];
    expect(moatWidth(jutted, moatOuterEdges(jutted, curtain))).toBeCloseTo(12);
    expect(moatWidth(jutted)).toBeLessThan(11);
  });
  it('raises an outer bank only where the form throws one up', () => {
    expect(moatBankRise(moatFormOf('fossa'), 1.5)).toBeCloseTo(0.9);
    expect(moatBankRise(moatFormOf('fossa'), 3.5)).toBe(0);
    expect(moatBankRise(moatFormOf('revetted'), 1.5)).toBe(0);
  });
});
