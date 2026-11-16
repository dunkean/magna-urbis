import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { recommendedCounts, recommendedCulture, settlementEnvironment } from '../src/v2/settlementDefaults';
import { plausibleCultures } from '../src/v2/environmentCultures';

describe('workbench environmental settlement suggestions', () => {
  it('scales counts with land area and density, and makes hostile terrain less populated', () => {
    const settings = defaultSettings(); settings.extent = 20000; settings.terrain!.relief = 'flat';
    const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
    const plain = total(recommendedCounts(settings));
    expect(total(recommendedCounts(settings, 2))).toBeGreaterThan(plain);
    expect(total(recommendedCounts(settings, 0))).toBe(0);
    settings.extent = 40000;
    const larger = total(recommendedCounts(settings));
    expect(larger).toBeGreaterThan(plain);
    // Four times the surface/population should grow the centres, not quadruple sites.
    expect(larger).toBeLessThan(plain * 3);
    settings.extent = 20000; settings.terrain!.relief = 'high-mountains'; settings.options.biome = 'desert';
    expect(total(recommendedCounts(settings))).toBeLessThan(plain / 5);
  });
  it('draws among plausible desert mountain cultures when environmental follow is requested', () => {
    const settings = defaultSettings(); settings.terrain!.relief = 'mountains'; settings.options.biome = 'desert';
    const choices = plausibleCultures(settings);
    expect(choices).toContain('persian');
    expect(choices).not.toContain('european-organic');
    for (let i = 0; i < choices.length; i++) {
      expect(recommendedCulture(settings, () => (i + .5) / choices.length)).toBe(choices[i]);
    }
  });
  it('detects layer and coastline changes even when the stored climate stays the same', () => {
    const settings = defaultSettings(); settings.terrain!.climate = 'temperate';
    const surface = settlementEnvironment(settings);
    settings.options.biome = 'underdark';
    expect(settlementEnvironment(settings)).not.toBe(surface);
    settings.options.biome = 'temperate'; settings.terrain!.coastMask = 0;
    expect(settlementEnvironment(settings)).not.toBe(surface);
  });
  it('returns bounded integer counts without mutating a recipe', () => {
    const settings = defaultSettings(); settings.extent = 200000;
    const before = structuredClone(settings);
    for (const n of Object.values(recommendedCounts(settings, 3))) {
      expect(Number.isInteger(n)).toBe(true); expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1000);
    }
    expect(settings).toEqual(before);
  });
});
