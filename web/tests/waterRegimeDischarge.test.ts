import { describe, expect, it } from 'vitest';
import { dischargeSize, meanDischarge, riverState, threadShare, waterClimate } from '../src/render/waterRegime';

describe('water regime by absolute discharge', () => {
  it('fills the bed in humid climates and leaves a thread in dry ones (square root of the runoff)', () => {
    expect(threadShare(289)).toBe(1); // temperate preset
    expect(threadShare(210)).toBe(1); // continental, the driest humid preset
    expect(threadShare(97)).toBeCloseTo(.70, 2); // mediterranean
    expect(threadShare(1.4)).toBeCloseTo(.084, 3); // desert
  });
  it('dries a desert trunk of 123 km2 (5.5 L/s) in every season, keeps a temperate brook running', () => {
    const q = meanDischarge(123.5e6, 1.4);
    expect(q).toBeCloseTo(.0055, 4);
    expect(dischargeSize(q)).toBe(0);
    for (const season of [0, .25, .5, .75]) expect(riverState(waterClimate({ zone: 'desert', season }), dischargeSize(q)).dry).toBeGreaterThan(.85);
    expect(riverState(waterClimate({ zone: 'temperate', season: .5 }), dischargeSize(meanDischarge(.05e6, 289))).dry).toBe(0);
  });
  it('keeps a large exotic river perennial in a desert', () => {
    expect(riverState(waterClimate({ zone: 'desert', season: .5 }), dischargeSize(20)).dry).toBeLessThan(.4);
  });
});
