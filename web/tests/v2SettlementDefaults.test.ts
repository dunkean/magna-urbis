import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { recommendedCounts, recommendedCulture } from '../src/v2/settlementDefaults';
import { CULTURES } from '../src/gen/options';

describe('workbench environmental settlement suggestions', () => {
  it('scales counts with land area and density, and makes hostile terrain less populated', () => {
    const settings = defaultSettings(); settings.extent = 20000; settings.terrain!.relief = 'flat';
    const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
    const plain = total(recommendedCounts(settings));
    expect(total(recommendedCounts(settings, 2))).toBeGreaterThan(plain);
    expect(total(recommendedCounts(settings, 0))).toBe(0);
    settings.extent = 40000;
    expect(total(recommendedCounts(settings))).toBeGreaterThan(plain * 3);
    settings.extent = 20000; settings.terrain!.relief = 'high-mountains'; settings.options.biome = 'desert';
    expect(total(recommendedCounts(settings))).toBeLessThan(plain / 5);
  });
  it('suggests Persian towns for desert mountains and preserves non-medieval scenarios', () => {
    const settings = defaultSettings(); settings.terrain!.relief = 'mountains'; settings.options.biome = 'desert';
    expect(recommendedCulture(settings)).toBe('persian');
    expect(CULTURES).toContain(recommendedCulture(settings));
    for (const culture of ['american-grid', 'cyberpunk', 'roman-core', 'dwarven', 'elven']) {
      settings.options.culture = culture; expect(recommendedCulture(settings)).toBeUndefined();
    }
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
