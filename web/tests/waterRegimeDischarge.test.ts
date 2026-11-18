import { describe, expect, it } from 'vitest';
import { dischargeSize, meanDischarge, riverState, threadShare, waterClimate } from '../src/render/waterRegime';

describe('water regime by absolute discharge', () => {
  it('fills the bed in humid climates and leaves a thread in dry ones (square root of the runoff)', () => {
    expect(threadShare(289)).toBe(1); // temperate preset
    expect(threadShare(210)).toBe(1); // continental, the driest humid preset
    expect(threadShare(97)).toBeCloseTo(0.7, 2); // mediterranean
    expect(threadShare(1.4)).toBeCloseTo(0.084, 3); // desert
  });
  it('dries a desert trunk of 123 km2 (5.5 L/s) in every season, keeps a temperate brook running', () => {
    const q = meanDischarge(123.5e6, 1.4);
    expect(q).toBeCloseTo(0.0055, 4);
    expect(dischargeSize(q)).toBe(0);
    for (const season of [0, 0.25, 0.5, 0.75]) expect(riverState(waterClimate({ zone: 'desert', season }), dischargeSize(q)).dry).toBeGreaterThan(0.85);
    expect(riverState(waterClimate({ zone: 'temperate', season: 0.5 }), dischargeSize(meanDischarge(0.05e6, 289))).dry).toBe(0);
  });
  it('keeps a large exotic river perennial in a desert', () => {
    expect(riverState(waterClimate({ zone: 'desert', season: 0.5 }), dischargeSize(20)).dry).toBeLessThan(0.4);
  });
});
